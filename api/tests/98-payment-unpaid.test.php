<?php

declare(strict_types=1);

/**
 * ประเภทการรับเงิน "ยังไม่ชำระ" — รายการ 0 บาทที่บอกว่าลูกค้าจะมาจ่ายตอนรับของ
 *
 * ร้านขอ 14 ก.ย. 2026: ลูกค้าบางรายไม่จ่ายอะไรเลยตอนสั่ง แล้วมาจ่ายทีเดียวตอนส่งมอบ ·
 * เดิมขั้นชำระเงินยืนยันไม่ได้จนกว่าจะจ่ายครบ ร้านเลือกให้บันทึกเป็นรายการรับเงิน 0 บาท
 * (ไม่ใช่ธงบนออเดอร์) เพื่อให้เห็นในประวัติการรับเงินว่าใครบันทึกไว้เมื่อไหร่
 *
 * กติกาที่ตกลงกัน:
 *   1. ยอดเป็น 0 เสมอ ไม่มีวิธีชำระ · ประเภทอื่นยังต้องมากกว่า 0
 *   2. ต้องผูกออเดอร์ที่ยังมียอดค้าง · หนึ่งออเดอร์มีได้รายการเดียวที่ยังไม่ยกเลิก
 *   3. มีรายการนี้ + วันนัดรับ = ยืนยันขั้นชำระเงินได้แม้ยอดค้าง (กระดานงานกติกาเดียวกัน)
 *   4. ไม่นับเป็นเงินรับในรายงาน หน้าหลัก และเอกสารปิดยอด
 *   5. แก้ไขไม่ได้ และแก้รายการอื่นให้เป็นประเภทนี้ไม่ได้ — ผิดให้ลบแล้วบันทึกใหม่
 *
 * ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

require_once __DIR__ . '/../routes/dashboard.php';
require_once __DIR__ . '/../routes/reports.php';

group('รับเงินประเภท "ยังไม่ชำระ"');

/** ลูกค้า + พนักงาน + เคส + ออเดอร์ราคาที่กำหนด (มีวันนัดรับเป็นค่าตั้งต้น) */
function upFixtures(Tx $q, float $price = 1000, bool $appointment = true): array
{
    $tag   = bin2hex(random_bytes(3));
    $cust  = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "ยังไม่ชำระ-$tag")['insertId'];
    $emp   = (int) $q->run('INSERT INTO employees (employee_name, active) VALUES (?, 1)', "ผู้บันทึก-$tag")['insertId'];
    $case  = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-UNPAID-$tag", $cust)['insertId'];
    $order = (int) $q->run(
        'INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount, deposit, appointment_date)
         VALUES (?, ?, NOW(), ?, 0, 0, ?)',
        $cust, $case, $price, $appointment ? date('Y-m-d', strtotime('+3 days')) : null
    )['insertId'];
    return ['case' => $case, 'order' => $order, 'emp' => $emp];
}

/** ยิงเส้นทางจริงที่ปุ่ม "บันทึกว่ายังไม่ชำระ" เรียก */
function upPost(array $f, array $extra = []): array
{
    return Router::dispatch('POST', '/api/payments', [], $extra + [
        'case_id'     => $f['case'],
        'order_id'    => $f['order'],
        'kind'        => 'unpaid',
        'amount'      => 0,
        'received_by' => $f['emp'],
    ]);
}

/** เงินจริงที่รับไว้แล้ว ใส่ตรงลงตาราง */
function upRaw(Tx $q, array $f, float $amount, string $kind = 'deposit'): int
{
    return (int) $q->run(
        "INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, paid_at)
         VALUES (?, ?, ?, 'Cash', ?, ?, NOW())",
        $f['case'], $f['order'], $kind, $amount, $f['emp']
    )['insertId'];
}

/** @return array{status:?int,reason:?string,msg:string} */
function upError(callable $fn): array
{
    try {
        $fn();
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null, 'msg' => $e->getMessage()];
    }
    return ['status' => null, 'reason' => null, 'msg' => ''];
}

function upComplete(array $f): mixed
{
    return Router::dispatch('POST', "/api/cases/{$f['case']}/processes/payment/complete", [], []);
}

function upMissing(array $f): array
{
    return caseDetail($f['case'])['processes']['payment']['missing'];
}

