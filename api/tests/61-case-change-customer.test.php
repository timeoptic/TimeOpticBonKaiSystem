<?php

declare(strict_types=1);

/**
 * เปลี่ยนลูกค้าของเคส — ปุ่ม "เปลี่ยนลูกค้า" บนหัวหน้าเคส (ร้านขอ 15 ก.ย. 2026)
 *
 * ที่มา: เปิดเคสแล้วเลือกลูกค้าผิดคน (CASE-2026-00021 เปิดให้ Fredrick Lee แต่เป็นงานของ
 * Fredrik Ternstrand) ตอนนั้นต้องแก้ในฐานด้วยมือ
 *
 * กติกาที่ร้านตัดสิน:
 *   1. แอดมินขึ้นไปเท่านั้น (system.zone — เกณฑ์เดียวกับแก้ไขรายการรับเงิน) · API ตรวจเอง
 *   2. บังคับเหตุผล · ลูกค้าคนเดิมหรือคนที่ไม่มีในระบบไม่รับ
 *   3. ของที่ผูกกับเคสนั้นย้ายตามในทรานแซกชันเดียว: ออเดอร์ ค่าสายตา คิวจอง
 *      ค่าสายตาเก่าของลูกค้าคนเดิมที่ไม่ได้ผูกเคสไม่แตะ — เป็นประวัติของคนนั้นจริง
 *   4. ใบเสร็จที่ออกไปแล้วไม่แก้ชื่อบนใบ แต่หน้าเว็บต้องรู้จำนวนเพื่อเตือนก่อนยืนยัน
 *   5. ลงไทม์ไลน์เคส: ใครเปลี่ยน จากใครเป็นใคร เหตุผล
 *
 * ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

group('เปลี่ยนลูกค้าของเคส');

/** บัญชีเจ้าของร้านตัวจริงจากฐาน */
function ccOwner(): array
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

/** คนที่ถือบทบาทเดียว — ด่านอ่านแค่บทบาท */
function ccActorAs(string $role): array
{
    StockModule::boot();
    return [
        'id' => 0, 'username' => "test.$role", 'displayName' => "ทดสอบ $role",
        'roles' => [$role], 'perms' => \Optic\Roles::permsOf([$role]), 'employeeId' => null,
    ];
}

/**
 * ลูกค้าสองคน · เคสของคนแรกพร้อมออเดอร์ ค่าสายตาสองใบ คิวจอง ใบเสร็จ
 * และค่าสายตาเก่าของคนแรกที่ไม่ได้ผูกเคส
 */
function ccFixtures(Tx $q): array
{
    $tag  = bin2hex(random_bytes(3));
    $from = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ผิดคน', "เปลี่ยน-$tag")['insertId'];
    $to   = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ถูกคน', "เปลี่ยน-$tag")['insertId'];
    $case = (int) $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        "TEST-CCUST-$tag", $from, 'reception', 'new_glasses'
    )['insertId'];
    $order = (int) $q->run(
        'INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount, deposit) VALUES (?, ?, NOW(), 1000, 0, 0)',
        $from, $case
    )['insertId'];
    $rx1 = (int) $q->run("INSERT INTO prescriptions (case_id, customer_id, kind) VALUES (?, ?, 'measured')", $case, $from)['insertId'];
    $rx2 = (int) $q->run("INSERT INTO prescriptions (case_id, customer_id, kind) VALUES (?, ?, 'final')", $case, $from)['insertId'];
    $oldRx = (int) $q->run("INSERT INTO prescriptions (case_id, customer_id, kind) VALUES (NULL, ?, 'old')", $from)['insertId'];
    $booking = (int) $q->run(
        'INSERT INTO bookings (booking_code, booking_date, booking_time, customer_id, case_id) VALUES (?, CURDATE(), ?, ?, ?)',
        "TEST-BK-$tag", '10:00:00', $from, $case
    )['insertId'];
    $receipt = (int) $q->run(
        'INSERT INTO receipts (receipt_no, order_id, total_amount, bill_name) VALUES (?, ?, ?, ?)',
        "TEST-RC-$tag", $order, '1000.00', "ผิดคน เปลี่ยน-$tag"
    )['insertId'];
    return compact('from', 'to', 'case', 'order', 'rx1', 'rx2', 'oldRx', 'booking', 'receipt');
}

