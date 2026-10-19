<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Db;
use Optic\Roles;
use PDO;
use PDOException;

/**
 * แก้ไข / ยกเลิกการเบิกของร้านเอง (TimeOptic) — แถว "จ่ายออก" ที่ไม่ผูกสาขา
 *
 * ร้านถามไว้ 12 ก.ย. 2026: "ถ้า TimeOptic เบิกผิดแก้อย่างไร ไม่มีที่แก้ให้เลย" · ฝั่งสาขา
 * แก้และยกเลิกได้ที่หน้าการเบิกจากสาขา (`Settlement`) ฝั่งร้านเองไม่มีอะไรเลย ·
 * เส้นแบ่งเดียวกับฝั่งสาขา: **อะไรที่แก้แล้วของบนชั้นไม่ขยับ แก้ได้**
 *
 *   แก้ได้     เลขเอกสาร · หมายเหตุ · ผู้เบิก
 *   แก้ไม่ได้  สินค้า · จำนวน — ของที่ตัดออกจากล็อตไปแล้ว คีย์ผิดต้องยกเลิกแล้วเบิกใหม่
 *
 * ยกเลิก = คืนของเข้าล็อตเดิมตามจำนวนเดิม พร้อมแถว RETURN ที่ชี้กลับมาด้วย
 * `reverses_log_id` (035) ซึ่งเป็น UNIQUE — ฐานข้อมูลเองไม่ยอมให้คืนแถวเดียวกันสองรอบ
 *
 * สองกรณีที่ไม่ให้ทำทางนี้:
 *   ใบของสาขา        มีหน้าของตัวเอง และมีใบหนี้ที่ต้องปิดไปพร้อมกัน
 *   ของที่ตัดตามเคส  ต้องแก้ที่หน้าเคส (เปิดขั้นการขายกลับมาแก้) · คืนจากฝั่งคลังแล้ว
 *                    `case_stock_issues` ยังเชื่อว่าของอยู่กับลูกค้า เคสกับคลังจะไม่ตรงกัน
 *
 * สิทธิ์ชุดเดียวกับการแก้ใบของสาขา (`branch.settle` — เจ้าของร้าน Superuser ฝ่ายบัญชี)
 * ตามที่ร้านเลือกไว้ · ผู้ดูแลคลังเบิกได้ แต่แก้ย้อนหลังต้องผ่านคนกลุ่มนั้น
 *
 * ── ของเสีย (SCRAP) ยกเลิกได้ด้วย — ร้านขอไว้ 14 ก.ย. 2026 ──────────────────────
 * ตัดของเสียผิดตัวหรือของไม่ได้เสียจริง ต้องคืนของได้เหมือนการเบิก · ยกเลิกได้อย่างเดียว
 * แก้รายละเอียดไม่ได้ เพราะช่องที่แก้ได้ของการเบิก (ผู้เบิก) ไม่มีความหมายกับของเสีย ·
 * ของเสียไม่ผูกสาขาหรือเคส จึงไม่มีทางแก้ที่อื่นให้ส่งไป
 */
final class ShopIssue
{
    /**
     * @param array<string,mixed> $body
     * @param list<string> $roles
     * @return array<string,mixed>
     */
    public static function edit(int $logId, array $body, array $roles, int $actorId): array
    {
        Roles::require(Roles::settleBranch($roles), 'แก้การเบิกของร้าน');

        return Db::tx(static function (PDO $pdo) use ($logId, $body): array {
            $row = self::editable($pdo, $logId);

            $doc = array_key_exists('reference_doc', $body)
                ? self::text($body['reference_doc'], 100, 'เลขเอกสาร')
                : $row['reference_doc'];
            $note = array_key_exists('note', $body)
                ? self::text($body['note'], 500, 'หมายเหตุ')
                : $row['notes'];
            $to = array_key_exists('issued_to_admin_id', $body)
                ? self::staff($pdo, $body['issued_to_admin_id'])
                : ($row['issued_to_admin_id'] === null ? null : (int) $row['issued_to_admin_id']);

            $pdo->prepare('UPDATE inventory_logs SET reference_doc = ?, notes = ?, issued_to_admin_id = ? WHERE id = ?')
                ->execute([$doc, $note, $to, $logId]);

            return ['id' => $logId, 'referenceDoc' => $doc, 'notes' => $note, 'issuedToId' => $to];
        });
    }

