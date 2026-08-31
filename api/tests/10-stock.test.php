<?php

declare(strict_types=1);

use Optic\ApiError;
use Optic\Db;
use Optic\Service\Stock;

// idem() and issueReq() live in harness.php — 60-branches.test.php needs them
// too, and a single-file run only loads the file it was asked for.

group('ตัดสต็อก — เส้นทางปกติ');

test('ตัดแล้วยอดคงเหลือลดตามจำนวน', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $before = Stock::availability($sku)['on_hand'];

        $out = Stock::issue(issueReq($sku, 1, idem('issue')));

        eq($out['replayed'], false, 'ครั้งแรกต้องไม่ใช่การเล่นซ้ำ');
        eq(Stock::availability($sku)['on_hand'], $before - 1, 'ยอดคงเหลือหลังตัด');
        eq(array_sum(array_column($out['cuts'], 'quantity')), 1, 'จำนวนที่ตัดรวม');
    });
});

test('ตัดตามลำดับ FIFO — ล็อตที่รับเข้าก่อนถูกตัดก่อน', function () {
    withRollback(function () {
        $sku = skuWithLots(2);

        $lots = Db::all(
            'SELECT l.lot_number, l.remaining_qty FROM stock_lots l
             JOIN products p ON p.id = l.product_id
             WHERE p.sku = ? AND l.remaining_qty > 0
             ORDER BY l.received_date ASC, l.id ASC',
            [$sku],
        );
        $oldest = $lots[0];

        $out = Stock::issue(issueReq($sku, (int) $oldest['remaining_qty'], idem('fifo')));

        eq($out['cuts'][0]['lot'], $oldest['lot_number'], 'ล็อตแรกที่ถูกตัด');
        eq(lotRemaining((string) $oldest['lot_number']), 0, 'ล็อตเก่าสุดต้องถูกใช้จนหมดก่อน');
    });
});

test('ตัดข้ามล็อตได้เมื่อล็อตเดียวไม่พอ', function () {
    withRollback(function () {
        $sku = skuWithLots(2);
        $onHand = Stock::availability($sku)['on_hand'];
        $first = (int) Db::value(
            'SELECT l.remaining_qty FROM stock_lots l JOIN products p ON p.id = l.product_id
             WHERE p.sku = ? AND l.remaining_qty > 0 ORDER BY l.received_date ASC, l.id ASC LIMIT 1',
            [$sku],
        );

        $want = $first + 1;
        ok($want <= $onHand, 'ต้องมีของพอสำหรับทดสอบข้ามล็อต');

        $out = Stock::issue(issueReq($sku, $want, idem('span')));

        ok(count($out['cuts']) >= 2, 'ต้องตัดจากอย่างน้อยสองล็อต');
        eq(array_sum(array_column($out['cuts'], 'quantity')), $want, 'ผลรวมที่ตัด');
    });
});

test('บันทึกลง inventory_logs เป็นชนิด OUT พร้อมผู้ทำรายการ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $doc = 'JOB-TEST-' . random_int(1000, 9999);

        Stock::issue(issueReq($sku, 1, idem('log'), ['reference_doc' => $doc]));

        $log = Db::one('SELECT * FROM inventory_logs WHERE reference_doc = ?', [$doc]);
        ok($log !== null, 'ต้องมีแถวใน inventory_logs');
        eq($log['action_type'], 'OUT', 'ชนิดของรายการ');
        eq((int) $log['quantity'], -1, 'จำนวนต้องติดลบ');
        eq($log['created_by_kind'], 'user', 'ต้องบันทึกเป็น id space เดียว');
        eq((int) $log['created_by'], 1, 'ผู้ทำรายการ');
    });
});

group('ตัดสต็อก — กันทำซ้ำ');

test('ยิงกุญแจเดิมซ้ำ ตัดครั้งเดียว', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $k = idem('idem');
        $before = Stock::availability($sku)['on_hand'];

        $first  = Stock::issue(issueReq($sku, 1, $k));
        $second = Stock::issue(issueReq($sku, 1, $k));

        eq($first['replayed'], false, 'ครั้งแรก');
        eq($second['replayed'], true, 'ครั้งที่สองต้องเป็นการเล่นซ้ำ');
        eq($second['cuts'], $first['cuts'], 'คำตอบต้องเหมือนเดิมทุกประการ');
        eq(Stock::availability($sku)['on_hand'], $before - 1, 'ของต้องหายไปแค่ชิ้นเดียว');
    });
});

