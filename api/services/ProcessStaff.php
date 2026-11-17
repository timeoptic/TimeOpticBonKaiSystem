<?php
/**
 * ผู้รับผิดชอบแต่ละขั้นตอน — ใครถูกเลือกเป็นพนักงานของขั้นไหนได้ แยกตามประเภทงาน
 * (ร้านขอ 17 พ.ย. 2026: ค่าคอมต้องคิดถูกคน)
 *
 * เก็บเป็น JSON ก้อนเดียวใน app_settings.process_staff:
 *   { "<ประเภทงาน>": { "mode": "list"|"all", "slots": { "<ช่อง>": [employee_id, …] } } }
 *
 * กติกา
 *   - mode "all" หรือยังไม่เคยตั้ง = เลือกได้ทุกคนเหมือนเดิม
 *   - mode "list" แต่ช่องไหนยังไม่ได้ใส่ชื่อ = ช่องนั้นเลือกได้ทุกคน (ไม่ล็อกร้านจนทำงานไม่ได้)
 *   - เคสที่ประเภทว่างหรือเป็นค่าเก่า ใช้ชุดของ "ตัดแว่นใหม่" (ได้ครบ 6 ขั้นเหมือนกัน)
 *   - API ตรวจเฉพาะเมื่อชื่อเปลี่ยน — แก้ใบเก่าที่คนเดิมไม่อยู่ในรายชื่อแล้วยังบันทึกได้
 *   - grinder 0 = "ไม่มีคนเจีย" ผ่านเสมอ
 *
 * หน้าเว็บอ่านชุดเดียวกันจาก /api/meta (process_staff) ไปกรองช่องเลือกพนักงาน
 */
declare(strict_types=1);

final class ProcessStaff
{
    public const KEY = 'process_staff';

    /** ช่องเลือกพนักงานที่ถูกคุม — ลำดับคือลำดับในหน้าตั้งค่า */
    public const SLOTS = [
        'reception' => 'รับลูกค้า',
        'exam'      => 'วัดสายตา',
        'sales'     => 'ขาย',
        'payment'   => 'ชำระเงิน',
        'centering' => 'วัด Center',
        'delivery'  => 'ส่งมอบ',
        'grinder'   => 'คนเจีย',
    ];

    /** ช่องของแต่ละขั้น (คนเจียอยู่ในขั้นส่งมอบ) */
    public const SLOT_PROCESS = [
        'reception' => 'reception', 'exam' => 'exam', 'sales' => 'sales', 'payment' => 'payment',
        'centering' => 'centering', 'delivery' => 'delivery', 'grinder' => 'delivery',
    ];

    public const DEFAULT_TYPE = 'ตัดแว่นใหม่';

    public static function caseTypes(): array
    {
        return Lookups::lists()['case_type'] ?? [self::DEFAULT_TYPE];
    }

    public static function typeKey(?string $caseType): string
    {
        $t = trim((string) $caseType);
        return in_array($t, self::caseTypes(), true) ? $t : self::DEFAULT_TYPE;
    }

    /** ค่าที่บันทึกไว้ ตัดของที่ไม่รู้จักทิ้ง · ไม่เคยตั้ง = [] */
    private static ?array $cache = null;

    public static function config(): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }
        $raw = Db::get('SELECT `value` FROM app_settings WHERE `key` = ?', self::KEY);
        $data = json_decode((string) ($raw['value'] ?? ''), true);
        return self::$cache = self::normalize(is_array($data) ? $data : []);
    }

    private static function normalize(array $data): array
    {
        $out = [];
        foreach (self::caseTypes() as $type) {
            $t = $data[$type] ?? null;
            if (!is_array($t)) {
                continue;
            }
            $slots = [];
            foreach (array_keys(self::SLOTS) as $slot) {
                $ids = array_values(array_unique(array_filter(
                    array_map('intval', (array) ($t['slots'][$slot] ?? [])),
                    fn($v) => $v > 0
                )));
                $slots[$slot] = $ids;
            }
            $out[$type] = ['mode' => ($t['mode'] ?? '') === 'list' ? 'list' : 'all', 'slots' => $slots];
        }
        return $out;
    }

    /** บันทึกทั้งก้อน (เฉพาะประเภทงานที่ส่งมา ที่เหลือคงเดิม) */
    public static function save(array $body): array
    {
        $merged = array_merge(self::config(), array_intersect_key($body, array_flip(self::caseTypes())));
        $clean = self::normalize($merged);

        $ids = [];
        foreach ($clean as $t) {
            foreach ($t['slots'] as $list) {
                array_push($ids, ...$list);
            }
        }
        if ($ids = array_values(array_unique($ids))) {
            $marks = implode(',', array_fill(0, count($ids), '?'));
            $found = array_map('intval', array_column(Db::all("SELECT id FROM employees WHERE id IN ($marks)", ...$ids), 'id'));
            if ($missing = array_diff($ids, $found)) {
                bad('ไม่พบพนักงาน ID ' . implode(', ', $missing));
            }
        }
        Db::run(
            'INSERT INTO app_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
            self::KEY,
            json_encode($clean, JSON_UNESCAPED_UNICODE)
        );
        return self::$cache = $clean;
    }

    /** รายชื่อ id ที่เลือกได้ · null = ไม่จำกัด */
    public static function allowed(string $slot, ?string $caseType): ?array
    {
        $t = self::config()[self::typeKey($caseType)] ?? null;
        if (!$t || $t['mode'] !== 'list') {
            return null;
        }
        $list = $t['slots'][$slot] ?? [];
        return $list ?: null;
    }

    /**
     * ด่านของ API — เรียกก่อนบันทึกช่องพนักงานของขั้นตอน
     * $caseId ใช้หาประเภทงาน (ถ้าไม่ได้ส่ง $caseType มา) · ไม่มีเคส = ไม่ใช่งานของขั้นตอน ไม่ตรวจ
     * $prev คือค่าที่บันทึกไว้เดิม — ไม่เปลี่ยนคนก็ไม่ตรวจ
     */
    public static function check(string $slot, ?int $caseId, ?int $employeeId, ?int $prev = null, ?string $caseType = null): void
    {
        if (!$employeeId || $employeeId <= 0 || ($prev !== null && $employeeId === $prev)) {
            return;
        }
        if ($caseType === null) {
            if (!$caseId) {
                return;
            }
            $row = Db::get('SELECT case_type FROM cases WHERE id = ?', $caseId);
            if (!$row) {
                return;
            }
            $caseType = $row['case_type'];
        }
        $allowed = self::allowed($slot, $caseType);
        if ($allowed === null || in_array($employeeId, $allowed, true)) {
            return;
        }
        $emp = Db::get('SELECT employee_name FROM employees WHERE id = ?', $employeeId);
        bad(sprintf(
            '%s ไม่ได้อยู่ในรายชื่อผู้รับผิดชอบขั้น "%s" ของงาน "%s" — เลือกคนที่กำหนดไว้ หรือให้แอดมินเพิ่มชื่อที่หน้า กำหนดผู้รับผิดชอบแต่ละขั้นตอน',
            $emp['employee_name'] ?? ('พนักงาน ID ' . $employeeId),
            self::SLOTS[$slot] ?? $slot,
            self::typeKey($caseType)
        ));
    }
}