    /**
     * @param array<string,mixed> $body
     * @param list<string> $roles
     * @return array{returned:list<array{lot:string,lot_id:int,quantity:int}>,returnLogId:int}
     */
    public static function cancel(int $logId, array $body, array $roles, int $actorId): array
    {
        Roles::require(Roles::settleBranch($roles), 'ยกเลิกการเบิกของร้าน');

        $why = self::text($body['note'] ?? null, 500, 'เหตุผล');
        if ($why === null) {
            throw ApiError::badRequest('ยกเลิกการเบิกต้องบอกเหตุผลไว้ด้วย', 'missing_field');
        }

        return Db::tx(static function (PDO $pdo) use ($logId, $why, $actorId): array {
            $row = self::editable($pdo, $logId, true);
            $what = $row['action_type'] === 'SCRAP' ? 'ยกเลิกการตัดของเสีย' : 'ยกเลิกการเบิก';

            $qty = -(int) $row['quantity'];
            if ($qty <= 0 || $row['lot_id'] === null) {
                throw ApiError::conflict('nothing_to_return', 'รายการนี้ไม่มีของที่ต้องคืนเข้าล็อต');
            }
            $lotId = (int) $row['lot_id'];

            // ไม่คืนเกินกว่าที่ล็อตเคยรับเข้า — กฎเดียวกับ Stock::undoBranchIssue · ล็อตค้างส่ง
            // (initial 0 ยอดติดลบ) กลับขึ้นมาที่ศูนย์พอดีด้วยกฎเดียวกันนี้
            $put = $pdo->prepare(
                'UPDATE stock_lots SET remaining_qty = remaining_qty + ?
                 WHERE id = ? AND remaining_qty + ? <= ' . Stock::RETURN_CEILING_SQL
            );
            $put->execute([$qty, $lotId, $qty]);
            if ($put->rowCount() !== 1) {
                throw ApiError::conflict('over_return', 'คืนแล้วยอดจะเกินจำนวนที่เคยรับเข้าล็อตนี้', ['lot_id' => $lotId]);
            }

            try {
                $pdo->prepare(
                    'INSERT INTO inventory_logs
                       (product_id, lot_id, action_type, quantity, unit_cost,
                        reference_doc, notes, created_by, created_by_kind, reverses_log_id, created_at)
                     SELECT product_id, id, \'RETURN\', ?, cost_per_unit, ?, ?, ?, \'user\', ?, NOW()
                     FROM stock_lots WHERE id = ?'
                )->execute([$qty, $row['reference_doc'], $what . ' — ' . $why, $actorId, $logId, $lotId]);
            } catch (PDOException $e) {
                // 23000 = UNIQUE ของ reverses_log_id — อีกคนเพิ่งยกเลิกแถวนี้ไปก่อน
                if (($e->errorInfo[0] ?? '') === '23000') {
                    throw ApiError::conflict('already_returned', 'รายการนี้ยกเลิกและคืนของไปแล้ว');
                }
                throw $e;
            }
            $returnId = (int) $pdo->lastInsertId();

            LowStock::watchLot($lotId);

            $lot = $pdo->prepare('SELECT lot_number FROM stock_lots WHERE id = ?');
            $lot->execute([$lotId]);

            return [
                'returned'    => [['lot' => (string) $lot->fetchColumn(), 'lot_id' => $lotId, 'quantity' => $qty]],
                'returnLogId' => $returnId,
            ];
        });
    }

