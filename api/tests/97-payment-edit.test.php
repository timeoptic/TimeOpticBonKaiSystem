<?php

declare(strict_types=1);

/**
 * แก้ไขรายการรับเงิน — เฉพาะแอดมิน/เจ้าของร้าน
 *
 * ร้านขอ 11 ก.ย. 2026: ประวัติการรับเงินมีปุ่ม "แก้ไข" ให้ Admin/Owner แก้จำนวนเงิน
 * ประเภท วิธีชำระ อ้างอิง ผู้รับเงิน และเวลารับ
 *
 * กติกาที่ร้านตัดสิน:
 *   1. แอดมินขึ้นไปเท่านั้น (system.zone — เกณฑ์เดียวกับยกเลิกใบขาย POS) · API ตรวจเอง
 *   2. บังคับใส่เหตุผล และบันทึกค่าเก่า → ค่าใหม่ลงไทม์ไลน์ของเคส
 *   3. แก้จนเกินยอดคงเหลือไม่ได้ — ยอดคงเหลือคิดโดยไม่นับรายการที่กำลังแก้
 *   4. รายการที่ยกเลิกแล้วแก้ไม่ได้
 *   5. มัดจำในออเดอร์ขยับตามเมื่อแก้จำนวนหรือประเภทของรายการมัดจำ
 *
 * ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

group('แก้ไขรายการรับเงิน');

/** เจ้าของร้านตัวจริงจากฐาน */
function editOwner(): array
{
    StockModule::boot();   // โหลดคลาส \Optic\* ของฝั่งคลัง (Auth, Roles)
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
        'id'          => (int) $r['id'],
        'username'    => $r['username'],
        'displayName' => $r['display_name'],
        'roles'       => $roles,
        'perms'       => \Optic\Roles::permsOf($roles),
        'employeeId'  => $r['employee_id'] === null ? null : (int) $r['employee_id'],
    ];
}

/** คนที่ถือบทบาทเดียว — ไม่ต้องมีบัญชีจริง ด่านอ่านแค่บทบาท */
function editActorAs(string $role): array
{
    StockModule::boot();
    return [
        'id' => 0, 'username' => "test.$role", 'displayName' => "ทดสอบ $role",
        'roles' => [$role], 'perms' => \Optic\Roles::permsOf([$role]), 'employeeId' => null,
    ];
}

/** ลูกค้า + พนักงานสองคน + เคส + ออเดอร์ */
function editFixtures(Tx $q, float $price = 1000): array
{
    $tag   = bin2hex(random_bytes(3));
    $cust  = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "แก้เงิน-$tag")['insertId'];
    $emp   = (int) $q->run('INSERT INTO employees (employee_name, active) VALUES (?, 1)', "ผู้รับ-$tag")['insertId'];
    $emp2  = (int) $q->run('INSERT INTO employees (employee_name, active) VALUES (?, 1)', "ผู้รับสอง-$tag")['insertId'];
    $case  = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-PED-$tag", $cust)['insertId'];
    $order = (int) $q->run(
        'INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount, deposit) VALUES (?, ?, NOW(), ?, 0, 0)',
        $cust, $case, $price
    )['insertId'];
    return ['case' => $case, 'order' => $order, 'emp' => $emp, 'emp2' => $emp2];
}

/** แถวเงินที่ใส่ตรงลงตาราง (มัดจำจะบวกเข้า custom_orders.deposit แบบเดียวกับ POST) */
function editPayment(Tx $q, array $f, float $amount, string $kind = 'final', bool $cancelled = false): int
{
    $id = (int) $q->run(
        "INSERT INTO payments (case_id, order_id, kind, method, amount, reference, received_by, paid_at, cancelled_at)
         VALUES (?, ?, ?, 'Cash', ?, NULL, ?, '2026-09-11 10:00:00', ?)",
        $f['case'], $f['order'], $kind, $amount, $f['emp'], $cancelled ? date('Y-m-d H:i:s') : null
    )['insertId'];
    if ($kind === 'deposit' && !$cancelled) {
        $q->run('UPDATE custom_orders SET deposit = deposit + ? WHERE id = ?', $amount, $f['order']);
    }
    return $id;
}

