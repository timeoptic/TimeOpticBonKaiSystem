<?php
/**
 * ตัดสต็อกของเคสหนึ่งใบ ผ่าน API ของระบบคลัง.
 *
 * จุดตัดคือตอน **ยืนยันรายการขาย** (`POST /api/cases/{id}/processes/sales/complete`)
 * ไม่ใช่ตอนเลือกสินค้าเข้าออเดอร์ — เลือกไว้เฉย ๆ ยังไม่ใช่การขาย
 *
 * สามช่องของออเดอร์กับข้างตาที่มันหมายถึง (ชื่อคอลัมน์กับข้างตาสลับกันอยู่
 * ตาม schema เดิม อย่าอ่านจากชื่อคอลัมน์):
 *
 *   frame_product_id      กรอบ            —
 *   lens_product_id       เลนส์ขวา (R)    right   lens_od_price / lens_r_sku
 *   right_lens_product_id เลนส์ซ้าย (L)   left    lens_os_price / lens_l_sku
 *
 * เลนส์ที่ร้านไม่ได้สต็อกจะโดนปฏิเสธด้วย `custom_made` → ตกไปเปิดใบสั่งตัด
 * `POST /api/rx` พร้อมค่าสายตาของข้างนั้น (ค่าสายตาอยู่กับ *ใบสั่ง* ไม่ใช่กับสินค้า
 * สั่งรุ่นเดียวกันให้ลูกค้าคนละคนคนละค่าสายตาได้โดยไม่ต้องสร้าง SKU ใหม่)
 *
 * ไม่เขียน `stock_lots` / `inventory_logs` เอง — ดูเหตุผลใน StockClient.php
 *
 * สิ่งที่ทำที่นี่จดไว้ที่ `case_stock_issues` เพื่อสองเรื่อง: กันตัดซ้ำเมื่อกดยืนยัน
 * ใหม่ และเก็บ `idem_key` ไว้ใช้เป็น `reverses_key` ตอนคืนของ
 */
declare(strict_types=1);

final class CaseStock
{
    /** ช่องของออเดอร์ => [ป้ายที่คนอ่าน, ข้างตา, คอลัมน์ราคา, คอลัมน์ชื่อ] */
    private const SLOTS = [
        'frame' => ['กรอบ',          null,    'frame_price',   'frame_name'],
        'lensR' => ['เลนส์ขวา (R)',  'right', 'lens_od_price', 'lens_r_name'],
        'lensL' => ['เลนส์ซ้าย (L)', 'left',  'lens_os_price', 'lens_l_name'],
    ];

    private const SLOT_COLUMN = [
        'frame' => 'frame_product_id',
        'lensR' => 'lens_product_id',
        'lensL' => 'right_lens_product_id',
    ];

