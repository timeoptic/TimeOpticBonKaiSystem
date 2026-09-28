<?php

declare(strict_types=1);

/**
 * กดปุ่ม "เปิดออเดอร์" ซ้ำ — คำขอที่สองต้องได้ใบเดิม ไม่ใช่ใบใหม่
 *
 * เคสจริง CASE-2026-00140 / 00159 (28 ก.ย. 2026): กดสองทีห่างกัน 1 วินาที ได้สองใบ
 * ใบแรกไม่มีเงิน รายงานจึงขึ้นยอดค้างเต็มจำนวนทั้งที่ลูกค้าจ่ายครบแล้ว
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('กันออเดอร์ซ้ำจากการกดซ้ำ');

function doubleSubmitCustomer(Tx $q): int
{
    return $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'กดซ้ำ',
        '0000000000'
    )['insertId'];
}

function doubleSubmitOrder(int $cid, string $price, array $extra = []): array
{
    return Router::dispatch('POST', '/api/orders', [], [
        'customer_id' => $cid,
        'frame_name'  => 'กรอบทดสอบ',
        'frame_price' => $price,
    ] + $extra);
}

function ordersOf(Tx $q, int $cid): int
{
    return (int) $q->get('SELECT COUNT(*) n FROM custom_orders WHERE customer_id = ?', $cid)['n'];
}

test('ส่งออเดอร์เดิมซ้ำทันที ได้ใบเดิมกลับมา', function () {
    rollback(function (Tx $q) {
        $cid = doubleSubmitCustomer($q);
        $a   = doubleSubmitOrder($cid, '999');
        $b   = doubleSubmitOrder($cid, '999');
        eq((int) $b['id'], (int) $a['id'], 'คำขอที่สองคืนใบเดิม');
        eq(ordersOf($q, $cid), 1, 'ในฐานมีใบเดียว');
    });
});

test('มัดจำไม่ถูกบันทึกซ้ำเมื่อกดซ้ำ', function () {
    rollback(function (Tx $q) {
        $cid = doubleSubmitCustomer($q);
        $a   = doubleSubmitOrder($cid, '999', ['deposit' => '999']);
        doubleSubmitOrder($cid, '999', ['deposit' => '999']);
        $paid = $q->get('SELECT COUNT(*) n, SUM(amount) s FROM payments WHERE order_id = ?', (int) $a['id']);
        eq((int) $paid['n'], 1, 'มัดจำหนึ่งรายการ');
        eq((float) $paid['s'], 999.0, 'ยอดมัดจำ');
    });
});

test('ราคาต่างกันถือเป็นออเดอร์ใหม่', function () {
    rollback(function (Tx $q) {
        $cid = doubleSubmitCustomer($q);
        $a   = doubleSubmitOrder($cid, '999');
        $b   = doubleSubmitOrder($cid, '1500');
        ok((int) $b['id'] !== (int) $a['id'], 'ได้ใบใหม่');
        eq(ordersOf($q, $cid), 2, 'ในฐานมีสองใบ');
    });
});

test('ใบเดิมเก่ากว่า 30 วินาทีแล้ว เปิดใบใหม่ได้ตามปกติ', function () {
    rollback(function (Tx $q) {
        $cid = doubleSubmitCustomer($q);
        $a   = doubleSubmitOrder($cid, '999');
        $q->run('UPDATE custom_orders SET created_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', (int) $a['id']);
        $b = doubleSubmitOrder($cid, '999');
        ok((int) $b['id'] !== (int) $a['id'], 'ได้ใบใหม่');
    });
});