/** ค่าที่ฟอร์มแก้ไขส่ง — เริ่มจากแถวเดิมทั้งหมด แล้วทับด้วยที่เปลี่ยน */
function editBody(Tx $q, int $id, array $change): array
{
    $p = $q->get('SELECT * FROM payments WHERE id = ?', $id);
    return $change + [
        'amount'      => (float) $p['amount'],
        'kind'        => $p['kind'],
        'method'      => $p['method'],
        'reference'   => $p['reference'],
        'received_by' => (int) $p['received_by'],
        'paid_at'     => $p['paid_at'],
        'reason'      => 'กดจำนวนผิด',
    ];
}

function editPut(array $actor, int $id, array $body): mixed
{
    StockModule::boot();
    return \Optic\Auth::as($actor, fn() => Router::dispatch('PUT', "/api/payments/$id", [], $body));
}

/** @return array{status:?int,reason:?string,msg:string,payload:array} */
function editError(array $actor, int $id, array $body): array
{
    try {
        editPut($actor, $id, $body);
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null, 'msg' => $e->getMessage(), 'payload' => $e->payload];
    }
    return ['status' => null, 'reason' => null, 'msg' => '', 'payload' => []];
}

test('พนักงานขายแก้ไม่ได้ — 403 และแถวเงินไม่เปลี่ยน', function () {
    rollback(function (Tx $q) {
        $f  = editFixtures($q);
        $id = editPayment($q, $f, 500);
        $e  = editError(editActorAs('sales'), $id, editBody($q, $id, ['amount' => 400]));
        eq($e['status'], 403, 'สถานะ');
        eq((float) $q->get('SELECT amount FROM payments WHERE id = ?', $id)['amount'], 500.0, 'จำนวนเงินในฐาน');
    });
});

test('เจ้าของร้านแก้จำนวน วิธีชำระ อ้างอิง ผู้รับ และเวลารับได้', function () {
    rollback(function (Tx $q) {
        $f   = editFixtures($q);
        $id  = editPayment($q, $f, 500);
        $row = editPut(editOwner(), $id, editBody($q, $id, [
            'amount' => 450, 'method' => 'BBL', 'reference' => 'TX-778',
            'received_by' => $f['emp2'], 'paid_at' => '2026-09-10 16:30:00',
        ]));
        $p = $q->get('SELECT amount, method, reference, received_by, paid_at FROM payments WHERE id = ?', $id);
        eq((float) $p['amount'], 450.0, 'จำนวนเงิน');
        eq($p['method'], 'BBL', 'วิธีชำระ');
        eq($p['reference'], 'TX-778', 'อ้างอิง');
        eq((int) $p['received_by'], $f['emp2'], 'ผู้รับเงิน');
        eq($p['paid_at'], '2026-09-10 16:30:00', 'เวลารับ');
        eq((int) $row['id'], $id, 'คำตอบคือแถวที่แก้');
    });
});

test('แอดมินแก้ได้', function () {
    rollback(function (Tx $q) {
        $f  = editFixtures($q);
        $id = editPayment($q, $f, 500);
        editPut(editActorAs('admin'), $id, editBody($q, $id, ['amount' => 480]));
        eq((float) $q->get('SELECT amount FROM payments WHERE id = ?', $id)['amount'], 480.0, 'จำนวนเงิน');
    });
});

test('ไม่ใส่เหตุผล แก้ไม่ได้', function () {
    rollback(function (Tx $q) {
        $f  = editFixtures($q);
        $id = editPayment($q, $f, 500);
        $e  = editError(editOwner(), $id, editBody($q, $id, ['amount' => 400, 'reason' => '  ']));
        eq($e['status'], 400, 'สถานะ');
        eq((float) $q->get('SELECT amount FROM payments WHERE id = ?', $id)['amount'], 500.0, 'จำนวนเงินในฐาน');
    });
});

test('แก้จนเกินยอดคงเหลือไม่ได้ — ยอดคงเหลือไม่นับรายการที่กำลังแก้', function () {
    rollback(function (Tx $q) {
        $f = editFixtures($q, 1000);
        editPayment($q, $f, 600);
        $b = editPayment($q, $f, 300);
        /* ไม่นับตัวเอง: 1000 − 600 = 400 → แก้เป็น 400 ได้ */
        editPut(editOwner(), $b, editBody($q, $b, ['amount' => 400]));
        eq((float) $q->get('SELECT amount FROM payments WHERE id = ?', $b)['amount'], 400.0, 'แก้เป็นพอดียอด');

        $e = editError(editOwner(), $b, editBody($q, $b, ['amount' => 401]));
        eq($e['status'], 400, 'สถานะ');
        eq($e['reason'], 'over_balance', 'เหตุผล');
        eq((float) ($e['payload']['balance'] ?? -1), 400.0, 'ยอดที่แก้ได้สูงสุด');
    });
});

