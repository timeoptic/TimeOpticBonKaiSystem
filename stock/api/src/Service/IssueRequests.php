<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Db;
use Optic\Roles;
use PDO;

/**
 * คำขอตัดเลนส์จากบัญชีสาขา — ร้านขอไว้ 27 ต.ค. 2026
 *
 * บัญชีสาขาไม่ผูกกับสาขาใดสาขาหนึ่ง — คนขอเลือกเองในฟอร์มว่าเบิกให้สาขาไหน และคนตรวจ
 * เปลี่ยนได้ (ร้านเปลี่ยนใจ 27 ต.ค. 2026 จากแบบผูกบัญชีละสาขา) · `admins.branch_id` (040)
 * ยังอยู่ ใช้เป็นสาขาที่เลือกไว้ให้ก่อนเท่านั้น
 *
 * สาขากรอกได้ แต่ของยังไม่ขยับ · แอดมินหรือเจ้าของร้าน (`issue.approve`) ตรวจ แก้ค่าได้
 * แล้วกดยืนยัน ระบบจึงตัดผ่านทางเดิมทั้งหมด:
 *
 *   issue  ตะกร้าเบิกให้สาขา → `StockGate::issueMany` (FIFO, ใบค้างรับของสาขา)
 *   rx     ใบสั่งตัด RX หนึ่งใบ → `Rx::order` (ผูกสาขาของคำขอ)
 *
 * กติกาทุกข้อของการเบิกและการเปิดใบสั่งจึงอยู่ที่เดิม ที่นี่ตรวจแค่รูปร่างของคำขอ ·
 * คนที่กดยืนยันคือคนที่ลงชื่อในสมุด ส่วนชื่อคนขอไปอยู่ที่ `taken_by` / หมายเหตุ
 *
 * ระหว่างรอตรวจไม่กันของ (ร้านเลือก) — ของไม่พอตอนยืนยัน `issueMany` ปฏิเสธทั้งตะกร้า
 * แอดมินแก้จำนวนแล้วกดใหม่
 */
final class IssueRequests
{
    private const BASKET_MAX = 20;

    /**
     * สาขาที่ไม่ใช้ทางนี้ — Bewell (5335) มีระบบของตัวเองแยกต่างหาก (ร้านเลือก 27 ต.ค. 2026)
     */
    private const NO_REQUESTS = [5335];

    private const RX_TEXT = ['brand' => 120, 'lens_model' => 120, 'lens_design' => 120];
    private const RX_POWER = ['sph', 'cyl', 'axis', 'add', 'sale_price'];

    /* ────────────────────────────────────────────────────────── สาขา */

    /**
     * สาขาส่งคำขอ
     *
     * @param array<string,mixed> $req {kind, branch_id, body}
     * @param array<string,mixed> $actor
     * @return array<string,mixed>
     */
    public static function create(array $req, array $actor): array
    {
        Roles::require(Roles::requestIssue($actor['roles']), 'ส่งคำขอตัดเลนส์');
        $branch = self::branch($req['branch_id'] ?? null);

        $kind = self::kind($req['kind'] ?? null);
        $body = self::clean($kind, $req['body'] ?? null);
        $json = self::encode($body);

        Db::run(
            'INSERT INTO issue_requests (kind, branch_id, requested_by, body, original)
             VALUES (?, ?, ?, ?, ?)',
            [$kind, $branch, (int) $actor['id'], $json, $json],
        );

        return self::byId((int) Db::conn()->lastInsertId());
    }

    /**
     * คำขอของบัญชีนี้ — ล่าสุดก่อน
     *
     * @param array<string,mixed> $actor
     * @return array<string,mixed>
     */
    public static function mine(array $actor, ?string $q = null): array
    {
        Roles::require(Roles::requestIssue($actor['roles']), 'ดูคำขอตัดเลนส์');
        $id = (int) $actor['id'];
        $default = Db::value('SELECT branch_id FROM admins WHERE id = ?', [$id]);
        [$find, $args] = self::search($q);

        return [
            'branches'        => self::branches(),
            'defaultBranchId' => $default === null ? null : (int) $default,
            'requests'        => self::rows('r.requested_by = ?' . $find, [$id, ...$args], $q === null ? 50 : 200),
        ];
    }

