<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Roles;
use Optic\Service\Catalog;
use Optic\Service\Receiving;
use Optic\Service\Stock;

function newSku(): string
{
    return 'TST-' . strtoupper(bin2hex(random_bytes(3)));
}

/** @return array<string,mixed> */
function productArgs(array $over = []): array
{
    return array_merge([
        'sku'                => newSku(),
        'name'               => 'สินค้าทดสอบ',
        'product_type'       => 'Frame',
        'category_id'        => (int) Db::value("SELECT id FROM categories WHERE code = 'Frame'"),
        'base_selling_price' => '1990.00',
        'is_custom_made'     => false,
        'attributes'         => ['brand' => 'ทดสอบ', 'color' => 'ดำ'],
    ], $over);
}

group('แคตตาล็อกสินค้า');

test('เพิ่มสินค้าใหม่ได้', function () {
    withRollback(function () {
        $args = productArgs();
        $out = Catalog::createProduct($args, [Roles::OWNER]);

        ok($out['id'] > 0, 'ต้องได้ id กลับมา');
        $row = Db::one('SELECT * FROM products WHERE id = ?', [$out['id']]);
        eq($row['sku'], $args['sku'], 'SKU ที่บันทึก');
        eq((string) $row['base_selling_price'], '1990.00', 'ราคาขายเก็บเป็น DECIMAL ไม่เพี้ยน');

        $attrs = json_decode((string) $row['attributes'], true);
        eq($attrs['color'], 'ดำ', 'attributes เก็บ JSON ภาษาไทยได้');
    });
});

