<?php

declare(strict_types=1);

/**
 * ตัวกรองประเภทลูกค้าในหน้ารายงาน — ทั้งหมด / ลูกค้าร้าน / SightFirst
 *
 * แบ่งด้วยกติกาเดียวกับกระดานงาน (routes/cases.php):
 *   sightfirst = ออเดอร์ของเคสที่ customer_category = 'sight_first'
 *   shop       = ที่เหลือทั้งหมด รวมออเดอร์ที่ไม่ผูกเคส และขายหน้าร้าน (POS / ระบบเดิม)
 *              ซึ่งไม่มีประเภทลูกค้าให้แยก
 *
 * สิ่งที่ต้องไม่พังเงียบ: ลูกค้าร้าน + SightFirst ต้องเท่ากับทั้งหมดเสมอ — ไม่งั้น
 * มีเงินหล่นหายระหว่างสองกลุ่มโดยไม่มีตัวเลขไหนบอก
 *
 * ของทดสอบลงวันที่ปี 2031 ในทรานแซกชันที่ roll back — ไม่ปนกับข้อมูลจริงของร้าน
 */

group('ตัวกรองประเภทลูกค้าในรายงาน');

const RG_DAY = '2031-01-15';

/** เคส SightFirst หนึ่งใบ เคสลูกค้าร้านหนึ่งใบ ออเดอร์ไม่ผูกเคสหนึ่งใบ บิล POS หนึ่งใบ */
function reportGroupFixtures(Tx $q): array
{
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', 'รายงานกลุ่ม')['insertId'];
    $tag  = bin2hex(random_bytes(3));

    $case = static fn(string $cat) => (int) $q->run(
        'INSERT INTO cases (case_code, customer_id, customer_category, opened_at, referral_source) VALUES (?, ?, ?, ?, ?)',
        "TEST-RG-$cat-$tag", $cust, $cat, RG_DAY . ' 10:00:00', $cat === 'sight_first' ? 'Lions' : 'Walk-in'
    )['insertId'];
    $order = static fn(?int $caseId, float $price) => (int) $q->run(
        'INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount) VALUES (?, ?, ?, ?, 0)',
        $cust, $caseId, RG_DAY . ' 11:00:00', $price
    )['insertId'];
    $pay = static fn(int $orderId, float $amount) => $q->run(
        "INSERT INTO payments (order_id, amount, method, kind, paid_at) VALUES (?, ?, 'Cash', 'full', ?)",
        $orderId, $amount, RG_DAY . ' 12:00:00'
    );

    $sfCase   = $case('sight_first');
    $shopCase = $case('customer');
    $sfOrder   = $order($sfCase, 1000);
    $shopOrder = $order($shopCase, 5000);
    $bareOrder = $order(null, 700);
    $pay($sfOrder, 400);
    $pay($shopOrder, 2000);

    $posId = (int) $q->run(
        "INSERT INTO pos_sales (pos_no, sale_date, subtotal, total_amount, paid_amount, balance_amount,
                                status, payment_status, fulfillment_status)
         VALUES (?, ?, 300, 300, 300, 0, 'active', 'paid', 'delivered')",
        "TEST-RG-POS-$tag", RG_DAY . ' 13:00:00'
    )['insertId'];

    return compact('sfCase', 'shopCase', 'sfOrder', 'shopOrder', 'bareOrder', 'posId');
}

$ids = static fn(array $rows) => array_map(static fn($r) => (int) $r['id'], $rows);

test('range() อ่าน group จาก query และค่าที่ไม่รู้จักตกกลับเป็น all', function () {
    eq(SalesReport::range([])['group'], 'all', 'ไม่ส่งมา');
    eq(SalesReport::range(['group' => 'sightfirst'])['group'], 'sightfirst', 'sightfirst');
    eq(SalesReport::range(['group' => 'shop'])['group'], 'shop', 'shop');
    eq(SalesReport::range(['group' => 'ลูกค้า VIP'])['group'], 'all', 'ค่าที่ไม่รู้จัก');
});

test('บิลงานตัดแว่น: SightFirst ได้เฉพาะเคส SightFirst · ลูกค้าร้านได้ที่เหลือรวมออเดอร์ไม่ผูกเคส', function () use ($ids) {
    rollback(function (Tx $q) use ($ids) {
        $f = reportGroupFixtures($q);

        $sf   = $ids(SalesReport::mainBills(RG_DAY, RG_DAY, 'all', 'sightfirst'));
        $shop = $ids(SalesReport::mainBills(RG_DAY, RG_DAY, 'all', 'shop'));
        $all  = $ids(SalesReport::mainBills(RG_DAY, RG_DAY, 'all', 'all'));

        eq($sf, [$f['sfOrder']], 'SightFirst');
        sort($shop);
        $expect = [$f['shopOrder'], $f['bareOrder']];
        sort($expect);
        eq($shop, $expect, 'ลูกค้าร้าน');
        eq(count($sf) + count($shop), count($all), 'สองกลุ่มรวมกันต้องเท่าทั้งหมด');
    });
});

