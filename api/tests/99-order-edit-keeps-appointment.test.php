<?php

declare(strict_types=1);

/**
 * บันทึกแก้ไขออเดอร์ต้องไม่ล้างวันนัดรับ (ร้านเจอ 31 ต.ค. 2026 — หาย 55 ใบบนระบบจริง)
 *
 * ฟอร์มขั้นขายไม่มีช่องวันนัดรับ เพราะกรอกที่ขั้นชำระเงิน · PUT เขียนทับทุกคอลัมน์
 * ช่องที่ไม่ได้ส่งมาจึงเคยกลายเป็น NULL
 *
 * ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

group('แก้ออเดอร์ไม่ล้างวันนัดรับ');

function oeaFixtures(Tx $q): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "นัดรับ-$tag")['insertId'];
    $case = (int) $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        "TEST-APPT-$tag", $cust, 'payment', 'new_glasses'
    )['insertId'];
    $order = (int) $q->run(
        "INSERT INTO custom_orders (customer_id, case_id, order_date, appointment_date, appointment_time, total_price)
         VALUES (?, ?, '2026-10-20 10:00:00', '2026-11-02', '14:00', 1500)",
        $cust, $case
    )['insertId'];
    return compact('cust', 'case', 'order');
}

function oeaAppt(Tx $q, int $id): array
{
    $o = $q->get('SELECT appointment_date, appointment_time FROM custom_orders WHERE id = ?', $id);
    return [substr((string) $o['appointment_date'], 0, 10), substr((string) $o['appointment_time'], 0, 5)];
}

test('ฟอร์มไม่ส่งวันนัดมา — วันนัดรับและเวลาเดิมยังอยู่', function () {
    rollback(function (Tx $q) {
        $f = oeaFixtures($q);
        Router::dispatch('PUT', "/api/orders/{$f['order']}", [], [
            'customer_id' => $f['cust'], 'case_id' => $f['case'], 'notes' => 'แก้หมายเหตุ',
        ]);
        eq(oeaAppt($q, $f['order']), ['2026-11-02', '14:00'], 'วันนัดรับ');
        eq($q->get('SELECT notes FROM custom_orders WHERE id = ?', $f['order'])['notes'], 'แก้หมายเหตุ', 'ช่องอื่นยังแก้ได้');
    });
});

test('ส่งวันนัดมาตรง ๆ ยังเขียนทับได้', function () {
    rollback(function (Tx $q) {
        $f = oeaFixtures($q);
        Router::dispatch('PUT', "/api/orders/{$f['order']}", [], [
            'customer_id' => $f['cust'], 'case_id' => $f['case'], 'appointment_date' => '2026-11-09',
        ]);
        eq(oeaAppt($q, $f['order'])[0], '2026-11-09', 'วันนัดรับ');
    });
});
