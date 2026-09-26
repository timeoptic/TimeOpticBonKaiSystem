<?php

declare(strict_types=1);

/**
 * ใบเบิกเลนส์ของ Bewell — กติกาสถานะ การหาค่าสายตาสุดท้าย และ sync จากหน้าขาย
 * ทุกข้อที่แตะฐานรันใน transaction ที่ roll back เสมอ
 */

group('ใบเบิกเลนส์ — กติกาสถานะ');

test('เดินหน้าทีละขั้นได้', function () {
    eq(LensRequisition::transitionError('pending', 'issued', true), null, 'รอเบิก → เบิกแล้ว');
    eq(LensRequisition::transitionError('received', 'assembled', true), null, 'ได้รับ → ประกอบ');
});

test('ข้ามขั้นได้', function () {
    eq(LensRequisition::transitionError('pending', 'ordered', true), null, 'รอเบิก → สั่งเลนส์');
});

test('ย้อนสถานะไม่ได้', function () {
    ok(LensRequisition::transitionError('ordered', 'issued', true) !== null, 'สั่งเลนส์ → เบิกแล้ว ต้องไม่ได้');
});

test('ยกเลิกได้จนกว่าจะประกอบแล้ว', function () {
    eq(LensRequisition::transitionError('received', 'cancelled', false), null, 'ได้รับ → ยกเลิก');
    ok(LensRequisition::transitionError('assembled', 'cancelled', true) !== null, 'ประกอบแล้วยกเลิกไม่ได้');
    ok(LensRequisition::transitionError('cancelled', 'issued', true) !== null, 'ยกเลิกแล้วไปต่อไม่ได้');
});

test('ไม่มีค่าสายตาสุดท้าย เบิกไม่ได้', function () {
    ok(LensRequisition::transitionError('pending', 'issued', false) !== null, 'ต้องห้ามเบิก');
});

test('รายการเลนส์: คำนวณยอดและบังคับยี่ห้อ', function () {
    $rows = LensRequisition::cleanItems([
        ['eye' => 'r', 'brand' => 'HOYA', 'design' => 'Nulux', 'quantity' => 1, 'unit_price' => 1500],
    ]);
    eq($rows[0]['eye'], 'R', 'ข้าง');
    eq($rows[0]['line_total'], 1500.0, 'ยอดบรรทัด');
    eq(array_keys($rows[0])[0], 'eye', 'คีย์แรกตรงกับลำดับคอลัมน์');
    $threw = false;
    try {
        LensRequisition::cleanItems([['eye' => 'L', 'brand' => '']]);
    } catch (HttpError $e) {
        $threw = $e->status === 400;
    }
    ok($threw, 'ไม่มียี่ห้อต้องตอบ 400');
});

group('ใบเบิกเลนส์ — sync จากหน้าขายและการเปลี่ยนสถานะ');

/** ลูกค้า + เคส + ออเดอร์ (+ ใบค่าสายตา final ถ้าขอ) */
function lrFixture(Tx $q, bool $withFinal = true): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "ใบเบิก-$tag")['insertId'];
    $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-LR-$tag", $cust)['insertId'];
    $rx   = null;
    if ($withFinal) {
        $rx = (int) $q->run(
            "INSERT INTO prescriptions (case_id, customer_id, kind, r_sphere, r_cylinder, r_axis, l_sphere, confirmed_at)
             VALUES (?, ?, 'final', '-1.25', '-0.50', '180', '-1.00', NOW())",
            $case,
            $cust
        )['insertId'];
    }
    $order = (int) $q->run(
        "INSERT INTO custom_orders (customer_id, case_id, order_date, frame_name, total_price, discount)
         VALUES (?, ?, NOW(), 'oldframe', 3000, 0)",
        $cust,
        $case
    )['insertId'];
    return ['customer' => $cust, 'case' => $case, 'rx' => $rx, 'order' => $order];
}

function lrItems(int $price = 1500): array
{
    $one = fn(string $eye) => [
        'eye' => $eye, 'source' => 'MOCK', 'mock_code' => 'MOCK-HOYA-TEST', 'brand' => 'HOYA',
        'lens_type' => 'Single Vision', 'design' => 'Nulux', 'lens_index' => '1.56',
        'coating' => 'VG', 'option_name' => 'Blue Control', 'quantity' => 1, 'unit_price' => $price,
    ];
    return [$one('R'), $one('L')];
}

function lrSync(int $order, array $items): array
{
    return Router::dispatch('POST', '/api/lens-requisitions/sync', [], ['order_id' => $order, 'items' => $items]);
}

function lrStatus(int $id, string $status, string $reason = ''): array
{
    return Router::dispatch('POST', "/api/lens-requisitions/$id/status", [], ['status' => $status, 'reason' => $reason]);
}

