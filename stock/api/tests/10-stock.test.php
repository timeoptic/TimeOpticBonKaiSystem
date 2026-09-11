<?php

declare(strict_types=1);

use Optic\ApiError;
use Optic\Db;
use Optic\Roles;
use Optic\Service\Receiving;
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
            'SELECT l.id, l.lot_number, l.remaining_qty FROM stock_lots l
             JOIN products p ON p.id = l.product_id
             WHERE p.sku = ? AND l.remaining_qty > 0
             ORDER BY l.received_date ASC, l.id ASC',
            [$sku],
        );
        $oldest = $lots[0];

        $out = Stock::issue(issueReq($sku, (int) $oldest['remaining_qty'], idem('fifo')));

        eq($out['cuts'][0]['lot'], $oldest['lot_number'], 'ล็อตแรกที่ถูกตัด');
        eq(lotRemaining((int) $oldest['id']), 0, 'ล็อตเก่าสุดต้องถูกใช้จนหมดก่อน');
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
        $k = idem('retry');

        /* จำนวนติดลบถูกปฏิเสธก่อนแตะฐานข้อมูล — ใช้เป็นตัวอย่างของ "คำขอที่ถูก
           ปฏิเสธ" แทน "ของไม่พอ" ซึ่งปฏิเสธที่หลังจากล็อกล็อตไปแล้ว */
        throwsReason('bad_quantity', fn() => Stock::issue(issueReq($sku, -1, $k)), 'จำนวนติดลบ');

        // กุญแจเดิมต้องยังใช้ได้ คำขอที่ตายก่อนถึงฐานข้อมูลไม่ควรกินกุญแจไปด้วย
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

/**
 * @param list<array{sku:string,quantity:int}> $items
 * @param array<string,mixed> $extra ทับค่าเริ่มต้นได้ รวมถึง `source` ซึ่งเป็นตัว
 *        ตัดสินว่าตะกร้าใบนี้ยอมให้ยอดติดลบไหม
 */
function basketReq(array $items, string $k, array $extra = []): array
{
    return $extra + ['source' => 'test', 'idem_key' => $k, 'items' => $items, 'actor_id' => 1];
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

test('ตะกร้าที่มีบรรทัดของไม่พอ ยังตัดได้ทั้งใบ ส่วนที่ขาดกลายเป็นยอดค้าง', function () {
    withRollback(function () {
        [$a, $b] = twoSkus();
        $beforeA = Stock::availability($a)['on_hand'];
        $beforeB = Stock::availability($b)['on_hand'];

        /* คู่เลนส์ต้องออกไปพร้อมกันหรือไม่ออกเลย — เดิมบรรทัดที่ของไม่พอทำให้ทั้ง
           ใบถูกปฏิเสธ · ตะกร้าที่มาจากการขายหน้าร้านไม่มีบรรทัดไหนที่ "ทำไม่ได้"
           ทั้งใบจึงผ่าน และข้างที่ของไม่พอกลายเป็นยอดค้างส่งแทนที่จะพาอีกข้างตกไป
           ด้วย · ตะกร้าจากหน้าคลังไม่ใช่แบบนั้น ดูเทสต์ "เบิกเกินของที่มี" */
        Stock::issueMany(basketReq(
            [['sku' => $a, 'quantity' => 1], ['sku' => $b, 'quantity' => $beforeB + 2]],
            idem('short'),
            ['source' => 'frontdesk'],
        ));

        eq(Stock::availability($a)['on_hand'], $beforeA - 1, 'ตัวแรกถูกตัดหนึ่งชิ้น');
        eq(Stock::availability($b)['on_hand'], -2, 'ตัวที่สองค้างส่งสองชิ้น');
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

test('ของไม่พอก็ตัดได้ ส่วนที่เกินกลายเป็นยอดค้างส่ง', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];

        $res = Stock::issue(saleReq($sku, $onHand + 2, idem('short')));

        eq(array_sum(array_column($res['cuts'], 'quantity')), $onHand + 2, 'ตัดครบตามที่ขอ');
        eq(Stock::availability($sku)['on_hand'], -2, 'ยอดคงเหลือติดลบเท่าที่ค้าง');

        $short = array_values(array_filter($res['cuts'], fn($c) => ($c['shortfall'] ?? false) === true));
        eq(count($short), 1, 'ต้องมีบรรทัดค้างส่งหนึ่งบรรทัด');
        eq($short[0]['quantity'], 2, 'จำนวนที่ค้าง');
        eq($short[0]['unit_cost'], null, 'ยังไม่รู้ต้นทุนจนกว่าของจะมาถึง');
    });
});

test('ของที่ค้างส่งไปกองบนล็อตของมันเอง ล็อตจริงไม่ติดลบ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];
        Stock::issue(saleReq($sku, $onHand + 3, idem('shortlot')));

        $rows = Db::all(
            'SELECT l.lot_number, l.remaining_qty FROM stock_lots l
               JOIN products p ON p.id = l.product_id
              WHERE p.sku = ? AND l.remaining_qty < 0',
            [$sku],
        );
        eq(count($rows), 1, 'ล็อตที่ติดลบต้องมีใบเดียว');
        eq($rows[0]['lot_number'], 'SHORT-' . $sku, 'และต้องเป็นล็อตค้างส่ง');
        eq((int) $rows[0]['remaining_qty'], -3, 'ยอดค้าง');
    });
});

