<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Roles;
use Optic\Service\Catalog;
use Optic\Service\LowStock;
use Optic\Service\Receiving;
use Optic\Service\Stock;

/**
 * สินค้ารอสั่ง · สองมุมมอง — ร้านขอไว้ 14 ก.ย. 2026
 *
 * หน้าเดิมคือ `state=backorder` ทั้งก้อน ซึ่งนับเลนส์ทุกค่าสายตาที่ไม่เคยสต็อกและไม่ได้ตั้ง
 * ขั้นต่ำเป็น "ของหมด" ด้วย — บนเครื่องจริงสองพันกว่าแถว ร้านบอกว่ามั่วและยาก:
 *
 *   alerted   ของที่เพิ่งถูกเตือนเข้า Telegram ว่าต่ำกว่าขั้นต่ำ (`low_stock_notified_at`)
 *             และยังไม่ได้เติม · เรียงจากที่เตือนล่าสุด
 *   ordering  ตั้งขั้นต่ำไว้แล้วต่ำกว่า หรือยอดติดลบ · ไม่รวมของที่แค่เหลือศูนย์โดยไม่ได้ตั้งขั้นต่ำ
 *
 * `backorder` เดิมไม่เปลี่ยน — แดชบอร์ดกับเมนูยังนับด้วยตัวนั้น
 *
 * ไฟล์นี้มีตัวช่วยของตัวเอง รันเดี่ยว ๆ ได้ (`run.php 72-`) ไม่ต้องพึ่งตัวช่วยในไฟล์ 70
 */

group('สินค้ารอสั่ง · สองมุมมอง');

/** สินค้าของเทสต์นี้ พร้อมของ `$qty` ชิ้น · `$tag` อยู่ในชื่อ ไว้ค้นหลายตัวพร้อมกัน */
function viewProduct(int $qty, int $minStock, string $tag = ''): array
{
    $sku = 'BV-' . strtoupper(bin2hex(random_bytes(3)));
    Catalog::createProduct([
        'sku'                => $sku,
        'name'               => trim("สินค้าทดสอบมุมมองรอสั่ง $tag"),
        'product_type'       => 'Frame',
        'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Frame'"),
        'base_selling_price' => '900.00',
        'min_stock'          => $minStock,
        'is_custom_made'     => false,
    ], [Roles::OWNER]);

    if ($qty > 0) {
        Receiving::receive([
            'sku'           => $sku,
            'quantity'      => $qty,
            'cost_per_unit' => '300.00',
            'received_date' => date('Y-m-d'),
        ], [Roles::OWNER], 1);
    }

    return ['sku' => $sku, 'id' => (int) Db::value('SELECT id FROM products WHERE sku = ?', [$sku])];
}

/** แถวของสินค้านี้ในสถานะนั้น หรือ null ถ้าไม่อยู่ */
function viewRow(array $p, string $state): ?array
{
    foreach (Inventory::products(['state' => $state, 'q' => $p['sku'], 'sort' => 'added'], true)['rows'] as $r) {
        if ($r['id'] === $p['id']) {
            return $r;
        }
    }
    return null;
}

function flagAt(array $p, string $at): void
{
    Db::run('UPDATE products SET low_stock_notified_at = ? WHERE id = ?', [$at, $p['id']]);
}

test('แจ้งเตือนล่าสุด: ขึ้นเมื่อถูกเตือนว่าต่ำกว่าขั้นต่ำ และหายเองเมื่อเติมจนพ้นขั้นต่ำ', function () {
    withRollback(function () {
        LowStock::reset();
        $p = viewProduct(5, 3);
        LowStock::collect();
        eq(viewRow($p, 'alerted'), null, 'ของยังพอ ไม่อยู่ในแจ้งเตือน');

        Stock::issue(issueReq($p['sku'], 3, idem('alert-view')));
        LowStock::collect();
        $row = viewRow($p, 'alerted');
        ok($row !== null, 'ต่ำกว่าขั้นต่ำแล้วถูกเตือน ต้องขึ้นในแจ้งเตือนล่าสุด');
        ok(is_string($row['lowStockNotifiedAt'] ?? null), 'แถวบอกเวลาที่เตือน — ได้ ' . render($row['lowStockNotifiedAt'] ?? null));

        Receiving::receive(
            ['sku' => $p['sku'], 'quantity' => 5, 'cost_per_unit' => '300.00', 'received_date' => date('Y-m-d')],
            [Roles::OWNER],
            1,
        );
        LowStock::collect();
        eq(viewRow($p, 'alerted'), null, 'เติมจนพ้นขั้นต่ำแล้วหาย');
        LowStock::reset();
    });
});