test('กุญแจต่างกันถือเป็นคนละเหตุการณ์', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $before = Stock::availability($sku)['on_hand'];

        Stock::issue(issueReq($sku, 1, idem('a')));
        Stock::issue(issueReq($sku, 1, idem('b')));

        eq(Stock::availability($sku)['on_hand'], $before - 2, 'ต้องตัดสองครั้ง');
    });
});

test('คำขอที่ถูกปฏิเสธไม่จองกุญแจไว้ — ยิงใหม่ได้', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];
        $k = idem('retry');

        // ขอเกินของที่มี → ถูกปฏิเสธ
        throwsReason('insufficient', fn() => Stock::issue(issueReq($sku, $onHand + 5, $k)), 'ขอเกิน');

        // กุญแจเดิมต้องยังใช้ได้ เพราะ "ของไม่พอ" เปลี่ยนได้เมื่อของเข้าใหม่
        $out = Stock::issue(issueReq($sku, 1, $k));
        eq($out['replayed'], false, 'ต้องทำงานจริง ไม่ใช่เล่นซ้ำคำปฏิเสธ');
    });
});

group('ตะกร้า — หลายรายการในคำขอเดียว');

/** Two different products that each have stock, which is what a pair of lenses is. */
function twoSkus(): array
{
    $rows = \Optic\Db::all(
        'SELECT p.sku FROM products p
         JOIN stock_lots l ON l.product_id = p.id AND l.remaining_qty > 1
         WHERE p.is_custom_made = 0
         GROUP BY p.id, p.sku
         ORDER BY p.id LIMIT 2',
    );
    if (count($rows) < 2) {
        fail('ไม่พบสินค้าสองตัวที่ยังมีของ');
    }
    return [(string) $rows[0]['sku'], (string) $rows[1]['sku']];
}

/** @param list<array{sku:string,quantity:int}> $items */
function basketReq(array $items, string $k, array $extra = []): array
{
    return ['source' => 'test', 'idem_key' => $k, 'items' => $items, 'actor_id' => 1] + $extra;
}

test('ตัดสองสินค้าพร้อมกันในคำขอเดียว — คู่เลนส์ซ้ายขวาไม่ต้องยิงสองรอบ', function () {
    withRollback(function () {
        [$a, $b] = twoSkus();
        $beforeA = Stock::availability($a)['on_hand'];
        $beforeB = Stock::availability($b)['on_hand'];

        $out = Stock::issueMany(basketReq(
            [['sku' => $a, 'quantity' => 1], ['sku' => $b, 'quantity' => 2]],
            idem('basket'),
        ));

        eq(count($out['lines']), 2, 'ต้องได้สองบรรทัด');
        eq($out['quantity'], 3, 'จำนวนรวมทั้งตะกร้า');
        eq(Stock::availability($a)['on_hand'], $beforeA - 1, 'ยอดของตัวแรก');
        eq(Stock::availability($b)['on_hand'], $beforeB - 2, 'ยอดของตัวที่สอง');
    });
});

test('บรรทัดเดียวของไม่พอ ทั้งตะกร้าต้องไม่ถูกตัด', function () {
    withRollback(function () {
        [$a, $b] = twoSkus();
        $beforeA = Stock::availability($a)['on_hand'];
        $beforeB = Stock::availability($b)['on_hand'];

        throwsReason(
            'insufficient',
            fn() => Stock::issueMany(basketReq(
                [['sku' => $a, 'quantity' => 1], ['sku' => $b, 'quantity' => $beforeB + 10]],
                idem('short'),
            )),
            'ตะกร้าที่มีบรรทัดของไม่พอ',
        );

        // ตัวแรกต้องไม่ถูกตัดทิ้งไว้ — ไม่งั้นคู่เลนส์จะออกไปข้างเดียว
        eq(Stock::availability($a)['on_hand'], $beforeA, 'ตัวแรกต้องยังอยู่ครบ');
        eq(Stock::availability($b)['on_hand'], $beforeB, 'ตัวที่สองต้องยังอยู่ครบ');
    });
});

