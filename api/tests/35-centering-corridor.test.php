<?php

declare(strict_types=1);

/**
 * ค่า Cor. (corridor — ความยาวทางเดินสายตาของเลนส์โปรเกรสซีฟ) ในค่าการวัด Center
 *
 * ยิงผ่าน Router::dispatch() เส้นเดียวกับที่หน้าเว็บกดบันทึก Draft แล้วอ่านกลับด้วย
 * GET /api/centerings/:case_id ตัวที่แผงวัด Center ใช้โหลดค่า · ถ้าลืมเติมชื่อคอลัมน์
 * ในรายการ `cols` ของ route ค่าจะหายเงียบ ๆ ตอนบันทึก ทั้งที่หน้าจอกรอกได้ครบ
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('ค่า Cor. ในค่าการวัด Center');

/** เคสเปล่าหนึ่งใบที่อยู่ขั้นวัด Center */
function corridorCase(Tx $q): int
{
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'ค่า Cor',
        '0000000000'
    )['insertId'];

    return $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        'TEST-COR-' . bin2hex(random_bytes(4)),
        $cust,
        'centering',
        'new_glasses'
    )['insertId'];
}

test('บันทึก Cor. แล้วอ่านกลับได้ค่าเดิม', function () {
    rollback(function (Tx $q) {
        $case = corridorCase($q);
        Router::dispatch('POST', '/api/centerings', [], [
            'case_id'  => $case,
            'r_pd'     => '31.0',
            'l_pd'     => '31.0',
            'pd_total' => '62.0',
            'corridor' => '14',
        ]);

        $row = Router::dispatch('GET', '/api/centerings/' . $case, [], []);
        eq($row['corridor'] ?? '(ไม่มีคอลัมน์)', '14', 'ค่า Cor. ที่อ่านกลับมา');
        eq($row['r_pd'] ?? null, '31.0', 'ค่าอื่นที่บันทึกพร้อมกันยังอยู่ครบ');
    });
});

/* ช่องไม่บังคับ — ไม่กรอกต้องเป็น NULL แบบเดียวกับ CVD / Panto ไม่ใช่ข้อความว่าง
   ที่ทำให้ "ยังไม่ได้วัด" กับ "วัดแล้วได้ค่าว่าง" แยกกันไม่ออก */
test('ไม่กรอก Cor. เก็บเป็น NULL ไม่ใช่ข้อความว่าง', function () {
    rollback(function (Tx $q) {
        $case = corridorCase($q);
        Router::dispatch('POST', '/api/centerings', [], [
            'case_id'  => $case,
            'r_pd'     => '31.0',
            'l_pd'     => '31.0',
            'pd_total' => '62.0',
            'corridor' => '',
        ]);

        $row = Router::dispatch('GET', '/api/centerings/' . $case, [], []);
        ok(is_array($row) && array_key_exists('corridor', $row), 'แถว centerings ต้องมีคอลัมน์ corridor');
        eq($row['corridor'], null, 'ค่า Cor. ตอนไม่กรอก');
    });
});

/* บันทึกทับรอบสอง (แก้ค่า) ต้องได้ค่าใหม่ ไม่ใช่ค่ารอบแรกค้างอยู่ */
test('แก้ Cor. แล้วบันทึกทับ ได้ค่าใหม่', function () {
    rollback(function (Tx $q) {
        $case = corridorCase($q);
        $base = ['case_id' => $case, 'r_pd' => '31.0', 'l_pd' => '31.0', 'pd_total' => '62.0'];
        Router::dispatch('POST', '/api/centerings', [], $base + ['corridor' => '14']);
        Router::dispatch('POST', '/api/centerings', [], $base + ['corridor' => '18']);

        $row = Router::dispatch('GET', '/api/centerings/' . $case, [], []);
        eq($row['corridor'] ?? '(ไม่มีคอลัมน์)', '18', 'ค่า Cor. หลังแก้');
    });
});