/** รหัสตอบของ HttpError ที่ $fn โยน · null = ไม่โยน */
function lrStatusCode(callable $fn): ?int
{
    try {
        $fn();
    } catch (HttpError $e) {
        return $e->status;
    }
    return null;
}

test('sync ครั้งแรกสร้างใบรอเบิก ผูกเคส ลูกค้า และคัดลอกค่าสายตาสุดท้าย', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $r = lrSync($f['order'], lrItems());
        eq($r['status'], 'pending', 'สถานะ');
        eq((int) $r['case_id'], $f['case'], 'เคส');
        eq((int) $r['customer_id'], $f['customer'], 'ลูกค้า');
        eq((int) $r['prescription_id'], $f['rx'], 'ใบค่าสายตา');
        eq($r['rx_snapshot']['r_sphere'], '-1.25', 'SPH ขวาในใบเบิก');
        eq(count($r['items']), 2, 'จำนวนรายการ');
        eq((float) $r['total'], 3000.0, 'ยอดรวม');
        ok(str_starts_with($r['req_no'], 'LR-'), 'เลขใบ ' . $r['req_no']);
    });
});

test('sync ซ้ำตอนยังรอเบิก แทนที่รายการในใบเดิม', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $a = lrSync($f['order'], lrItems(1500));
        $b = lrSync($f['order'], [lrItems(2000)[0]]);
        eq((int) $b['id'], (int) $a['id'], 'ใบเดิม');
        eq(count($b['items']), 1, 'รายการใหม่');
        eq((float) $b['total'], 2000.0, 'ยอดใหม่');
    });
});

test('เบิกไปแล้ว sync ซ้ำตอบ 409', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $a = lrSync($f['order'], lrItems());
        lrStatus((int) $a['id'], 'issued');
        eq(lrStatusCode(fn() => lrSync($f['order'], lrItems(9))), 409, 'รหัสตอบ');
    });
});

test('ยกเลิกใบเดิมแล้ว sync ได้ใบใหม่', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $a = lrSync($f['order'], lrItems());
        lrStatus((int) $a['id'], 'cancelled', 'ลูกค้าเปลี่ยนรุ่น');
        $b = lrSync($f['order'], lrItems(2500));
        ok((int) $b['id'] !== (int) $a['id'], 'ต้องเป็นใบใหม่');
    });
});

test('ไม่มีค่าสายตาสุดท้าย: ออกใบได้ แต่เบิกไม่ได้ จนกว่าจะยืนยันค่าสายตา', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q, false);
        $a = lrSync($f['order'], lrItems());
        eq($a['rx_snapshot'], null, 'ยังไม่มีค่าสายตา');
        eq(lrStatusCode(fn() => lrStatus((int) $a['id'], 'issued')), 409, 'เบิกตอนไม่มีค่าสายตา');
        $q->run(
            "INSERT INTO prescriptions (case_id, customer_id, kind, r_sphere, confirmed_at) VALUES (?, ?, 'final', '-2.00', NOW())",
            $f['case'],
            $f['customer']
        );
        $b = lrStatus((int) $a['id'], 'issued');
        eq($b['status'], 'issued', 'เบิกได้หลังยืนยันค่าสายตา');
        eq($b['rx_snapshot']['r_sphere'], '-2.00', 'ดึงค่าสายตาใหม่ตอนเบิก');
        ok($b['issued_at'] !== null, 'ประทับเวลาเบิก');
    });
});

test('เปลี่ยนสถานะเขียนไทม์ไลน์เคส และยกเลิกต้องมีเหตุผล', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $a = lrSync($f['order'], lrItems());
        lrStatus((int) $a['id'], 'ordered');
        $ev = $q->get(
            "SELECT note FROM case_events WHERE case_id = ? AND action = 'lens_requisition_status' ORDER BY id DESC LIMIT 1",
            $f['case']
        );
        ok($ev !== null && str_contains($ev['note'], 'กำลังตัด/ผลิต'), 'ไทม์ไลน์: ' . json_encode($ev, JSON_UNESCAPED_UNICODE));
        eq(lrStatusCode(fn() => lrStatus((int) $a['id'], 'cancelled')), 400, 'ยกเลิกไม่มีเหตุผล');
    });
});

test('รายการรวมค้นด้วยรหัสเคสเจอ และดูใบของเคสได้', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        lrSync($f['order'], lrItems());
        $code = $q->get('SELECT case_code FROM cases WHERE id = ?', $f['case'])['case_code'];
        $rows = Router::dispatch('GET', '/api/lens-requisitions', ['q' => $code]);
        eq(count($rows), 1, 'จำนวนที่เจอ');
        ok(str_contains((string) $rows[0]['summary'], 'Nulux'), 'สรุปรายการ ' . $rows[0]['summary']);
        eq(count(Router::dispatch('GET', '/api/cases/' . $f['case'] . '/lens-requisitions')), 1, 'ใบของเคส');
    });
});