test('สินค้าเดิมใส่ซ้ำสองบรรทัด ถูกรวมเป็นการตัดครั้งเดียว', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $before = Stock::availability($sku)['on_hand'];

        $out = Stock::issueMany(basketReq(
            [['sku' => $sku, 'quantity' => 1], ['sku' => $sku, 'quantity' => 2]],
            idem('merge'),
        ));

        eq(count($out['lines']), 1, 'ต้องเหลือบรรทัดเดียว');
        eq($out['lines'][0]['quantity'], 3, 'จำนวนถูกรวม');
        eq(Stock::availability($sku)['on_hand'], $before - 3, 'ยอดคงเหลือ');
    });
});

test('ตะกร้ายิงซ้ำด้วยกุญแจเดิม ตัดครั้งเดียว', function () {
    withRollback(function () {
        [$a, $b] = twoSkus();
        $before = Stock::availability($a)['on_hand'];
        $k = idem('basket-replay');
        $items = [['sku' => $a, 'quantity' => 1], ['sku' => $b, 'quantity' => 1]];

        $first  = Stock::issueMany(basketReq($items, $k));
        $second = Stock::issueMany(basketReq($items, $k));

        eq($first['replayed'], false, 'ครั้งแรกทำงานจริง');
        eq($second['replayed'], true, 'ครั้งที่สองต้องเป็นการเล่นซ้ำ');
        eq(Stock::availability($a)['on_hand'], $before - 1, 'ตัดครั้งเดียวเท่านั้น');
    });
});

test('ตะกร้าว่างถูกปฏิเสธ', function () {
    withRollback(function () {
        throwsReason(
            'empty_basket',
            fn() => Stock::issueMany(basketReq([], idem('empty'))),
            'ตะกร้าว่าง',
        );
    });
});

test('ตะกร้าลงสมุดครบทุกบรรทัด และคงเหลือยังตรงกับสมุด', function () {
    withRollback(function () {
        [$a, $b] = twoSkus();
        $doc = 'JOB-' . random_int(10000, 99999);

        Stock::issueMany(basketReq(
            [['sku' => $a, 'quantity' => 1], ['sku' => $b, 'quantity' => 1]],
            idem('basket-log'),
            ['reference_doc' => $doc],
        ));

        eq(
            (int) \Optic\Db::value('SELECT COUNT(DISTINCT product_id) FROM inventory_logs WHERE reference_doc = ?', [$doc]),
            2,
            'ต้องมีสมุดของทั้งสองสินค้าใต้เอกสารเดียวกัน',
        );

        $bad = \Optic\Db::all(
            'SELECT l.id FROM stock_lots l
             LEFT JOIN inventory_logs g ON g.lot_id = l.id
             GROUP BY l.id, l.remaining_qty
             HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)'
        );
        eq(count($bad), 0, 'ล็อตที่ยอดไม่ตรงกับสมุด');
    });
});

group('ตัดสต็อก — กรณีที่ต้องปฏิเสธ');

test('สินค้าสั่งตัด RX ตัดสต็อกไม่ได้', function () {
    withRollback(function () {
        $sku = (string) Db::value('SELECT sku FROM products WHERE is_custom_made = 1 LIMIT 1');
        $e = throwsReason('custom_made', fn() => Stock::issue(issueReq($sku, 1, idem('rx'))), 'สินค้าสั่งตัด');
        eq($e->status, 409, 'รหัสสถานะ');
        eq($e->payload()['sku'], $sku, 'ต้องบอก sku กลับไปด้วย');
    });
});

test('ของไม่พอ ปฏิเสธพร้อมบอกว่าเหลือเท่าไหร่', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];

        $e = throwsReason(
            'insufficient',
            fn() => Stock::issue(issueReq($sku, $onHand + 1, idem('short'))),
            'ขอเกินของที่มี',
        );
        eq($e->status, 409, 'รหัสสถานะ');
        eq($e->payload()['available'], $onHand, 'ต้องบอกยอดคงเหลือจริง');
        eq($e->payload()['wanted'], $onHand + 1, 'ต้องบอกจำนวนที่ขอ');
    });
});

