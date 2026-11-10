<?php

declare(strict_types=1);

/**
 * วันส่งมอบ — แอดมินขึ้นไปลงย้อนหลัง / แก้ได้ พนักงานทั่วไปได้ "ตอนนี้" เสมอ
 *
 * ร้านขอ 22 ต.ค. 2026 · ด่านเดียวกับแก้รายการรับเงิน (system.zone)
 *   1. POST /api/case-deliveries: พนักงานขายส่งวันอะไรมาก็ได้เวลาเซิร์ฟเวอร์ · แอดมินได้วันที่ส่ง
 *   2. บันทึกซ้ำหลังส่งมอบแล้ว วันเดิมต้องอยู่
 *   3. PUT /api/case-deliveries/:id/date: แอดมินเท่านั้น · บังคับเหตุผล · ห้ามอนาคต
 *   4. บิลที่ปิดตอนส่งมอบ (วันปิด = วันส่งมอบเดิม) ขยับวันปิดตาม · บิลที่ปิดคนละวันไม่แตะ
 */

group('แก้วันส่งมอบ');

/** เจ้าของร้านตัวจริงจากฐาน (แบบเดียวกับ 97-payment-edit) */
function ddOwner(): array
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

function ddActorAs(string $role): array
{
    StockModule::boot();
    return [
        'id' => 0, 'username' => "test.$role", 'displayName' => "ทดสอบ $role",
        'roles' => [$role], 'perms' => \Optic\Roles::permsOf([$role]), 'employeeId' => null,
    ];
}

function ddFixtures(Tx $q, ?string $deliveredAt = null): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "วันส่ง-$tag")['insertId'];
    $emp  = (int) $q->run('INSERT INTO employees (employee_name, active) VALUES (?, 1)', "ส่ง-$tag")['insertId'];
    $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-DD-$tag", $cust)['insertId'];
    $order = (int) $q->run(
        'INSERT INTO custom_orders (customer_id, case_id, employee_id, order_date, total_price, discount, deposit)
         VALUES (?, ?, ?, NOW(), 1000, 0, 0)',
        $cust, $case, $emp
    )['insertId'];
    if ($deliveredAt !== null) {
        $q->run(
            'INSERT INTO case_deliveries (case_id, order_id, delivered_at, handed_over_by) VALUES (?, ?, ?, ?)',
            $case, $order, $deliveredAt, $emp
        );
    }
    return ['case' => $case, 'order' => $order, 'emp' => $emp];
}

function ddCall(array $actor, string $method, string $path, array $body): mixed
{
    StockModule::boot();
    return \Optic\Auth::as($actor, fn() => Router::dispatch($method, $path, [], $body));
}

function ddError(array $actor, string $method, string $path, array $body): ?int
{
    try {
        ddCall($actor, $method, $path, $body);
    } catch (HttpError $e) {
        return $e->status;
    }
    return null;
}

function ddPost(array $actor, array $f, string $at): array
{
    return ddCall($actor, 'POST', '/api/case-deliveries', [
        'case_id' => $f['case'], 'order_id' => $f['order'], 'delivered_at' => $at,
        'handed_over_by' => $f['emp'], 'employee_id' => $f['emp'], 'grinder_employee_id' => $f['emp'],
    ]);
}

test('พนักงานขายส่งวันย้อนหลังมา — ได้เวลาเซิร์ฟเวอร์แทน', function () {
    rollback(function (Tx $q) {
        $f = ddFixtures($q);
        $row = ddPost(ddActorAs('sales'), $f, '2026-01-01 10:00:00');
        ok(abs(strtotime($row['delivered_at']) - time()) < 120, 'delivered_at = ตอนนี้ ได้ ' . $row['delivered_at']);
    });
});

test('บันทึกคนเจียได้ และส่งมอบครั้งแรกต้องเลือกคนเจีย', function () {
    rollback(function (Tx $q) {
        $f = ddFixtures($q);
        $row = ddCall(ddOwner(), 'POST', '/api/case-deliveries', [
            'case_id' => $f['case'], 'order_id' => $f['order'], 'delivered_at' => '2026-10-01T14:30',
            'handed_over_by' => $f['emp'], 'employee_id' => $f['emp'], 'grinder_employee_id' => $f['emp'],
        ]);
        eq((int) $row['grinder_employee_id'], (int) $f['emp'], 'grinder_employee_id');
    });
    rollback(function (Tx $q) {
        $f = ddFixtures($q);
        eq(ddError(ddOwner(), 'POST', '/api/case-deliveries', [
            'case_id' => $f['case'], 'order_id' => $f['order'], 'delivered_at' => '2026-10-01T14:30',
            'handed_over_by' => $f['emp'], 'employee_id' => $f['emp'],
        ]), 400, 'ไม่เลือกคนเจีย = 400');
    });
});