/** เจ้าของร้านตัวจริงจากฐาน — ด่านแก้ไขรายการรับเงินอ่านบทบาทจากคนล็อกอิน */
function upOwner(): array
{
    StockModule::boot();
    $r = Db::get(
        "SELECT a.id, a.username, a.display_name, a.employee_id
           FROM admins a JOIN admin_roles r ON r.admin_id = a.id
          WHERE r.role = 'owner' AND a.is_active = 1 LIMIT 1"
    );
    if (!$r) {
        failTest('ไม่มีบัญชี owner ในฐาน');
    }
    $roles = \Optic\Auth::rolesOf((int) $r['id']);
    return [
        'id' => (int) $r['id'], 'username' => $r['username'], 'displayName' => $r['display_name'],
        'roles' => $roles, 'perms' => \Optic\Roles::permsOf($roles),
        'employeeId' => $r['employee_id'] === null ? null : (int) $r['employee_id'],
    ];
}

test('บันทึก "ยังไม่ชำระ" ได้ — เก็บเป็น 0 บาท ไม่มีวิธีชำระ ไม่ว่าหน้าเว็บส่งเงินมาเท่าไหร่', function () {
    rollback(function (Tx $q) {
        $f   = upFixtures($q);
        $row = upPost($f, ['amount' => 500, 'method' => 'Cash']);
        eq([$row['kind'], (float) $row['amount'], $row['method']], ['unpaid', 0.0, ''], 'แถวที่บันทึก');
        $c = caseDetail($f['case']);
        eq([(float) $c['paid'], (float) $c['balance']], [0.0, 1000.0], 'ยอดรับแล้ว / คงเหลือไม่ขยับ');
    });
});

test('ประเภทอื่นยังต้องมากกว่า 0 บาท', function () {
    rollback(function (Tx $q) {
        $f = upFixtures($q);
        eq(upError(fn() => upPost($f, ['kind' => 'deposit', 'amount' => 0, 'method' => 'Cash']))['status'], 400, 'มัดจำ 0 บาท');
    });
});

test('หนึ่งออเดอร์มี "ยังไม่ชำระ" ได้รายการเดียว · ยกเลิกแล้วบันทึกใหม่ได้', function () {
    rollback(function (Tx $q) {
        $f     = upFixtures($q);
        $first = upPost($f);
        eq(upError(fn() => upPost($f))['reason'], 'unpaid_exists', 'บันทึกซ้ำ');
        Router::dispatch('DELETE', "/api/payments/{$first['id']}", [], ['reason' => 'ทดสอบ']);
        eq(upPost($f)['kind'], 'unpaid', 'หลังยกเลิก บันทึกใหม่ได้');
    });
});

test('ชำระครบแล้วบันทึก "ยังไม่ชำระ" ไม่ได้ · ไม่ผูกออเดอร์บันทึกไม่ได้', function () {
    rollback(function (Tx $q) {
        $f = upFixtures($q, 1000);
        upRaw($q, $f, 1000, 'full');
        eq(upError(fn() => upPost($f))['reason'], 'nothing_due', 'ออเดอร์ที่จ่ายครบแล้ว');

        $g = upFixtures($q);
        eq(upError(fn() => upPost($g, ['order_id' => null]))['status'], 400, 'ไม่มีออเดอร์');
    });
});

test('มี "ยังไม่ชำระ" + วันนัดรับ → ยืนยันขั้นชำระเงินได้แม้ยอดยังค้าง · ไม่มีรายการนี้ยังยืนยันไม่ได้', function () {
    rollback(function (Tx $q) {
        $f = upFixtures($q);
        upRaw($q, $f, 200);
        $before = upError(fn() => upComplete($f));
        ok($before['status'] === 400 && str_contains($before['msg'], 'ยอดคงเหลือ'), 'ก่อนบันทึก: ติดยอดคงเหลือ — ได้ ' . $before['msg']);

        upPost($f);
        eq(upMissing($f), [], 'ไม่มีอะไรขาดแล้ว');
        $states = upComplete($f);
        eq($states['payment']['status'], 'completed', 'ขั้นชำระเงินเสร็จแล้ว');
        eq((float) caseDetail($f['case'])['balance'], 800.0, 'ยอดค้างยังอยู่ ไปเก็บตอนส่งมอบ');
    });
});

test('มี "ยังไม่ชำระ" แต่ไม่มีวันนัดรับ ยังยืนยันขั้นชำระเงินไม่ได้', function () {
    rollback(function (Tx $q) {
        $f = upFixtures($q, 1000, false);
        upPost($f);
        eq(upMissing($f), ['วันนัดรับ'], 'ขาดวันนัดรับอย่างเดียว');
    });
});