test('แจ้งเตือนล่าสุดเรียงจากที่เตือนล่าสุดขึ้นก่อน ไม่ใช่ตามสินค้าที่เพิ่มล่าสุด', function () {
    withRollback(function () {
        $tag = strtoupper(bin2hex(random_bytes(3)));
        $first = viewProduct(1, 3, $tag);   // id น้อยกว่า แต่เตือนทีหลัง
        $second = viewProduct(1, 3, $tag);
        flagAt($first, '2026-09-14 10:00:00');
        flagAt($second, '2026-09-13 09:00:00');

        $ids = array_column(
            Inventory::products(['state' => 'alerted', 'q' => $tag, 'sort' => 'alerted'], true)['rows'],
            'id',
        );
        eq($ids, [$first['id'], $second['id']], 'ลำดับ');
        LowStock::reset();
    });
});

test('ธงเตือนค้างทั้งที่ของพ้นขั้นต่ำแล้ว ไม่ขึ้นในแจ้งเตือนล่าสุด', function () {
    withRollback(function () {
        $p = viewProduct(5, 3);
        flagAt($p, '2026-09-14 09:00:00');
        eq(viewRow($p, 'alerted'), null, 'ของยังพอ แม้ธงยังไม่ถูกล้าง');
        LowStock::reset();
    });
});

test('ต่ำกว่าขั้นต่ำทั้งหมด: ไม่นับของที่แค่เหลือศูนย์โดยไม่ได้ตั้งขั้นต่ำ · นับยอดติดลบกับต่ำกว่าขั้นต่ำที่ตั้งไว้', function () {
    withRollback(function () {
        $zero = viewProduct(0, 0);
        $low = viewProduct(2, 3);
        $fine = viewProduct(5, 3);
        $neg = viewProduct(1, 0);
        Stock::issue(saleReq($neg['sku'], 3, idem('ordering-neg')));

        ok(viewRow($zero, 'backorder') !== null, 'ตัวกรองเดิมยังนับของหมดที่ไม่ได้ตั้งขั้นต่ำ — แดชบอร์ดไม่ถูกแตะ');
        eq(viewRow($zero, 'ordering'), null, 'ของหมดที่ไม่ได้ตั้งขั้นต่ำ');
        ok(viewRow($low, 'ordering') !== null, 'ต่ำกว่าขั้นต่ำที่ตั้งไว้');
        eq(viewRow($fine, 'ordering'), null, 'ของยังพอ');
        ok(viewRow($neg, 'ordering') !== null, 'ยอดติดลบ');
        LowStock::reset();
    });
});

test('จำนวนบนชิปของสองมุมมองตรงกับจำนวนแถว', function () {
    withRollback(function () {
        $p = viewProduct(1, 3);
        flagAt($p, '2026-09-14 09:00:00');

        $counts = Inventory::stockStateCounts([]);
        foreach (['alerted', 'ordering'] as $state) {
            ok(array_key_exists($state, $counts), "มีจำนวนของ $state");
            eq($counts[$state], Inventory::products(['state' => $state], true)['total'], "จำนวนของ $state");
        }
        LowStock::reset();
    });
});

test('เวลาที่เตือนก่อนระบบตั้งเขตเวลาไทย (ลงเป็น UTC) ถูกแปลงเป็นเวลาไทย · แถวหลังจากนั้นไม่แตะ', function () {
    withRollback(function () {
        $tag = strtoupper(bin2hex(random_bytes(3)));
        $old = viewProduct(1, 3, $tag);
        $new = viewProduct(1, 3, $tag);
        flagAt($old, '2026-09-12 06:25:51');
        flagAt($new, '2026-09-14 11:38:20');

        eq(viewRow($old, 'alerted')['lowStockNotifiedAt'], '2026-09-12 13:25:51', 'แถวเก่า UTC → ไทย');
        eq(viewRow($new, 'alerted')['lowStockNotifiedAt'], '2026-09-14 11:38:20', 'แถวใหม่เป็นเวลาไทยอยู่แล้ว');
        eq(Inventory::product($old['id'])['lowStockNotifiedAt'], '2026-09-12 13:25:51', 'ลิ้นชักสินค้าก็แปลงเหมือนกัน');
        LowStock::reset();
    });
});
