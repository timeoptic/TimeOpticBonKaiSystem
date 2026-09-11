<?php

declare(strict_types=1);

/**
 * สต็อกจากระบบเดิม (legacy_stock) — หน้าบ้านอ่านประวัติได้ แต่เลือกของเก่าไม่ได้
 *
 * migration 032 ย้ายของ Access ออกจาก products/stock_lots · ออเดอร์เก่ายังชี้มาที่เลขชิ้น
 * ของ Access ผ่าน frame_product_id / lens_product_id จึงต้องอ่านผ่าน v_stock_lot_all
 * ส่วนที่ "เลือกของ" ยังอ่าน v_stock_lot ซึ่งมีแต่คลังจริง
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('สต็อกจากระบบเดิม (legacy_stock)');

/** ของเก่าหนึ่งชิ้น + ออเดอร์ที่ยังไม่ปิดซึ่งถือชิ้นนั้นเป็นกรอบ · คืน [order id, legacy id] */
function legacyOrder(Tx $q, string $name = 'Legacy Frame ทดสอบ'): array
{
    /* เลขสูงกว่าของ Access จริง (หกหมื่นกว่า) แต่ต่ำกว่าล็อตใหม่ (เริ่มล้าน) */
    $legacyId = 900000 + random_int(1, 99999);
    $q->run(
        'INSERT INTO legacy_stock (id, product_type, product_name, product_price, product_expense, stock_date, sold)
         VALUES (?,?,?,?,?,?,1)',
        $legacyId, 'Frame', $name, 3500, 1200, '2024-01-15'
    );
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ', 'สต็อกเก่า', '0000000000'
    )['insertId'];
    $order = $q->run(
        'INSERT INTO custom_orders (customer_id, frame_product_id, frame_name, total_price, order_closed)
         VALUES (?,?,?,?,0)',
        $cust, $legacyId, $name, 3500
    )['insertId'];
    return [(int) $order, $legacyId];
}

test('รายละเอียดออเดอร์เก่าเห็นกรอบจาก legacy_stock', function () {
    rollback(function (Tx $q) {
        [$order, $legacyId] = legacyOrder($q);
        $o = orderDetail($order);
        eq($o['frame']['id'] ?? null, $legacyId, 'id ของกรอบ');
        eq($o['frame']['product_name'] ?? null, 'Legacy Frame ทดสอบ', 'ชื่อกรอบ');
        eq($o['frame']['source'] ?? null, 'legacy', 'ที่มาของกรอบ');
    });
});

test('ของเก่าไม่อยู่ใน v_stock_lot (หน้าเลือกของ) แต่อยู่ใน v_stock_lot_all', function () {
    rollback(function (Tx $q) {
        [, $legacyId] = legacyOrder($q);
        eq($q->get('SELECT id FROM v_stock_lot WHERE id = ?', $legacyId), null, 'v_stock_lot ต้องไม่เห็นของเก่า');
        eq((int) ($q->get('SELECT id FROM v_stock_lot_all WHERE id = ?', $legacyId)['id'] ?? 0), $legacyId, 'v_stock_lot_all เห็นของเก่า');
    });
});

/* ออเดอร์เก่าที่ยังไม่ปิด — พนักงานเปิดฟอร์มแล้วกดบันทึกซ้ำโดยไม่เปลี่ยนกรอบ ต้องไม่ error
   และต้องไม่ไปแตะคลังจริง */
test('บันทึกออเดอร์เก่าซ้ำด้วยกรอบเดิมผ่าน และไม่ตัดคลังจริง', function () {
    rollback(function (Tx $q) {
        [$order, $legacyId] = legacyOrder($q);
        $logsBefore = (int) $q->get('SELECT COUNT(*) n FROM inventory_logs')['n'];
        $o = Router::dispatch('POST', "/api/orders/$order/fill", [], ['frame_product_id' => $legacyId]);
        eq((int) ($o['frame_product_id'] ?? 0), $legacyId, 'กรอบหลังบันทึกซ้ำ');
        eq((int) $q->get('SELECT COUNT(*) n FROM inventory_logs')['n'], $logsBefore, 'สมุดคลังต้องไม่มีรายการเพิ่ม');
    });
});

test('เลือกของเก่าที่ออเดอร์ไม่ได้ถืออยู่ไม่ได้', function () {
    rollback(function (Tx $q) {
        [, $legacyId] = legacyOrder($q, 'ของเก่าชิ้นแรก');
        [$other] = legacyOrder($q, 'ของเก่าชิ้นที่สอง');
        $threw = false;
        try {
            Router::dispatch('POST', "/api/orders/$other/fill", [], ['frame_product_id' => $legacyId]);
        } catch (AssertionFailed $e) {
            throw $e;
        } catch (Throwable $e) {
            $threw = true;
        }
        ok($threw, 'ต้องปฏิเสธการเลือกของเก่าที่ไม่ได้อยู่ในคลังจริง');
    });
});
