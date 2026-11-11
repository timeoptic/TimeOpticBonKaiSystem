<?php

declare(strict_types=1);

/**
 * แก้วันเปิดบิล (order_date) จากตารางหน้ารายงานงานตัดแว่น (ร้านขอ 2 ต.ค. 2026)
 *
 * กติกา:
 *   1. แอดมินขึ้นไปเท่านั้น (system.zone) · API ตรวจเอง
 *   2. บังคับเหตุผล · วันที่ผิดรูป วันในอนาคต วันเดิม ไม่รับ
 *   3. เปลี่ยนแค่วัน เวลาเดิมคงไว้ · คอลัมน์อื่นของออเดอร์ไม่แตะ
 *   4. ลงไทม์ไลน์เคส: จากวันไหนเป็นวันไหน เหตุผล
 *
 * ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

group('แก้วันเปิดบิล');

function odActorAs(string $role): array
{
    StockModule::boot();
    return [
        'id' => 0, 'username' => "test.$role", 'displayName' => "ทดสอบ $role",
        'roles' => [$role], 'perms' => \Optic\Roles::permsOf([$role]), 'employeeId' => null,
    ];
}

function odFixtures(Tx $q): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "วันบิล-$tag")['insertId'];
    $case = (int) $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        "TEST-ODATE-$tag", $cust, 'reception', 'new_glasses'
    )['insertId'];
    $order = (int) $q->run(
        "INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount, deposit)
         VALUES (?, ?, '2026-09-20 14:35:10', 1500, 100, 0)",
        $cust, $case
    )['insertId'];
    return compact('cust', 'case', 'order');
}

function odPut(array $actor, int $orderId, array $body): mixed
{
    StockModule::boot();
    return \Optic\Auth::as($actor, fn() => Router::dispatch('PUT', "/api/orders/$orderId/order-date", [], $body));
}

function odError(callable $call): array
{
    try {
        $call();
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null];
    }
    return ['status' => null, 'reason' => null];
}

function odDate(Tx $q, int $id): string
{
    return (string) $q->get('SELECT order_date FROM custom_orders WHERE id = ?', $id)['order_date'];
}

test('พนักงานขายแก้ไม่ได้ — 403 และวันเดิมยังอยู่', function () {
    rollback(function (Tx $q) {
        $f = odFixtures($q);
        $e = odError(fn() => odPut(odActorAs('sales'), $f['order'], ['order_date' => '2026-09-18', 'reason' => 'คีย์ช้า']));
        eq($e['status'], 403, 'สถานะ');
        eq(odDate($q, $f['order']), '2026-09-20 14:35:10', 'วันเปิดบิล');
    });
});

test('แอดมินแก้ได้ — เปลี่ยนแค่วัน เวลาเดิมคงไว้ ราคาไม่แตะ', function () {
    rollback(function (Tx $q) {
        $f = odFixtures($q);
        odPut(odActorAs('admin'), $f['order'], ['order_date' => '2026-09-18', 'reason' => 'คีย์บิลย้อนหลัง']);
        eq(odDate($q, $f['order']), '2026-09-18 14:35:10', 'วันเปิดบิล');
        $o = $q->get('SELECT total_price, discount FROM custom_orders WHERE id = ?', $f['order']);
        eq([(float) $o['total_price'], (float) $o['discount']], [1500.0, 100.0], 'ราคา/ส่วนลด');
    });
});

test('ไทม์ไลน์เคสบันทึกวันเดิม วันใหม่ และเหตุผล', function () {
    rollback(function (Tx $q) {
        $f = odFixtures($q);
        odPut(odActorAs('owner'), $f['order'], ['order_date' => '2026-09-18', 'reason' => 'คีย์บิลย้อนหลัง']);
        $ev = $q->get('SELECT * FROM case_events WHERE case_id = ? ORDER BY id DESC LIMIT 1', $f['case']);
        eq($ev['action'] ?? null, 'order_date_changed', 'action');
        ok(str_contains((string) $ev['note'], '2026-09-20 → 2026-09-18'), 'โน้ตมีวันเดิม → วันใหม่: ' . $ev['note']);
        ok(str_contains((string) $ev['note'], 'คีย์บิลย้อนหลัง'), 'โน้ตมีเหตุผล: ' . $ev['note']);
    });
});

test('ไม่มีเหตุผล / วันผิดรูป / วันในอนาคต / วันเดิม ตอบ 400 และไม่แก้อะไร', function () {
    rollback(function (Tx $q) {
        $f     = odFixtures($q);
        $admin = odActorAs('admin');
        $tomorrow = date('Y-m-d', strtotime('+1 day'));
        eq(odError(fn() => odPut($admin, $f['order'], ['order_date' => '2026-09-18', 'reason' => '  ']))['status'], 400, 'ไม่มีเหตุผล');
        eq(odError(fn() => odPut($admin, $f['order'], ['order_date' => '2026-02-30', 'reason' => 'x']))['status'], 400, 'วันไม่มีจริง');
        eq(odError(fn() => odPut($admin, $f['order'], ['order_date' => 'เมื่อวาน', 'reason' => 'x']))['status'], 400, 'ไม่ใช่วันที่');
        eq(odError(fn() => odPut($admin, $f['order'], ['order_date' => $tomorrow, 'reason' => 'x']))['status'], 400, 'วันในอนาคต');
        eq(odError(fn() => odPut($admin, $f['order'], ['order_date' => '2026-09-20', 'reason' => 'x'])), ['status' => 400, 'reason' => 'same_date'], 'วันเดิม');
        eq(odDate($q, $f['order']), '2026-09-20 14:35:10', 'วันเปิดบิล');
    });
});

test('บันทึกแก้ไขออเดอร์ (PUT /api/orders/:id) ไม่เปลี่ยนวันเปิดบิล แม้ส่ง order_date มาหรือไม่ส่ง', function () {
    rollback(function (Tx $q) {
        $f = odFixtures($q);
        $body = ['customer_id' => $f['cust'], 'case_id' => $f['case'], 'frame_name' => 'กรอบทดสอบ', 'frame_type' => 'กรอบเต็มโลหะ', 'total_price' => 1500, 'discount' => 0, 'deposit' => 0];
        Router::dispatch('PUT', "/api/orders/{$f['order']}", [], $body);
        eq(odDate($q, $f['order']), '2026-09-20 14:35:10', 'ไม่ส่ง order_date');
        Router::dispatch('PUT', "/api/orders/{$f['order']}", [], $body + ['order_date' => '2026-01-01']);
        eq(odDate($q, $f['order']), '2026-09-20 14:35:10', 'ส่ง order_date มา');
    });
});