test('ยอดคงเหลือยังเท่ากับผลรวมในสมุด แม้ตอนติดลบ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];
        Stock::issue(saleReq($sku, $onHand + 2, idem('ledger')));

        $drift = Db::all(
            'SELECT l.lot_number FROM stock_lots l
               JOIN products p ON p.id = l.product_id
               LEFT JOIN inventory_logs g ON g.lot_id = l.id
              WHERE p.sku = ?
              GROUP BY l.id, l.lot_number, l.remaining_qty
             HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)',
            [$sku],
        );
        eq($drift, [], 'ทุกล็อตต้องมียอดตรงกับสมุด');
    });
});

test('รับของเข้าทีหลัง หักกลบยอดที่ค้างส่งให้เอง', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];
        Stock::issue(saleReq($sku, $onHand + 4, idem('settle')));
        eq(Stock::availability($sku)['on_hand'], -4, 'ค้างอยู่สี่ชิ้น');

        /* ของมาถึงหกชิ้น — สี่ชิ้นถูกกันไว้จ่ายของที่ขายค้างไว้ เหลือขายได้สอง */
        Receiving::receive(['sku' => $sku, 'quantity' => 6, 'cost_per_unit' => 100, 'received_date' => date('Y-m-d')], [Roles::OWNER], 1);
        eq(Stock::availability($sku)['on_hand'], 2, 'เหลือขายได้เท่าที่เกินจากหนี้');

        $neg = (int) Db::value(
            'SELECT COUNT(*) FROM stock_lots l JOIN products p ON p.id = l.product_id
              WHERE p.sku = ? AND l.remaining_qty < 0',
            [$sku],
        );
        eq($neg, 0, 'ไม่เหลือล็อตที่ติดลบ');
    });
});

test('ของมาถึงน้อยกว่าที่ค้าง ก็หักกลบเท่าที่มี', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];
        Stock::issue(saleReq($sku, $onHand + 5, idem('partial')));

        Receiving::receive(['sku' => $sku, 'quantity' => 2, 'cost_per_unit' => 100, 'received_date' => date('Y-m-d')], [Roles::OWNER], 1);
        eq(Stock::availability($sku)['on_hand'], -3, 'ยังค้างอยู่สามชิ้น');
    });
});