    /** สาขายกเลิกคำขอของตัวเองที่ยังรอตรวจ @param array<string,mixed> $actor */
    public static function cancel(int $id, array $actor): array
    {
        Roles::require(Roles::requestIssue($actor['roles']), 'ยกเลิกคำขอตัดเลนส์');

        $n = Db::run(
            "UPDATE issue_requests SET status = 'cancelled'
              WHERE id = ? AND requested_by = ? AND status = 'pending'",
            [$id, (int) $actor['id']],
        );
        if ($n !== 1) {
            throw ApiError::conflict('not_pending', 'คำขอนี้ถูกตรวจไปแล้ว หรือไม่ใช่คำขอของคุณ');
        }
        return self::byId($id);
    }

    /* ────────────────────────────────────────────────────── คนตรวจ */

    /**
     * จำนวนที่รอตรวจ กับเลขคำขอล่าสุด — ป๊อปอัพใช้เลขล่าสุดบอกว่ามีคำขอ "ใหม่" ไหม
     *
     * @param list<string> $roles
     * @return array{pending:int,latestId:int}
     */
    public static function pendingCount(array $roles): array
    {
        Roles::require(Roles::approveIssue($roles), 'ดูคำขอตัดเลนส์จากสาขา');
        $row = Db::one(
            "SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS latest FROM issue_requests WHERE status = 'pending'"
        );
        return ['pending' => (int) $row['n'], 'latestId' => (int) $row['latest']];
    }

    /**
     * รายการให้คนตรวจ — รอตรวจทั้งหมด หรือที่ตรวจแล้ว 100 ใบล่าสุด
     *
     * @param list<string> $roles
     * @return array{requests:list<array<string,mixed>>,branches:list<array{id:int,name:string}>}
     */
    public static function list(string $status, array $roles, ?string $q = null): array
    {
        Roles::require(Roles::approveIssue($roles), 'ดูคำขอตัดเลนส์จากสาขา');
        [$find, $args] = self::search($q);
        return [
            'requests' => match ($status) {
                'pending' => self::rows("r.status = 'pending'{$find}", $args, 200, 'ASC'),
                'all'     => self::rows("1 = 1{$find}", $args, 200),
                default   => self::rows("r.status <> 'pending'{$find}", $args, 100),
            },
            'branches' => self::branches(),
        ];
    }

    /**
     * ช่องค้นหาของหน้าคำขอ — ร้านขอ 3 พ.ย. 2026 (คำขอเยอะจนเลื่อนหาไม่ไหว)
     *
     * หมายเหตุสำคัญที่สุด เพราะสาขาใส่เลขออเดอร์ไว้ที่นั่น · อ่านหมายเหตุผ่าน JSON_EXTRACT
     * เพราะ json_encode เก็บ "/" เป็น "\/" ค้นตรง ๆ ใน body แล้ว "123/4" จะไม่เจอ ·
     * นอกนั้นค้น body ทั้งก้อน (SKU, ยี่ห้อ/ค่าสายตาของ RX), สาขา, ผู้ขอ, ผู้ตรวจ,
     * เหตุผลตีกลับ, ผลยืนยัน (เลขเอกสาร) และเลขคำขอ REQ-xxxxx
     *
     * @return array{0:string,1:list<mixed>}
     */
    private static function search(?string $q): array
    {
        if ($q === null || $q === '') {
            return ['', []];
        }
        $like = '%' . addcslashes($q, '\%_') . '%';
        $sql = " AND (JSON_UNQUOTE(JSON_EXTRACT(r.body, '$.note')) LIKE ?
                   OR JSON_UNQUOTE(JSON_EXTRACT(r.original, '$.note')) LIKE ?
                   OR r.body LIKE ? OR b.name LIKE ? OR q.display_name LIKE ? OR q.username LIKE ?
                   OR v.display_name LIKE ? OR r.reject_reason LIKE ? OR r.result LIKE ?";
        $args = array_fill(0, 9, $like);
        if (preg_match('/^(?:REQ-?)?0*(\d{1,9})$/i', $q, $m)) {
            $sql .= ' OR r.id = ?';
            $args[] = (int) $m[1];
        }
        return [$sql . ')', $args];
    }

