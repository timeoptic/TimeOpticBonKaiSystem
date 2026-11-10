<?php

declare(strict_types=1);

require_once __DIR__ . '/TimeOpticRequests.php';
require_once __DIR__ . '/TimeOpticRx.php';

/**
 * กติกาใบเบิกเลนส์ของ Bewell — แยกจาก route เพื่อเทสต์ได้โดยไม่ต้องผ่าน HTTP
 *
 * เลนส์ของ Bewell ไม่ใช่สต็อก ใบเบิกจึงไม่แตะ products / stock_lots / rx_orders เลย
 */
final class LensRequisition
{
    /** ลำดับงานปกติ — เดินหน้าหรือข้ามขั้นได้ ย้อนไม่ได้ · cancelled อยู่นอกลำดับ */
    public const FLOW = ['pending', 'issued', 'ordered', 'received', 'assembled'];

    public const LABEL = [
        'pending'   => 'รอเบิก',
        'issued'    => 'ส่งรายการเบิกแล้ว',
        'ordered'   => 'กำลังตัด/ผลิต',
        'received'  => 'ได้รับเลนส์แล้ว',
        'assembled' => 'ประกอบแล้ว',
        'cancelled' => 'ยกเลิก',
    ];

    /** รหัสสถานะในไฟล์ Export — ชื่อที่ใช้คุยกับ TimeOptic ตอนเบิกเลนส์ */
    public const CODE = [
        'pending'   => 'PENDING',
        'issued'    => 'REQUESTED',
        'ordered'   => 'PROCESSING',
        'received'  => 'RECEIVED',
        'assembled' => 'ASSEMBLED',
        'cancelled' => 'CANCELLED',
    ];

    /** ที่มาของการยกเลิก — ยกเลิกด้วยมือ หรือระบบยกเลิกให้เพราะออเดอร์/เคสถูกยกเลิก */
    public const CANCEL_SOURCE = [
        'manual'         => 'ยกเลิกใบเบิก',
        'order_deleted'  => 'ลบออเดอร์',
        'case_cancelled' => 'ยกเลิกเคส',
        'lens_cleared'   => 'ล้างเลนส์ในหน้าขาย',
    ];

    /** คอลัมน์เวลาที่ประทับตอนเข้าสถานะนั้น */
    public const STAMP = [
        'issued'    => 'issued_at',
        'ordered'   => 'ordered_at',
        'received'  => 'received_at',
        'assembled' => 'assembled_at',
        'cancelled' => 'cancelled_at',
    ];

    /** ช่องของใบค่าสายตาที่คัดลอกลงใบเบิก */
    public const RX_FIELDS = [
        'r_sphere', 'r_cylinder', 'r_axis', 'r_add', 'r_pd', 'r_prism', 'r_base',
        'l_sphere', 'l_cylinder', 'l_axis', 'l_add', 'l_pd', 'l_prism', 'l_base',
        'pd_total', 'test_for',
    ];

    /** null = เปลี่ยนได้ · ข้อความ = เหตุผลที่เปลี่ยนไม่ได้ */
    public static function transitionError(string $from, string $to, bool $hasRx): ?string
    {
        if (!isset(self::LABEL[$to])) {
            return 'สถานะไม่ถูกต้อง';
        }
        if ($from === $to) {
            return 'ใบเบิกอยู่สถานะนี้อยู่แล้ว';
        }
        if ($from === 'cancelled') {
            return 'ใบเบิกนี้ถูกยกเลิกแล้ว';
        }
        if ($to === 'cancelled') {
            return $from === 'assembled' ? 'ประกอบแล้ว ยกเลิกใบเบิกไม่ได้' : null;
        }
        if (array_search($to, self::FLOW, true) < array_search($from, self::FLOW, true)) {
            return 'ย้อนสถานะใบเบิกไม่ได้';
        }
        if (!$hasRx) {
            return 'เคสนี้ยังไม่มีค่าสายตาสุดท้าย — ยืนยันค่าสายตาก่อนเบิกเลนส์';
        }
        return null;
    }

