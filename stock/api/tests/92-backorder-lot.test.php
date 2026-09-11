<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Roles;
use Optic\Service\Catalog;
use Optic\Service\Stock;

/**
 * ล็อตค้างส่งที่เปิดให้ก่อนขาย — สินค้าที่ไม่เคยรับของเข้าเลย
 *
 * หน้าขายของหน้าร้านเก็บ "id ของล็อต" ลงออเดอร์ แล้วตอนยืนยันการขายค่อยแปลงเป็น SKU
 * ส่งมาตัดที่นี่ · สินค้าที่มีแต่ชื่อในแคตตาล็อก (ยังไม่มีล็อตสักใบ) จึงเลือกไม่ได้เลย
 * ทั้งที่การขายหน้าร้านตัดติดลบได้อยู่แล้ว (`MAY_GO_SHORT`)
 *
 * `Stock::backorderLot()` เปิดล็อตค้างส่ง `SHORT-<sku>` ยอดศูนย์ให้ก่อน — ใบเดียวกับ
 * ที่การตัดติดลบจะไปลงอยู่แล้ว ไม่ใช่ล็อตแบบใหม่
 */

group('ล็อตค้างส่งที่เปิดให้ก่อนขาย');

/** สินค้าในแคตตาล็อกที่ยังไม่เคยรับของเข้า */
function catalogOnlyProduct(bool $customMade = false): string
{
    $sku = 'BL-' . strtoupper(bin2hex(random_bytes(3)));
    Catalog::createProduct([
        'sku'                => $sku,
        'name'               => 'เลนส์ทดสอบที่ยังไม่เคยรับเข้า',
        'product_type'       => 'Lens',
        'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'"),
        'base_selling_price' => '900.00',
        'is_custom_made'     => $customMade,
    ], [Roles::OWNER]);
    return $sku;
}

test('สินค้าที่ไม่มีล็อต ได้ล็อตค้างส่งยอดศูนย์หนึ่งใบ', function () {
    withRollback(function () {
        $sku = catalogOnlyProduct();
        $pid = (int) Db::value('SELECT id FROM products WHERE sku = ?', [$sku]);
        eq((int) Db::value('SELECT COUNT(*) FROM stock_lots WHERE product_id = ?', [$pid]), 0, 'ตั้งต้นไม่มีล็อต');

        $r = Stock::backorderLot($sku);

        $lot = Db::one('SELECT lot_number, initial_qty, remaining_qty FROM stock_lots WHERE id = ?', [$r['lot_id']]);
        eq($lot['lot_number'] ?? null, 'SHORT-' . $sku, 'เลขล็อต');
        eq((int) $lot['initial_qty'], 0, 'รับเข้าศูนย์');
        eq((int) $lot['remaining_qty'], 0, 'คงเหลือศูนย์');
        eq(Stock::availability($sku)['on_hand'], 0, 'ยอดคงเหลือของสินค้ายังเป็นศูนย์');
        eq((int) Db::value('SELECT COUNT(*) FROM inventory_logs WHERE lot_id = ?', [$r['lot_id']]), 0, 'ไม่มีของเคลื่อน จึงไม่มีแถวในสมุด');
    });
});

test('เรียกซ้ำได้ใบเดิม ไม่เปิดล็อตใหม่ทุกครั้งที่มีคนกดเลือก', function () {
    withRollback(function () {
        $sku = catalogOnlyProduct();
        $a = Stock::backorderLot($sku);
        $b = Stock::backorderLot($sku);
        eq($b['lot_id'], $a['lot_id'], 'id ของล็อตครั้งที่สอง');
        $pid = (int) Db::value('SELECT id FROM products WHERE sku = ?', [$sku]);
        eq((int) Db::value('SELECT COUNT(*) FROM stock_lots WHERE product_id = ?', [$pid]), 1, 'ยังมีล็อตใบเดียว');
    });
});

test('ขายหน้าร้านหลังจากนั้น ยอดติดลบลงบนล็อตใบเดียวกัน', function () {
    withRollback(function () {
        $sku = catalogOnlyProduct();
        $r = Stock::backorderLot($sku);

        Stock::issue(saleReq($sku, 1, idem('after-backorder-lot')));

        eq(Stock::availability($sku)['on_hand'], -1, 'ยอดหลังขาย');
        eq((int) Db::value('SELECT remaining_qty FROM stock_lots WHERE id = ?', [$r['lot_id']]), -1, 'ยอดติดลบอยู่บนล็อตค้างส่งใบนั้น');
        $pid = (int) Db::value('SELECT id FROM products WHERE sku = ?', [$sku]);
        eq((int) Db::value('SELECT COUNT(*) FROM stock_lots WHERE product_id = ?', [$pid]), 1, 'ไม่มีล็อตค้างส่งใบที่สอง');
    });
});

test('สินค้าสั่งตัดไม่มีสต็อก — ไม่เปิดล็อตให้', function () {
    withRollback(function () {
        $sku = catalogOnlyProduct(true);
        throwsReason('custom_made', fn() => Stock::backorderLot($sku), 'สินค้าสั่งตัด');
    });
});

test('SKU ที่ไม่มีอยู่ ปฏิเสธ', function () {
    withRollback(function () {
        throwsReason('unknown_sku', fn() => Stock::backorderLot('NO-SUCH-' . bin2hex(random_bytes(3))), 'SKU ที่ไม่มี');
    });
});