test('ไม่ส่ง SKU มา ระบบออกรหัสให้เอง ตามชนิดสินค้า', function () {
    withRollback(function () {
        $args = productArgs(['product_type' => 'Lens', 'category_id' => (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'")]);
        unset($args['sku']);

        $first = Catalog::createProduct($args, [Roles::OWNER]);
        ok((bool) preg_match('/^LNS-\d{4}$/', $first['sku']), 'รหัสที่ออกให้ต้องขึ้นต้นด้วยชนิดสินค้า: ' . $first['sku']);

        $second = Catalog::createProduct($args, [Roles::OWNER]);
        ok($second['sku'] !== $first['sku'], 'สินค้าตัวถัดไปต้องได้รหัสใหม่ ไม่ชนกับตัวก่อน');
    });
});

test('ของสั่งตัดนับรหัสคนละชุดกับของที่เก็บสต็อก', function () {
    withRollback(function () {
        $lens = ['product_type' => 'Lens', 'category_id' => (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'")];

        $stock = productArgs($lens);
        unset($stock['sku']);
        $a = Catalog::createProduct($stock, [Roles::OWNER]);
        ok((bool) preg_match('/^LNS-\d{4}$/', $a['sku']), 'เลนส์สต็อกใช้ชุด LNS: ' . $a['sku']);

        $made = productArgs($lens + ['is_custom_made' => true]);
        unset($made['sku']);
        $b = Catalog::createProduct($made, [Roles::OWNER]);
        ok((bool) preg_match('/^RX-\d{4}$/', $b['sku']), 'เลนส์สั่งตัดใช้ชุด RX: ' . $b['sku']);

        // กรอบแว่นสั่งตัดก็ต้องอยู่ชุด RX เหมือนกัน — แยกตามวิธีได้มา ไม่ใช่ตามชนิด
        $frame = productArgs(['is_custom_made' => true]);
        unset($frame['sku']);
        ok(
            str_starts_with(Catalog::createProduct($frame, [Roles::OWNER])['sku'], 'RX-'),
            'กรอบสั่งตัดก็ใช้ชุด RX',
        );
    });
});

test('ส่ง SKU มาเอง ระบบใช้ตามนั้น ไม่ออกรหัสทับ', function () {
    withRollback(function () {
        $args = productArgs(['sku' => 'SUPPLIER-OWN-1']);
        eq(Catalog::createProduct($args, [Roles::OWNER])['sku'], 'SUPPLIER-OWN-1', 'รหัสของผู้ขายต้องอยู่ครบ');
    });
});

test('ตัวช่วยเติมชื่อและแบรนด์ ให้เฉพาะของชนิดเดียวกัน และไม่ซ้ำกันเอง', function () {
    withRollback(function () {
        $hints = Inventory::productHints('Frame');

        ok(count($hints['brands']) > 0, 'ต้องมีแบรนด์ของกรอบแว่นให้เลือก');
        eq(count($hints['brands']), count(array_unique($hints['brands'])), 'แบรนด์ต้องไม่ซ้ำกันเอง');

        // แบรนด์ของคอนแทคเลนส์ต้องไม่หลุดมาอยู่ในรายการของกรอบแว่น
        $ctl = Inventory::productHints('ContactLen');
        $bleed = array_intersect($hints['brands'], array_diff($ctl['brands'], $hints['brands']));
        eq(count($bleed), 0, 'ชนิดหนึ่งต้องไม่เห็นแบรนด์ของอีกชนิด');

        $created = Catalog::createProduct(productArgs(['brand' => 'แบรนด์ที่เพิ่งพิมพ์']), [Roles::OWNER]);
        ok($created['id'] > 0, 'แบรนด์ใหม่ที่ไม่เคยมีต้องบันทึกได้ ไม่ใช่รายการปิด');
        ok(
            in_array('แบรนด์ที่เพิ่งพิมพ์', Inventory::productHints('Frame')['brands'], true),
            'พอบันทึกแล้ว ครั้งถัดไปต้องมีให้เลือก',
        );
    });
});

test('พนักงานหน้าร้านเพิ่มสินค้าได้ แต่แก้กับลบไม่ได้', function () {
    withRollback(function () {
        /* ของใหม่ถูกค้นพบตอนขาย ลูกค้ายืนรออยู่ — ห้ามเพิ่มแล้วพนักงานจะเลือกของ
           ที่ใกล้เคียงที่สุดแทน ซึ่งผิดกว่าการมี SKU เกินมาหนึ่งตัว */
        $made = Catalog::createProduct(productArgs(), [Roles::SALES]);
        ok($made['id'] > 0, 'พนักงานขายเพิ่มสินค้าได้');

        /* แต่ของที่มีประวัติของคนอื่นอยู่แล้ว ยังแตะไม่ได้ */
        throwsReason(
            'forbidden',
            fn() => Catalog::updateProduct($made['id'], productArgs(['name' => 'เปลี่ยนชื่อ']), [Roles::SALES]),
            'staff แก้สินค้า',
        );
        throwsReason('forbidden', fn() => Catalog::deleteProduct($made['id'], [Roles::SALES]), 'staff ลบสินค้า');

        /* และต้นทุนยังเป็นสิทธิ์คนละใบ */
        throwsReason(
            'forbidden',
            fn() => Receiving::receive([
                'sku'           => $made['sku'],
                'quantity'      => 1,
                'cost_per_unit' => '100.00',
                'received_date' => date('Y-m-d'),
            ], [Roles::SALES], 1),
            'staff กรอกต้นทุน',
        );
    });
});

/**
 * ราคาขายที่เปลี่ยนต้องทิ้งร่องรอยไว้ในสมุด
 *
 * เดิม updateProduct ไม่เขียน log อะไรเลย ราคาขายจึงเปลี่ยนได้เงียบ ๆ จากหน้าสินค้า
 * หรือหน้าสินค้ารอสั่ง แล้วตรวจย้อนหลังไม่ได้ว่าใครเปลี่ยน จากเท่าไรเป็นเท่าไร
 */
test('แก้ราคาขายแล้วได้แถว PRICE ในสมุด', function () {
    withRollback(function () {
        $new = Catalog::createProduct(productArgs(['base_selling_price' => '1000.00']), [Roles::OWNER]);
        $before = (int) Db::value(
            "SELECT COUNT(*) FROM inventory_logs WHERE product_id = ? AND action_type = 'PRICE'",
            [$new['id']],
        );

        Catalog::updateProduct(
            $new['id'],
            productArgs(['sku' => $new['sku'], 'base_selling_price' => '1250.00']),
            [Roles::OWNER],
        );

        $row = Db::one(
            "SELECT sale_price, quantity, notes FROM inventory_logs
              WHERE product_id = ? AND action_type = 'PRICE' ORDER BY id DESC LIMIT 1",
            [$new['id']],
        );
        ok($row !== null, 'ต้องมีแถว PRICE เกิดขึ้น');
        eq((float) $row['sale_price'], 1250.0, 'ราคาบนแถวคือราคาใหม่');
        eq((int) $row['quantity'], 0, 'ไม่มีของเคลื่อน จำนวนต้องเป็นศูนย์');
        ok(str_contains((string) $row['notes'], '1000.00'), 'บันทึกต้องบอกราคาเดิมด้วย');
        ok(str_contains((string) $row['notes'], '1250.00'), 'และราคาใหม่');
        eq($before, 0, 'ก่อนแก้ต้องยังไม่มีแถว PRICE');
    });
});

test('แก้ชื่อสินค้าเฉย ๆ ไม่ควรได้แถวราคาแถมมา', function () {
    withRollback(function () {
        $new = Catalog::createProduct(productArgs(['base_selling_price' => '1000.00']), [Roles::OWNER]);

        Catalog::updateProduct(
            $new['id'],
            productArgs(['sku' => $new['sku'], 'base_selling_price' => '1000.00', 'name' => 'ชื่อใหม่']),
            [Roles::OWNER],
        );

        $n = (int) Db::value(
            "SELECT COUNT(*) FROM inventory_logs WHERE product_id = ? AND action_type = 'PRICE'",
            [$new['id']],
        );
        eq($n, 0, 'ราคาไม่เปลี่ยน ก็ไม่ควรมีแถวราคา');
    });
});

test('SKU ซ้ำถูกปฏิเสธ', function () {
    withRollback(function () {
        $existing = (string) Db::value('SELECT sku FROM products LIMIT 1');
        throwsReason(
            'duplicate_sku',
            fn() => Catalog::createProduct(productArgs(['sku' => $existing]), [Roles::OWNER]),
            'SKU ซ้ำ',
        );
    });
});

test('ค่าที่ไม่ถูกต้องถูกปฏิเสธก่อนเขียน', function () {
    withRollback(function () {
        throwsReason('bad_sku', fn() => Catalog::createProduct(productArgs(['sku' => 'มีช่องว่าง ไม่ได้']), [Roles::OWNER]), 'SKU มีอักขระต้องห้าม');
        // A blank name is now an instruction to compose one from the spec, so
        // it is only refused when there is no spec to compose from.
        throwsReason(
            'bad_name',
            fn() => Catalog::createProduct(
                productArgs(['name' => '', 'brand' => null, 'attributes' => []]),
                [Roles::OWNER],
            ),
            'ชื่อว่างและไม่มีสเปกให้ประกอบชื่อ',
        );
        throwsReason('bad_type', fn() => Catalog::createProduct(productArgs(['product_type' => 'Spaceship']), [Roles::OWNER]), 'ชนิดไม่รู้จัก');
        throwsReason('bad_price', fn() => Catalog::createProduct(productArgs(['base_selling_price' => '-5']), [Roles::OWNER]), 'ราคาติดลบ');
        throwsReason('unknown_category', fn() => Catalog::createProduct(productArgs(['category_id' => 9999]), [Roles::OWNER]), 'หมวดหมู่ไม่มีจริง');
    });
});

test('แก้ไขสินค้าได้', function () {
    withRollback(function () {
        $created = Catalog::createProduct(productArgs(), [Roles::OWNER]);
        $out = Catalog::updateProduct(
            $created['id'],
            productArgs(['sku' => $created['sku'], 'name' => 'ชื่อใหม่', 'base_selling_price' => '2500.00']),
            [Roles::ADMIN],
        );
        eq($out['name'], 'ชื่อใหม่', 'ชื่อที่แก้');
        eq((string) Db::value('SELECT base_selling_price FROM products WHERE id = ?', [$created['id']]), '2500.00', 'ราคาใหม่');
    });
});

test('เปลี่ยนสินค้าที่ยังมีสต็อกเป็นสินค้าสั่งตัดไม่ได้', function () {
    withRollback(function () {
        // ถ้าเปลี่ยนได้ ล็อตที่มีของจะค้างอยู่โดยไม่มีใครตัดออกได้เลย
        $sku = skuWithLots(1);
        $p = Db::one('SELECT * FROM products WHERE sku = ?', [$sku]);
        $e = throwsReason(
            'has_stock',
            fn() => Catalog::updateProduct(
                (int) $p['id'],
                productArgs(['sku' => $sku, 'is_custom_made' => true, 'category_id' => (int) $p['category_id'], 'product_type' => $p['product_type']]),
                [Roles::OWNER],
            ),
            'เปลี่ยนเป็นสั่งตัดทั้งที่มีของ',
        );
        ok($e->payload()['lots'] > 0, 'ต้องบอกว่ามีกี่ล็อต');
    });
});

test('ลบสินค้าที่ไม่เคยมีประวัติได้', function () {
    withRollback(function () {
        $created = Catalog::createProduct(productArgs(), [Roles::OWNER]);
        $out = Catalog::deleteProduct($created['id'], [Roles::OWNER]);
        eq($out['sku'], $created['sku'], 'SKU ที่ลบ');
        eq(Db::value('SELECT id FROM products WHERE id = ?', [$created['id']]), null, 'ต้องหายจากฐานข้อมูล');
    });
});

test('ลบสินค้าที่มีประวัติไม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $id = (int) Db::value('SELECT id FROM products WHERE sku = ?', [$sku]);
        $e = throwsReason('has_history', fn() => Catalog::deleteProduct($id, [Roles::OWNER]), 'ลบสินค้าที่มีประวัติ');
        ok($e->payload()['logs'] > 0, 'ต้องบอกจำนวนประวัติ');
    });
});

group('แก้ไขล็อต');

test('ปรับยอดคงเหลือแล้วเกิด log ADJUST อัตโนมัติ', function () {
    withRollback(function () {
        $lot = Db::one('SELECT * FROM stock_lots WHERE remaining_qty > 1 ORDER BY id LIMIT 1');
        $target = (int) $lot['remaining_qty'] - 1;

        $out = Catalog::updateLot((int) $lot['id'], ['remaining_qty' => $target], [Roles::SALES], 1);

        eq($out['remaining'], $target, 'ยอดใหม่');
        eq($out['adjusted'], -1, 'ส่วนต่างที่ปรับ');

        $adj = Db::one(
            "SELECT * FROM inventory_logs WHERE lot_id = ? AND action_type = 'ADJUST' ORDER BY id DESC LIMIT 1",
            [$lot['id']],
        );
        ok($adj !== null, 'ต้องมี log ADJUST');
        eq((int) $adj['quantity'], -1, 'จำนวนใน log');
        ok(str_contains((string) $adj['notes'], 'แก้คงเหลือ'), 'หมายเหตุอธิบายว่าแก้จากเท่าไหร่เป็นเท่าไหร่');
    });
});

test('ปรับยอดแล้วสมุดยังตรง', function () {
    withRollback(function () {
        $lot = Db::one('SELECT * FROM stock_lots WHERE remaining_qty > 1 ORDER BY id LIMIT 1');
        Catalog::updateLot((int) $lot['id'], ['remaining_qty' => (int) $lot['remaining_qty'] - 1], [Roles::SALES], 1);

        $bad = Db::all(
            'SELECT l.lot_number FROM stock_lots l
             LEFT JOIN inventory_logs g ON g.lot_id = l.id
             GROUP BY l.id, l.lot_number, l.remaining_qty
             HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)'
        );
        eq(count($bad), 0, 'ล็อตที่ยอดไม่ตรงกับสมุด');
    });
});

test('คงเหลือมากกว่าที่รับเข้าได้ ถ้าบอกเหตุผล — ตรวจนับเจอของเกินเป็นเรื่องปกติ', function () {
    withRollback(function () {
        $lot = Db::one('SELECT * FROM stock_lots ORDER BY id LIMIT 1');
        $over = (int) $lot['initial_qty'] + 1;

        // Without a reason it is refused: the same keystroke that records a real
        // surplus also types 100 where 10 was meant.
        throwsReason(
            'over_initial_needs_note',
            fn() => Catalog::updateLot((int) $lot['id'], ['remaining_qty' => $over], [Roles::OWNER], 1),
            'คงเหลือเกินที่รับเข้าโดยไม่บอกเหตุผล',
        );

        // With one, it goes through and the reason lands in the ledger.
        Catalog::updateLot(
            (int) $lot['id'],
            ['remaining_qty' => $over, 'note' => 'ตรวจนับประจำเดือน ของเกิน 1 ชิ้น'],
            [Roles::OWNER],
            1,
        );

        eq(lotRemaining((int) $lot['id']), $over, 'คงเหลือหลังปรับ');

        $adj = Db::one(
            "SELECT notes, quantity FROM inventory_logs
             WHERE lot_id = ? AND action_type = 'ADJUST' ORDER BY id DESC LIMIT 1",
            [$lot['id']],
        );
        ok(
            str_contains((string) $adj['notes'], 'ตรวจนับประจำเดือน ของเกิน 1 ชิ้น'),
            'เหตุผลต้องอยู่ในสมุด ไม่ใช่แค่ในช่องหมายเหตุของล็อต',
        );
        ok(
            str_contains((string) $adj['notes'], 'มากกว่าที่รับเข้า'),
            'สมุดต้องบอกด้วยว่านี่คือยอดที่เกินจำนวนรับเข้า',
        );
    });
});

test('ปรับยอดเกินจำนวนรับเข้าแล้ว สมุดยังตรงกับยอดคงเหลือ', function () {
    withRollback(function () {
        $lot = Db::one('SELECT * FROM stock_lots ORDER BY id LIMIT 1');

        Catalog::updateLot(
            (int) $lot['id'],
            ['remaining_qty' => (int) $lot['initial_qty'] + 3, 'note' => 'ผู้ขายส่งเกิน'],
            [Roles::OWNER],
            1,
        );

        $bad = Db::all(
            'SELECT l.lot_number FROM stock_lots l
             LEFT JOIN inventory_logs g ON g.lot_id = l.id
             GROUP BY l.id, l.lot_number, l.remaining_qty
             HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)'
        );
        eq(count($bad), 0, 'ล็อตที่ยอดไม่ตรงกับสมุด');
    });
});