test('รายการที่ยกเลิกแล้วแก้ไม่ได้', function () {
    rollback(function (Tx $q) {
        $f  = editFixtures($q);
        $id = editPayment($q, $f, 500, 'final', true);
        eq(editError(editOwner(), $id, editBody($q, $id, ['amount' => 400]))['status'], 400, 'สถานะ');
    });
});

test('ไม่มีอะไรเปลี่ยน ไม่บันทึก', function () {
    rollback(function (Tx $q) {
        $f  = editFixtures($q);
        $id = editPayment($q, $f, 500);
        eq(editError(editOwner(), $id, editBody($q, $id, []))['status'], 400, 'สถานะ');
        eq((int) $q->get("SELECT COUNT(*) n FROM case_events WHERE case_id = ? AND action = 'payment_edited'", $f['case'])['n'], 0, 'ไม่มีบันทึกในไทม์ไลน์');
    });
});

test('ไม่พบรายการ — 404', function () {
    rollback(function (Tx $q) {
        eq(editError(editOwner(), 999999999, ['amount' => 1, 'received_by' => 1, 'reason' => 'x'])['status'], 404, 'สถานะ');
    });
});

test('มัดจำในออเดอร์ขยับตามจำนวนและประเภท', function () {
    rollback(function (Tx $q) {
        $f   = editFixtures($q);
        $id  = editPayment($q, $f, 300, 'deposit');
        $dep = fn() => (float) $q->get('SELECT deposit FROM custom_orders WHERE id = ?', $f['order'])['deposit'];
        eq($dep(), 300.0, 'มัดจำตั้งต้น');

        editPut(editOwner(), $id, editBody($q, $id, ['amount' => 200]));
        eq($dep(), 200.0, 'แก้จำนวนมัดจำ');

        editPut(editOwner(), $id, editBody($q, $id, ['kind' => 'final']));
        eq($dep(), 0.0, 'เปลี่ยนจากมัดจำเป็นชำระส่วนที่เหลือ');

        editPut(editOwner(), $id, editBody($q, $id, ['kind' => 'deposit', 'amount' => 250]));
        eq($dep(), 250.0, 'เปลี่ยนกลับเป็นมัดจำ');
    });
});

test('บันทึกลงไทม์ไลน์ — ใครแก้ ค่าเก่า → ค่าใหม่ และเหตุผล', function () {
    rollback(function (Tx $q) {
        $f  = editFixtures($q);
        $id = editPayment($q, $f, 500);
        editPut(editOwner(), $id, editBody($q, $id, ['amount' => 450, 'method' => 'BBL', 'reason' => 'ลูกค้าโอนมาไม่ใช่เงินสด']));
        $ev = $q->get("SELECT entity, entity_id, note, payload FROM case_events WHERE case_id = ? AND action = 'payment_edited'", $f['case']);
        ok($ev !== null, 'มีบันทึก payment_edited');
        eq($ev['entity'], 'payment', 'entity');
        eq((int) $ev['entity_id'], $id, 'entity_id');
        ok(str_contains($ev['note'], 'ลูกค้าโอนมาไม่ใช่เงินสด'), "เหตุผลอยู่ใน note: {$ev['note']}");
        ok(str_contains($ev['note'], '500.00') && str_contains($ev['note'], '450.00'), "จำนวนเก่า/ใหม่อยู่ใน note: {$ev['note']}");
        ok(str_contains($ev['note'], 'Cash') && str_contains($ev['note'], 'BBL'), "วิธีชำระเก่า/ใหม่อยู่ใน note: {$ev['note']}");
        $payload = json_decode((string) $ev['payload'], true);
        eq((float) $payload['before']['amount'], 500.0, 'payload.before.amount');
        eq((float) $payload['after']['amount'], 450.0, 'payload.after.amount');
        ok(($payload['by'] ?? '') !== '', 'payload.by มีชื่อคนแก้');
    });
});
