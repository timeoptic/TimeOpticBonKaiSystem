<?php

declare(strict_types=1);

/**
 * ขั้นขาย — เลนส์สั่งตัด RX นับว่ามีเลนส์
 *
 * เหตุการณ์จริง 11 ก.ย. 2026: เคส 10460 เลือกเลนส์สั่งตัด RX ครบสองข้างแล้ว (ใบสั่ง
 * RX-2026-0001/0002) แต่ขั้นขายยังขึ้น "ยังขาด: เลนส์" · ฟอร์มเก็บเลนส์ RX ไว้ที่ชื่อ
 * แยกข้าง (lens_r_name / lens_l_name) ส่วน lens_name ว่าง และเกณฑ์ทั้งสองชุดอ่านแค่
 * lens_name — processMissing() ที่ปุ่มยืนยันใช้ กับ caseStageMap() ที่กระดานใช้
 *
 * ของทดสอบในฐานอยู่ในทรานแซกชันที่ roll back เสมอ
 */

group('ขั้นขาย — เลนส์สั่งตัด RX นับว่ามีเลนส์');

const RX_LENS = 'Hitop FTphotogrey1.5 Bifocal';

/** สิ่งที่ขั้นขายยังขาด สำหรับออเดอร์หน้าตาแบบนี้ */
function salesMissingFor(array $order): array
{
    return processMissing([
        'order'         => $order + ['frame_name' => 'oldframe', 'total_price' => 2900],
        'prescriptions' => [],
        'centering'     => null,
        'delivery'      => null,
        'payments'      => [],
        'balance'       => null,
        'customer_id'   => 1,
        'received_by'   => 1,
    ])['sales'];
}

test('เลนส์ RX สองข้าง แม้ lens_name ว่าง ไม่ขึ้นว่าขาดเลนส์', function () {
    $missing = salesMissingFor(['lens_name' => null, 'lens_r_name' => RX_LENS, 'lens_l_name' => RX_LENS]);
    ok(!in_array('เลนส์', $missing, true), 'ยังขาด: ' . implode(', ', $missing));
});

test('มีเลนส์ข้างเดียว (ซ้าย) ก็นับว่ามีเลนส์', function () {
    $missing = salesMissingFor(['lens_name' => '', 'lens_r_name' => null, 'lens_l_name' => RX_LENS]);
    ok(!in_array('เลนส์', $missing, true), 'ยังขาด: ' . implode(', ', $missing));
});

test('ออเดอร์เลนส์สต็อกแบบเดิม (มีแต่ lens_name) ยังนับว่ามีเลนส์', function () {
    $missing = salesMissingFor(['lens_name' => 'Hoya 1.56', 'lens_r_name' => null, 'lens_l_name' => null]);
    ok(!in_array('เลนส์', $missing, true), 'ยังขาด: ' . implode(', ', $missing));
});

test('ไม่มีชื่อเลนส์สักช่อง ยังขึ้นว่าขาดเลนส์', function () {
    eq(salesMissingFor(['lens_name' => null, 'lens_r_name' => '', 'lens_l_name' => null]), ['เลนส์'], 'สิ่งที่ขาด');
});

test('กระดาน: เคสที่ออเดอร์มีแต่เลนส์ RX ไม่ค้างที่ขั้นขาย', function () {
    rollback(function (Tx $q) {
        $tag  = bin2hex(random_bytes(3));
        $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "RX-$tag")['insertId'];
        $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-RXL-$tag", $cust)['insertId'];
        $q->run(
            "INSERT INTO custom_orders (customer_id, case_id, order_date, frame_name, lens_name, lens_r_name, lens_l_name, total_price, discount)
             VALUES (?, ?, NOW(), 'oldframe', NULL, ?, ?, 2900, 0)",
            $cust, $case, RX_LENS, RX_LENS
        );
        /* ขาย ✓ แล้วยังไม่มีการรับเงิน — ขั้นถัดไปที่ยังเปิดอยู่คือชำระเงิน */
        eq(caseStageMap([$case])[$case]['process_stage'], 'payment', 'ขั้นของเคสบนกระดาน');
    });
});
