<?php

declare(strict_types=1);

/**
 * POS ขายกรอบแว่นกับคอนแทคเลนส์จากคลัง — ตัดสต็อกจริง
 *
 * สเปก: docs/superpowers/specs/2026-09-18-pos-sell-from-stock-design.md
 *
 * สี่เรื่องที่ไฟล์นี้เฝ้าไว้:
 *
 *   1. ขายของจากคลังแล้วล็อตลดจริง และสมุดคลังอ้างเลขบิล
 *   2. ของไม่พอ = ไม่มีใบเกิดขึ้นเลย (ตัดกับเขียนใบอยู่ใน transaction เดียวกัน)
 *   3. กดซ้ำไม่ตัดสองรอบ · ยกเลิกบิลแล้วของกลับเข้าคลัง
 *   4. ของจาก pos_items ยังไม่แตะคลังเหมือนเดิม
 *
 * ใช้ posCall / posCallError / posPaidSale / posItemId จาก 80-pos-items.test.php
 * ของทดสอบทุกชิ้นอยู่ใน rollback()
 */

group('POS ขายของจากคลัง');

/** สินค้าคลังหนึ่งตัวพร้อมล็อตเดียว — คืน [product_id, lot_id, sku] */
function posStockFixture(Tx $q, string $type, string $sku, int $qty): array
{
    $cat = (int) $q->get('SELECT id FROM categories WHERE code = ?', $type)['id'];
    $pid = (int) $q->run(
        'INSERT INTO products (sku, category_id, product_type, name, brand, base_selling_price, attributes)
         VALUES (?,?,?,?,?,?,?)',
        $sku, $cat, $type, "ทดสอบ $sku", 'TestBrand', '1500.00', '{}'
    )['insertId'];
    $lot = (int) $q->run(
        'INSERT INTO stock_lots (lot_number, product_id, initial_qty, remaining_qty, received_date)
         VALUES (?,?,?,?,CURDATE())',
        "LOT-$sku", $pid, max($qty, 1), $qty
    )['insertId'];
    return [$pid, $lot, $sku];
}

function posLotLeft(Tx $q, int $lot): int
{
    return (int) $q->get('SELECT remaining_qty FROM stock_lots WHERE id = ?', $lot)['remaining_qty'];
}

test('รายการกรอบจากคลัง มีคงเหลือและคีย์ที่หน้าเว็บใช้', function () {
    rollback(function (Tx $q) {
        posStockFixture($q, 'Frame', 'TST-POSFRM1', 2);
        $rows  = posCall('GET', '/api/pos/stock-products', [], ['type' => 'Frame']);
        $bySku = array_column($rows, null, 'sku');

        ok(isset($bySku['TST-POSFRM1']), 'ต้องเห็นกรอบทดสอบ');
        $r = $bySku['TST-POSFRM1'];
        eq($r['on_hand'], 2, 'คงเหลือ');
        eq($r['stock'], true, 'ธงของจากคลัง');
        eq($r['product_type'], 'Frame', 'ประเภท');
        eq($r['brand'], 'TestBrand', 'แบรนด์');
        eq($r['pos_fields'], [], 'กรอบไม่มีช่องกรอกเพิ่ม');
    });
});

test('คอนแทคเลนส์จากคลังถามข้าง ไม่ถามค่าสายตา', function () {
    rollback(function (Tx $q) {
        posStockFixture($q, 'ContactLen', 'TST-POSCTL1', 0);
        $rows  = posCall('GET', '/api/pos/stock-products', [], ['type' => 'ContactLen']);
        $r     = array_column($rows, null, 'sku')['TST-POSCTL1'] ?? null;

        ok($r !== null, 'ต้องเห็นคอนแทคเลนส์ทดสอบ แม้ของหมด');
        eq($r['on_hand'], 0, 'คงเหลือศูนย์');
        eq(array_column($r['pos_fields'], 'key'), ['eye'], 'ช่องกรอกมีแค่ข้าง');
    });
});

test('ประเภทอื่นนอกจากกรอบกับคอนแทคเลนส์ ขอไม่ได้', function () {
    try {
        posCall('GET', '/api/pos/stock-products', [], ['type' => 'Lens']);
        failTest('ต้อง 400');
    } catch (HttpError $e) {
        eq($e->status, 400, 'สถานะ');
    }
});

test('ขายกรอบจากคลัง ล็อตลด และสมุดคลังอ้างเลขบิล', function () {
    rollback(function (Tx $q) {
        [$pid, $lot, $sku] = posStockFixture($q, 'Frame', 'TST-POSFRM2', 2);

        $sale = posCall('POST', '/api/pos/sales', posPaidSale([
            ['stock_product_id' => $pid, 'quantity' => 1, 'unit_price' => 1500],
        ], 1500) + ['client_ref' => 'test-pos-stock-1']);

        eq(posLotLeft($q, $lot), 1, 'ล็อตเหลือ');
        $it = $sale['items'][0];
        eq((int) $it['product_id'], $pid, 'product_id ชี้สินค้าคลัง');
        eq($it['pos_item_id'], null, 'pos_item_id ว่าง');
        eq($it['sku_snapshot'], $sku, 'SKU');
        $meta = json_decode((string) $it['item_meta'], true);
        ok(($meta['stock_idem_key'] ?? '') !== '', 'จดคีย์การตัดไว้');

        $log = $q->get(
            "SELECT reference_doc, quantity FROM inventory_logs WHERE lot_id = ? AND action_type = 'OUT'
              ORDER BY id DESC LIMIT 1",
            $lot
        );
        ok($log !== null, 'มีแถวตัดในสมุดคลัง');
        eq($log['reference_doc'], $sale['pos_no'], 'สมุดอ้างเลขบิล');
    });
});

