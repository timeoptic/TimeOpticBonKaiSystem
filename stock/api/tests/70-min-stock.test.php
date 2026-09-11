<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Repo\Reports;
use Optic\Roles;
use Optic\Service\Catalog;
use Optic\Service\Receiving;
use Optic\Service\Stock;

/** Whether a product comes back under a given stock-state filter. */
function inState(int $id, string $state): bool
{
    $page = Inventory::products(['state' => $state, 'per' => 100], true);
    foreach ($page['rows'] as $r) {
        if ($r['id'] === $id) {
            return true;
        }
    }
    return false;
}

group('จำนวนขั้นต่ำ');

test('ตั้งขั้นต่ำแล้วเก็บได้ และอ่านกลับมาได้ทั้งในรายการและในหน้าสินค้า', function () {
    withRollback(function () {
        $p = productAtLevel(10, 4);

        eq(Inventory::product($p['id'], true)['minStock'], 4, 'ขั้นต่ำในหน้าสินค้า');

        $page = Inventory::products(['q' => $p['sku']], true);
        eq($page['rows'][0]['minStock'], 4, 'ขั้นต่ำในแถวรายการ');
    });
});

test('ขั้นต่ำ 0 = เตือนตอนของหมด — คนลืมกรอก ต้องไม่กลายเป็นไม่มีใครรู้ว่าของหมด', function () {
    withRollback(function () {
        /* เจ้าของร้านตัดสินใจ 2026-09-10: ช่องขั้นต่ำเปิดมาเป็น 0 เพราะคนชอบลืมกรอก
           และ 0 ต้องแปลว่า "เตือนเมื่อหมด" ไม่ใช่ "ไม่ต้องเตือน" · เดิม 0 คือเงียบ
           ผลคือสินค้าที่ไม่มีใครกรอกขั้นต่ำ หมดจนติดลบก็ไม่มีอะไรบอกใคร */
        $empty = productAtLevel(0, 0);
        eq(Inventory::product($empty['id'], true)['minStock'], 0, 'ค่าเริ่มต้นของขั้นต่ำ');
        eq(inState($empty['id'], 'low'), true, 'ขั้นต่ำ 0 และของหมด ต้องเข้าตัวกรอง low');
        eq(inState($empty['id'], 'out'), true, 'และยังนับว่าหมดสต็อกตามเดิม');

        $stocked = productAtLevel(3, 0);
        eq(inState($stocked['id'], 'low'), false, 'ขั้นต่ำ 0 แต่ยังมีของ ยังไม่ต้องเตือน');
    });
});

test('เหลือเท่ากับขั้นต่ำก็เตือนแล้ว — เส้นคือ ≤ ไม่ใช่ <', function () {
    withRollback(function () {
        $above = productAtLevel(6, 5);
        eq(inState($above['id'], 'low'), false, 'เหลือมากกว่าขั้นต่ำหนึ่งชิ้น');

        $atLevel = productAtLevel(5, 5);
        eq(inState($atLevel['id'], 'low'), true, 'เหลือเท่าขั้นต่ำพอดี');

        $below = productAtLevel(4, 5);
        eq(inState($below['id'], 'low'), true, 'เหลือน้อยกว่าขั้นต่ำหนึ่งชิ้น');
    });
});

test('ของหมดแต่ตั้งขั้นต่ำไว้ ยังนับว่าต่ำกว่าขั้นต่ำ — เตือนสายดีกว่าไม่เตือน', function () {
    withRollback(function () {
        $p = productAtLevel(0, 3);
        eq(inState($p['id'], 'low'), true, 'ของหมดต้องเข้าตัวกรอง low ด้วย');
        eq(inState($p['id'], 'out'), true, 'และยังเข้าตัวกรองหมดสต็อกตามเดิม');
    });
});

test('ตัดของจนต่ำกว่าขั้นต่ำ แล้วยอดนับขึ้นเอง — ไม่มีค่าที่เก็บไว้ให้เพี้ยน', function () {
    withRollback(function () {
        $p = productAtLevel(6, 5);
        eq(inState($p['id'], 'low'), false, 'ก่อนตัด ยังเหนือขั้นต่ำ');

        $before = Inventory::summary(true)['lowStock'];
        Stock::issue(issueReq($p['sku'], 2, idem('min-stock')));

        eq(inState($p['id'], 'low'), true, 'ตัดออกสองชิ้นแล้วต่ำกว่าขั้นต่ำ');
        eq(Inventory::summary(true)['lowStock'], $before + 1, 'ยอดรวมบนหน้าจอขยับตาม');
    });
});