    /**
     * อ่านว่าเคสนี้ควรตัดอะไรบ้าง โดยไม่ยิงเน็ต — ใช้ทั้งตอนตัดจริง ตอนโหมด dry
     * และตอนอยากบอกผู้ใช้ล่วงหน้าว่ากดยืนยันแล้วจะเกิดอะไร
     *
     * @return array<int,array<string,mixed>>
     */
    public static function plan(array $case): array
    {
        $order = $case['order'] ?? null;
        if (!$order || !($order['id'] ?? null)) {
            return [];
        }
        $rx    = self::prescriptionFor($case, $order);
        $lines = [];

        foreach (self::SLOTS as $slot => [$label, $eye, $priceCol, $nameCol]) {
            /* กรอบจากคลังของอีกสาขา (FrameRemote) — ออเดอร์ไม่มีล็อตของที่นี่ ตัดด้วย SKU ที่บ่อนไก่ */
            if ($slot === 'frame' && (int) ($order['frame_remote'] ?? 0) === 1) {
                $sku = trim((string) ($order['frame_sku'] ?? ''));
                $lines[] = [
                    'slot' => $slot, 'label' => $label, 'eye' => null, 'lot_id' => null, 'sku' => $sku,
                    'name' => (string) ($order[$nameCol] ?? ''), 'price' => round((float) ($order[$priceCol] ?? 0), 2),
                    'rx' => null, 'remote' => true,
                    'missing' => $sku === '' ? 'ไม่พบ SKU ของกรอบจากคลัง' . FrameRemote::label()
                        : (FrameRemote::enabled() ? null : 'กรอบนี้มาจากคลัง' . FrameRemote::label() . ' แต่ยังไม่ได้ตั้งค่าการเชื่อม (FRAME_STOCK_* ใน .env)'),
                ];
                continue;
            }
            $lotId = (int) ($order[self::SLOT_COLUMN[$slot]] ?? 0);
            if (!$lotId) {
                continue;
            }
            /* ออเดอร์เก็บ id ของล็อต แต่ API ของคลังรับ SKU แล้วเลือกล็อตเองตาม FIFO
               จึงต้องแปลงก่อนส่ง — อ่านจาก v_stock_lot ซึ่งเป็นการอ่าน ไม่ใช่การเขียน
               (วันที่ฟอร์มเก็บ SKU ตรง ๆ แล้ว บรรทัดนี้จะหายไป) */
            $lot = Db::get('SELECT id, sku, product_name FROM v_stock_lot WHERE id = ?', $lotId);
            $sku = trim((string) ($lot['sku'] ?? ''));
            $lines[] = [
                'slot'    => $slot,
                'label'   => $label,
                'eye'     => $eye,
                'lot_id'  => $lotId,
                'sku'     => $sku,
                'name'    => (string) ($lot['product_name'] ?? ($order[$nameCol] ?? '')),
                'price'   => round((float) ($order[$priceCol] ?? 0), 2),
                'rx'      => $eye ? self::eyeValues($rx, $eye) : null,
                'missing' => $sku === '' ? "ไม่พบ SKU ของ$label (ล็อต #$lotId)" : null,
            ];
        }
        return $lines;
    }