test('ปรับยอดปกติ (ไม่เกินที่รับเข้า) ยังไม่ต้องกรอกเหตุผล', function () {
    withRollback(function () {
        $lot = Db::one('SELECT * FROM stock_lots WHERE remaining_qty > 1 ORDER BY id LIMIT 1');
        $lower = (int) $lot['remaining_qty'] - 1;

        Catalog::updateLot((int) $lot['id'], ['remaining_qty' => $lower], [Roles::OWNER], 1);
        eq(lotRemaining((int) $lot['id']), $lower, 'ลดยอดได้โดยไม่ต้องมีเหตุผล');
    });
});

test('พนักงานหน้าร้านแก้ต้นทุนล็อตไม่ได้ แต่ปรับยอดได้', function () {
    withRollback(function () {
        $lot = Db::one('SELECT * FROM stock_lots WHERE remaining_qty > 1 ORDER BY id LIMIT 1');

        throwsReason(
            'forbidden',
            fn() => Catalog::updateLot((int) $lot['id'], ['cost_per_unit' => '55.00'], [Roles::SALES], 1),
            'staff แก้ต้นทุน',
        );

        $out = Catalog::updateLot((int) $lot['id'], ['remaining_qty' => (int) $lot['remaining_qty'] - 1], [Roles::SALES], 1);
        eq($out['adjusted'], -1, 'staff ปรับยอดได้');
    });
});