test('แอดมินลงวันส่งมอบย้อนหลังได้', function () {
    rollback(function (Tx $q) {
        $f = ddFixtures($q);
        $row = ddPost(ddOwner(), $f, '2026-10-01T14:30');
        eq($row['delivered_at'], '2026-10-01 14:30:00', 'delivered_at');
    });
});

test('แอดมินลงวันในอนาคตไม่ได้', function () {
    rollback(function (Tx $q) {
        $f = ddFixtures($q);
        eq(ddError(ddOwner(), 'POST', '/api/case-deliveries', [
            'case_id' => $f['case'], 'delivered_at' => date('Y-m-d H:i', time() + 86400),
        ]), 400, 'สถานะ');
    });
});

test('บันทึกซ้ำหลังส่งมอบแล้ว วันเดิมไม่ถูกเขียนทับ', function () {
    rollback(function (Tx $q) {
        $f = ddFixtures($q, '2026-10-05 09:00:00');
        eq(ddPost(ddActorAs('sales'), $f, '2026-10-06 09:00')['delivered_at'], '2026-10-05 09:00:00', 'พนักงานขาย');
        eq(ddPost(ddOwner(), $f, '2026-10-06 09:00')['delivered_at'], '2026-10-05 09:00:00', 'แอดมิน');
    });
});

test('PUT แก้วัน: พนักงานขายได้ 403 และวันไม่เปลี่ยน', function () {
    rollback(function (Tx $q) {
        $f = ddFixtures($q, '2026-10-05 09:00:00');
        eq(ddError(ddActorAs('sales'), 'PUT', "/api/case-deliveries/{$f['case']}/date", [
            'delivered_at' => '2026-10-04 09:00', 'reason' => 'ลืมกด',
        ]), 403, 'สถานะ');
        eq($q->get('SELECT delivered_at FROM case_deliveries WHERE case_id = ?', $f['case'])['delivered_at'],
            '2026-10-05 09:00:00', 'วันในฐาน');
    });
});

test('PUT แก้วัน: ต้องมีเหตุผล และเคสต้องส่งมอบแล้ว', function () {
    rollback(function (Tx $q) {
        $f = ddFixtures($q, '2026-10-05 09:00:00');
        eq(ddError(ddOwner(), 'PUT', "/api/case-deliveries/{$f['case']}/date", [
            'delivered_at' => '2026-10-04 09:00', 'reason' => ' ',
        ]), 400, 'ไม่มีเหตุผล');
        $g = ddFixtures($q);
        eq(ddError(ddOwner(), 'PUT', "/api/case-deliveries/{$g['case']}/date", [
            'delivered_at' => '2026-10-04 09:00', 'reason' => 'ลืมกด',
        ]), 400, 'ยังไม่ส่งมอบ');
    });
});

test('PUT แก้วัน: บิลที่ปิดตอนส่งมอบขยับวันปิดตาม ลงไทม์ไลน์ บิลที่ปิดคนละวันไม่แตะ', function () {
    rollback(function (Tx $q) {
        $f = ddFixtures($q, '2026-10-05 09:00:00');
        /* Bewell ไม่ได้ปิดบิลตอนส่งมอบ — จำลองบิลที่ถูกปิดด้วยวันเดียวกับวันส่งมอบ */
        $q->run("UPDATE custom_orders SET order_closed = 1, order_close_date = '2026-10-05 09:00:00' WHERE id = ?", $f['order']);
        $other = (int) $q->run(
            "INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount, deposit,
               order_closed, order_close_date)
             SELECT customer_id, case_id, NOW(), 500, 0, 0, 1, '2026-10-02 11:00:00' FROM custom_orders WHERE id = ?",
            $f['order']
        )['insertId'];

        $row = ddCall(ddOwner(), 'PUT', "/api/case-deliveries/{$f['case']}/date", [
            'delivered_at' => '2026-10-03T16:45', 'reason' => 'ส่งจริงวันที่ 3 ลืมกด',
        ]);
        eq($row['delivered_at'], '2026-10-03 16:45:00', 'delivered_at');
        eq($q->get('SELECT order_close_date d FROM custom_orders WHERE id = ?', $f['order'])['d'],
            '2026-10-03 16:45:00', 'วันปิดบิลที่ปิดตอนส่งมอบ');
        eq($q->get('SELECT order_close_date d FROM custom_orders WHERE id = ?', $other)['d'],
            '2026-10-02 11:00:00', 'บิลที่ปิดคนละวัน');
        $ev = $q->get(
            "SELECT note FROM case_events WHERE case_id = ? AND action = 'delivery_date_edited'",
            $f['case']
        );
        ok($ev && str_contains($ev['note'], '2026-10-05 09:00 → 2026-10-03 16:45'), 'ไทม์ไลน์: ' . ($ev['note'] ?? '-'));
        ok(str_contains($ev['note'], 'ส่งจริงวันที่ 3 ลืมกด'), 'เหตุผลในไทม์ไลน์');
    });
});