test('ยกเลิก "ยังไม่ชำระ" แล้ว ขั้นชำระเงินกลับมาต้องจ่ายครบ', function () {
    rollback(function (Tx $q) {
        $f   = upFixtures($q);
        $row = upPost($f);
        Router::dispatch('DELETE', "/api/payments/{$row['id']}", [], ['reason' => 'ทดสอบ']);
        eq(upMissing($f), ['ยอดคงเหลือ 1000'], 'กลับมาติดยอดคงเหลือ');
    });
});

test('กระดานงานใช้กติกาเดียวกัน — มัดจำแล้วค้างที่ชำระเงิน · บันทึก "ยังไม่ชำระ" แล้วไปขั้นถัดไป', function () {
    rollback(function (Tx $q) {
        $f = upFixtures($q);
        upRaw($q, $f, 100);
        eq(caseStageMap([$f['case']])[$f['case']]['process_stage'], 'payment', 'มัดจำไม่ครบ');
        upPost($f);
        eq(caseStageMap([$f['case']])[$f['case']]['process_stage'], 'centering', 'มี "ยังไม่ชำระ"');
    });
});

test('ไม่นับเป็นเงินรับ — รายงานการรับเงิน Excel หน้าหลัก และเอกสารปิดยอด', function () {
    rollback(function (Tx $q) {
        $f   = upFixtures($q);
        $day = today();
        upRaw($q, $f, 300);

        $snap = static function () use ($f, $day) {
            $mine   = static fn(array $rows, string $col) => array_values(array_filter($rows, static fn($r) => (int) $r[$col] === $f['order']));
            $screen = Router::dispatch('GET', '/api/reports/payments', ['from' => $day, 'to' => $day], []);
            $closed = Router::dispatch('GET', '/api/reports/daily-closed', ['from' => $day, 'to' => $day], []);
            return [
                'receipts' => count($mine(SalesReport::receipts($day, $day, 'all'), 'order_id')),
                'screen'   => [$screen['count'], $screen['total']],
                'tx'       => Router::dispatch('GET', '/api/reports/payments/transactions', ['from' => $day, 'to' => $day], [])['count'],
                'today'    => (int) Router::dispatch('GET', '/api/dashboard', [], [])['stats']['received_today']['n'],
                'closed'   => count($mine($closed['payments'], 'order_id')),
                'kinds'    => array_keys((array) $closed['summary']['payment_by_kind']),
            ];
        };

        $before = $snap();
        upPost($f);
        $after = $snap();
        eq($after['receipts'], 1, 'receipts() เห็นแค่เงินจริง');
        eq($after['screen'], $before['screen'], 'Dashboard หน้าการรับเงิน');
        eq($after['tx'], $before['tx'], 'ตารางรายละเอียด');
        eq($after['today'], $before['today'], 'รับเงินวันนี้ที่หน้าหลัก');
        eq($after['closed'], 1, 'เอกสารปิดยอดรายวัน');
        ok(!in_array('unpaid', $after['kinds'], true), 'สรุปตามประเภทไม่มี unpaid');
    });
});

test('แก้ไข "ยังไม่ชำระ" ไม่ได้ · แก้รายการเงินจริงให้เป็น "ยังไม่ชำระ" ไม่ได้', function () {
    rollback(function (Tx $q) {
        $f      = upFixtures($q);
        $owner  = upOwner();
        $marker = upPost($f);
        $put    = static fn(int $id, array $body) => \Optic\Auth::as($owner, fn() => Router::dispatch('PUT', "/api/payments/$id", [], $body + [
            'amount' => 100, 'method' => 'Cash', 'received_by' => $f['emp'],
            'paid_at' => date('Y-m-d H:i:s'), 'reason' => 'ทดสอบ',
        ]));

        eq(upError(fn() => $put((int) $marker['id'], ['kind' => 'deposit']))['reason'], 'unpaid_locked', 'แก้รายการยังไม่ชำระ');

        $real = upRaw($q, $f, 200);
        eq(upError(fn() => $put($real, ['kind' => 'unpaid', 'amount' => 200]))['reason'], 'unpaid_locked', 'แก้เงินจริงเป็นยังไม่ชำระ');
        eq($q->get('SELECT kind FROM payments WHERE id = ?', $real)['kind'], 'deposit', 'แถวเดิมไม่เปลี่ยน');
    });
});
