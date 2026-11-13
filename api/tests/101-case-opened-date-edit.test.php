<?php

declare(strict_types=1);

/**
 * แก้วันเปิดเคสแล้ววันเปิดบิลขยับตาม (ร้านขอ 13 พ.ย. 2026 — เคส CASE-2026-00467)
 *
 * กติกา:
 *   1. แอดมินขึ้นไปเท่านั้น (system.zone) · API ตรวจเอง
 *   2. บังคับเหตุผล · วันที่ผิดรูป วันในอนาคต วันเดิม ไม่รับ
 *   3. วันเปิดเคสเปลี่ยนแค่วัน เวลาเดิมคงไว้
 *   4. บิลทุกใบในเคสขยับจำนวนวันเท่ากัน เวลาเดิมคงไว้ · วันปิดบิลไม่แตะ
 *   5. บิลจะเลยวันนี้หรือเลยวันปิดบิล → ไม่รับ และไม่มีอะไรเปลี่ยน
 *   6. ลงไทม์ไลน์ทั้งเคสและบิล
 *
 * ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

group('แก้วันเปิดเคส');

function cdActorAs(string $role): array
{
    StockModule::boot();
    return [
        'id' => 0, 'username' => "test.$role", 'displayName' => "ทดสอบ $role",
        'roles' => [$role], 'perms' => \Optic\Roles::permsOf([$role]), 'employeeId' => null,
    ];
}

function cdFixtures(Tx $q, ?string $closeDate = null): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "วันเคส-$tag")['insertId'];
    $case = (int) $q->run(
        "INSERT INTO cases (case_code, customer_id, status, case_type, opened_at) VALUES (?,?,?,?, '2026-09-20 10:15:00')",
        "TEST-CDATE-$tag", $cust, 'reception', 'new_glasses'
    )['insertId'];
    $o1 = (int) $q->run(
        "INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, order_closed, order_close_date)
         VALUES (?, ?, '2026-09-20 10:30:45', 1500, ?, ?)",
        $cust, $case, $closeDate ? 1 : 0, $closeDate
    )['insertId'];
    $o2 = (int) $q->run(
        "INSERT INTO custom_orders (customer_id, case_id, order_date, total_price) VALUES (?, ?, '2026-09-25 16:00:00', 900)",
        $cust, $case
    )['insertId'];
    return compact('cust', 'case', 'o1', 'o2');
}

function cdPut(array $actor, int $caseId, array $body): mixed
{
    StockModule::boot();
    return \Optic\Auth::as($actor, fn() => Router::dispatch('PUT', "/api/cases/$caseId/opened-date", [], $body));
}

function cdError(callable $call): array
{
    try {
        $call();
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null];
    }
    return ['status' => null, 'reason' => null];
}

function cdState(Tx $q, array $f): array
{
    return [
        (string) $q->get('SELECT opened_at FROM cases WHERE id = ?', $f['case'])['opened_at'],
        (string) $q->get('SELECT order_date FROM custom_orders WHERE id = ?', $f['o1'])['order_date'],
        (string) $q->get('SELECT order_date FROM custom_orders WHERE id = ?', $f['o2'])['order_date'],
    ];
}

const CD_UNCHANGED = ['2026-09-20 10:15:00', '2026-09-20 10:30:45', '2026-09-25 16:00:00'];

test('พนักงานขายแก้ไม่ได้ — 403 และไม่มีอะไรเปลี่ยน', function () {
    rollback(function (Tx $q) {
        $f = cdFixtures($q);
        $e = cdError(fn() => cdPut(cdActorAs('sales'), $f['case'], ['opened_date' => '2026-09-18', 'reason' => 'คีย์ช้า']));
        eq($e['status'], 403, 'สถานะ');
        eq(cdState($q, $f), CD_UNCHANGED, 'วันที่');
    });
});

test('แอดมินแก้ได้ — เคสเปลี่ยนแค่วัน บิลทุกใบขยับเท่ากัน เวลาเดิมคงไว้', function () {
    rollback(function (Tx $q) {
        $f = cdFixtures($q);
        $r = cdPut(cdActorAs('admin'), $f['case'], ['opened_date' => '2026-09-23', 'reason' => 'คีย์เคสย้อนหลัง']);
        eq($r['days'], 3, 'จำนวนวันที่ขยับ');
        eq(cdState($q, $f), ['2026-09-23 10:15:00', '2026-09-23 10:30:45', '2026-09-28 16:00:00'], 'วันที่');
    });
});

test('ถอยวันได้ — บิลถอยตาม', function () {
    rollback(function (Tx $q) {
        $f = cdFixtures($q);
        cdPut(cdActorAs('admin'), $f['case'], ['opened_date' => '2026-09-18', 'reason' => 'ลูกค้ามาจริงวันที่ 18']);
        eq(cdState($q, $f), ['2026-09-18 10:15:00', '2026-09-18 10:30:45', '2026-09-23 16:00:00'], 'วันที่');
    });
});

test('บิลจะเปิดหลังวันปิดบิล → 400 และไม่มีอะไรเปลี่ยน · วันปิดบิลไม่แตะ', function () {
    rollback(function (Tx $q) {
        $f = cdFixtures($q, '2026-09-22 12:00:00');
        $e = cdError(fn() => cdPut(cdActorAs('admin'), $f['case'], ['opened_date' => '2026-09-23', 'reason' => 'x']));
        eq($e['status'], 400, 'สถานะ');
        eq(cdState($q, $f), CD_UNCHANGED, 'วันที่');
        eq((string) $q->get('SELECT order_close_date FROM custom_orders WHERE id = ?', $f['o1'])['order_close_date'], '2026-09-22 12:00:00', 'วันปิดบิล');
    });
});

test('บิลจะเลยวันนี้ → 400', function () {
    rollback(function (Tx $q) {
        $f = cdFixtures($q);
        $q->run('UPDATE custom_orders SET order_date = ? WHERE id = ?', date('Y-m-d') . ' 09:00:00', $f['o2']);
        $e = cdError(fn() => cdPut(cdActorAs('admin'), $f['case'], ['opened_date' => '2026-09-21', 'reason' => 'x']));
        eq($e['status'], 400, 'สถานะ');
        eq((string) $q->get('SELECT opened_at FROM cases WHERE id = ?', $f['case'])['opened_at'], '2026-09-20 10:15:00', 'วันเปิดเคส');
    });
});

test('ไม่มีเหตุผล · วันอนาคต · วันผิดรูป · วันเดิม → 400', function () {
    rollback(function (Tx $q) {
        $f = cdFixtures($q);
        $a = cdActorAs('admin');
        eq(cdError(fn() => cdPut($a, $f['case'], ['opened_date' => '2026-09-18', 'reason' => ' ']))['status'], 400, 'ไม่มีเหตุผล');
        eq(cdError(fn() => cdPut($a, $f['case'], ['opened_date' => date('Y-m-d', strtotime('+2 day')), 'reason' => 'x']))['status'], 400, 'อนาคต');
        eq(cdError(fn() => cdPut($a, $f['case'], ['opened_date' => '2026-02-30', 'reason' => 'x']))['status'], 400, 'ผิดรูป');
        eq(cdError(fn() => cdPut($a, $f['case'], ['opened_date' => '2026-09-20', 'reason' => 'x']))['reason'], 'same_date', 'วันเดิม');
        eq(cdState($q, $f), CD_UNCHANGED, 'วันที่');
    });
});

test('ลงไทม์ไลน์ — เคสหนึ่งแถว บิลใบละแถว', function () {
    rollback(function (Tx $q) {
        $f = cdFixtures($q);
        cdPut(cdActorAs('admin'), $f['case'], ['opened_date' => '2026-09-22', 'reason' => 'คีย์ย้อนหลัง']);
        $ev = $q->all('SELECT action, entity_id, note FROM case_events WHERE case_id = ? ORDER BY id', $f['case']);
        eq(array_column($ev, 'action'), ['order_date_changed', 'order_date_changed', 'case_opened_date_changed'], 'เหตุการณ์');
        eq((int) $ev[0]['entity_id'], $f['o1'], 'บิลใบแรก');
        ok(str_contains((string) $ev[2]['note'], '2026-09-20 → 2026-09-22'), 'โน้ตบอกจากวันไหนเป็นวันไหน');
        ok(str_contains((string) $ev[2]['note'], 'คีย์ย้อนหลัง'), 'โน้ตมีเหตุผล');
    });
});
