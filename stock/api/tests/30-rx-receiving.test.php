<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Roles;
use Optic\Service\Receiving;
use Optic\Service\Rx;
use Optic\Service\Stock;

/** SKU ของเลนส์สั่งตัดตัวแรกที่เจอ */
function customSku(): string
{
    return (string) Db::value('SELECT sku FROM products WHERE is_custom_made = 1 LIMIT 1');
}

function doc(string $prefix): string
{
    return $prefix . '-' . bin2hex(random_bytes(3));
}

group('ใบสั่งตัด RX');

test('เปิดใบสั่ง RX ของเลนส์สั่งตัดได้ และเว้นต้นทุนไว้ก่อน', function () {
    withRollback(function () {
        $sku = customSku();
        $ref = doc('RX-TEST');

        $out = Rx::order(['sku' => $sku, 'reference_doc' => $ref], Roles::SALES, 1);

        eq($out['awaitingCost'], true, 'ต้องขึ้นว่ารอลงต้นทุน');
        eq($out['unitCost'], null, 'ต้นทุนต้องยังว่าง');

        $log = Db::one('SELECT * FROM inventory_logs WHERE reference_doc = ?', [$ref]);
        eq($log['action_type'], 'RX_ORDER', 'ชนิดของรายการ');
        eq((int) $log['quantity'], -1, 'จำนวนต้องเป็น -1');
        eq($log['lot_id'], null, 'ต้องไม่ผูกกับล็อต');
        eq($log['created_by_kind'], 'user', 'บันทึกใน id space เดียว');
    });
});

test('พิมพ์ชื่อรุ่นที่ยังไม่มี ระบบเพิ่มรุ่นให้พร้อมเปิดใบสั่ง', function () {
    withRollback(function () {
        $name = 'รุ่นทดสอบ ' . bin2hex(random_bytes(3));

        $out = Rx::order(['lens_name' => $name, 'sale_price' => '9500'], Roles::OWNER, 1);

        $p = Db::one('SELECT * FROM products WHERE sku = ?', [$out['sku']]);
        ok($p !== null, 'ต้องมีรุ่นใหม่ในแคตตาล็อก');
        eq($p['name'], $name, 'ชื่อรุ่นตามที่พิมพ์');
        eq((int) $p['is_custom_made'], 1, 'ต้องเป็นของสั่งตัด ไม่ใช่ของเก็บสต็อก');
        eq($p['product_type'], 'Lens', 'ชนิดต้องเป็นเลนส์');
        ok(str_starts_with((string) $p['sku'], 'RX-'), 'รหัสต้องอยู่ชุด RX: ' . $p['sku']);
    });
});

test('พิมพ์ชื่อรุ่นที่มีอยู่แล้ว ใช้ตัวเดิม ไม่สร้างซ้ำ', function () {
    withRollback(function () {
        $sku = customSku();
        $name = (string) Db::value('SELECT name FROM products WHERE sku = ?', [$sku]);
        $before = (int) Db::value('SELECT COUNT(*) FROM products WHERE name = ?', [$name]);

        $out = Rx::order(['lens_name' => $name], Roles::OWNER, 1);

        eq($out['sku'], $sku, 'ต้องได้รุ่นเดิม');
        eq(
            (int) Db::value('SELECT COUNT(*) FROM products WHERE name = ?', [$name]),
            $before,
            'จำนวนสินค้าชื่อนี้ต้องเท่าเดิม — ไม่สร้างตัวซ้ำ',
        );
    });
});

test('พนักงานหน้าร้านเปิดรุ่นใหม่ผ่านใบสั่งได้ และสั่งรุ่นที่มีอยู่ได้', function () {
    withRollback(function () {
        /* ลูกค้าสั่งเลนส์รุ่นที่ร้านไม่เคยลง — ห้ามเปิดรุ่นใหม่แล้วคนขายจะเลือกรุ่น
           ที่ใกล้เคียงที่สุดแทน แล้วใบสั่งจะบอกรุ่นผิดตลอดไป */
        $fresh = 'รุ่นที่ไม่เคยมี ' . bin2hex(random_bytes(3));
        $out = Rx::order(['lens_name' => $fresh], Roles::SALES, 1);
        eq(
            (string) Db::value('SELECT name FROM products WHERE sku = ?', [$out['sku']]),
            $fresh,
            'รุ่นใหม่ถูกเปิดไว้ในแคตตาล็อกด้วยชื่อที่เขียนบนใบสั่ง',
        );
        eq($out['unitCost'], null, 'แต่ยังไม่มีต้นทุน — คนละสิทธิ์');

        $sku = customSku();
        $name = (string) Db::value('SELECT name FROM products WHERE sku = ?', [$sku]);
        eq(Rx::order(['lens_name' => $name], Roles::SALES, 1)['sku'], $sku, 'staff สั่งรุ่นที่มีอยู่ได้');
    });
});