    /**
     * ค่าสายตาสุดท้ายของออเดอร์ — ใบที่ผูกกับออเดอร์ก่อน (ตั้งตอนกดยืนยันค่าสายตา)
     * ไม่มีค่อยหาใบ final ล่าสุดของเคส เหมือนที่หน้าออเดอร์หาอยู่
     */
    public static function finalRx(Tx $q, array $order): ?array
    {
        $row = null;
        if (!empty($order['final_prescription_id'])) {
            $row = $q->get('SELECT * FROM prescriptions WHERE id = ?', (int) $order['final_prescription_id']);
        }
        if (!$row && !empty($order['case_id'])) {
            $row = $q->get(
                "SELECT * FROM prescriptions WHERE case_id = ? AND kind = 'final'
                  ORDER BY confirmed_at DESC, id DESC LIMIT 1",
                (int) $order['case_id']
            );
        }
        return $row ?: null;
    }

    public static function snapshot(array $rx): array
    {
        $out = ['prescription_id' => (int) $rx['id']];
        foreach (self::RX_FIELDS as $f) {
            $out[$f] = $rx[$f] ?? null;
        }
        return $out;
    }

    /** รายการจากหน้าเว็บ → แถวพร้อมเขียน · ลำดับคีย์ = ลำดับคอลัมน์ใน INSERT ของ routes/lens.php */
    public static function cleanItems(array $items): array
    {
        if (!$items) {
            bad('ไม่มีรายการเลนส์');
        }
        $text = static fn($v, int $max) => mb_substr(trim((string) ($v ?? '')), 0, $max);
        $out  = [];
        foreach (array_values($items) as $i => $it) {
            $n   = $i + 1;
            $eye = strtoupper(trim((string) ($it['eye'] ?? '')));
            if (!in_array($eye, ['R', 'L', 'PAIR'], true)) {
                bad("รายการที่ $n: ข้างของเลนส์ไม่ถูกต้อง");
            }
            $brand = $text($it['brand'] ?? '', 80);
            /* เลนส์จาก lens_catalog ยี่ห้อไม่บังคับ — withCatalog() เติมค่าจากฐานให้ */
            if ($brand === '' && !int_or($it['lens_catalog_id'] ?? null)) {
                bad("รายการที่ $n: ไม่มียี่ห้อเลนส์");
            }
            $qty   = max(1, (int) ($it['quantity'] ?? 1));
            $price = round((float) ($it['unit_price'] ?? 0), 2);
            if ($price < 0) {
                bad("รายการที่ $n: ราคาติดลบไม่ได้");
            }
            $source = strtoupper((string) ($it['source'] ?? 'MOCK'));
            $out[] = [
                'eye'          => $eye === 'PAIR' ? 'pair' : $eye,
                'source'       => in_array($source, ['MOCK', 'CATALOG', 'DATABASE'], true) ? $source : 'MOCK',
                'mock_code'    => $text($it['mock_code'] ?? '', 120) ?: null,
                'brand'        => $brand,
                'lens_type'    => $text($it['lens_type'] ?? '', 80) ?: null,
                'design'       => $text($it['design'] ?? '', 120) ?: null,
                'lens_index'   => $text($it['lens_index'] ?? '', 10) ?: null,
                'coating'      => $text($it['coating'] ?? '', 80) ?: null,
                'option_name'  => $text($it['option_name'] ?? '', 80) ?: null,
                'photochromic' => $text($it['photochromic'] ?? '', 80) ?: null,
                'color'        => $text($it['color'] ?? '', 40) ?: null,
                'quantity'     => $qty,
                'unit_price'   => $price,
                'line_total'   => round($qty * $price, 2),
                'lens_catalog_id' => int_or($it['lens_catalog_id'] ?? null) ?: null,
                'lens_code'       => null,
                'lens_name'       => null,
                'cost_price'      => null,
            ];
        }
        return $out;
    }

