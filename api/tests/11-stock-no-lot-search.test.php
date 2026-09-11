<?php

declare(strict_types=1);

/**
 * ช่องค้นหาในหน้าขายต้องเจอสินค้าที่ยังไม่เคยรับของเข้า — `stockProductsWithoutLots()`
 *
 * `GET /api/stock` ไล่จาก `v_stock_lot` ซึ่งเริ่มที่ล็อต สินค้าที่มีแต่ชื่อในแคตตาล็อก
 * จึงไม่เคยโผล่ ทั้งที่ขายหน้าร้านตัดติดลบได้ · เจอเรื่องจริงวันที่ 2026-09-10 — โหลด
 * แคตตาล็อกเลนส์ 2,648 รุ่น มีของจริงแค่ 704 ที่เหลือค้นไม่เจอเลย
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('ค้นหาสินค้าที่ยังไม่มีล็อต');

/** สินค้าเปล่า ไม่มีล็อต · คืน id */
function noLotProduct(Tx $q, string $sku, string $name, int $cat = 31, string $type = 'Lens', int $custom = 0): int
{
    return (int) $q->run(
        'INSERT INTO products (sku, category_id, product_type, name, brand, base_selling_price, is_custom_made, attributes)
         VALUES (?,?,?,?,?,?,?,?)',
        $sku, $cat, $type, $name, 'Hitop', '850.00', $custom,
        json_encode(['coating' => 'MC', 'lens_index' => '1.50', 'lens_design' => 'Single Vision'])
    )['insertId'];
}

/** SKU ที่เจอ จำกัดเฉพาะของทดสอบ */
function noLotSkus(string $term, ?string $type = 'Lens'): array
{
    $rows = array_filter(stockProductsWithoutLots($term, $type), fn($r) => str_starts_with((string) $r['sku'], 'TNL-'));
    $skus = array_column($rows, 'sku');
    sort($skus);
    return $skus;
}

test('สินค้าที่ไม่มีล็อตค้นเจอ พร้อมยอดศูนย์และไม่มี id ล็อต', function () {
    rollback(function (Tx $q) {
        $pid = noLotProduct($q, 'TNL-SV150', 'Hitop MC Single Vision (1.50) -6.00/0.00');
        $rows = array_values(array_filter(stockProductsWithoutLots('TNL-SV150', 'Lens'), fn($r) => $r['sku'] === 'TNL-SV150'));
        eq(count($rows), 1, 'จำนวนแถว');
        eq($rows[0]['id'], null, 'id ล็อต');
        eq((int) $rows[0]['product_id'], $pid, 'product_id');
        eq((int) $rows[0]['remaining_qty'], 0, 'คงเหลือ');
        eq($rows[0]['product_name'], 'Hitop MC Single Vision (1.50) -6.00/0.00', 'ชื่อ');
    });
});

test('คำค้นแบบคนขาย ("MC 1.5") ใช้กับสินค้าที่ไม่มีล็อตได้เหมือนกัน', function () {
    rollback(function (Tx $q) {
        noLotProduct($q, 'TNL-SV150', 'Hitop MC Single Vision (1.50) -6.00/0.00');
        eq(noLotSkus('MC 1.5'), ['TNL-SV150'], 'MC 1.5');
        eq(noLotSkus('6.00'), ['TNL-SV150'], 'ค่าสายตาในชื่อ');
        eq(noLotSkus('blue 1.5'), [], 'คำที่ไม่ตรง');
    });
});

test('สินค้าที่มีล็อตแล้วไม่ซ้ำในรายการนี้ — ส่วนนั้นมาจาก v_stock_lot', function () {
    rollback(function (Tx $q) {
        $pid = noLotProduct($q, 'TNL-HASLOT', 'Hitop MC Single Vision (1.50) -5.00/0.00');
        $q->run(
            "INSERT INTO stock_lots (lot_number, product_id, initial_qty, remaining_qty, received_date) VALUES ('L1', ?, 2, 2, CURDATE())",
            $pid
        );
        eq(noLotSkus('TNL-HASLOT'), [], 'มีล็อตแล้ว');
    });
});

test('สินค้าสั่งตัดไม่อยู่ในรายการ — เลนส์สั่งตัดใช้ปุ่มสั่งตัด RX', function () {
    rollback(function (Tx $q) {
        noLotProduct($q, 'TNL-RX', 'Hitop RX Progressive', 31, 'Lens', 1);
        eq(noLotSkus('TNL-RX'), [], 'สั่งตัด');
    });
});

test('กรองประเภทได้ — ช่องเลนส์ไม่เห็นกรอบ', function () {
    rollback(function (Tx $q) {
        noLotProduct($q, 'TNL-FRAME', 'Frame no lot', 32, 'Frame');
        eq(noLotSkus('TNL-FRAME', 'Lens'), [], 'ค้นในช่องเลนส์');
        eq(noLotSkus('TNL-FRAME', 'Frame'), ['TNL-FRAME'], 'ค้นในช่องกรอบ');
    });
});