test('ไม่บอกรุ่นเลนส์เลย ถูกปฏิเสธ', function () {
    withRollback(function () {
        throwsReason('missing_field', fn() => Rx::order([], Roles::OWNER, 1), 'ไม่บอกรุ่น');
    });
});

test('ไม่ส่งเลขที่ใบสั่งมา ระบบออกเลขให้เอง และเลขถัดไปไม่ชนกัน', function () {
    withRollback(function () {
        $first = Rx::order(['sku' => customSku()], Roles::SALES, 1);
        ok(
            (bool) preg_match('/^RX-\d{4}-\d{4}$/', $first['referenceDoc']),
            'รูปแบบเลขที่ออกให้: ' . $first['referenceDoc'],
        );

        $second = Rx::order(['sku' => customSku()], Roles::SALES, 1);
        ok($second['referenceDoc'] !== $first['referenceDoc'], 'ใบถัดไปต้องได้เลขใหม่');
        ok($second['referenceDoc'] > $first['referenceDoc'], 'และต้องเดินหน้า ไม่ใช่ถอยหลัง');
    });
});

test('ส่งเลขที่ใบสั่งมาเอง ระบบใช้ตามนั้น', function () {
    withRollback(function () {
        $ref = doc('JOB-OWN');
        eq(
            Rx::order(['sku' => customSku(), 'reference_doc' => $ref], Roles::SALES, 1)['referenceDoc'],
            $ref,
            'เลขของร้านต้องอยู่ครบ ไม่ถูกออกเลขทับ',
        );
    });
});

test('ค่าสายตาอยู่กับใบสั่ง — สองใบของเลนส์รุ่นเดียวกันเก็บคนละค่าได้', function () {
    withRollback(function () {
        $sku = customSku();

        $a = Rx::order([
            'sku' => $sku, 'reference_doc' => doc('RX-EYE-A'),
            'eye_side' => 'left', 'sph' => '-2.25', 'cyl' => '-0.75', 'axis' => '90', 'add' => '+2.00',
        ], Roles::SALES, 1);

        $b = Rx::order([
            'sku' => $sku, 'reference_doc' => doc('RX-EYE-B'),
            'eye_side' => 'right', 'sph' => '-8.00', 'axis' => '180',
        ], Roles::SALES, 1);

        $one = Db::one('SELECT * FROM rx_orders WHERE log_id = ?', [$a['id']]);
        eq($one['eye_side'], 'left', 'ข้างตาของใบแรก');
        eq((float) $one['sph'], -2.25, 'SPH ของใบแรก');
        eq((int) $one['axis'], 90, 'AXIS ของใบแรก');
        eq($one['add_power'], '+2.00', 'ADD เก็บตามที่เขียน ไม่แปลงเป็นตัวเลข');

        $two = Db::one('SELECT * FROM rx_orders WHERE log_id = ?', [$b['id']]);
        eq((float) $two['sph'], -8.0, 'SPH ของใบที่สอง — คนละค่ากับใบแรกทั้งที่เลนส์รุ่นเดียวกัน');
        eq($two['cyl'], null, 'ไม่ได้กรอก CYL ก็ต้องว่าง ไม่ใช่ศูนย์');
    });
});

test('ราคาขายเก็บบนใบสั่ง และใครเปิดใบก็กรอกได้', function () {
    withRollback(function () {
        // ราคาที่ตกลงกับลูกค้าเกิดที่หน้าเคาน์เตอร์ — คนที่พูดกับลูกค้าคือคนที่กรอก
        // ต่างจากต้นทุนจากผู้ขาย ที่เป็นตัวเลขทางบัญชีและยังอยู่หลัง enterRxCost ตามเดิม
        $staff = Rx::order(
            ['sku' => customSku(), 'reference_doc' => doc('RX-SELL-STAFF'), 'sale_price' => '9500'],
            Roles::SALES,
            1,
        );
        eq($staff['salePrice'], '9500', 'staff กรอกราคาขายได้');

        throwsReason(
            'forbidden',
            fn() => Rx::order(
                ['sku' => customSku(), 'reference_doc' => doc('RX-COST-DENY'), 'unit_cost' => '4780'],
                Roles::SALES,
                1,
            ),
            'staff กรอกต้นทุน',
        );

        $out = Rx::order([
            'sku' => customSku(), 'reference_doc' => doc('RX-SELL'),
            'unit_cost' => '4780', 'sale_price' => '9500.00',
        ], Roles::ADMIN, 1);

        eq($out['salePrice'], '9500.00', 'ราคาขายที่บันทึก');
        eq(
            (float) Db::value('SELECT sale_price FROM rx_orders WHERE log_id = ?', [$out['id']]),
            9500.0,
            'ราคาขายในตาราง',
        );
    });
});