    /**
     * เติมค่าจาก lens_catalog ลงรายการ — สำเนา ณ วันที่ขาย ไม่ใช่ลิงก์
     *
     * ชื่อ ชนิด Index Coating ยี่ห้อ และต้นทุน อ่านจากฐานเสมอ ไม่เชื่อค่าที่หน้าเว็บส่งมา
     * (พนักงานขายไม่เห็นต้นทุนด้วยซ้ำ) · ราคาขายเป็นของหน้าขาย เพราะร้านแก้ราคาในออเดอร์ได้
     * ต้นทุนในตารางเป็นต่อคู่ ข้างเดียวจึงคิดครึ่งหนึ่ง
     */
    public static function withCatalog(Tx $q, array $items): array
    {
        foreach ($items as $n => &$it) {
            if (!$it['lens_catalog_id']) {
                continue;
            }
            $c = $q->get('SELECT * FROM lens_catalog WHERE id = ?', $it['lens_catalog_id']);
            if (!$c) {
                bad('รายการที่ ' . ($n + 1) . ': ไม่พบเลนส์นี้ในรายการเลนส์');
            }
            $cost = $c['cost_price'] === null ? null : (float) $c['cost_price'];
            $it['source']     = 'CATALOG';
            $it['mock_code']  = $c['code'];
            $it['lens_code']  = $c['code'];
            $it['lens_name']  = $c['lens_name'];
            $it['brand']      = (string) ($c['brand'] ?? '');
            $it['lens_type']  = $c['lens_type'];
            $it['design']     = $c['lens_name'];
            $it['lens_index'] = $c['lens_index'];
            $it['coating']    = $c['coating'];
            $it['cost_price'] = $cost === null ? null : round($it['eye'] === 'pair' ? $cost : $cost / 2, 2);
        }
        unset($it);
        return $items;
    }

    /** ผู้ใช้ที่ล็อกอินอยู่ (employees.id) — null ตอนรันจากเทสต์หรือ CLI */
    public static function actorEmployee(): ?int
    {
        $a = class_exists('StockModule') ? StockModule::actor() : null;
        return isset($a['employeeId']) ? (int) $a['employeeId'] : null;
    }

    /**
     * ยืนยันขั้นขายแล้ว = ใช้เลนส์จริง · ใบของเคสที่ยังไม่ยกเลิกถูกประทับ used_at
     * เรียกหลังตัดสต็อกกรอบสำเร็จ (routes/processes.php) — จังหวะเดียวกับที่ของออกจากร้าน
     * กดยืนยันซ้ำไม่ประทับทับของเดิม
     */
    public static function markUsed(Tx $q, int $caseId, ?int $employee): int
    {
        $rows = $q->all(
            "SELECT lr.id, lr.req_no, lr.rx_snapshot, lr.status, o.final_prescription_id, lr.case_id
               FROM lens_requisitions lr LEFT JOIN custom_orders o ON o.id = lr.order_id
              WHERE lr.case_id = ? AND lr.status <> 'cancelled' AND lr.used_at IS NULL FOR UPDATE",
            $caseId
        );
        foreach ($rows as $r) {
            /* ค่าสายตาเพิ่งยืนยันหลังออกใบ — ถึงตอนขายต้องมีสำเนาค่าสายตาติดใบไปด้วย */
            if (!$r['rx_snapshot']) {
                $rx = self::finalRx($q, $r);
                if ($rx) {
                    $q->run(
                        'UPDATE lens_requisitions SET prescription_id = ?, rx_snapshot = ? WHERE id = ?',
                        (int) $rx['id'],
                        json_encode(self::snapshot($rx), JSON_UNESCAPED_UNICODE),
                        (int) $r['id']
                    );
                }
            }
            $q->run('UPDATE lens_requisitions SET used_at = NOW(), used_by = ? WHERE id = ?', $employee, (int) $r['id']);
            logEvent($q, $caseId, [
                'action'      => 'lens_usage_recorded',
                'entity'      => 'lens_requisition',
                'entity_id'   => (int) $r['id'],
                'employee_id' => $employee,
                'note'        => $r['req_no'] . ': บันทึกการใช้เลนส์ (ยืนยันขั้นขาย)',
            ]);
        }
        return count($rows);
    }