    /**
     * ตัดของจริง. ต้องเรียก **นอก** Db::tx() — ถือ transaction ค้างข้ามการยิง HTTP
     * หลายรอบจะได้ lock timeout แทนที่จะได้ความปลอดภัย
     *
     * ยิงทีละบรรทัด ถ้าบรรทัดไหนพัง จะคืนบรรทัดที่สำเร็จไปแล้วกลับเข้าคลังก่อน
     * แล้วค่อยโยนต่อ — ปล่อยให้ตัดค้างครึ่งใบแปลว่าของหายโดยไม่มีใครรู้
     *
     * ใบสั่งตัด (RX) ถูกจัดไปท้ายแถวเสมอ เพราะฝั่งคลังไม่มีเส้นยกเลิกใบสั่ง
     * ถ้ามันไปอยู่ต้นแถวแล้วบรรทัดหลังพัง จะเหลือใบสั่งที่ถอนไม่ได้ค้างไว้
     *
     * @return array{done:array,skipped:array,mode:string}
     */
    public static function issueForCase(array $case, ?int $employeeId = null): array
    {
        $order = $case['order'] ?? null;
        if (!$order || !($order['id'] ?? null)) {
            return ['done' => [], 'skipped' => [], 'mode' => StockClient::mode()];
        }
        /* ไม่เหลือช่องสต็อกเลยก็ยังต้องไปต่อ — เปลี่ยนเลนส์สต็อกเป็นเลนส์สั่งตัด RX ทุกช่องแล้ว
           ของที่ตัดไว้ต้องคืน · เดิมออกตรงนี้เลย ของเก่าค้างอยู่ (CASE-2026-00243, 3 ต.ค. 2026) */
        $lines = self::plan($case);

        $caseId   = (int) $case['id'];
        $orderId  = (int) $order['id'];
        $caseCode = (string) ($case['case_code'] ?? '');
        $mode     = StockClient::mode();

        foreach ($lines as $l) {
            if ($l['missing']) {
                throw new StockApiError('unknown_sku', $l['missing']);
            }
        }

        $held   = self::heldBySlot($orderId);
        $todo   = [];
        $undo   = [];
        $skipped = [];

        foreach ($lines as $l) {
            $prev = $held[$l['slot']] ?? null;
            if ($prev && $prev['sku'] === $l['sku']) {
                /* ช่องนี้ตัดไปแล้วด้วยของชิ้นเดียวกัน — กดยืนยันซ้ำไม่ตัดรอบสอง */
                $skipped[] = ['slot' => $l['slot'], 'label' => $l['label'], 'sku' => $l['sku']];
                continue;
            }
            if ($prev) {
                /* เปลี่ยนของในช่องเดิม — คืนชิ้นเก่าก่อนแล้วค่อยตัดชิ้นใหม่ */
                $undo[] = $prev;
            }
            $todo[] = $l;
        }
        /* ช่องที่ถูกล้างทิ้งไปเลย (เลือกไว้แล้วเอาออก) ก็ต้องคืนของด้วย */
        foreach ($held as $slot => $prev) {
            if (!in_array($slot, array_column($lines, 'slot'), true)) {
                $undo[] = $prev;
            }
        }

        if (!$todo && !$undo) {
            return ['done' => [], 'skipped' => $skipped, 'mode' => $mode];
        }
        if ($mode !== 'live') {
            /* dry / off — จดไว้ว่าจะส่งอะไร แล้วไม่ยิง ของจริงไม่ขยับ */
            return [
                'done'    => array_map(fn($l) => $l + ['dry' => true], $todo),
                'undo'    => array_values(array_map(fn($prev) => (string) $prev['slot'], $undo)),
                'skipped' => $skipped,
                'mode'    => $mode,
            ];
        }

        /* รายการกรอบที่ค้างส่งไปคลังอีกสาขา ส่งก่อน — ลำดับการตัด/คืนจะได้ไม่สลับกัน */
        if (FrameRemote::enabled()) {
            FrameRemote::flush();
        }

        foreach ($undo as $prev) {
            self::reverse($prev, 'เปลี่ยนสินค้าในออเดอร์ ' . $caseCode);
        }

        /* เลนส์สั่งตัดไปท้ายแถว — ดูเหตุผลใน docblock ของเมทอดนี้ */
        usort($todo, fn($a, $b) => (int) ($a['eye'] !== null) <=> (int) ($b['eye'] !== null));

        $done = [];
        try {
            foreach ($todo as $l) {
                $done[] = self::issueLine($caseId, $orderId, $caseCode, $l, $employeeId);
            }
        } catch (StockApiError $e) {
            foreach (array_reverse($done) as $d) {
                if (($d['kind'] ?? '') === 'issue') {
                    try {
                        self::reverse($d, 'ยกเลิกอัตโนมัติ — ตัดสต็อกไม่ครบใบ');
                    } catch (StockApiError) {
                        /* คืนไม่สำเร็จก็ยังต้องรายงานสาเหตุแรกให้ผู้ใช้เห็น
                           แถวใน case_stock_issues ที่ยังไม่มี reversed_at คือรายการที่ต้องตามเก็บ */
                    }
                }
            }
            throw $e;
        }

        return ['done' => $done, 'skipped' => $skipped, 'mode' => $mode];
    }

    /** คืนของทั้งใบกลับเข้าคลัง — ใช้ตอนเปิดขั้นการขายกลับมาแก้ */
    public static function returnForCase(array $case, string $why): array
    {
        $order = $case['order'] ?? null;
        if (!$order || !($order['id'] ?? null)) {
            return [];
        }
        $out = [];
        foreach (self::heldBySlot((int) $order['id']) as $prev) {
            if ((int) ($prev['remote'] ?? 0) !== 1 && !StockClient::live()) {
                continue;
            }
            $out[] = self::reverse($prev, $why);
        }
        return $out;
    }