    /**
     * แถวที่แก้/ยกเลิกทางนี้ได้ — ล็อกไว้ก่อนอ่าน สองคนกดพร้อมกันจึงต่อคิวกัน
     *
     * `$scrapToo` — ยกเลิกรับแถวตัดของเสียด้วย ส่วนการแก้รับเฉพาะแถวจ่ายออก
     *
     * @return array<string,mixed>
     */
    private static function editable(PDO $pdo, int $logId, bool $scrapToo = false): array
    {
        $st = $pdo->prepare('SELECT * FROM inventory_logs WHERE id = ? FOR UPDATE');
        $st->execute([$logId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);

        if ($row === false) {
            throw ApiError::notFound('ไม่พบรายการเบิกนี้');
        }
        $kinds = $scrapToo ? ['OUT', 'SCRAP'] : ['OUT'];
        if (!in_array($row['action_type'], $kinds, true)) {
            throw ApiError::conflict(
                'not_shop_issue',
                $scrapToo
                    ? 'ยกเลิกได้เฉพาะรายการจ่ายออกหรือตัดของเสีย'
                    : 'แก้ได้เฉพาะรายการจ่ายออก — รายการตัดของเสียยกเลิกได้อย่างเดียว',
                ['action' => $row['action_type']],
            );
        }
        if ($row['branch_issue_id'] !== null) {
            throw ApiError::conflict('branch_issue', 'รายการนี้เป็นการเบิกของสาขา — แก้หรือยกเลิกที่หน้าการเบิกจากสาขา', [
                'branch_issue_id' => (int) $row['branch_issue_id'],
            ]);
        }

        // ของเสียไม่ได้มาจากเคส — เลขเอกสารของมันเป็นอะไรก็ได้ที่คนพิมพ์ ห้ามเอาไปเทียบเลขเคส
        $case = $row['action_type'] === 'OUT' ? self::caseOf($pdo, $row['reference_doc']) : null;
        if ($case !== null) {
            throw ApiError::conflict(
                'case_linked',
                "ของรายการนี้ตัดตามเคส {$row['reference_doc']} — แก้ที่หน้าเคส (เปิดขั้นการขายกลับมาแก้) ไม่งั้นเคสกับคลังจะไม่ตรงกัน",
                ['case_id' => $case],
            );
        }

        $done = $pdo->prepare('SELECT id FROM inventory_logs WHERE reverses_log_id = ? LIMIT 1');
        $done->execute([$logId]);
        $back = $done->fetchColumn();
        if ($back !== false) {
            throw ApiError::conflict('already_returned', 'รายการนี้ยกเลิกและคืนของไปแล้ว', [
                'return_log_id' => (int) $back,
            ]);
        }

        return $row;
    }

    /** เคสหน้าร้านที่ตัดของรายการนี้ไป — เลขเอกสารของการตัดตามเคสคือเลขเคส */
    private static function caseOf(PDO $pdo, ?string $doc): ?int
    {
        if ($doc === null || $doc === '') {
            return null;
        }
        $st = $pdo->prepare('SELECT case_id FROM case_stock_issues WHERE reference_doc = ? ORDER BY id DESC LIMIT 1');
        $st->execute([$doc]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    /** ข้อความที่ตัดช่องว่างแล้ว · ว่างคือ null */
    private static function text(mixed $v, int $max, string $what): ?string
    {
        if ($v === null) {
            return null;
        }
        if (!is_string($v) && !is_int($v)) {
            throw ApiError::badRequest("{$what}ต้องเป็นข้อความ", 'bad_field');
        }
        $s = trim((string) $v);
        if ($s === '') {
            return null;
        }
        if (mb_strlen($s) > $max) {
            throw ApiError::badRequest("{$what}ยาวเกิน {$max} ตัวอักษร", 'bad_field');
        }
        return $s;
    }

    /** ผู้เบิก — บัญชีที่มีอยู่และยังใช้งานได้ · ว่างคือไม่ระบุ */
    private static function staff(PDO $pdo, mixed $v): ?int
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_int($v) && !(is_string($v) && ctype_digit($v))) {
            throw ApiError::badRequest('ผู้เบิกต้องเป็นรหัสผู้ใช้', 'bad_field');
        }
        $st = $pdo->prepare('SELECT id, is_active FROM admins WHERE id = ?');
        $st->execute([(int) $v]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            throw ApiError::notFound('ไม่พบผู้ใช้ที่ระบุเป็นผู้เบิก');
        }
        if (!(bool) $row['is_active']) {
            throw ApiError::conflict('inactive_actor', 'บัญชีผู้เบิกถูกปิดใช้งานอยู่');
        }
        return (int) $v;
    }
}
