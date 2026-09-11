<?php

declare(strict_types=1);

/**
 * กันบันทึกรับเงินผิด — เกินยอดคงเหลือ และกดซ้ำ
 *
 * เหตุการณ์จริง 11 ก.ย. 2026: ออเดอร์ 10459 ถูกบันทึก ฿2,900 สามครั้งห่างกัน 4 และ
 * 2 วินาที เพราะปุ่มไม่ล็อกระหว่างบันทึก ช่องจำนวนเงินไม่ล้าง และคำเตือนเกินยอดหายไป
 * ทันทีที่ยอดครบ · หน้าเว็บแก้แล้วก็จริง แต่ด่านจริงต้องอยู่ที่เซิร์ฟเวอร์ — แท็บที่สอง
 * หรือเครื่องที่สองไม่รู้เรื่องที่หน้าเว็บอีกแท็บกันไว้
 *
 * กติกาที่ร้านตัดสิน:
 *   1. รับเกินยอดคงเหลือไม่ได้เลย (ไม่มีปุ่มยืนยันให้ข้าม)
 *   2. ออเดอร์ที่ยังไม่ใส่ราคา (ยอด 0) ยังไม่มียอดให้เทียบ — รับมัดจำได้
 *   3. ยอดเท่ากัน ออเดอร์เดียวกัน ภายใน 10 นาที = อาจซ้ำ ต้องยืนยันก่อน
 *
 * ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

group('กันบันทึกรับเงินผิด');

/** ลูกค้า + พนักงาน + เคส + ออเดอร์ราคาที่กำหนด */
function payFixtures(Tx $q, float $price = 1000): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "รับเงิน-$tag")['insertId'];
    $emp  = (int) $q->run('INSERT INTO employees (employee_name, active) VALUES (?, 1)', "พนักงานรับเงิน-$tag")['insertId'];
    $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-PAY-$tag", $cust)['insertId'];
    $order = (int) $q->run(
        'INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount) VALUES (?, ?, NOW(), ?, 0)',
        $cust, $case, $price
    )['insertId'];
    return ['case' => $case, 'order' => $order, 'emp' => $emp];
}

/** ยิงเส้นทางจริงที่ปุ่ม "บันทึกการรับเงิน" เรียก */
function payPost(array $f, float $amount, array $extra = []): array
{
    return Router::dispatch('POST', '/api/payments', [], $extra + [
        'case_id'     => $f['case'],
        'order_id'    => $f['order'],
        'kind'        => 'deposit',
        'method'      => 'Cash',
        'amount'      => $amount,
        'received_by' => $f['emp'],
    ]);
}

/** @return array{status:?int,reason:?string,payload:array} */
function payError(array $f, float $amount, array $extra = []): array
{
    try {
        payPost($f, $amount, $extra);
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null, 'payload' => $e->payload];
    }
    return ['status' => null, 'reason' => null, 'payload' => []];
}

function payCount(Tx $q, array $f): int
{
    return (int) $q->get('SELECT COUNT(*) n FROM payments WHERE case_id = ? AND cancelled_at IS NULL', $f['case'])['n'];
}

/** แถวเงินที่ใส่ตรงลงตาราง — ใช้จำลองของที่ถูกยกเลิกแล้ว หรือบันทึกไว้นานแล้ว */
function payRaw(Tx $q, array $f, float $amount, string $createdSql = 'NOW()', bool $cancelled = false): void
{
    $q->run(
        "INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, paid_at, created_at, cancelled_at)
         VALUES (?, ?, 'deposit', 'Cash', ?, ?, NOW(), $createdSql, " . ($cancelled ? 'NOW()' : 'NULL') . ')',
        $f['case'], $f['order'], $amount, $f['emp']
    );
}

test('รับเงินไม่เกินยอดคงเหลือ บันทึกได้', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        $row = payPost($f, 400);
        eq((float) $row['amount'], 400.0, 'ยอดที่บันทึก');
        eq(payCount($q, $f), 1, 'จำนวนรายการ');
    });
});

