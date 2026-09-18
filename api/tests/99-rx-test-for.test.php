<?php

declare(strict_types=1);

/**
 * ยืนยันค่าสายตา Final ต้องเลือก "ใช้สำหรับ / Test For" ก่อน
 *
 * ร้านขอ 14 ก.ย. 2026 · ช่องนี้พิมพ์ลงใบสั่งตัดและใบค่าสายตา (TestFor ของระบบเดิม) — ห้องผลิต
 * ต้องรู้ว่าเลนส์คู่นี้สั่งไว้ใช้ทำอะไร · ตอนที่ขอ มีใบ Final ยืนยันไปแล้ว 8 จาก 21 ใบโดยไม่ได้เลือก
 *
 * ด่านอยู่ที่ POST /api/prescriptions/:id/confirm · ใบที่ยืนยันไปก่อนหน้านี้ไม่ย้อนบังคับ
 * ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

require_once __DIR__ . '/../routes/prescriptions.php';

group('ยืนยันค่าสายตาต้องมี Test For');

/** ลูกค้า + เคส + ใบค่าสายตาที่ยังไม่ยืนยัน */
function tfFixtures(Tx $q, ?string $testFor): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "TestFor-$tag")['insertId'];
    $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-TF-$tag", $cust)['insertId'];
    $rx   = (int) $q->run(
        "INSERT INTO prescriptions (case_id, customer_id, kind, test_date, test_for, r_sphere, l_sphere)
         VALUES (?, ?, 'final', NOW(), ?, '-1.00', '-1.25')",
        $case, $cust, $testFor
    )['insertId'];
    return ['case' => $case, 'rx' => $rx];
}

function tfConfirm(array $f): array
{
    return Router::dispatch('POST', "/api/prescriptions/{$f['rx']}/confirm", [], []);
}

/** @return array{status:?int,reason:?string,msg:string} */
function tfError(callable $fn): array
{
    try {
        $fn();
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null, 'msg' => $e->getMessage()];
    }
    return ['status' => null, 'reason' => null, 'msg' => ''];
}

test('ยังไม่เลือก Test For — ยืนยันไม่ได้ และใบยังไม่ถูกยืนยัน', function () {
    rollback(function (Tx $q) {
        $f   = tfFixtures($q, null);
        $err = tfError(fn() => tfConfirm($f));
        eq([$err['status'], $err['reason']], [400, 'test_for_required'], 'ด่าน');
        ok(str_contains($err['msg'], 'Test For'), 'ข้อความบอกว่าขาดอะไร — ได้ ' . $err['msg']);
        eq($q->get('SELECT confirmed_at FROM prescriptions WHERE id = ?', $f['rx'])['confirmed_at'], null, 'ยังไม่ยืนยัน');
    });
});

test('ช่องว่างล้วนนับว่ายังไม่ได้เลือก', function () {
    rollback(function (Tx $q) {
        $f = tfFixtures($q, '   ');
        eq(tfError(fn() => tfConfirm($f))['reason'], 'test_for_required', 'ช่องว่าง');
    });
});

test('เลือก Test For แล้ว — ยืนยันได้ ผูกเข้าออเดอร์ของเคสตามเดิม', function () {
    rollback(function (Tx $q) {
        $f     = tfFixtures($q, 'Progressive');
        $order = (int) $q->run(
            'INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount)
             SELECT customer_id, id, NOW(), 1000, 0 FROM cases WHERE id = ?',
            $f['case']
        )['insertId'];
        $row = tfConfirm($f);
        eq([$row['kind'], $row['test_for']], ['final', 'Progressive'], 'ใบที่ยืนยัน');
        ok($row['confirmed_at'] !== null, 'มีเวลายืนยัน');
        eq((int) $q->get('SELECT final_prescription_id FROM custom_orders WHERE id = ?', $order)['final_prescription_id'], $f['rx'], 'ออเดอร์ชี้ใบนี้');
    });
});