function ccPost(array $actor, int $caseId, array $body): mixed
{
    StockModule::boot();
    return \Optic\Auth::as($actor, fn() => Router::dispatch('POST', "/api/cases/$caseId/customer", [], $body));
}

function ccPreview(array $actor, int $caseId): mixed
{
    StockModule::boot();
    return \Optic\Auth::as($actor, fn() => Router::dispatch('GET', "/api/cases/$caseId/customer"));
}

/** @return array{status:?int,reason:?string,msg:string} */
function ccError(callable $call): array
{
    try {
        $call();
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null, 'msg' => $e->getMessage()];
    }
    return ['status' => null, 'reason' => null, 'msg' => ''];
}

function ccCustomerOf(Tx $q, string $table, int $id): int
{
    return (int) $q->get("SELECT customer_id FROM `$table` WHERE id = ?", $id)['customer_id'];
}

test('พนักงานขายเปลี่ยนไม่ได้ — 403 และเคสยังเป็นของคนเดิม', function () {
    rollback(function (Tx $q) {
        $f = ccFixtures($q);
        $e = ccError(fn() => ccPost(ccActorAs('sales'), $f['case'], ['customer_id' => $f['to'], 'reason' => 'เลือกผิด']));
        eq($e['status'], 403, 'สถานะ');
        eq(ccCustomerOf($q, 'cases', $f['case']), $f['from'], 'ลูกค้าของเคส');
        eq(ccError(fn() => ccPreview(ccActorAs('sales'), $f['case']))['status'], 403, 'สถานะของหน้าสรุปก่อนเปลี่ยน');
    });
});

test('เจ้าของร้านเปลี่ยนได้ — เคส ออเดอร์ ค่าสายตาของเคส และคิวจองย้ายไปคนใหม่', function () {
    rollback(function (Tx $q) {
        $f   = ccFixtures($q);
        $res = ccPost(ccOwner(), $f['case'], ['customer_id' => $f['to'], 'reason' => 'เลือกลูกค้าผิดตอนเปิดเคส']);
        eq(ccCustomerOf($q, 'cases', $f['case']), $f['to'], 'ลูกค้าของเคส');
        eq(ccCustomerOf($q, 'custom_orders', $f['order']), $f['to'], 'ลูกค้าของออเดอร์');
        eq(ccCustomerOf($q, 'prescriptions', $f['rx1']), $f['to'], 'ค่าสายตาที่วัด');
        eq(ccCustomerOf($q, 'prescriptions', $f['rx2']), $f['to'], 'ค่าสายตาที่ใช้จริง');
        eq(ccCustomerOf($q, 'bookings', $f['booking']), $f['to'], 'คิวจองของเคส');
        eq($res['moved'] ?? null, ['orders' => 1, 'prescriptions' => 2, 'bookings' => 1], 'จำนวนที่ย้าย');
    });
});

test('ค่าสายตาเก่าที่ไม่ได้ผูกเคสยังเป็นของลูกค้าคนเดิม', function () {
    rollback(function (Tx $q) {
        $f = ccFixtures($q);
        ccPost(ccOwner(), $f['case'], ['customer_id' => $f['to'], 'reason' => 'เลือกผิด']);
        eq(ccCustomerOf($q, 'prescriptions', $f['oldRx']), $f['from'], 'ค่าสายตาเก่าที่ไม่ผูกเคส');
    });
});

test('แอดมินเปลี่ยนได้', function () {
    rollback(function (Tx $q) {
        $f = ccFixtures($q);
        ccPost(ccActorAs('admin'), $f['case'], ['customer_id' => $f['to'], 'reason' => 'เลือกผิด']);
        eq(ccCustomerOf($q, 'cases', $f['case']), $f['to'], 'ลูกค้าของเคส');
    });
});