group('ลบล็อต');

test('ลบล็อตที่ยังไม่มีการเคลื่อนไหวได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $lotNo = 'LOT-DEL' . random_int(10000, 99999);
        $made = Receiving::receive(
            ['sku' => $sku, 'lot_number' => $lotNo, 'quantity' => 4, 'received_date' => '2026-08-01'],
            [Roles::OWNER],
            1,
        );

        $out = Catalog::deleteLot($made['lotId'], [Roles::OWNER]);
        eq($out['lotNumber'], $lotNo, 'ล็อตที่ลบ');
        eq(Db::value('SELECT id FROM stock_lots WHERE id = ?', [$made['lotId']]), null, 'ล็อตต้องหาย');
        eq((int) Db::value('SELECT COUNT(*) FROM inventory_logs WHERE lot_id = ?', [$made['lotId']]), 0, 'log รับเข้าต้องหายไปด้วย');
    });
});

test('ลบล็อตที่ตัดของออกไปแล้วไม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $lotNo = 'LOT-USED' . random_int(10000, 99999);
        $made = Receiving::receive(
            ['sku' => $sku, 'lot_number' => $lotNo, 'quantity' => 2, 'received_date' => '2020-01-01'],
            [Roles::OWNER],
            1,
        );

        // รับเข้าด้วยวันที่เก่าสุด ล็อตนี้จึงเป็นตัวแรกที่ FIFO จะตัด
        Stock::issue([
            'source' => 'test', 'idem_key' => 'del-' . bin2hex(random_bytes(4)),
            'sku' => $sku, 'quantity' => 1, 'actor_id' => 1,
        ]);

        throwsReason('lot_in_use', fn() => Catalog::deleteLot($made['lotId'], [Roles::OWNER]), 'ลบล็อตที่ใช้ไปแล้ว');
    });
});