    /**
     * เปิดขั้นขายกลับมาแก้ = ยังไม่ได้ขาย · ใบที่ยังรอเบิกกลับไปเป็นร่าง (used_at = NULL)
     * ใบที่ส่งรายการเบิกไปแล้วไม่แตะ — TimeOptic ได้รายการไปแล้ว ต้องยกเลิกใบเองถ้าไม่เอา
     * ทุกครั้งลงไทม์ไลน์เคสว่าใครทำเมื่อไร
     */
    public static function unmarkUsed(Tx $q, int $caseId, ?int $employee): int
    {
        $rows = $q->all(
            "SELECT id, req_no FROM lens_requisitions
              WHERE case_id = ? AND status = 'pending' AND used_at IS NOT NULL FOR UPDATE",
            $caseId
        );
        foreach ($rows as $r) {
            $q->run('UPDATE lens_requisitions SET used_at = NULL, used_by = NULL WHERE id = ?', (int) $r['id']);
            logEvent($q, $caseId, [
                'action'      => 'lens_usage_reverted',
                'entity'      => 'lens_requisition',
                'entity_id'   => (int) $r['id'],
                'employee_id' => $employee,
                'note'        => $r['req_no'] . ': ถอนการใช้เลนส์ (เปิดขั้นขายกลับมาแก้)',
            ]);
        }
        return count($rows);
    }

    /**
     * ยกเลิกใบเบิกทุกใบที่ยังไม่ยกเลิกของออเดอร์หรือเคส — แทนการลบ ใบยังอยู่ให้ตรวจย้อนหลัง
     * ว่าใครยกเลิก เมื่อไร เพราะอะไร และอ้างถึงออเดอร์ไหน (order_ref ติดใบไว้แล้ว)
     * ใบที่ประกอบแล้วไม่ยกเลิก (กติกาเดียวกับ transitionError) แต่ลงไทม์ไลน์ไว้ให้เห็น
     *
     * @param 'order'|'case' $by
     */
    public static function cancelFor(Tx $q, string $by, int $id, string $source, string $reason, ?int $employee): int
    {
        $col  = $by === 'order' ? 'order_id' : 'case_id';
        $rows = $q->all(
            "SELECT id, req_no, case_id, status, timeoptic_req_id, timeoptic_req_code, timeoptic_status
               FROM lens_requisitions
              WHERE `$col` = ? AND status <> 'cancelled' FOR UPDATE",
            $id
        );
        $done = 0;
        foreach ($rows as $r) {
            if ($r['status'] === 'assembled') {
                logEvent($q, (int) $r['case_id'], [
                    'action'      => 'lens_requisition_kept',
                    'entity'      => 'lens_requisition',
                    'entity_id'   => (int) $r['id'],
                    'employee_id' => $employee,
                    'note'        => $r['req_no'] . ': ประกอบแล้ว ไม่ยกเลิกให้อัตโนมัติ · ' . $reason,
                ]);
                continue;
            }
            $q->run(
                'UPDATE lens_requisitions
                    SET status = ?, cancelled_at = NOW(), cancelled_by = ?, cancel_source = ?, cancel_reason = ?
                  WHERE id = ?',
                'cancelled',
                $employee,
                $source,
                mb_substr($reason, 0, 255),
                (int) $r['id']
            );
            /* ใบที่ส่งเข้าคลัง TimeOptic แล้ว — ยกเลิกคำขอฝั่งนั้นตามไปด้วย (ไม่สำเร็จก็ไม่ขวาง) */
            $tNote = '';
            if ($r['timeoptic_req_id'] && $r['timeoptic_status'] !== 'cancelled' && class_exists('TimeOpticRequests')) {
                $tNote = TimeOpticRequests::cancelLinked($q, (int) $r['id'], (int) $r['timeoptic_req_id'], (string) $r['timeoptic_req_code']);
            }
            logEvent($q, (int) $r['case_id'], [
                'action'      => 'lens_requisition_status',
                'entity'      => 'lens_requisition',
                'entity_id'   => (int) $r['id'],
                'employee_id' => $employee,
                'note'        => mb_substr($r['req_no'] . ': ' . self::LABEL[$r['status']] . ' → ยกเลิก · ' . $reason . $tNote, 0, 250),
                'payload'     => ['from' => $r['status'], 'to' => 'cancelled', 'source' => $source],
            ]);
            $done++;
        }
        return $done;
    }
}
