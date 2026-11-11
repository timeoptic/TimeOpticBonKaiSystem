<?php

declare(strict_types=1);

/**
 * ประเภทกรอบของออเดอร์ — ช่อง "ประเภทกรอบ" ในการ์ดกรอบแว่นของขั้นขาย
 *
 * ยิงผ่าน Router::dispatch() เส้นเดียวกับที่หน้าเว็บกดบันทึกออเดอร์ แล้วอ่านแถวกลับ
 * จากฐานตรง ๆ · รายการตัวเลือกเทียบกับ Lookups::lists() ตัวที่ /api/meta ส่งให้หน้าเว็บ
 * ช่องเลือกบนหน้าจอกับด่านตรวจค่าของ API จึงอ่านรายการเดียวกัน
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('ประเภทกรอบของออเดอร์');

/** เรียงตามที่เจ้าของร้านกำหนด (2026-09-10) — ลำดับนี้คือลำดับในช่องเลือก */
function expectedFrameTypes(): array
{
    return ['กรอบเต็มโลหะ', 'กรอบเต็มพลาสติก', 'กรอบเซาะร่องเอ็น', 'กรอบเซาะร่องเหล็ก', 'กรอบเซาะร่องพลาสติก', 'กรอบเจาะ'];
}

function frameTypeCustomer(Tx $q): int
{
    return $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'ประเภทกรอบ',
        '0000000000'
    )['insertId'];
}

/** เปิดออเดอร์ผ่าน route ตัวจริง แล้วคืนแถวที่อ่านกลับจากฐาน */
function orderWithFrameType(Tx $q, mixed $frameType): array
{
    $saved = Router::dispatch('POST', '/api/orders', [], [
        'customer_id' => frameTypeCustomer($q),
        'frame_name'  => 'กรอบทดสอบ',
        'frame_price' => '1500',
        'frame_type'  => $frameType,
    ]);
    return $q->get('SELECT * FROM custom_orders WHERE id = ?', (int) $saved['id']);
}

test('ตัวเลือกประเภทกรอบมีหกแบบ เรียงตามที่ร้านใช้', function () {
    eq(Lookups::lists()['frame_type'] ?? null, expectedFrameTypes(), 'รายการที่ /api/meta ส่งให้หน้าเว็บ');
});

test('เลือกประเภทกรอบแล้วบันทึกลงออเดอร์', function () {
    rollback(function (Tx $q) {
        $row = orderWithFrameType($q, 'กรอบเซาะร่องเอ็น');
        eq($row['frame_type'] ?? '(ไม่มีคอลัมน์)', 'กรอบเซาะร่องเอ็น', 'ประเภทกรอบที่บันทึก');
        eq($row['frame_name'], 'กรอบทดสอบ', 'ข้อมูลกรอบอื่นยังบันทึกตามปกติ');
    });
});

test('ทุกประเภทในรายการบันทึกได้', function () {
    rollback(function (Tx $q) {
        foreach (expectedFrameTypes() as $type) {
            eq(orderWithFrameType($q, $type)['frame_type'] ?? '(ไม่มีคอลัมน์)', $type, "บันทึก $type");
        }
    });
});

/* บังคับเลือกตั้งแต่ 11 พ.ย. 2026 (ร้านขอ) — ค่าคอมงานเจียใน HRMS คิดจากประเภทกรอบ */
test('ไม่เลือกประเภทกรอบ ถูกปฏิเสธด้วย 400 ทั้งเปิดและแก้ออเดอร์', function () {
    rollback(function (Tx $q) {
        foreach (['', '   ', null] as $blank) {
            try {
                orderWithFrameType($q, $blank);
                ok(false, 'เปิดออเดอร์ไม่มีประเภทกรอบต้องไม่ผ่าน (' . var_export($blank, true) . ')');
            } catch (HttpError $e) {
                eq($e->status, 400, 'สถานะ');
                ok(str_contains($e->getMessage(), 'กรุณาเลือกประเภทกรอบ'), 'ข้อความบอกว่าต้องเลือก');
            }
        }
        $row = orderWithFrameType($q, 'กรอบเจาะ');
        try {
            Router::dispatch('PUT', '/api/orders/' . $row['id'], [], [
                'customer_id' => $row['customer_id'],
                'frame_name'  => 'กรอบทดสอบ',
                'frame_price' => '1500',
                'frame_type'  => '',
            ]);
            ok(false, 'แก้ออเดอร์ให้ประเภทกรอบว่างต้องไม่ผ่าน');
        } catch (HttpError $e) {
            eq($e->status, 400, 'สถานะตอนแก้');
        }
        eq($q->get('SELECT frame_type FROM custom_orders WHERE id = ?', $row['id'])['frame_type'], 'กรอบเจาะ', 'ค่าเดิมยังอยู่');
    });
});

/* ช่องบนหน้าจอเป็นตัวเลือกล็อก แต่ API ต้องกันเองด้วย — ไม่งั้นยิงตรงเข้ามาได้คำ
   สิบแบบในสิบใบ แล้วนับทีหลังไม่ได้ว่าใบไหนกรอบเจาะ */
test('ค่าที่ไม่อยู่ในรายการถูกปฏิเสธด้วย 400', function () {
    rollback(function (Tx $q) {
        try {
            Router::dispatch('POST', '/api/orders', [], [
                'customer_id' => frameTypeCustomer($q),
                'frame_type'  => 'กรอบทองคำ',
            ]);
        } catch (HttpError $e) {
            eq($e->status, 400, 'รหัสตอบกลับ');
            return;
        }
        failTest('ค่าที่ไม่อยู่ในรายการต้องถูกปฏิเสธ แต่บันทึกผ่าน');
    });
});

/* PUT เขียนทับทุกคอลัมน์ — แก้ออเดอร์ต้องเปลี่ยนประเภทได้ และค่าที่ส่งมาต้องชนะค่าเดิม */
test('แก้ออเดอร์แล้วเปลี่ยนประเภทกรอบได้', function () {
    rollback(function (Tx $q) {
        $row = orderWithFrameType($q, 'กรอบเต็มโลหะ');
        Router::dispatch('PUT', '/api/orders/' . $row['id'], [], [
            'customer_id' => $row['customer_id'],
            'frame_name'  => 'กรอบทดสอบ',
            'frame_type'  => 'กรอบเจาะ',
        ]);
        $after = $q->get('SELECT frame_type FROM custom_orders WHERE id = ?', (int) $row['id']);
        eq($after['frame_type'] ?? '(ไม่มีคอลัมน์)', 'กรอบเจาะ', 'ประเภทกรอบหลังแก้');
    });
});