test('ของไม่พอแล้วต้องไม่ตัดอะไรเลย', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];

        try {
            Stock::issue(issueReq($sku, $onHand + 1, idem('none')));
        } catch (ApiError) {
        }

        eq(Stock::availability($sku)['on_hand'], $onHand, 'ยอดต้องไม่ขยับ');
    });
});

test('SKU ที่ไม่มีในระบบ ตอบ 404', function () {
    withRollback(function () {
        $e = throwsReason(
            'unknown_sku',
            fn() => Stock::issue(issueReq('NO-SUCH-SKU-9999', 1, idem('nosku'))),
            'sku ไม่มีจริง',
        );
        eq($e->status, 404, 'รหัสสถานะ');
    });
});

test('จำนวนที่ไม่ถูกต้องถูกปฏิเสธก่อนแตะฐานข้อมูล', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        throwsReason('bad_quantity', fn() => Stock::issue(issueReq($sku, 0, idem('q0'))), 'จำนวน 0');
        throwsReason('bad_quantity', fn() => Stock::issue(issueReq($sku, -3, idem('qneg'))), 'จำนวนติดลบ');
    });
});

test('ไม่ส่งกุญแจกันซ้ำมาก็ถูกปฏิเสธ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        throwsReason(
            'missing_field',
            fn() => Stock::issue(['source' => 'test', 'sku' => $sku, 'quantity' => 1]),
            'ไม่มี idem_key',
        );
    });
});

group('ของเสีย');

test('ตัดเสียบันทึกเป็น SCRAP ไม่ใช่ OUT', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $doc = 'SCR-TEST-' . random_int(1000, 9999);

        $out = Stock::scrap(issueReq($sku, 1, idem('scrap'), [
            'reference_doc' => $doc,
            'note'          => 'ขอบบิ่นตอนเจียร',
        ]));

        eq($out['action'], 'SCRAP', 'ชนิดของคำขอ');

        $log = Db::one('SELECT * FROM inventory_logs WHERE reference_doc = ?', [$doc]);
        eq($log['action_type'], 'SCRAP', 'ชนิดในสมุด');
        eq($log['notes'], 'ขอบบิ่นตอนเจียร', 'หมายเหตุ');
    });
});

test('ของเสียก็ลดสต็อกจริงเหมือนการขาย', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $before = Stock::availability($sku)['on_hand'];

        Stock::scrap(issueReq($sku, 1, idem('scrapqty')));

        eq(Stock::availability($sku)['on_hand'], $before - 1, 'ยอดต้องลด');
    });
});

test('ของเสียแยกออกจากต้นทุนขายในสมุด', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $doc = 'MIX-' . random_int(1000, 9999);

        Stock::issue(issueReq($sku, 1, idem('m1'), ['reference_doc' => $doc . '-OUT']));
        Stock::scrap(issueReq($sku, 1, idem('m2'), ['reference_doc' => $doc . '-SCR']));

        $out   = Db::value('SELECT action_type FROM inventory_logs WHERE reference_doc = ?', [$doc . '-OUT']);
        $scrap = Db::value('SELECT action_type FROM inventory_logs WHERE reference_doc = ?', [$doc . '-SCR']);

        eq($out, 'OUT', 'การขาย');
        eq($scrap, 'SCRAP', 'ของเสีย');
        neq($out, $scrap, 'สองอย่างนี้ต้องแยกกันได้');
    });
});

group('คืนของ');

test('คืนแล้วของกลับเข้าล็อตเดิม', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $k = idem('ret-src');
        $before = Stock::availability($sku)['on_hand'];

        $cut = Stock::issue(issueReq($sku, 1, $k));
        $lot = $cut['cuts'][0]['lot'];
        $afterCut = lotRemaining($lot);

        $back = Stock::returnStock([
            'source'       => 'test',
            'idem_key'     => idem('ret-back'),
            'reverses_key' => $k,
            'actor_id'     => 1,
        ]);

        eq($back['action'], 'RETURN', 'ชนิด');
        eq(lotRemaining($lot), $afterCut + 1, 'ของต้องกลับเข้าล็อตเดิม');
        eq(Stock::availability($sku)['on_hand'], $before, 'ยอดรวมกลับมาเท่าเดิม');
    });
});