    /** รายการที่เคสนี้ตัดไปแล้วและยังไม่ได้คืน — เอาไว้โชว์ในหน้าเคส */
    public static function ledger(int $caseId): array
    {
        return Db::all(
            'SELECT slot, kind, sku, product_name, quantity, idem_key, reference_doc,
                    unit_cost, total_cost, issued_at, reversed_at,
                    remote, remote_state, reverse_state, remote_error
               FROM case_stock_issues WHERE case_id = ? ORDER BY id',
            $caseId
        );
    }

    /* ---------------------------------------------------------------- */

    /** @return array<string,array<string,mixed>> slot => แถวที่ยังไม่ได้คืน */
    private static function heldBySlot(int $orderId): array
    {
        $rows = Db::all(
            'SELECT * FROM case_stock_issues
              WHERE order_id = ? AND reversed_at IS NULL ORDER BY id',
            $orderId
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r['slot']] = $r;
        }
        return $out;
    }

    private static function issueLine(
        int $caseId,
        int $orderId,
        string $caseCode,
        array $l,
        ?int $employeeId
    ): array {
        if (!empty($l['remote'])) {
            return self::issueRemoteLine($caseId, $orderId, $caseCode, $l, $employeeId);
        }
        $attempt = (int) (Db::get(
            'SELECT COUNT(*) n FROM case_stock_issues WHERE order_id = ? AND slot = ?',
            $orderId,
            $l['slot']
        )['n'] ?? 0) + 1;

        /* คีย์กันตัดซ้ำ — ประกอบจากสิ่งที่ระบุรายการนั้นได้จริง ยิงกี่ครั้งก็ได้คีย์เดิม
           ห้ามสุ่ม ไม่งั้นการ retry ตอนเน็ตหลุดจะกลายเป็นการตัดสต็อกรอบสองเงียบ ๆ
           มี sku กับเลขครั้งอยู่ด้วย เพราะเปลี่ยนของในช่องเดิมแล้วยืนยันใหม่คือ
           การตัดคนละครั้ง ไม่ใช่การ retry ครั้งเดิม */
        $idem = self::key("case-$caseCode-o$orderId-{$l['slot']}-{$l['sku']}-$attempt");

        $body = [
            'source'        => StockClient::source(),
            'idem_key'      => $idem,
            'quantity'      => 1,
            'reference_doc' => $caseCode,
            'note'          => trim("ขายหน้าร้าน {$l['label']} — เคส $caseCode"),
        ];

        $kind = 'issue';
        try {
            $res = StockClient::post('/stock/issue', $body + ['sku' => $l['sku']]);
        } catch (StockApiError $e) {
            if ($e->reason !== 'custom_made') {
                throw $e;
            }
            /* สินค้าสั่งตัด ไม่มีสต็อกให้ตัด — เปิดใบสั่งตัดพร้อมค่าสายตาของข้างนั้นแทน
               ไม่ส่ง reference_doc ให้ฝั่งคลังออกเลข RX-{ปี}-{ลำดับ} เอง แล้วเก็บกลับมา */
            $kind = 'rx';
            $rxBody = $body;
            unset($rxBody['quantity'], $rxBody['reference_doc']);
            $rxBody['sku']  = $l['sku'];
            $rxBody['note'] = trim("เคส $caseCode · {$l['label']}");
            if ($l['eye']) {
                $rxBody['eye_side'] = $l['eye'];
                foreach (($l['rx'] ?? []) as $k => $v) {
                    if ($v !== null) {
                        $rxBody[$k] = $v;
                    }
                }
            }
            if ($l['price'] > 0) {
                $rxBody['sale_price'] = $l['price'];
            }
            $res = StockClient::post('/rx', $rxBody);
        }

        $row = [
            'case_id'       => $caseId,
            'order_id'      => $orderId,
            'slot'          => $l['slot'],
            'kind'          => $kind,
            'sku'           => $l['sku'],
            'product_name'  => $l['name'],
            'lot_id'        => $l['lot_id'],
            'quantity'      => 1,
            'idem_key'      => $idem,
            /* ใบสั่งตัดได้เลขของฝั่งคลังกลับมา ส่วนการตัดปกติอ้าง case_code ของเรา */
            'reference_doc' => $kind === 'rx'
                ? (string) ($res['referenceDoc'] ?? $res['reference_doc'] ?? $caseCode)
                : $caseCode,
            /* staff ไม่ได้รับฟิลด์ต้นทุนกลับมาเลย — เป็น null ไม่ใช่ศูนย์ */
            'unit_cost'     => self::firstNum($res, ['unit_cost', 'unitCost']),
            'total_cost'    => self::firstNum($res, ['total_cost', 'totalCost']),
            'response'      => json_encode($res, JSON_UNESCAPED_UNICODE),
            'employee_id'   => $employeeId,
        ];
        self::record($row);
        return $row + ['label' => $l['label']];
    }

    /**
     * กรอบจากคลังอีกสาขา — คีย์นำหน้าด้วยรหัสสาขา เพราะเลขเคส/เลขออเดอร์ของสองสาขาซ้ำกันได้
     * (CASE-2026-00001 มีทั้งสองที่) ไม่ใส่จะไปได้คำตอบของเคสบ่อนไก่กลับมาแทนการตัดจริง
     */
    private static function issueRemoteLine(int $caseId, int $orderId, string $caseCode, array $l, ?int $employeeId): array
    {
        $attempt = (int) (Db::get(
            'SELECT COUNT(*) n FROM case_stock_issues WHERE order_id = ? AND slot = ?',
            $orderId,
            $l['slot']
        )['n'] ?? 0) + 1;
        $from = FrameRemote::from();
        $row  = FrameRemote::issue([
            'case_id'       => $caseId,
            'order_id'      => $orderId,
            'slot'          => $l['slot'],
            'sku'           => $l['sku'],
            'product_name'  => $l['name'],
            'idem_key'      => self::key(FrameRemote::tag() . "-case-$caseCode-o$orderId-{$l['slot']}-{$l['sku']}-$attempt"),
            'reference_doc' => mb_substr("$from $caseCode", 0, 100),
            'note'          => "ขายที่สาขา$from {$l['label']} — เคส $caseCode",
            'employee_id'   => $employeeId,
        ]);
        return $row + ['label' => $l['label'], 'kind' => 'issue', 'remote' => 1];
    }

    /** คืนหนึ่งรายการกลับเข้าคลัง โดยอ้าง idem_key เดิม */
    private static function reverse(array $prev, string $why): array
    {
        if ((int) ($prev['remote'] ?? 0) === 1) {
            return FrameRemote::reverse($prev, $why);
        }
        if ((string) $prev['kind'] === 'rx') {
            /* ฝั่งคลังไม่มีเส้นยกเลิกใบสั่งตัด และ RX ไม่ได้แตะยอดสต็อกอยู่แล้ว
               จึงแค่ปิดแถวฝั่งเราแล้วบอกให้คนไปจัดการใบสั่งเอง */
            Db::run(
                'UPDATE case_stock_issues SET reversed_at = ?, reverse_note = ? WHERE id = ?',
                nowStamp(),
                'ใบสั่งตัดต้องยกเลิกที่ระบบคลังเอง — ' . $why,
                (int) $prev['id']
            );
            return ['slot' => $prev['slot'], 'kind' => 'rx', 'manual' => true];
        }

        $reverseKey = self::key('rev-' . $prev['idem_key'] . '-' . $prev['id']);
        StockClient::post('/stock/return', [
            'source'       => StockClient::source(),
            'idem_key'     => $reverseKey,
            'reverses_key' => (string) $prev['idem_key'],
            'note'         => $why,
        ]);
        Db::run(
            'UPDATE case_stock_issues SET reversed_at = ?, reverse_idem_key = ?, reverse_note = ?
              WHERE id = ?',
            nowStamp(),
            $reverseKey,
            $why,
            (int) $prev['id']
        );
        return ['slot' => $prev['slot'], 'kind' => 'issue', 'sku' => $prev['sku']];
    }

    private static function record(array $r): void
    {
        Db::run(
            'INSERT INTO case_stock_issues
               (case_id, order_id, slot, kind, sku, product_name, lot_id, quantity,
                idem_key, reference_doc, unit_cost, total_cost, response, employee_id, issued_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            $r['case_id'],
            $r['order_id'],
            $r['slot'],
            $r['kind'],
            $r['sku'],
            $r['product_name'],
            $r['lot_id'],
            $r['quantity'],
            $r['idem_key'],
            $r['reference_doc'],
            $r['unit_cost'],
            $r['total_cost'],
            $r['response'],
            $r['employee_id'],
            nowStamp()
        );
    }

    /** `idem_key` ยาวได้ไม่เกิน 120 — ตัดตรงกลางด้วย hash ไม่ใช่ตัดหางทิ้ง เพราะหางคือส่วนที่ต่างกัน */
    private static function key(string $s): string
    {
        return strlen($s) <= 120 ? $s : substr($s, 0, 79) . '-' . substr(sha1($s), 0, 40);
    }

    /** ใบสั่งตัดใช้ค่าสายตาที่ยืนยันแล้วของเคสนี้ ไม่ใช่ค่าที่วัดมาแล้วยังไม่ได้ใช้ */
    private static function prescriptionFor(array $case, array $order): ?array
    {
        $pid = (int) ($order['final_prescription_id'] ?? 0);
        if ($pid) {
            return Db::get('SELECT * FROM prescriptions WHERE id = ?', $pid) ?: null;
        }
        foreach (($case['prescriptions'] ?? []) as $p) {
            if (($p['kind'] ?? '') === 'final') {
                return $p;
            }
        }
        return null;
    }

    /**
     * ค่าสายตาของข้างเดียว ในรูปที่ API ของคลังรับ
     * sph/cyl ทศนิยมไม่เกินสองตำแหน่ง ติดลบได้ · axis จำนวนเต็ม 0–180
     * add เก็บตามที่เขียน (เช่น `+2.00`) จึงส่งเป็นข้อความ
     */
    private static function eyeValues(?array $rx, string $eye): ?array
    {
        if (!$rx) {
            return null;
        }
        $p = $eye === 'right' ? 'r_' : 'l_';
        $axis = self::num($rx[$p . 'axis'] ?? null);
        return array_filter([
            'sph'  => self::num($rx[$p . 'sphere'] ?? null),
            'cyl'  => self::num($rx[$p . 'cylinder'] ?? null),
            'axis' => $axis === null ? null : max(0, min(180, (int) round($axis))),
            'add'  => trim((string) ($rx[$p . 'add'] ?? '')) ?: null,
        ], fn($v) => $v !== null);
    }

    /** ค่าสายตาเก็บเป็นข้อความ ("-2.25", "+2.00", "", "—") — เอาเฉพาะที่เป็นตัวเลขจริง */
    private static function num(mixed $v): ?float
    {
        $s = trim((string) $v);
        if ($s === '' || !preg_match('/^[+-]?\d+(\.\d+)?$/', $s)) {
            return null;
        }
        return round((float) $s, 2);
    }

    private static function firstNum(array $res, array $keys): ?float
    {
        foreach ($keys as $k) {
            if (isset($res[$k]) && is_numeric($res[$k])) {
                return round((float) $res[$k], 2);
            }
        }
        return null;
    }
}