test('ลบล็อตแล้วสมุดยังตรง', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $made = Receiving::receive(
            ['sku' => $sku, 'lot_number' => 'LOT-BAL' . random_int(10000, 99999), 'quantity' => 3, 'received_date' => '2026-08-02'],
            [Roles::OWNER],
            1,
        );
        Catalog::deleteLot($made['lotId'], [Roles::OWNER]);

        $bad = Db::all(
            'SELECT l.lot_number FROM stock_lots l
             LEFT JOIN inventory_logs g ON g.lot_id = l.id
             GROUP BY l.id, l.lot_number, l.remaining_qty
             HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)'
        );
        eq(count($bad), 0, 'ล็อตที่ยอดไม่ตรงกับสมุด');
    });
});

test('ตัวเลขบนชิปเลนส์ตรงกับจำนวนแถวที่กดแล้วได้จริง', function () {
    withRollback(function () {
        // ชิปเคยนับทั้งแคตตาล็อก ขณะที่ตารางใต้มันถูกกรองอยู่ — "1.74 · 2"
        // จึงลอยอยู่เหนือหน้าที่กดแล้วว่าง เพราะเลนส์ 1.74 ทั้งสองตัวเป็นของสั่งตัด
        foreach ([[], ['make' => 'ready'], ['make' => 'custom']] as $scope) {
            $options = Inventory::lensOptions($scope);

            foreach ($options['indexes'] as $chip) {
                $rows = Inventory::products(
                    $scope + ['type' => 'Lens', 'index' => $chip['value']],
                    true,
                );
                eq(
                    $rows['total'],
                    $chip['count'],
                    'ดัชนี ' . $chip['value'] . ' บนชิปบอก ' . $chip['count'] . ' แต่กดแล้วได้ ' . $rows['total'],
                );
            }

            foreach ($options['designs'] as $chip) {
                $rows = Inventory::products(
                    $scope + ['type' => 'Lens', 'design' => $chip['value']],
                    true,
                );
                eq(
                    $rows['total'],
                    $chip['count'],
                    'ชนิดเลนส์ ' . $chip['value'] . ' บนชิปบอก ' . $chip['count'] . ' แต่กดแล้วได้ ' . $rows['total'],
                );
            }
        }
    });
});