    /**
     * ยืนยันตัด — บอดี้ที่ส่งมา (ถ้ามี) คือค่าที่แก้แล้ว ทับของเดิมก่อนตัด
     *
     * ทั้งหมดอยู่ในทรานแซกชันเดียว: ล็อกคำขอ ตัดผ่านทางเดิม แล้วปิดคำขอ · ตัดไม่ผ่าน (ของไม่พอ
     * ค่าสายตาผิด) ไม่มีอะไรถูกเขียนเลย รวมถึงค่าที่แก้ — คนตรวจแก้ต่อจากหน้าจอเดิมได้
     *
     * @param array<string,mixed> $req {body?, branch_id?}
     * @param array<string,mixed> $actor
     * @return array<string,mixed>
     */
    public static function approve(int $id, array $req, array $actor): array
    {
        Roles::require(Roles::approveIssue($actor['roles']), 'ยืนยันคำขอตัดเลนส์');

        Db::tx(static function (PDO $pdo) use ($id, $req, $actor): void {
            $row = self::lockPending($pdo, $id);
            $kind = (string) $row['kind'];
            if (array_key_exists('branch_id', $req)) {
                $row['branch_id'] = self::branch($req['branch_id']);
            }
            $body = array_key_exists('body', $req)
                ? self::clean($kind, $req['body'])
                : self::decode((string) $row['body']);

            $tag = 'คำขอสาขา ' . self::code($id) . ' · ' . $row['requester'];
            $note = self::joinNote($body['note'] ?? null, $tag);

            if ($kind === 'issue') {
                $res = StockGate::issueMany([
                    'source'        => 'web',
                    'idem_key'      => 'issue-request:' . $id,
                    'items'         => $body['items'],
                    'branch_id'     => (int) $row['branch_id'],
                    'taken_by'      => mb_substr((string) $row['requester'], 0, 120),
                    'reference_doc' => $body['reference_doc'] ?? self::code($id),
                    'note'          => $note,
                ]);
                $result = [
                    'referenceDoc' => $body['reference_doc'] ?? self::code($id),
                    'lines'        => array_map(
                        static fn(array $l): array => ['sku' => $l['sku'] ?? null, 'quantity' => $l['quantity'] ?? null],
                        $res['lines'] ?? [],
                    ),
                ];
            } else {
                $order = Rx::order(
                    [...$body, 'branch_id' => (int) $row['branch_id'], 'unit_cost' => null, 'note' => $note],
                    $actor['roles'],
                    (int) $actor['id'],
                );
                $result = ['referenceDoc' => $order['referenceDoc'], 'orderId' => $order['id'], 'name' => $order['name']];
            }

            $pdo->prepare(
                "UPDATE issue_requests
                    SET status = 'approved', branch_id = ?, body = ?, result = ?, reviewed_by = ?, reviewed_at = NOW()
                  WHERE id = ?"
            )->execute([(int) $row['branch_id'], self::encode($body), self::encode($result), (int) $actor['id'], $id]);
        });

        return self::byId($id);
    }

    /**
     * ตีกลับ — ต้องมีเหตุผล สาขาเห็นข้อความนี้
     *
     * @param array<string,mixed> $req {reason}
     * @param array<string,mixed> $actor
     */
    public static function reject(int $id, array $req, array $actor): array
    {
        Roles::require(Roles::approveIssue($actor['roles']), 'ตีกลับคำขอตัดเลนส์');
        $reason = self::text($req['reason'] ?? null, 400);
        if ($reason === null) {
            throw ApiError::badRequest('เขียนเหตุผลที่ตีกลับก่อน สาขาจะเห็นข้อความนี้', 'missing_reason');
        }

        Db::tx(static function (PDO $pdo) use ($id, $reason, $actor): void {
            self::lockPending($pdo, $id);
            $pdo->prepare(
                "UPDATE issue_requests
                    SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = NOW()
                  WHERE id = ?"
            )->execute([$reason, (int) $actor['id'], $id]);
        });

        return self::byId($id);
    }

    /* ─────────────────────────────────────────────────────── ภายใน */

    /**
     * สาขาที่เลือกเบิกให้ได้ — เปิดใช้งานอยู่ และไม่ใช่ Bewell
     *
     * @return list<array{id:int,name:string}>
     */
    private static function branches(): array
    {
        $out = [];
        foreach (Db::all('SELECT id, name FROM branches WHERE is_active = 1 ORDER BY name') as $b) {
            if (!in_array((int) $b['id'], self::NO_REQUESTS, true)) {
                $out[] = ['id' => (int) $b['id'], 'name' => (string) $b['name']];
            }
        }
        return $out;
    }

    private static function branch(mixed $raw): int
    {
        if ($raw === null || $raw === '') {
            throw ApiError::badRequest('เลือกก่อนว่าเบิกให้สาขาไหน', 'missing_branch');
        }
        $id = self::id($raw, 'branch_id');
        if (!in_array($id, array_column(self::branches(), 'id'), true)) {
            throw ApiError::badRequest('สาขานี้ส่งคำขอไม่ได้ (ปิดใช้งาน หรือมีระบบของตัวเอง)', 'branch_excluded');
        }
        return $id;
    }