/**
 * ใครยอมให้ตัดเกินของที่มี — คำถามนี้ตอบด้วย `source` ที่เดียว
 *
 * สองเทสต์คู่นี้อยู่ด้วยกันเพราะจุดที่ต้องไม่พังคือ "ต่างกันเฉพาะตรงนี้" · คำขอ
 * เหมือนกันทุกช่อง ต่างกันช่องเดียว แล้วผลต้องต่างกันคนละทาง
 */
test('เบิกเกินของที่มีจากหน้าคลัง ถูกปฏิเสธ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];

        $e = throwsReason(
            'insufficient',
            fn() => Stock::issue(issueReq($sku, $onHand + 1, idem('over-web'))),
            'เบิกเกินของที่มีหนึ่งชิ้น',
        );
        eq($e->extra['available'], $onHand, 'ต้องบอกว่ามีอยู่เท่าไร');
        eq($e->status, 409, 'รหัสสถานะ');

        eq(Stock::availability($sku)['on_hand'], $onHand, 'ของต้องไม่ขยับเลย');
    });
});

test('การขายหน้าร้านตัดเกินได้ ส่วนที่เกินไปค้างส่ง', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];

        Stock::issue(saleReq($sku, $onHand + 1, idem('over-sale')));
        eq(Stock::availability($sku)['on_hand'], -1, 'ยอดติดลบหนึ่งตามที่ค้าง');
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
        $lotId = (int) $cut['cuts'][0]['lot_id'];
        $afterCut = lotRemaining($lotId);

        $back = Stock::returnStock([
            'source'       => 'test',
            'idem_key'     => idem('ret-back'),
            'reverses_key' => $k,
            'actor_id'     => 1,
        ]);

        eq($back['action'], 'RETURN', 'ชนิด');
        eq(lotRemaining($lotId), $afterCut + 1, 'ของต้องกลับเข้าล็อตเดิม');
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
        $lotId = (int) $cut['cuts'][0]['lot_id'];
        $afterCut = lotRemaining($lotId);

        Stock::returnStock(['source' => 'test', 'idem_key' => $backKey, 'reverses_key' => $srcKey, 'actor_id' => 1]);
        $again = Stock::returnStock(['source' => 'test', 'idem_key' => $backKey, 'reverses_key' => $srcKey, 'actor_id' => 1]);

        eq($again['replayed'], true, 'ครั้งที่สองต้องเป็นการเล่นซ้ำ');
        eq(lotRemaining($lotId), $afterCut + 1, 'ของต้องกลับเข้าแค่ชิ้นเดียว');
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

test('ล็อตที่รับของเข้ามาจริง ไม่มีทางติดลบ', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $onHand = Stock::availability($sku)['on_hand'];

        // ตัดจนหมดพอดี แล้วขายต่ออีกหนึ่ง — ขายได้ และไปค้างบนล็อตค้างส่ง
        Stock::issue(issueReq($sku, $onHand, idem('drain')));
        eq(Stock::availability($sku)['on_hand'], 0, 'ต้องเหลือศูนย์พอดี');

        Stock::issue(saleReq($sku, 1, idem('over')));
        eq(Stock::availability($sku)['on_hand'], -1, 'ขายต่อได้ ยอดติดลบหนึ่ง');

        /* ล็อตคือของที่มาถึงจริงเป็นกล่อง ๆ ติดลบไม่ได้ตามนิยาม · ที่ติดลบได้มี
           ใบเดียวคือล็อตค้างส่ง ซึ่งไม่ได้มาจากการรับของ (initial_qty = 0) */
        $neg = Db::all("SELECT lot_number, initial_qty FROM stock_lots WHERE remaining_qty < 0");
        foreach ($neg as $l) {
            ok(str_starts_with((string) $l['lot_number'], 'SHORT-'), "ล็อต {$l['lot_number']} ติดลบทั้งที่ไม่ใช่ล็อตค้างส่ง");
            eq((int) $l['initial_qty'], 0, 'ล็อตค้างส่งต้องไม่มียอดรับเข้า');
        }
    });
});
