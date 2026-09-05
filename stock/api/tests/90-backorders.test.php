<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Roles;
use Optic\Service\Receiving;
use Optic\Service\Stock;

/**
 * สินค้ารอสั่ง — หน้าจอที่ถามว่า "ตอนนี้ต้องสั่งอะไรบ้าง"
 *
 * หน้านั้นคือหน้าสินค้าและสต็อกที่ล็อกตัวกรองไว้ที่ `state=backorder` ทั้งหน้า
 * ตัวกรองจึงเป็นของชิ้นเดียวที่ต้องถูกทดสอบ — ถ้ามันตอบผิด หน้าจะบอกให้สั่งของ
 * ที่มีอยู่บนชั้น หรือเงียบไปทั้งที่ลูกค้ารอของอยู่
 *
 * ถามที่ยอดรวมของ SKU ไม่ใช่ที่ชื่อล็อต — ล็อตค้างส่งยังอยู่หลังหักกลบ (ยอดศูนย์)
 * และของบางตัวมีล็อตจริงเหลืออยู่พร้อมกับยอดค้าง แล้วรวมกันแล้วไม่ติดลบ
 */

/** ตัดของเกินที่มี แล้วคืน sku กับ product_id ของตัวที่ค้าง */
function backorderedSku(int $over): array
{
    $sku = skuWithLots(1);
    $onHand = Stock::availability($sku)['on_hand'];
    Stock::issue(issueReq($sku, $onHand + $over, idem('backorder')));

    return [
        'sku' => $sku,
        'id'  => (int) Db::value('SELECT id FROM products WHERE sku = ?', [$sku]),
    ];
}

group('สินค้ารอสั่ง');

test('ขายเกินของที่มี แล้วสินค้าโผล่ในตัวกรองสินค้ารอสั่ง', function () {
    withRollback(function () {
        $p = backorderedSku(2);

        eq(Stock::availability($p['sku'])['on_hand'], -2, 'ยอดติดลบตามที่ค้าง');
        eq(inState($p['id'], 'backorder'), true, 'ต้องอยู่ในรายการที่ต้องสั่ง');
    });
});

test('ของที่ยังมีบนชั้น ไม่ใช่ของที่ต้องสั่ง', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $id = (int) Db::value('SELECT id FROM products WHERE sku = ?', [$sku]);

        ok(Stock::availability($sku)['on_hand'] > 0, 'ตั้งต้นต้องมีของ');
        eq(inState($id, 'backorder'), false, 'มีของอยู่ ต้องไม่เข้ารายการ');

        /* ตัดจนหมดพอดี — ศูนย์ไม่ใช่ติดลบ ไม่มีลูกค้ารอของชิ้นที่ยังไม่ได้ขาย */
        Stock::issue(issueReq($sku, Stock::availability($sku)['on_hand'], idem('exact')));
        eq(inState($id, 'backorder'), false, 'หมดพอดีก็ยังไม่ใช่ของที่ต้องสั่ง');
    });
});

test('รับของเข้าแล้วแถวหายจากรายการเอง', function () {
    withRollback(function () {
        $p = backorderedSku(3);
        eq(inState($p['id'], 'backorder'), true, 'ก่อนของมาถึง');

        Receiving::receive([
            'sku'           => $p['sku'],
            'quantity'      => 3,
            'cost_per_unit' => '100.00',
            'received_date' => date('Y-m-d'),
        ], Roles::OWNER, 1);

        eq(Stock::availability($p['sku'])['on_hand'], 0, 'หักกลบหมดพอดี');
        /* ล็อตค้างส่งยังอยู่ ยอดเป็นศูนย์ — ตัวกรองที่ดูชื่อล็อตจะยังเห็นแถวนี้ */
        eq(inState($p['id'], 'backorder'), false, 'ของมาถึงแล้วต้องไม่เหลือค้าง');
    });
});

test('จำนวนบนชิปตรงกับจำนวนแถวที่ตัวกรองคืนมา', function () {
    withRollback(function () {
        $before = Inventory::stockStateCounts([])['backorder'];
        backorderedSku(1);
        $after = Inventory::stockStateCounts([]);

        eq($after['backorder'], $before + 1, 'เพิ่มขึ้นหนึ่งตัว');
        eq(
            $after['backorder'],
            Inventory::products(['state' => 'backorder', 'per' => 200], true)['total'],
            'ตัวเลขบนชิปกับจำนวนแถวจริงต้องเท่ากัน',
        );
    });
});

test('ของที่ขายไปก่อนของมาถึง ได้ต้นทุนตอนของมาถึงจริง', function () {
    withRollback(function () {
        $p = backorderedSku(2);

        // แถวขาออกที่ตัดจากล็อตค้างส่ง — ตอนขายยังไม่มีใครรู้ต้นทุน
        $short = Db::one(
            'SELECT id FROM stock_lots WHERE product_id = ? AND remaining_qty < 0',
            [$p['id']],
        );
        ok($short !== null, 'ต้องมีล็อตค้างส่ง');

        $blank = (int) Db::value(
            'SELECT COUNT(*) FROM inventory_logs WHERE lot_id = ? AND unit_cost IS NULL',
            [(int) $short['id']],
        );
        ok($blank > 0, 'ตอนขายต้องยังไม่มีต้นทุน');

        // ของมาถึงพร้อมใบกำกับ
        Receiving::receive([
            'sku'           => $p['sku'],
            'quantity'      => 5,
            'cost_per_unit' => '77.00',
            'received_date' => date('Y-m-d'),
        ], Roles::OWNER, 1);

        $lot = Db::one('SELECT cost_per_unit FROM stock_lots WHERE id = ?', [(int) $short['id']]);
        eq(round((float) $lot['cost_per_unit'], 2), 77.0, 'ล็อตค้างส่งต้องได้ต้นทุนของกล่องที่มาจ่ายหนี้');

        eq(
            (int) Db::value(
                'SELECT COUNT(*) FROM inventory_logs WHERE lot_id = ? AND unit_cost IS NULL',
                [(int) $short['id']],
            ),
            0,
            'แถวที่ออกไปตอนยังไม่รู้ต้นทุน ต้องได้ต้นทุนไปด้วย',
        );
    });
});

test('ของมาถึงโดยยังไม่รู้ต้นทุน ไม่ได้ไปเขียนอะไรทับ', function () {
    withRollback(function () {
        $p = backorderedSku(1);
        $short = Db::one(
            'SELECT id FROM stock_lots WHERE product_id = ? AND remaining_qty < 0',
            [$p['id']],
        );

        Receiving::receive([
            'sku'           => $p['sku'],
            'quantity'      => 3,
            'cost_per_unit' => null,
            'received_date' => date('Y-m-d'),
        ], Roles::OWNER, 1);

        $lot = Db::one('SELECT cost_per_unit FROM stock_lots WHERE id = ?', [(int) $short['id']]);
        eq($lot['cost_per_unit'], null, 'ไม่รู้ต้นทุนก็ยังไม่รู้ ไม่ใช่ศูนย์บาท');
    });
});