test('รับเกินยอดคงเหลือไม่ได้ — ตอบ over_balance และไม่มีแถวใหม่', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        $e = payError($f, 1200);
        eq($e['status'], 400, 'สถานะ');
        eq($e['reason'], 'over_balance', 'รหัสเหตุผล');
        eq((float) ($e['payload']['balance'] ?? -1), 1000.0, 'ยอดคงเหลือที่บอกกลับ');
        eq(payCount($q, $f), 0, 'ต้องไม่มีรายการ');
    });
});

test('รับเกินยอดไม่ได้แม้ส่ง confirm_duplicate มา — ไม่มีทางข้ามกติกานี้', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        eq(payError($f, 1500, ['confirm_duplicate' => true])['reason'], 'over_balance', 'รหัสเหตุผล');
    });
});

test('ชำระครบแล้ว รับเพิ่มแม้ 1 บาทก็ไม่ได้', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        payPost($f, 1000);
        $e = payError($f, 1);
        eq($e['reason'], 'over_balance', 'รหัสเหตุผล');
        eq((float) $e['payload']['balance'], 0.0, 'คงเหลือศูนย์');
    });
});

test('ยอดคงเหลือนับจากเงินที่ยังไม่ถูกยกเลิกเท่านั้น', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        payRaw($q, $f, 1000, 'NOW() - INTERVAL 1 HOUR', true);
        payPost($f, 1000);
        eq(payCount($q, $f), 1, 'รับเต็มได้หลังรายการเดิมถูกยกเลิก');
    });
});

test('ออเดอร์ที่ยังไม่ใส่ราคา (ยอด 0) รับมัดจำได้', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 0);
        payPost($f, 500);
        eq(payCount($q, $f), 1, 'จำนวนรายการ');
    });
});

test('ยอดเท่ากัน ออเดอร์เดียวกัน ภายใน 10 นาที ต้องถามก่อน — possible_duplicate', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        payPost($f, 300);
        $e = payError($f, 300);
        eq($e['status'], 409, 'สถานะ');
        eq($e['reason'], 'possible_duplicate', 'รหัสเหตุผล');
        eq((float) ($e['payload']['duplicate']['amount'] ?? -1), 300.0, 'ยอดของรายการที่เพิ่งบันทึก');
        ok(is_int($e['payload']['duplicate']['seconds_ago'] ?? null), 'ต้องบอกว่าบันทึกไปกี่วินาทีแล้ว');
        eq(payCount($q, $f), 1, 'ต้องยังมีรายการเดียว');
    });
});

test('ยืนยันแล้วว่าไม่ซ้ำ บันทึกได้', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        payPost($f, 300);
        payPost($f, 300, ['confirm_duplicate' => true]);
        eq(payCount($q, $f), 2, 'จำนวนรายการ');
    });
});

test('ยอดต่างกันไม่นับว่าซ้ำ', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        payPost($f, 300);
        payPost($f, 200);
        eq(payCount($q, $f), 2, 'จำนวนรายการ');
    });
});

test('รายการที่ถูกยกเลิกแล้วไม่นับว่าซ้ำ', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        payRaw($q, $f, 300, 'NOW()', true);
        payPost($f, 300);
        eq(payCount($q, $f), 1, 'จำนวนรายการ');
    });
});

test('รายการที่บันทึกไว้นานกว่า 10 นาทีไม่นับว่าซ้ำ', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        payRaw($q, $f, 300, 'NOW() - INTERVAL 11 MINUTE');
        payPost($f, 300);
        eq(payCount($q, $f), 2, 'จำนวนรายการ');
    });
});

test('รับเงินที่ไม่มีออเดอร์ ไม่มียอดให้เทียบ แต่ยังกันซ้ำด้วยเคส', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        $noOrder = ['order_id' => null];
        payPost($f, 5000, $noOrder);
        eq(payError($f, 5000, $noOrder)['reason'], 'possible_duplicate', 'รหัสเหตุผล');
    });
});