test('ค่าสายตาที่กรอกผิดถูกปฏิเสธก่อนเขียน', function () {
    withRollback(function () {
        $bad = fn(array $over) => Rx::order(
            ['sku' => customSku(), 'reference_doc' => doc('RX-BAD')] + $over,
            Roles::OWNER,
            1,
        );
        throwsReason('bad_axis', fn() => $bad(['axis' => '900']), 'AXIS เกิน 180');
        throwsReason('bad_rx', fn() => $bad(['sph' => 'ลบสองจุดสอง']), 'SPH ไม่ใช่ตัวเลข');
        throwsReason('bad_eye_side', fn() => $bad(['eye_side' => 'both']), 'ข้างตาที่ไม่มีจริง');
        throwsReason('bad_price', fn() => $bad(['sale_price' => '-5']), 'ราคาขายติดลบ');
    });
});

test('สมุดใบสั่งอ่านได้ทั้งเล่ม และกรองเฉพาะที่รอต้นทุนได้', function () {
    withRollback(function () {
        $ref = doc('RX-BOOK');
        Rx::order(['sku' => customSku(), 'reference_doc' => $ref, 'sph' => '-3.50'], Roles::SALES, 1);

        $book = Rx::orders($ref, false, 1, 20);
        eq($book['total'], 1, 'ค้นด้วยเลขที่ใบสั่งต้องเจอใบเดียว');
        eq((float) $book['rows'][0]['sph'], -3.5, 'ค่าสายตาต้องมากับใบสั่ง');
        eq($book['rows'][0]['unitCost'], null, 'ใบนี้ยังไม่มีต้นทุน');

        eq(Rx::orders($ref, true, 1, 20)['total'], 1, 'ตัวกรองรอต้นทุนต้องยังเห็นใบนี้');

        Rx::setCost((int) $book['rows'][0]['id'], '5000', Roles::ADMIN);
        eq(Rx::orders($ref, true, 1, 20)['total'], 0, 'พอลงต้นทุนแล้วต้องหลุดจากรายการรอ');
        eq(Rx::orders($ref, false, 1, 20)['total'], 1, 'แต่ยังอยู่ในสมุดทั้งเล่ม');
    });
});

test('พนักงานหน้าร้านกรอกต้นทุนตอนเปิดใบสั่งไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'forbidden',
            fn() => Rx::order(
                ['sku' => customSku(), 'reference_doc' => doc('RX-DENY'), 'unit_cost' => '7400'],
                Roles::SALES,
                1,
            ),
            'staff กรอกต้นทุน',
        );
    });
});

test('ฝ่ายบัญชีกรอกต้นทุนตอนเปิดใบสั่งได้', function () {
    withRollback(function () {
        $out = Rx::order(
            ['sku' => customSku(), 'reference_doc' => doc('RX-ACC'), 'unit_cost' => '7400.50'],
            Roles::ADMIN,
            1,
        );
        eq($out['unitCost'], '7400.50', 'ต้นทุนต้องเก็บเป็นสตริง ไม่แปลงเป็น float');
        eq($out['awaitingCost'], false, 'ไม่ต้องรอลงต้นทุนแล้ว');
    });
});

test('ต้นทุนที่ไม่ใช่ตัวเลขถูกปฏิเสธ', function () {
    withRollback(function () {
        foreach (['-5', 'abc', '10.999'] as $bad) {
            throwsReason(
                'bad_cost',
                fn() => Rx::order(
                    ['sku' => customSku(), 'reference_doc' => doc('RX-BAD'), 'unit_cost' => $bad],
                    Roles::OWNER,
                    1,
                ),
                "ต้นทุน \"{$bad}\"",
            );
        }
    });
});

