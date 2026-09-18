<?php

declare(strict_types=1);

/**
 * ค้นหาในหน้าออเดอร์ตัดแว่น (/orders) — ช่องค้นหาพิมพ์เลขเคสได้
 *
 * ตารางออเดอร์โชว์เลขเคสแทน Invoice แล้ว (ร้านขอ 15 ก.ย. 2026) คนหน้าร้านจำงานด้วยเลขเคส
 * พิมพ์เลขที่เห็นในตารางแล้วต้องเจอออเดอร์นั้น · INV เดิมยังค้นได้ เผื่อเลขเก่าที่จดไว้
 *
 * ยิง GET /api/orders ตัวจริงเหมือนหน้าเว็บ · ของทดสอบอยู่ใน transaction ที่ roll back เสมอ
 */

group('ค้นหาออเดอร์ด้วยเลขเคส');

/** @return array{order:int, case_code:string, invoice_code:string} */
function orderInCase(Tx $q): array
{
    $cust = (int) $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'ค้นเลขเคส',
        '0000000000'
    )['insertId'];
    $code = 'TEST-ORDQ-' . bin2hex(random_bytes(4));
    $case = (int) $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        $code,
        $cust,
        'reception',
        'new_glasses'
    )['insertId'];
    $inv = 'TESTINV-' . bin2hex(random_bytes(4));
    $order = (int) $q->run(
        'INSERT INTO custom_orders (invoice_code, case_id, customer_id, frame_name, total_price, order_closed)
         VALUES (?,?,?,?,?,0)',
        $inv,
        $case,
        $cust,
        'กรอบทดสอบ',
        1500
    )['insertId'];
    return ['order' => $order, 'case_code' => $code, 'invoice_code' => $inv];
}

/** id ของออเดอร์ที่ /api/orders คืนมาเมื่อค้นด้วยคำนี้ */
function orderSearchIds(string $term): array
{
    $rows = Router::dispatch('GET', '/api/orders', ['q' => $term, 'status' => 'all', 'limit' => 50]);
    return array_map(static fn($r) => (int) $r['id'], $rows);
}

test('พิมพ์เลขเคสแล้วเจอออเดอร์ของเคสนั้น', function () {
    rollback(function (Tx $q) {
        $o = orderInCase($q);
        eq(orderSearchIds($o['case_code']), [$o['order']], 'ผลค้นด้วยเลขเคสเต็ม');
    });
});

test('พิมพ์เลขเคสบางส่วนก็เจอ', function () {
    rollback(function (Tx $q) {
        $o = orderInCase($q);
        ok(in_array($o['order'], orderSearchIds(substr($o['case_code'], -6)), true), 'ผลค้นด้วยท้ายเลขเคส 6 ตัว');
    });
});

test('ออเดอร์ในผลค้นมี case_code ให้ตารางโชว์', function () {
    rollback(function (Tx $q) {
        $o = orderInCase($q);
        $rows = Router::dispatch('GET', '/api/orders', ['q' => $o['case_code'], 'limit' => 50]);
        eq($rows[0]['case_code'] ?? null, $o['case_code'], 'case_code ของแถว');
    });
});

test('เลข INV เดิมยังค้นได้', function () {
    rollback(function (Tx $q) {
        $o = orderInCase($q);
        eq(orderSearchIds($o['invoice_code']), [$o['order']], 'ผลค้นด้วย INV');
    });
});