test('ขายหน้าร้าน (POS) นับเป็นลูกค้าร้าน — เลือก SightFirst แล้วไม่มี POS', function () use ($ids) {
    rollback(function (Tx $q) use ($ids) {
        $f = reportGroupFixtures($q);

        $posOf = static fn(array $rows) => array_values(array_filter($rows, static fn($r) => $r['src'] === 'pos'));
        eq(SalesReport::posBills(RG_DAY, RG_DAY, 'all', 'sightfirst'), [], 'SightFirst ต้องไม่มีบิลขายหน้าร้าน');
        eq($ids($posOf(SalesReport::posBills(RG_DAY, RG_DAY, 'all', 'shop'))), [$f['posId']], 'ลูกค้าร้าน');
        eq($ids($posOf(SalesReport::posBills(RG_DAY, RG_DAY, 'all', 'all'))), [$f['posId']], 'ทั้งหมด');
    });
});

test('เงินที่รับ: แยกตามประเภทลูกค้าของเคสที่ออเดอร์นั้นผูกอยู่', function () {
    rollback(function (Tx $q) {
        reportGroupFixtures($q);

        $sum = static fn(array $rows) => round(array_sum(array_column($rows, 'amount')), 2);
        eq($sum(SalesReport::receipts(RG_DAY, RG_DAY, 'main', 'sightfirst')), 400.0, 'SightFirst');
        eq($sum(SalesReport::receipts(RG_DAY, RG_DAY, 'main', 'shop')), 2000.0, 'ลูกค้าร้าน');
        eq($sum(SalesReport::receipts(RG_DAY, RG_DAY, 'main', 'all')), 2400.0, 'ทั้งหมด');
    });
});

test('รายงานช่องทาง: เคสแยกตามประเภทลูกค้า', function () use ($ids) {
    rollback(function (Tx $q) use ($ids) {
        $f = reportGroupFixtures($q);

        eq($ids(SalesReport::referralCases(RG_DAY, RG_DAY, 'sightfirst')), [$f['sfCase']], 'SightFirst');
        eq($ids(SalesReport::referralCases(RG_DAY, RG_DAY, 'shop')), [$f['shopCase']], 'ลูกค้าร้าน');
    });
});

test('ค้างชำระสะสม: ลูกค้าร้าน + SightFirst = ทั้งหมด', function () {
    rollback(function (Tx $q) {
        reportGroupFixtures($q);

        $all  = SalesReport::outstandingAllTime('all', 'all');
        $sf   = SalesReport::outstandingAllTime('all', 'sightfirst');
        $shop = SalesReport::outstandingAllTime('all', 'shop');
        ok(abs(($sf + $shop) - $all) < 0.01, "สองกลุ่มรวม $sf + $shop ต้องเท่าทั้งหมด $all");
        ok($sf >= 600.0, "SightFirst ต้องรวมค้างของเคสทดสอบ 600 บาท — ได้ $sf");
    });
});

test('เส้น /api/reports/main-process ส่ง group ต่อถึงบิล และบอกกลับใน meta', function () {
    rollback(function (Tx $q) {
        reportGroupFixtures($q);

        $res = Router::dispatch('GET', '/api/reports/main-process', ['from' => RG_DAY, 'to' => RG_DAY, 'group' => 'sightfirst', 'by' => 'open'], []);
        eq($res['group'], 'sightfirst', 'meta.group');
        eq($res['kpi']['bills'], 1, 'จำนวนเคส');
        eq($res['kpi']['revenue'], 1000.0, 'ยอดขาย');
    });
});

test('เส้น /api/reports/overview: เลือก SightFirst แล้วฝั่ง POS เป็นศูนย์', function () {
    rollback(function (Tx $q) {
        reportGroupFixtures($q);

        $res = Router::dispatch('GET', '/api/reports/overview', ['from' => RG_DAY, 'to' => RG_DAY, 'group' => 'sightfirst', 'by' => 'open'], []);
        $pos = array_values(array_filter($res['channels'], static fn($c) => $c['key'] === 'pos'))[0];
        eq($pos['bills'], 0, 'บิล POS');
        eq($res['kpi']['revenue'], 1000.0, 'ยอดขายรวม');
    });
});