test('สินค้าที่ยังมีสต็อกเปิดใบสั่งพิเศษไม่ได้', function () {
    withRollback(function () {
        // ถ้ายังมีของอยู่ต้องตัดตาม FIFO ก่อน ไม่งั้นจะจ่ายค่าของซ้ำทั้งที่มีอยู่แล้ว
        $sku = skuWithLots(1);
        $e = throwsReason(
            'still_in_stock',
            fn() => Rx::order(['sku' => $sku, 'reference_doc' => doc('RX-HAS')], Roles::OWNER, 1),
            'ยังมีสต็อก',
        );
        ok($e->payload()['available'] > 0, 'ต้องบอกว่าเหลือเท่าไหร่');
    });
});

test('ของหมดแล้วเปิดใบสั่งพิเศษได้ — เส้นทางที่ช่างใช้จริง', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];

        // ตัดจนหมดเกลี้ยง
        Stock::issue([
            'source' => 'test', 'idem_key' => 'drain-' . bin2hex(random_bytes(4)),
            'sku' => $sku, 'quantity' => $onHand, 'actor_id' => 1,
        ]);
        eq(Stock::availability($sku)['on_hand'], 0, 'ต้องหมดจริง');

        $out = Rx::order(['sku' => $sku, 'reference_doc' => doc('RX-OUT')], Roles::OWNER, 1);
        eq($out['wasOutOfStock'], true, 'ต้องรู้ว่าเป็นสินค้าปกติที่ของหมด');
        eq($out['awaitingCost'], true, 'รอลงต้นทุน');
    });
});

group('ลงต้นทุน RX ทีหลัง');

test('ฝ่ายบัญชีลงต้นทุนให้ใบสั่งที่ยังว่างได้', function () {
    withRollback(function () {
        $ref = doc('RX-LATE');
        Rx::order(['sku' => customSku(), 'reference_doc' => $ref], Roles::SALES, 1);
        $id = (int) Db::value('SELECT id FROM inventory_logs WHERE reference_doc = ?', [$ref]);

        $out = Rx::setCost($id, '9800.00', Roles::ADMIN);
        eq($out['unitCost'], '9800.00', 'ต้นทุนที่ลง');

        $stored = Db::value('SELECT unit_cost FROM inventory_logs WHERE id = ?', [$id]);
        eq((string) $stored, '9800.00', 'ค่าที่เก็บจริงในฐานข้อมูล');
    });
});

test('พนักงานหน้าร้านลงต้นทุนไม่ได้', function () {
    withRollback(function () {
        $ref = doc('RX-STAFF');
        Rx::order(['sku' => customSku(), 'reference_doc' => $ref], Roles::SALES, 1);
        $id = (int) Db::value('SELECT id FROM inventory_logs WHERE reference_doc = ?', [$ref]);

        throwsReason('forbidden', fn() => Rx::setCost($id, '100', Roles::SALES), 'staff ลงต้นทุน');
    });
});

test('ลงต้นทุนซ้ำรายการที่มีต้นทุนแล้วไม่ได้', function () {
    withRollback(function () {
        $ref = doc('RX-TWICE');
        Rx::order(['sku' => customSku(), 'reference_doc' => $ref, 'unit_cost' => '500'], Roles::OWNER, 1);
        $id = (int) Db::value('SELECT id FROM inventory_logs WHERE reference_doc = ?', [$ref]);

        // การแก้ตัวเลขที่ลงไปแล้วคือการ "แก้ไข" ไม่ใช่การ "กรอกให้ครบ"
        // ต้องไม่เงียบ ๆ ทับของเดิม
        throwsReason('already_costed', fn() => Rx::setCost($id, '999', Roles::OWNER), 'ลงซ้ำ');
    });
});

test('รายการที่รอต้นทุนโผล่ในรายการค้าง', function () {
    withRollback(function () {
        $ref = doc('RX-QUEUE');
        Rx::order(['sku' => customSku(), 'reference_doc' => $ref], Roles::SALES, 1);

        $refs = array_column(Rx::awaitingCost(), 'referenceDoc');
        ok(in_array($ref, $refs, true), 'ต้องอยู่ในคิวรอลงต้นทุน');
    });
});

group('รับของเข้าคลัง');

test('รับล็อตใหม่แล้วได้ทั้งล็อตและ log พร้อมกัน', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $lot = 'LOT-T' . random_int(10000, 99999);
        $before = Stock::availability($sku)['on_hand'];

        $out = Receiving::receive([
            'sku' => $sku, 'lot_number' => $lot, 'quantity' => 5,
            'cost_per_unit' => '123.45', 'received_date' => '2026-08-01',
        ], Roles::OWNER, 1);

        eq($out['quantity'], 5, 'จำนวนที่รับ');
        eq(Stock::availability($sku)['on_hand'], $before + 5, 'ยอดคงเหลือเพิ่ม');

        $log = Db::one('SELECT * FROM inventory_logs WHERE reference_doc = ?', ['GRN-' . $lot]);
        ok($log !== null, 'ต้องมี log คู่กัน');
        eq($log['action_type'], 'IN', 'ชนิดของ log');
        eq((int) $log['quantity'], 5, 'จำนวนใน log');
    });
});

