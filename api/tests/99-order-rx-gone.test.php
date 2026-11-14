<?php

declare(strict_types=1);

/**
 * ออเดอร์ที่ผูกใบสั่งตัด RX ซึ่งถูกลบ/ยกเลิกที่หน้าคลังไปแล้ว
 *
 * เหตุการณ์จริง 13 ต.ค. 2026: CASE-2026-00001 ข้างซ้ายยังจำ RX-2026-0044 (ใบ #6517) ที่ถูกลบไป
 * ตั้งแต่ ก.ย. หน้าออเดอร์ขึ้นการ์ด "สั่งตัดแล้ว" ซึ่งซ่อนปุ่มสั่งตัด — เปิดสองข้างได้ใบจริงข้างเดียว
 * rxLensState() ต้องบอกว่าใบนั้น "ไม่มีแล้ว" เพื่อให้ orderDetail ตัดลิงก์ทิ้ง
 */

group('ออเดอร์ — ใบสั่งตัด RX ที่ไม่มีแล้วในคลัง');

/** ใบสั่งตัดหนึ่งใบ · คืน log id */
function rxGoneOrder(Tx $q, array $rx = []): int
{
    $pid = $q->run(
        'INSERT INTO products (sku, category_id, product_type, name, base_selling_price, is_custom_made)
         VALUES (?,?,?,?,?,?)',
        'TRXG-' . mt_rand(1000, 9999), 31, 'Lens', 'RX gone test', '0.00', 1
    )['insertId'];
    $log = $q->run(
        "INSERT INTO inventory_logs (product_id, action_type, quantity, reference_doc, created_by_kind, created_at)
         VALUES (?, 'RX_ORDER', -1, 'RX-TEST-0001', 'user', NOW())",
        $pid
    )['insertId'];
    $q->run(
        'INSERT INTO rx_orders (log_id, eye_side, cancelled_at, scrapped_at) VALUES (?,?,?,?)',
        $log, 'left', $rx['cancelled_at'] ?? null, $rx['scrapped_at'] ?? null
    );
    return $log;
}

test('ใบที่ถูกลบไปแล้ว — gone', function () {
    $max = (int) (Db::get('SELECT MAX(id) id FROM inventory_logs')['id'] ?? 0);
    eq(rxLensState($max + 100000)['gone'], true, 'ใบที่ไม่มีในคลัง');
});

test('ใบที่ยังอยู่ — ไม่ gone', function () {
    rollback(function (Tx $q) {
        eq(rxLensState(rxGoneOrder($q))['gone'], false, 'ใบปกติ');
    });
});

test('ใบที่ถูกยกเลิก — gone', function () {
    rollback(function (Tx $q) {
        $log = rxGoneOrder($q, ['cancelled_at' => '2026-10-01 10:00:00']);
        eq(rxLensState($log)['gone'], true, 'ใบยกเลิก');
    });
});

test('ใบเจียร์เสีย (cancelled + scrapped) — ยังเป็นใบของข้างนี้ ไม่ gone', function () {
    rollback(function (Tx $q) {
        $log = rxGoneOrder($q, ['cancelled_at' => '2026-10-01 10:00:00', 'scrapped_at' => '2026-10-01 10:00:00']);
        $s = rxLensState($log);
        eq($s['gone'], false, 'ใบเจียร์เสีย');
        eq($s['scrapped_at'], '2026-10-01 10:00:00', 'ยังรายงานว่าเสีย');
    });
});
