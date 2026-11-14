<?php

declare(strict_types=1);

/**
 * รายงานยอดขายนับตามวันปิดบิล (วันส่งมอบ) — ค่าตั้งต้นของหน้ารายงานตั้งแต่ 30 ก.ย. 2026
 *
 * ร้านนับยอดของเดือนจากงานที่ส่งมอบในเดือนนั้น แต่รายงานเคยนับตามวันเปิดบิลอย่างเดียว
 * บิลที่เปิด 24 ส.ค. แล้วส่งมอบ 1 ก.ย. จึงไม่ขึ้นในเดือนกันยายน (เคส OLD-010239) ·
 * `by=close` (ตั้งต้น) นับด้วยวันปิดบิล · `by=open` คือแบบเดิม
 *
 * บิลที่ยังไม่ส่งมอบไม่มีวันปิด จึงไม่อยู่ในยอดของเดือนไหนเลยในโหมดวันปิดบิล —
 * ต้องโผล่ในบรรทัด "งานรอส่งมอบ" แทน ไม่งั้นหายเงียบ
 *
 * ของทดสอบอยู่ในปี 2031 ที่ไม่มีข้อมูลจริง และ roll back เสมอ
 */

group('รายงานยอดขาย: นับตามวันปิดบิล');

const BC_AUG = ['2031-08-01', '2031-08-31'];
const BC_SEP = ['2031-09-01', '2031-09-30'];

/** บิลเปิด 24 ส.ค. ปิด 1 ก.ย. (1999 บาท) กับบิลเปิด 5 ก.ย. ที่ยังไม่ส่งมอบ (700 บาท) */
function byCloseFixtures(Tx $q): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "วันปิด-$tag")['insertId'];
    $bill = static function (string $code, string $opened, ?string $closed, float $price) use ($q, $cust, $tag): int {
        $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "$code-$tag", $cust)['insertId'];
        return (int) $q->run(
            'INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount, deposit,
               order_closed, order_close_date) VALUES (?, ?, ?, ?, 0, 0, ?, ?)',
            $cust, $case, $opened, $price, $closed ? 1 : 0, $closed
        )['insertId'];
    };
    return [
        'closed' => $bill('BC-CLOSED', '2031-08-24 16:03:00', '2031-09-01 11:03:00', 1999),
        'open'   => $bill('BC-OPEN', '2031-09-05 10:00:00', null, 700),
    ];
}

$ids = static fn(array $rows) => array_map(static fn($r) => (int) $r['id'], $rows);

test('range() อ่าน by จาก query — ไม่ส่งมาหรือค่าแปลกคือวันปิดบิล', function () {
    eq(SalesReport::range([])['by'], 'close', 'ไม่ส่งมา');
    eq(SalesReport::range(['by' => 'open'])['by'], 'open', 'open');
    eq(SalesReport::range(['by' => 'วันไหนก็ได้'])['by'], 'close', 'ค่าที่ไม่รู้จัก');
});

test('นับตามวันปิดบิล: บิลเปิด ส.ค. ปิด ก.ย. อยู่เดือนกันยายน ไม่อยู่เดือนสิงหาคม', function () use ($ids) {
    rollback(function (Tx $q) use ($ids) {
        $f = byCloseFixtures($q);
        eq($ids(SalesReport::mainBills(...BC_SEP, status: 'all', group: 'all', by: 'close')), [$f['closed']], 'ก.ย.');
        eq($ids(SalesReport::mainBills(...BC_AUG, status: 'all', group: 'all', by: 'close')), [], 'ส.ค.');
    });
});

test('นับตามวันเปิดบิล: ได้แบบเดิม — บิลเดียวกันอยู่เดือนสิงหาคม', function () use ($ids) {
    rollback(function (Tx $q) use ($ids) {
        $f = byCloseFixtures($q);
        eq($ids(SalesReport::mainBills(...BC_AUG, status: 'all', group: 'all', by: 'open')), [$f['closed']], 'ส.ค.');
        eq($ids(SalesReport::mainBills(...BC_SEP, status: 'all', group: 'all', by: 'open')), [$f['open']], 'ก.ย.');
    });
});