test('ไม่ส่งเลขล็อตมา ระบบออกเลขให้เอง และล็อตที่สองของวันเดียวกันไม่ชนกัน', function () {
    withRollback(function () {
        $sku = skuWithLots(1);

        $first = Receiving::receive(
            ['sku' => $sku, 'quantity' => 2, 'received_date' => '2026-08-29'],
            Roles::OWNER,
            1,
        );
        eq($first['lotNumber'], 'L260829-01', 'เลขล็อตที่ออกให้ ผูกกับวันที่รับเข้า');

        $second = Receiving::receive(
            ['sku' => $sku, 'quantity' => 3, 'received_date' => '2026-08-29'],
            Roles::OWNER,
            1,
        );
        eq($second['lotNumber'], 'L260829-02', 'ของวันเดียวกันรอบสอง ต้องเป็นคนละล็อต');

        $log = Db::one('SELECT * FROM inventory_logs WHERE reference_doc = ?', ['GRN-L260829-02']);
        ok($log !== null, 'log ต้องอ้างเลขล็อตที่ออกให้');
    });
});

test('รับของโดยยังไม่รู้ต้นทุนได้ — ของมาก่อนใบกำกับเป็นเรื่องปกติ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $lot = 'LOT-N' . random_int(10000, 99999);

        $out = Receiving::receive([
            'sku' => $sku, 'lot_number' => $lot, 'quantity' => 3,
            'received_date' => '2026-08-10',
        ], Roles::SALES, 1);

        eq($out['awaitingCost'], true, 'ต้องขึ้นว่ารอต้นทุน');
        $stored = Db::one('SELECT cost_per_unit, notes FROM stock_lots WHERE lot_number = ?', [$lot]);
        eq($stored['cost_per_unit'], null, 'ต้นทุนต้องเป็น NULL ไม่ใช่ 0');
        ok(str_contains((string) $stored['notes'], 'ใบกำกับ'), 'ควรอธิบายว่าทำไมยังไม่มีต้นทุน');
    });
});

test('พนักงานหน้าร้านกรอกต้นทุนตอนรับของไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'forbidden',
            fn() => Receiving::receive([
                'sku' => skuWithLots(1), 'lot_number' => 'LOT-X' . random_int(1000, 9999),
                'quantity' => 1, 'cost_per_unit' => '50', 'received_date' => '2026-08-01',
            ], Roles::SALES, 1),
            'staff กรอกต้นทุน',
        );
    });
});

test('เลขล็อตซ้ำของสินค้าเดิมถูกปฏิเสธ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $lot = 'LOT-D' . random_int(10000, 99999);
        $args = ['sku' => $sku, 'lot_number' => $lot, 'quantity' => 1, 'received_date' => '2026-08-01'];

        Receiving::receive($args, Roles::OWNER, 1);
        throwsReason('duplicate_lot', fn() => Receiving::receive($args, Roles::OWNER, 1), 'ล็อตซ้ำ');
    });
});

test('เลนส์สั่งตัดรับเข้าเป็นล็อตไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'custom_made',
            fn() => Receiving::receive([
                'sku' => customSku(), 'lot_number' => 'LOT-C' . random_int(1000, 9999),
                'quantity' => 1, 'received_date' => '2026-08-01',
            ], Roles::OWNER, 1),
            'สินค้าสั่งตัด',
        );
    });
});

test('วันหมดอายุก่อนวันรับเข้าถูกปฏิเสธ', function () {
    withRollback(function () {
        throwsReason(
            'bad_expiry',
            fn() => Receiving::receive([
                'sku' => skuWithLots(1), 'lot_number' => 'LOT-E' . random_int(1000, 9999),
                'quantity' => 1, 'received_date' => '2026-08-01', 'expiry_date' => '2026-07-01',
            ], Roles::OWNER, 1),
            'วันหมดอายุย้อนหลัง',
        );
    });
});