    /** @return array<string,mixed> */
    private static function lockPending(PDO $pdo, int $id): array
    {
        $st = $pdo->prepare(
            'SELECT r.id, r.kind, r.status, r.branch_id, r.body,
                    COALESCE(a.display_name, a.username, CONCAT(\'#\', a.id)) AS requester
               FROM issue_requests r JOIN admins a ON a.id = r.requested_by
              WHERE r.id = ? FOR UPDATE'
        );
        $st->execute([$id]);
        $row = $st->fetch();
        if ($row === false) {
            throw ApiError::notFound('ไม่พบคำขอนี้');
        }
        if ($row['status'] !== 'pending') {
            throw ApiError::conflict('not_pending', 'คำขอนี้ถูกตรวจหรือยกเลิกไปแล้ว');
        }
        return $row;
    }

    private static function kind(mixed $v): string
    {
        if ($v !== 'issue' && $v !== 'rx') {
            throw ApiError::badRequest('kind ต้องเป็น issue หรือ rx', 'bad_kind');
        }
        return $v;
    }

    /**
     * รูปร่างของคำขอ — เก็บเฉพาะช่องที่รู้จัก ที่เหลือทิ้ง
     *
     * ต้นทุนไม่รับจากทางนี้เลย และสาขาไม่อยู่ในบอดี้ (มาจากบัญชีของคนขอ) · ค่าที่ทางเดิมตรวจ
     * ละเอียดกว่า (ค่าสายตา ราคา) ตรวจอีกรอบตอนยืนยัน
     *
     * @return array<string,mixed>
     */
    private static function clean(string $kind, mixed $raw): array
    {
        if (!is_array($raw)) {
            throw ApiError::badRequest('ไม่มีรายละเอียดคำขอ', 'missing_body');
        }
        $out = [
            'reference_doc' => self::text($raw['reference_doc'] ?? null, 100),
            'note'          => self::text($raw['note'] ?? null, 400),
        ];

        if ($kind === 'issue') {
            $items = $raw['items'] ?? null;
            if (!is_array($items) || $items === []) {
                throw ApiError::badRequest('ตะกร้าต้องมีอย่างน้อยหนึ่งรายการ', 'empty_basket');
            }
            if (count($items) > self::BASKET_MAX) {
                throw ApiError::badRequest('ตะกร้าใส่ได้ไม่เกิน ' . self::BASKET_MAX . ' รายการต่อครั้ง', 'basket_too_big');
            }
            $out['items'] = [];
            foreach ($items as $it) {
                $sku = is_array($it) ? trim((string) ($it['sku'] ?? '')) : '';
                $qty = is_array($it) ? ($it['quantity'] ?? null) : null;
                if ($sku === '' || mb_strlen($sku) > 100) {
                    throw ApiError::badRequest('ทุกรายการต้องมี SKU', 'bad_item');
                }
                if (!(is_int($qty) || (is_string($qty) && ctype_digit($qty))) || (int) $qty < 1 || (int) $qty > 999) {
                    throw ApiError::badRequest("จำนวนของ {$sku} ต้องเป็นจำนวนเต็ม 1–999", 'bad_quantity');
                }
                if (Db::value('SELECT id FROM products WHERE sku = ?', [$sku]) === null) {
                    throw ApiError::unknownSku($sku);
                }
                $out['items'][] = ['sku' => $sku, 'quantity' => (int) $qty];
            }
            return $out;
        }

        foreach (self::RX_TEXT as $k => $max) {
            $out[$k] = self::text($raw[$k] ?? null, $max);
        }
        if ($out['brand'] === null && $out['lens_model'] === null && $out['lens_design'] === null) {
            throw ApiError::badRequest('บอกก่อนว่าสั่งเลนส์อะไร — กรอกอย่างน้อยหนึ่งช่อง แบรนด์ รุ่น หรือชนิดเลนส์', 'missing_lens');
        }
        $eye = $raw['eye_side'] ?? null;
        $out['eye_side'] = $eye === 'right' || $eye === 'left' ? $eye : null;
        foreach (self::RX_POWER as $k) {
            $out[$k] = self::text($raw[$k] ?? null, 20);
        }
        return $out;
    }

    private static function text(mixed $v, int $max): ?string
    {
        if ($v === null || is_array($v)) {
            return null;
        }
        $v = trim((string) $v);
        if ($v === '') {
            return null;
        }
        if (mb_strlen($v) > $max) {
            throw ApiError::badRequest("ข้อความยาวเกิน {$max} ตัวอักษร", 'too_long');
        }
        return $v;
    }

    private static function id(mixed $v, string $field): int
    {
        if (!(is_int($v) || (is_string($v) && ctype_digit($v))) || (int) $v < 1) {
            throw ApiError::badRequest("{$field} ต้องเป็นจำนวนเต็ม", 'bad_field');
        }
        return (int) $v;
    }

    private static function joinNote(?string $note, string $tag): string
    {
        $s = $note === null ? $tag : $note . ' · ' . $tag;
        return mb_substr($s, 0, 500);
    }

    public static function code(int $id): string
    {
        return sprintf('REQ-%05d', $id);
    }

    /** @param array<string,mixed> $v */
    private static function encode(array $v): string
    {
        return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /** @return array<string,mixed> */
    private static function decode(?string $v): array
    {
        if ($v === null || $v === '') {
            return [];
        }
        $d = json_decode($v, true);
        return is_array($d) ? $d : [];
    }

    /** @return array<string,mixed> */
    private static function byId(int $id): array
    {
        $rows = self::rows('r.id = ?', [$id], 1);
        if ($rows === []) {
            throw ApiError::notFound('ไม่พบคำขอนี้');
        }
        return $rows[0];
    }

    /**
     * แถวพร้อมชื่อสินค้าและยอดคงเหลือของแต่ละบรรทัด — ไม่มีต้นทุน (สาขาก็อ่านทางนี้)
     *
     * @param list<mixed> $args
     * @return list<array<string,mixed>>
     */
    private static function rows(string $where, array $args, int $limit, string $order = 'DESC'): array
    {
        $rows = Db::all(
            "SELECT r.*, b.name AS branch_name,
                    COALESCE(q.display_name, q.username) AS requester,
                    COALESCE(v.display_name, v.username) AS reviewer
               FROM issue_requests r
               JOIN branches b ON b.id = r.branch_id
               JOIN admins q ON q.id = r.requested_by
               LEFT JOIN admins v ON v.id = r.reviewed_by
              WHERE {$where}
              ORDER BY r.id {$order}
              LIMIT {$limit}",
            $args,
        );

        $out = [];
        $skus = [];
        foreach ($rows as $r) {
            $body = self::decode($r['body']);
            $original = self::decode($r['original']);
            foreach ([$body, $original] as $b) {
                foreach ($b['items'] ?? [] as $it) {
                    $skus[$it['sku']] = true;
                }
            }
            $out[] = [
                'id'           => (int) $r['id'],
                'code'         => self::code((int) $r['id']),
                'kind'         => $r['kind'],
                'status'       => $r['status'],
                'branchId'     => (int) $r['branch_id'],
                'branchName'   => $r['branch_name'],
                'requester'    => $r['requester'],
                'reviewer'     => $r['reviewer'],
                'createdAt'    => $r['created_at'],
                'reviewedAt'   => $r['reviewed_at'],
                'rejectReason' => $r['reject_reason'],
                'body'         => $body,
                'original'     => $original,
                'edited'       => $body != $original,
                'result'       => self::decode($r['result']),
            ];
        }

        if ($skus !== []) {
            $list = array_keys($skus);
            $marks = implode(',', array_fill(0, count($list), '?'));
            $info = [];
            foreach (Db::all(
                "SELECT p.sku, p.name, p.is_custom_made,
                        (SELECT COALESCE(SUM(l.remaining_qty), 0) FROM stock_lots l WHERE l.product_id = p.id) AS on_hand
                   FROM products p WHERE p.sku IN ({$marks})",
                $list,
            ) as $p) {
                $info[$p['sku']] = ['name' => $p['name'], 'onHand' => (int) $p['on_hand']];
            }
            foreach ($out as &$o) {
                foreach (['body', 'original'] as $k) {
                    if (isset($o[$k]['items'])) {
                        $o[$k]['items'] = array_map(
                            static fn(array $it): array => $it + ($info[$it['sku']] ?? ['name' => null, 'onHand' => 0]),
                            $o[$k]['items'],
                        );
                    }
                }
            }
            unset($o);
        }

        return self::withUndone($out);
    }

    /**
     * คำขอที่ตัดแล้ว แต่คลังย้อนทีหลัง — คืนของจากใบเบิก ยกเลิกหรือลบใบสั่ง RX ใบเจียร์เสีย
     *
     * สถานะของคำขอยังเป็น approved (มันถูกตัดจริงไปแล้ว) ส่วนการย้อนเกิดในหน้าอื่นที่ไม่รู้จัก
     * คำขอ จึงอ่านสดจากรายการจริงทุกครั้ง ไม่ได้เขียนกลับมาเก็บ · เดิมการ์ดค้าง "ตัดแล้ว"
     * ทั้งที่ของคืนไปแล้ว (ร้านแจ้ง 28 ต.ค. 2026: REQ-00013, RX-2026-0392)
     *
     * `undone` = null | {state: cancelled|partial|deleted|scrapped, at, note}
     *
     * @param list<array<string,mixed>> $out
     * @return list<array<string,mixed>>
     */
    private static function withUndone(array $out): array
    {
        $issueKeys = [];
        $rxIds = [];
        foreach ($out as $o) {
            if ($o['status'] !== 'approved') {
                continue;
            }
            if ($o['kind'] === 'issue') {
                $issueKeys[] = 'issue-request:' . $o['id'];
            } elseif (isset($o['result']['orderId'])) {
                $rxIds[] = (int) $o['result']['orderId'];
            }
        }

        // ใบเบิกของแต่ละคำขอ อ่านจากคำตอบที่ issueMany เก็บไว้ตาม idem_key
        $issues = [];
        if ($issueKeys !== []) {
            $marks = implode(',', array_fill(0, count($issueKeys), '?'));
            $byIssue = [];
            foreach (Db::all(
                "SELECT idem_key, response FROM stock_requests
                  WHERE source = 'web' AND status = 'done' AND idem_key IN ({$marks})",
                $issueKeys,
            ) as $s) {
                $id = (int) substr((string) $s['idem_key'], strlen('issue-request:'));
                foreach (self::decode($s['response'])['lines'] ?? [] as $l) {
                    if (isset($l['branch_issue_id'])) {
                        $byIssue[(int) $l['branch_issue_id']] = $id;
                        $issues[$id][(int) $l['branch_issue_id']] = null;
                    }
                }
            }
            if ($byIssue !== []) {
                $ids = array_keys($byIssue);
                $marks = implode(',', array_fill(0, count($ids), '?'));
                foreach (Db::all(
                    "SELECT b.id, b.status,
                            (SELECT MAX(g.created_at) FROM inventory_logs g
                              WHERE g.branch_issue_id = b.id AND g.action_type = 'RETURN') AS back_at
                       FROM branch_issues b WHERE b.id IN ({$marks})",
                    $ids,
                ) as $b) {
                    $issues[$byIssue[(int) $b['id']]][(int) $b['id']] = $b;
                }
            }
        }

        $rx = [];
        if ($rxIds !== []) {
            $marks = implode(',', array_fill(0, count($rxIds), '?'));
            foreach (Db::all(
                "SELECT log_id, cancelled_at, cancelled_note, scrapped_at FROM rx_orders WHERE log_id IN ({$marks})",
                $rxIds,
            ) as $r) {
                $rx[(int) $r['log_id']] = $r;
            }
        }

        foreach ($out as &$o) {
            $o['undone'] = null;
            if ($o['status'] !== 'approved') {
                continue;
            }
            if ($o['kind'] === 'issue') {
                $lines = $issues[$o['id']] ?? [];
                $gone = array_filter($lines, static fn($b): bool => $b === null || $b['status'] === 'cancelled');
                if ($gone !== []) {
                    $at = array_filter(array_map(static fn($b) => $b['back_at'] ?? null, $gone));
                    $o['undone'] = [
                        'state' => count($gone) === count($lines) ? 'cancelled' : 'partial',
                        'at'    => $at === [] ? null : max($at),
                        'note'  => null,
                    ];
                }
            } elseif (isset($o['result']['orderId'])) {
                $r = $rx[(int) $o['result']['orderId']] ?? null;
                if ($r === null) {
                    $o['undone'] = ['state' => 'deleted', 'at' => null, 'note' => null];
                } elseif ($r['cancelled_at'] !== null) {
                    $o['undone'] = [
                        'state' => $r['scrapped_at'] !== null ? 'scrapped' : 'cancelled',
                        'at'    => $r['cancelled_at'],
                        'note'  => $r['cancelled_note'],
                    ];
                }
            }
        }
        unset($o);

        return $out;
    }
}