test('สินค้าสั่งตัด RX ไม่เคยถูกนับว่าต่ำกว่าขั้นต่ำ — มันไม่มีสต็อกให้ต่ำ', function () {
    withRollback(function () {
        $sku = 'MIN-' . strtoupper(bin2hex(random_bytes(3)));
        $out = Catalog::createProduct([
            'sku'                => $sku,
            'name'               => 'เลนส์สั่งตัดทดสอบ',
            'product_type'       => 'Lens',
            'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'"),
            'base_selling_price' => '4500.00',
            // Deliberately set: the guard has to be the kind of product, not the
            // absence of a figure, or one saved by mistake would alert forever.
            'min_stock'          => 5,
            'is_custom_made'     => true,
        ], [Roles::OWNER]);

        eq(inState($out['id'], 'low'), false, 'สินค้าสั่งตัดต้องไม่เข้าตัวกรอง low');
    });
});

test('ชิปนับยอดตรงกับจำนวนแถวที่ตัวกรองคืนมา', function () {
    withRollback(function () {
        productAtLevel(1, 9);
        productAtLevel(0, 2);

        $counts = Inventory::stockStateCounts([]);
        $page = Inventory::products(['state' => 'low', 'per' => 100], true);

        eq($counts['low'], $page['total'], 'ตัวเลขบนชิปกับยอดรวมของรายการ');
        eq($counts['low'], Inventory::summary(true)['lowStock'], 'และตรงกับตัวเลขบนหน้าสรุป');
    });
});

group('แก้ทีละช่อง ไม่ลบของที่ไม่ได้พูดถึง');

test('แก้ราคาอย่างเดียว ต้องไม่ล้างสเปกเลนส์ทิ้ง', function () {
    withRollback(function () {
        $sku = 'MIN-' . strtoupper(bin2hex(random_bytes(3)));
        $lens = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
        $out = Catalog::createProduct([
            'sku'                => $sku,
            'name'               => 'เลนส์ทดสอบสเปก',
            'product_type'       => 'Lens',
            'category_id'        => $lens,
            'base_selling_price' => '3200.00',
            'min_stock'          => 3,
            'is_custom_made'     => false,
            'attributes'         => ['lens_index' => '1.60', 'coating' => 'Crizal', 'sph' => -2.25],
        ], [Roles::OWNER]);

        // Exactly what the inline price edit on the product list sends: the
        // row's own facts, no `attributes`, no `min_stock`.
        Catalog::updateProduct($out['id'], [
            'sku'                => $sku,
            'name'               => 'เลนส์ทดสอบสเปก',
            'product_type'       => 'Lens',
            'category_id'        => $lens,
            'base_selling_price' => '3400.00',
            'is_custom_made'     => false,
        ], [Roles::OWNER]);

        $after = Inventory::product($out['id'], true);
        eq($after['basePrice'], 3400.0, 'ราคาที่แก้');
        eq($after['lensIndex'], '1.60', 'ดัชนีหักเหต้องยังอยู่');
        eq($after['coating'], 'Crizal', 'โค้ตติ้งต้องยังอยู่');
        eq($after['sph'], -2.25, 'ค่าสายตาต้องยังอยู่');
        eq($after['minStock'], 3, 'ขั้นต่ำที่ไม่ได้พูดถึงต้องไม่ถูกล้าง');
    });
});

test('ส่ง attributes มาเป็นอ็อบเจกต์ว่าง คือสั่งล้างจริง ๆ', function () {
    withRollback(function () {
        $sku = 'MIN-' . strtoupper(bin2hex(random_bytes(3)));
        $lens = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
        $base = [
            'sku'                => $sku,
            'name'               => 'เลนส์ทดสอบล้างสเปก',
            'product_type'       => 'Lens',
            'category_id'        => $lens,
            'base_selling_price' => '3200.00',
            'is_custom_made'     => false,
        ];
        $out = Catalog::createProduct($base + ['attributes' => ['coating' => 'Crizal']], [Roles::OWNER]);

        Catalog::updateProduct($out['id'], $base + ['attributes' => []], [Roles::OWNER]);

        eq(Inventory::product($out['id'], true)['coating'], null, 'สเปกถูกล้างตามที่สั่ง');
    });
});