test('ของไม่พอ ขายไม่ได้ และไม่มีใบเกิดขึ้น', function () {
    rollback(function (Tx $q) {
        [$pid, $lot] = posStockFixture($q, 'Frame', 'TST-POSFRM3', 1);
        $before = (int) $q->get('SELECT COUNT(*) n FROM pos_sales')['n'];

        $e = posCallError('POST', '/api/pos/sales', posPaidSale([
            ['stock_product_id' => $pid, 'quantity' => 2, 'unit_price' => 1500],
        ], 3000));

        eq($e['status'], 400, 'ต้องเป็น 400');
        eq((int) $q->get('SELECT COUNT(*) n FROM pos_sales')['n'], $before, 'จำนวนใบไม่เปลี่ยน');
        eq(posLotLeft($q, $lot), 1, 'ล็อตไม่เปลี่ยน');
    });
});

test('คอนแทคเลนส์จากคลังไม่ระบุข้าง ขายไม่ได้', function () {
    rollback(function (Tx $q) {
        [$pid] = posStockFixture($q, 'ContactLen', 'TST-POSCTL2', 3);

        $e = posCallError('POST', '/api/pos/sales', posPaidSale([
            ['stock_product_id' => $pid, 'quantity' => 1, 'unit_price' => 900],
        ], 900));

        eq($e['status'], 400, 'ต้องเป็น 400');
        ok(str_contains($e['msg'], 'ต้องระบุข้าง'), 'ข้อความ — ได้ ' . $e['msg']);
    });
});

test('สินค้าคลังประเภทอื่น (เลนส์) ขายผ่าน POS ไม่ได้', function () {
    rollback(function (Tx $q) {
        [$pid] = posStockFixture($q, 'Lens', 'TST-POSLNS1', 3);

        $e = posCallError('POST', '/api/pos/sales', posPaidSale([
            ['stock_product_id' => $pid, 'quantity' => 1, 'unit_price' => 900],
        ], 900));

        eq($e['status'], 400, 'ต้องเป็น 400');
    });
});

test('กดซ้ำด้วย client_ref เดิม ได้ใบเดิม ไม่ตัดสองรอบ', function () {
    rollback(function (Tx $q) {
        [$pid, $lot] = posStockFixture($q, 'ContactLen', 'TST-POSCTL3', 3);
        $body = posPaidSale([
            ['stock_product_id' => $pid, 'quantity' => 1, 'unit_price' => 900, 'item_meta' => ['eye' => 'R']],
        ], 900) + ['client_ref' => 'test-pos-stock-dup'];

        $a = posCall('POST', '/api/pos/sales', $body);
        $b = posCall('POST', '/api/pos/sales', $body);

        eq($b['id'], $a['id'], 'ใบเดียวกัน');
        eq(posLotLeft($q, $lot), 2, 'ตัดครั้งเดียว');
    });
});

test('ยกเลิกบิล ของกลับเข้าคลัง', function () {
    rollback(function (Tx $q) {
        [$pid, $lot] = posStockFixture($q, 'Frame', 'TST-POSFRM4', 2);
        $sale = posCall('POST', '/api/pos/sales', posPaidSale([
            ['stock_product_id' => $pid, 'quantity' => 2, 'unit_price' => 1500],
        ], 3000));
        eq(posLotLeft($q, $lot), 0, 'ขายหมดล็อต');

        $v = posCall('POST', "/api/pos/sales/{$sale['id']}/void", ['reason' => 'ทดสอบคืนของ']);

        eq($v['status'], 'void', 'สถานะใบ');
        eq(posLotLeft($q, $lot), 2, 'ของกลับครบ');
        $meta = json_decode((string) $v['items'][0]['item_meta'], true);
        ok(($meta['stock_return_key'] ?? '') !== '', 'จดคีย์การคืนไว้');
    });
});

test('ขายรายการ pos_items ไม่แตะสมุดคลัง', function () {
    rollback(function (Tx $q) {
        $before = (int) $q->get('SELECT COUNT(*) n FROM inventory_logs')['n'];
        posCall('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => posItemId($q, 'SRV-0001'), 'quantity' => 1, 'unit_price' => 350],
        ], 350));
        eq((int) $q->get('SELECT COUNT(*) n FROM inventory_logs')['n'], $before, 'สมุดคลังไม่เพิ่ม');
    });
});