test('อ้างรายการเดิมที่ไม่มีอยู่ ถูกปฏิเสธ', function () {
    withRollback(function () {
        throwsReason(
            'unknown_original',
            fn() => Stock::returnStock([
                'source'       => 'test',
                'idem_key'     => idem('ret-bad'),
                'reverses_key' => 'ไม่มีกุญแจนี้',
                'actor_id'     => 1,
            ]),
            'อ้างรายการที่ไม่มี',
        );
    });
});

test('คืนซ้ำสองครั้งด้วยกุญแจเดิม คืนจริงครั้งเดียว', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $srcKey = idem('ret2-src');
        $backKey = idem('ret2-back');

        $cut = Stock::issue(issueReq($sku, 1, $srcKey));
        $lot = $cut['cuts'][0]['lot'];
        $afterCut = lotRemaining($lot);

        Stock::returnStock(['source' => 'test', 'idem_key' => $backKey, 'reverses_key' => $srcKey, 'actor_id' => 1]);
        $again = Stock::returnStock(['source' => 'test', 'idem_key' => $backKey, 'reverses_key' => $srcKey, 'actor_id' => 1]);

        eq($again['replayed'], true, 'ครั้งที่สองต้องเป็นการเล่นซ้ำ');
        eq(lotRemaining($lot), $afterCut + 1, 'ของต้องกลับเข้าแค่ชิ้นเดียว');
    });
});

group('ยอดคงเหลือ');

test('เลนส์สั่งตัดรายงาน 0 เสมอ เพราะไม่เคยมีสต็อก', function () {
    withRollback(function () {
        $sku = (string) Db::value('SELECT sku FROM products WHERE is_custom_made = 1 LIMIT 1');
        $a = Stock::availability($sku);
        eq($a['is_custom_made'], true, 'ต้องบอกว่าเป็นของสั่งตัด');
        eq($a['on_hand'], 0, 'ยอดคงเหลือ');
    });
});

test('ถามยอดของ SKU ที่ไม่มี ตอบ 404', function () {
    withRollback(function () {
        throwsReason('unknown_sku', fn() => Stock::availability('NOPE-0000'), 'sku ไม่มีจริง');
    });
});

group('ความถูกต้องของสมุดบัญชี');

test('หลังตัด ขาย เสีย และคืน สมุดยังตรงกับยอดคงเหลือทุกล็อต', function () {
    withRollback(function () {
        $sku = skuWithLots(2);
        $k = idem('mix-issue');

        Stock::issue(issueReq($sku, 1, $k));
        Stock::scrap(issueReq($sku, 1, idem('mix-scrap')));
        Stock::returnStock([
            'source' => 'test', 'idem_key' => idem('mix-ret'), 'reverses_key' => $k, 'actor_id' => 1,
        ]);

        $bad = Db::all(
            'SELECT l.lot_number FROM stock_lots l
             LEFT JOIN inventory_logs g ON g.lot_id = l.id
             GROUP BY l.id, l.lot_number, l.remaining_qty
             HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)'
        );
        eq(count($bad), 0, 'ล็อตที่ยอดไม่ตรงกับสมุด');
    });
});

test('ยอดคงเหลือไม่มีทางติดลบ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];

        // ตัดจนหมดพอดี แล้วขออีกหนึ่ง
        Stock::issue(issueReq($sku, $onHand, idem('drain')));
        eq(Stock::availability($sku)['on_hand'], 0, 'ต้องเหลือศูนย์พอดี');

        throwsReason('insufficient', fn() => Stock::issue(issueReq($sku, 1, idem('over'))), 'ขอต่อทั้งที่หมดแล้ว');

        $neg = (int) Db::value('SELECT COUNT(*) FROM stock_lots WHERE remaining_qty < 0');
        eq($neg, 0, 'ล็อตที่ยอดติดลบ');
    });
});