test('วันที่รูปแบบผิดถูกปฏิเสธ', function () {
    withRollback(function () {
        foreach (['01/08/2026', '2026-13-01', 'เมื่อวาน'] as $bad) {
            throwsReason(
                'bad_date',
                fn() => Receiving::receive([
                    'sku' => skuWithLots(1), 'lot_number' => 'LOT-F' . random_int(1000, 9999),
                    'quantity' => 1, 'received_date' => $bad,
                ], Roles::OWNER, 1),
                "วันที่ \"{$bad}\"",
            );
        }
    });
});

test('รับของแล้วสมุดยังตรงกับยอดคงเหลือ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        Receiving::receive([
            'sku' => $sku, 'lot_number' => 'LOT-L' . random_int(10000, 99999),
            'quantity' => 7, 'cost_per_unit' => '99.00', 'received_date' => '2026-08-05',
        ], Roles::OWNER, 1);

        $bad = Db::all(
            'SELECT l.lot_number FROM stock_lots l
             LEFT JOIN inventory_logs g ON g.lot_id = l.id
             GROUP BY l.id, l.lot_number, l.remaining_qty
             HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)'
        );
        eq(count($bad), 0, 'ล็อตที่ยอดไม่ตรงกับสมุด');
    });
});

test('ต้นทุนจากผู้ขายไม่ถูกส่งไปหาบัญชีที่ไม่มีสิทธิ์เห็น', function () {
    withRollback(function () {
        $out = Rx::order([
            'sku' => customSku(), 'reference_doc' => doc('RX-HIDE'),
            'unit_cost' => '4780', 'sale_price' => '9500',
        ], Roles::OWNER, 1);

        $find = static function (array $page) use ($out): ?array {
            foreach ($page['rows'] as $r) {
                if ($r['id'] === $out['id']) {
                    return $r;
                }
            }
            return null;
        };

        $seen = $find(Rx::orders(null, false, 1, 100, true));
        eq($seen['unitCost'], 4780.0, 'เจ้าของร้านเห็นต้นทุน');

        // ไม่ใช่แค่หน้าจอไม่วาด — ตัวเลขต้องไม่ออกจากเซิร์ฟเวอร์เลย
        $hidden = $find(Rx::orders(null, false, 1, 100, false));
        eq($hidden['unitCost'], null, 'บัญชีที่ไม่มีสิทธิ์ต้องไม่ได้ตัวเลขต้นทุน');
        eq($hidden['salePrice'], 9500.0, 'แต่ราคาขายยังเห็นได้ — ใช้ขายของ');
    });
});

group('แก้ไขใบสั่งตัด RX ที่เปิดไปแล้ว');

/** ใบสั่งหนึ่งใบ ที่เทสต์ข้างล่างนี้เอาไปแก้ไปลบ */
function anRxOrder(array $over = []): array
{
    return Rx::order(['sku' => customSku(), 'reference_doc' => doc('RX-EDIT')] + $over, Roles::OWNER, 1);
}

/** แถวของใบนี้ตามที่สมุดใบสั่งรายงาน — null ถ้าไม่อยู่ในสมุดแล้ว */
function rxRow(int $id): ?array
{
    foreach (Rx::orders(null, false, 1, 200, true)['rows'] as $r) {
        if ($r['id'] === $id) {
            return $r;
        }
    }
    return null;
}

test('แก้ค่าสายตา หมายเหตุ และเลขใบสั่ง ของใบที่เปิดไปแล้วได้', function () {
    withRollback(function () {
        $o = anRxOrder(['eye_side' => 'left', 'sph' => '-2.00']);
        $ref = doc('RX-NEW');

        Rx::edit((int) $o['id'], [
            'reference_doc' => $ref,
            'eye_side' => 'right',
            'sph'  => '-2.25',
            'cyl'  => '-0.50',
            'axis' => '180',
            'add'  => '+2.00',
            'note' => 'อ่านใบสั่งผิดข้าง แก้แล้ว',
        ], Roles::SALES, 1);

        $r = rxRow((int) $o['id']);
        eq($r['referenceDoc'], $ref, 'เลขใบสั่ง');
        eq($r['eyeSide'], 'right', 'ข้างตา');
        eq($r['sph'], -2.25, 'SPH');
        eq($r['cyl'], -0.5, 'CYL');
        eq($r['axis'], 180, 'AXIS');
        eq($r['add'], '+2.00', 'ADD');
        eq($r['note'], 'อ่านใบสั่งผิดข้าง แก้แล้ว', 'หมายเหตุ');
    });
});