test('นับตามวันปิดบิล + สถานะ "ยังไม่จบ": ได้บิลที่ยังไม่ปิด ตามวันเปิดบิล', function () use ($ids) {
    rollback(function (Tx $q) use ($ids) {
        $f = byCloseFixtures($q);
        eq($ids(SalesReport::mainBills(...BC_SEP, status: 'open', group: 'all', by: 'close')), [$f['open']], 'ก.ย.');
    });
});

test('งานรอส่งมอบ: นับบิลที่ยังไม่ปิดทั้งร้าน ไม่นับบิลที่ปิดแล้ว', function () {
    rollback(function (Tx $q) {
        $before = SalesReport::pendingMain('all');
        byCloseFixtures($q);
        $after = SalesReport::pendingMain('all');
        eq($after['bills'] - $before['bills'], 1, 'จำนวนใบที่เพิ่ม');
        eq(round($after['revenue'] - $before['revenue'], 2), 700.0, 'ยอดที่เพิ่ม');
    });
});

test('เส้น main-process: ค่าตั้งต้นนับตามวันปิดบิล ยอดลงวันที่ปิด และมีงานรอส่งมอบ', function () {
    rollback(function (Tx $q) {
        byCloseFixtures($q);
        $res = Router::dispatch('GET', '/api/reports/main-process', ['from' => BC_SEP[0], 'to' => BC_SEP[1]], []);
        eq($res['by'], 'close', 'meta.by');
        eq($res['kpi']['bills'], 1, 'จำนวนเคส');
        eq($res['kpi']['revenue'], 1999.0, 'ยอดขาย');
        $day = array_values(array_filter($res['daily'], static fn($d) => $d['date'] === '2031-09-01'))[0];
        eq($day['main'], 1999.0, 'ยอดของวันที่ 1 ก.ย.');
        ok($res['pending'] !== null && $res['pending']['bills'] >= 1, 'ต้องมีงานรอส่งมอบ');
    });
});

test('เส้น main-process by=open: แบบเดิม และไม่มีบรรทัดงานรอส่งมอบ', function () {
    rollback(function (Tx $q) {
        byCloseFixtures($q);
        $res = Router::dispatch('GET', '/api/reports/main-process', ['from' => BC_AUG[0], 'to' => BC_AUG[1], 'by' => 'open'], []);
        eq($res['by'], 'open', 'meta.by');
        eq($res['kpi']['revenue'], 1999.0, 'ยอดขาย ส.ค.');
        eq($res['pending'], null, 'งานรอส่งมอบ');
    });
});

test('เส้น overview: ยอดรวมเดือนกันยายนนับบิลที่ปิดในเดือนนั้น', function () {
    rollback(function (Tx $q) {
        byCloseFixtures($q);
        $res = Router::dispatch('GET', '/api/reports/overview', ['from' => BC_SEP[0], 'to' => BC_SEP[1], 'channel' => 'main'], []);
        eq($res['kpi']['revenue'], 1999.0, 'ยอดขายรวม');
        ok($res['pending'] !== null, 'ต้องมีงานรอส่งมอบ');
    });
});

test('เส้น employees: โหมดวันปิดบิลไม่มีอัตราปิดการขาย (ทุกใบปิดแล้ว จะเป็น 100% เสมอ)', function () {
    rollback(function (Tx $q) {
        byCloseFixtures($q);
        $close = Router::dispatch('GET', '/api/reports/employees', ['from' => BC_SEP[0], 'to' => BC_SEP[1], 'channel' => 'main'], []);
        eq($close['rows'][0]['conversion'], null, 'by=close');
        $open = Router::dispatch('GET', '/api/reports/employees', ['from' => BC_AUG[0], 'to' => BC_AUG[1], 'channel' => 'main', 'by' => 'open'], []);
        eq($open['rows'][0]['conversion'], 100.0, 'by=open');
    });
});

test('Excel ยอดขาย: โหมดวันปิดบิลแบ่งเดือนตามวันปิด', function () {
    rollback(function (Tx $q) {
        byCloseFixtures($q);
        $sep = SalesExport::rows(BC_SEP[0], BC_SEP[1], 'main', 'all', 'all', 'close');
        eq(count($sep), 1, 'จำนวนแถว ก.ย.');
        eq($sep[0]['date'], '2031-09-01', 'วันที่ใช้แบ่งเดือน');
        eq(SalesExport::rows(BC_AUG[0], BC_AUG[1], 'main', 'all', 'all', 'close'), [], 'ส.ค.');
    });
});