test('ไทม์ไลน์เคสบันทึกว่าเปลี่ยนจากใครเป็นใคร เหตุผล และคนเปลี่ยน', function () {
    rollback(function (Tx $q) {
        $f     = ccFixtures($q);
        $owner = ccOwner();
        ccPost($owner, $f['case'], ['customer_id' => $f['to'], 'reason' => 'เลือกลูกค้าผิดตอนเปิดเคส']);
        $ev = $q->get('SELECT * FROM case_events WHERE case_id = ? ORDER BY id DESC LIMIT 1', $f['case']);
        eq($ev['action'] ?? null, 'customer_changed', 'action');
        eq((int) $ev['entity_id'], $f['to'], 'entity_id คือลูกค้าคนใหม่');
        eq($ev['employee_id'] === null ? null : (int) $ev['employee_id'], $owner['employeeId'], 'พนักงานที่เปลี่ยน');
        ok(str_contains((string) $ev['note'], 'ผิดคน') && str_contains((string) $ev['note'], 'ถูกคน'), 'โน้ตมีชื่อทั้งสองคน: ' . $ev['note']);
        ok(str_contains((string) $ev['note'], 'เลือกลูกค้าผิดตอนเปิดเคส'), 'โน้ตมีเหตุผล: ' . $ev['note']);
        $p = json_decode((string) $ev['payload'], true);
        eq([$p['from_customer_id'] ?? null, $p['to_customer_id'] ?? null], [$f['from'], $f['to']], 'payload จาก → เป็น');
    });
});

test('เลือกลูกค้าคนเดิม ตอบ 400 same_customer', function () {
    rollback(function (Tx $q) {
        $f = ccFixtures($q);
        $e = ccError(fn() => ccPost(ccOwner(), $f['case'], ['customer_id' => $f['from'], 'reason' => 'ลอง']));
        eq([$e['status'], $e['reason']], [400, 'same_customer'], 'สถานะ + เหตุผล');
    });
});

test('ลูกค้าที่ไม่มีในระบบ ตอบ 400 และไม่ย้ายอะไร', function () {
    rollback(function (Tx $q) {
        $f = ccFixtures($q);
        $missing = (int) $q->get('SELECT COALESCE(MAX(id), 0) + 1000 n FROM customers')['n'];
        $e = ccError(fn() => ccPost(ccOwner(), $f['case'], ['customer_id' => $missing, 'reason' => 'ลอง']));
        eq($e['status'], 400, 'สถานะ');
        eq(ccCustomerOf($q, 'custom_orders', $f['order']), $f['from'], 'ออเดอร์ยังเป็นของคนเดิม');
    });
});

test('ไม่ใส่เหตุผล ตอบ 400 และไม่ย้ายอะไร', function () {
    rollback(function (Tx $q) {
        $f = ccFixtures($q);
        $e = ccError(fn() => ccPost(ccOwner(), $f['case'], ['customer_id' => $f['to'], 'reason' => '   ']));
        eq($e['status'], 400, 'สถานะ');
        eq(ccCustomerOf($q, 'cases', $f['case']), $f['from'], 'ลูกค้าของเคส');
    });
});

test('สรุปก่อนเปลี่ยนบอกจำนวนของที่จะย้าย และใบเสร็จที่ออกไปแล้ว', function () {
    rollback(function (Tx $q) {
        $f = ccFixtures($q);
        eq(
            ccPreview(ccOwner(), $f['case']),
            ['orders' => 1, 'prescriptions' => 2, 'bookings' => 1, 'receipts' => 1],
            'สรุป'
        );
    });
});

test('ใบเสร็จที่ออกไปแล้วไม่ถูกแก้ชื่อบนใบ', function () {
    rollback(function (Tx $q) {
        $f = ccFixtures($q);
        $before = $q->get('SELECT bill_name FROM receipts WHERE id = ?', $f['receipt'])['bill_name'];
        ccPost(ccOwner(), $f['case'], ['customer_id' => $f['to'], 'reason' => 'เลือกผิด']);
        eq($q->get('SELECT bill_name FROM receipts WHERE id = ?', $f['receipt'])['bill_name'], $before, 'ชื่อบนใบเสร็จ');
    });
});