test('ล้างค่าสายตาที่เคยกรอกผิดให้ว่างได้ ไม่ใช่แก้ทับได้อย่างเดียว', function () {
    withRollback(function () {
        $o = anRxOrder(['eye_side' => 'left', 'sph' => '-2.00', 'cyl' => '-1.00', 'axis' => '90']);

        Rx::edit((int) $o['id'], [
            'eye_side' => '', 'sph' => '', 'cyl' => '', 'axis' => '', 'add' => '',
        ], Roles::OWNER, 1);

        $r = rxRow((int) $o['id']);
        eq($r['eyeSide'], null, 'ข้างตาต้องกลับไปว่าง');
        eq($r['sph'], null, 'SPH ต้องกลับไปว่าง');
        eq($r['axis'], null, 'AXIS ต้องกลับไปว่าง');
    });
});

test('แก้ราคาขายจากหน้าแก้ไข ยังลงบรรทัด PRICE ในสมุดเหมือนเดิม', function () {
    withRollback(function () {
        $o = anRxOrder(['sale_price' => '9500']);

        Rx::edit((int) $o['id'], ['sale_price' => '10200'], Roles::SALES, 1);

        eq(rxRow((int) $o['id'])['salePrice'], 10200.0, 'ราคาขายใหม่');

        $price = Db::all(
            "SELECT * FROM inventory_logs WHERE reference_doc = ? AND action_type = 'PRICE'",
            [$o['referenceDoc']],
        );
        eq(count($price), 1, 'ต้องมีบรรทัด PRICE หนึ่งบรรทัด');
        ok(
            str_contains((string) $price[0]['notes'], '9500') && str_contains((string) $price[0]['notes'], '10200'),
            'บรรทัดนั้นต้องบอกว่าจากเท่าไรเป็นเท่าไร — ได้: ' . $price[0]['notes'],
        );
    });
});

test('ราคาขายที่ไม่ได้เปลี่ยน ไม่ลงบรรทัด PRICE ซ้ำ', function () {
    withRollback(function () {
        $o = anRxOrder(['sale_price' => '9500']);

        Rx::edit((int) $o['id'], ['sale_price' => '9500', 'note' => 'แก้แต่หมายเหตุ'], Roles::OWNER, 1);

        eq(
            (int) Db::value(
                "SELECT COUNT(*) FROM inventory_logs WHERE reference_doc = ? AND action_type = 'PRICE'",
                [$o['referenceDoc']],
            ),
            0,
            'ไม่ควรมีบรรทัด PRICE เลย',
        );
    });
});

test('ค่าสายตาที่ผิดรูปแบบถูกปฏิเสธตอนแก้ เหมือนตอนเปิดใบ', function () {
    withRollback(function () {
        $o = anRxOrder();
        throwsReason(
            'bad_axis',
            fn() => Rx::edit((int) $o['id'], ['axis' => '200'], Roles::OWNER, 1),
            'AXIS เกิน 180',
        );
        throwsReason(
            'bad_rx',
            fn() => Rx::edit((int) $o['id'], ['sph' => 'ลบสอง'], Roles::OWNER, 1),
            'SPH ที่ไม่ใช่ตัวเลข',
        );
    });
});

test('ต้นทุนแก้ผ่านหน้าแก้ไขไม่ได้ — ยังเป็นทางของฝ่ายบัญชีทางเดียว', function () {
    withRollback(function () {
        $o = anRxOrder();
        Rx::edit((int) $o['id'], ['unit_cost' => '1'], Roles::SALES, 1);
        eq(rxRow((int) $o['id'])['awaitingCost'], true, 'ต้นทุนต้องยังว่างอยู่');
    });
});

group('ลบและยกเลิกใบสั่งตัด RX');

test('ใบที่ยังไม่มีต้นทุนและยังไม่ตั้งราคา ลบทิ้งได้จริง', function () {
    withRollback(function () {
        $o = anRxOrder();
        $id = (int) $o['id'];

        eq(Rx::remove($id, [], Roles::SALES, 1)['mode'], 'deleted', 'ต้องเป็นการลบจริง');

        eq((int) Db::value('SELECT COUNT(*) FROM inventory_logs WHERE id = ?', [$id]), 0, 'แถวในสมุดต้องหาย');
        eq((int) Db::value('SELECT COUNT(*) FROM rx_orders WHERE log_id = ?', [$id]), 0, 'ค่าสายตาต้องหายตาม');
    });
});