test('ขั้นต่ำติดลบหรือไม่ใช่จำนวนเต็ม ถูกปฏิเสธ', function () {
    withRollback(function () {
        $args = static fn(mixed $v): array => [
            'sku'                => 'MIN-' . strtoupper(bin2hex(random_bytes(3))),
            'name'               => 'สินค้าทดสอบขั้นต่ำ',
            'product_type'       => 'Frame',
            'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Frame'"),
            'base_selling_price' => '900.00',
            'min_stock'          => $v,
            'is_custom_made'     => false,
        ];

        throwsReason('bad_min_stock', fn() => Catalog::createProduct($args('-1'), [Roles::OWNER]), 'ขั้นต่ำติดลบ');
        throwsReason('bad_min_stock', fn() => Catalog::createProduct($args('2.5'), [Roles::OWNER]), 'ขั้นต่ำมีทศนิยม');
        throwsReason('bad_min_stock', fn() => Catalog::createProduct($args('มาก'), [Roles::OWNER]), 'ขั้นต่ำเป็นตัวอักษร');
        throwsReason('bad_min_stock', fn() => Catalog::createProduct($args(1000000), [Roles::OWNER]), 'ขั้นต่ำสูงเกินจริง');
    });
});

group('ขายดี และค้างสต๊อกนาน');

test('ของที่เพิ่งตัดออก ไม่โผล่ในรายการค้างนาน แต่ขึ้นในรายการขายดี', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        Stock::issue(issueReq($sku, 1, idem('movers')));

        $m = Reports::movers(date('Y-m-d'), date('Y-m-d'), 30, true);

        $sold = array_column($m['best'], 'sku');
        ok(in_array($sku, $sold, true), 'ของที่ตัดวันนี้ต้องอยู่ในรายการขายดีของวันนี้');

        $stuck = array_column($m['slow'], 'sku');
        ok(!in_array($sku, $stuck, true), 'และต้องไม่อยู่ในรายการค้างนาน');
    });
});

test('รายการค้างนานมีแต่ของที่ยังเหลืออยู่จริง และค้างเกินจำนวนวันที่ถาม', function () {
    withRollback(function () {
        $m = Reports::movers('2020-01-01', date('Y-m-d'), 60, true);

        foreach ($m['slow'] as $r) {
            ok($r['onHand'] > 0, "{$r['sku']} ต้องยังมีของเหลือ");
            ok($r['idleDays'] >= 60, "{$r['sku']} ต้องค้างอย่างน้อย 60 วัน");
        }
    });
});

test('ช่วงวันที่ไม่มีผลกับรายการค้างนาน — ความนิ่งไม่ได้ขึ้นกับว่าใครมองเดือนไหน', function () {
    withRollback(function () {
        $wide = Reports::movers('2020-01-01', date('Y-m-d'), 90, true);
        $narrow = Reports::movers(date('Y-m-d'), date('Y-m-d'), 90, true);

        eq(
            array_column($narrow['slow'], 'sku'),
            array_column($wide['slow'], 'sku'),
            'รายการค้างนานของสองช่วงวันที่',
        );
    });
});

test('จำนวนวันที่ค้างถูกบีบให้อยู่ในช่วงที่มีความหมาย', function () {
    withRollback(function () {
        eq(Reports::movers('2026-01-01', '2026-01-31', 0, true)['idleDays'], 7, 'ต่ำกว่าหนึ่งอาทิตย์');
        eq(Reports::movers('2026-01-01', '2026-01-31', 99999, true)['idleDays'], 3650, 'เกินสิบปี');
    });
});

test('คนที่ไม่มีสิทธิ์เห็นต้นทุน ได้ตัวเลขจำนวน แต่ไม่ได้ตัวเลขเงิน', function () {
    withRollback(function () {
        $m = Reports::movers('2020-01-01', date('Y-m-d'), 60, false);

        foreach ($m['best'] as $r) {
            eq($r['cost'], null, "ต้นทุนที่ขายไปของ {$r['sku']}");
            ok($r['qty'] >= 0, "จำนวนที่ขายของ {$r['sku']} ยังส่งมา");
        }
        foreach ($m['slow'] as $r) {
            eq($r['stockValue'], null, "มูลค่าที่จมอยู่ของ {$r['sku']}");
            ok($r['onHand'] > 0, "จำนวนคงเหลือของ {$r['sku']} ยังส่งมา");
        }
    });
});