test('ใบที่ตั้งราคาขายแล้ว ลบไม่ได้ — ยกเลิกแทน และแถวเดิมยังอยู่', function () {
    withRollback(function () {
        $o = anRxOrder(['sale_price' => '9500']);
        $id = (int) $o['id'];

        $out = Rx::remove($id, ['note' => 'ลูกค้ายกเลิกงาน'], Roles::OWNER, 1);
        eq($out['mode'], 'cancelled', 'ต้องเป็นการยกเลิก ไม่ใช่ลบ');

        eq((int) Db::value('SELECT COUNT(*) FROM inventory_logs WHERE id = ?', [$id]), 1, 'แถวเดิมต้องยังอยู่');

        $rx = Db::one('SELECT * FROM rx_orders WHERE log_id = ?', [$id]);
        neq($rx['cancelled_at'], null, 'ต้องถูกปั๊มว่ายกเลิกเมื่อไหร่');
        eq($rx['cancelled_note'], 'ลูกค้ายกเลิกงาน', 'เหตุผลต้องถูกเก็บ');
    });
});

test('ยกเลิกแล้วมีบรรทัด RETURN คู่กันในสมุด อ้างเลขใบเดิม', function () {
    withRollback(function () {
        $o = anRxOrder(['unit_cost' => '4780']);

        Rx::remove((int) $o['id'], ['note' => 'สั่งซ้ำสองใบ'], Roles::OWNER, 1);

        $ret = Db::all(
            "SELECT * FROM inventory_logs WHERE reference_doc = ? AND action_type = 'RETURN'",
            [$o['referenceDoc']],
        );
        eq(count($ret), 1, 'ต้องมีบรรทัด RETURN หนึ่งบรรทัด');
        eq((int) $ret[0]['quantity'], 1, 'กลับทิศกับ RX_ORDER ที่เป็น -1');
        eq($ret[0]['lot_id'], null, 'ใบสั่งตัดไม่เคยผูกล็อต การยกเลิกก็ไม่ผูก');
    });
});

test('ยกเลิกต้องบอกเหตุผล', function () {
    withRollback(function () {
        $o = anRxOrder(['sale_price' => '9500']);
        throwsReason(
            'missing_field',
            fn() => Rx::remove((int) $o['id'], [], Roles::OWNER, 1),
            'ยกเลิกโดยไม่บอกเหตุผล',
        );
    });
});

test('พนักงานหน้าร้านยกเลิกใบที่ลงต้นทุนแล้วไม่ได้ — มีตัวเลขเงินผูกอยู่', function () {
    withRollback(function () {
        $o = anRxOrder(['unit_cost' => '4780']);
        throwsReason(
            'forbidden',
            fn() => Rx::remove((int) $o['id'], ['note' => 'ขอลบ'], Roles::SALES, 1),
            'staff ยกเลิกใบที่มีต้นทุน',
        );
    });
});

test('ยกเลิกซ้ำไม่ได้', function () {
    withRollback(function () {
        $o = anRxOrder(['sale_price' => '9500']);
        Rx::remove((int) $o['id'], ['note' => 'ครั้งแรก'], Roles::OWNER, 1);
        throwsReason(
            'already_cancelled',
            fn() => Rx::remove((int) $o['id'], ['note' => 'ครั้งที่สอง'], Roles::OWNER, 1),
            'ยกเลิกใบเดิมซ้ำ',
        );
    });
});

test('ใบที่ยกเลิกแล้วหายจากสมุดใบสั่ง และไม่ค้างอยู่ในคิวรอลงต้นทุน', function () {
    withRollback(function () {
        $live = anRxOrder();
        $dead = anRxOrder(['sale_price' => '9500']);

        Rx::remove((int) $dead['id'], ['note' => 'ยกเลิก'], Roles::OWNER, 1);

        ok(rxRow((int) $live['id']) !== null, 'ใบที่ยังเดินอยู่ต้องยังเห็น');
        eq(rxRow((int) $dead['id']), null, 'ใบที่ยกเลิกต้องหายจากสมุด');

        $waiting = array_column(Rx::awaitingCost(), 'id');
        ok(!in_array((int) $dead['id'], $waiting, true), 'ใบที่ยกเลิกต้องไม่รออยู่ในคิวลงต้นทุน');
    });
});

test('ใบที่ยกเลิกแล้ว แก้ไขต่อไม่ได้', function () {
    withRollback(function () {
        $o = anRxOrder(['sale_price' => '9500']);
        Rx::remove((int) $o['id'], ['note' => 'ยกเลิก'], Roles::OWNER, 1);
        throwsReason(
            'already_cancelled',
            fn() => Rx::edit((int) $o['id'], ['note' => 'ขอแก้'], Roles::OWNER, 1),
            'แก้ใบที่ยกเลิกแล้ว',
        );
    });
});
