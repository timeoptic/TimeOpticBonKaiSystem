<?php

declare(strict_types=1);

/**
 * ส่งมอบแล้วออเดอร์ต้องปิดการขายเอง — ไม่ค้างบนหน้าแรก
 *
 * 26 ก.ย. 2026 เคส CASE-2026-00001: ทำครบทั้ง 6 ขั้น เคสขึ้น "ปิดเคสแล้ว" แต่ออเดอร์
 * ยังโชว์ในกล่อง "ออเดอร์ว่าง" บนหน้าแรก สองสาเหตุ:
 *   1. ยืนยันขั้นส่งมอบปิดแต่เคส ไม่ได้ปิดออเดอร์ (order_closed ค้าง 0)
 *   2. "ออเดอร์ว่าง" นับจาก *_product_id ของระบบเก่า ซึ่งขั้นตอน 6 ขั้นไม่ได้เขียน
 *      และกรอบเดิมของลูกค้าไม่มีรหัสสินค้าเลย
 *
 * ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

require_once __DIR__ . '/../routes/dashboard.php';

group('ปิดการขายตอนส่งมอบ');

/** ลูกค้า + เคส + ออเดอร์แบบที่ขั้นตอน 6 ขั้นสร้าง: กรอบเดิม เลนส์เป็นชื่อ/SKU ไม่มี product id */
function ocFixtures(Tx $q, float $price = 2100): array
{
    $tag   = bin2hex(random_bytes(3));
    $cust  = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "ปิดออเดอร์-$tag")['insertId'];
    $emp   = (int) $q->run('INSERT INTO employees (employee_name, active) VALUES (?, 1)', "ผู้ส่งมอบ-$tag")['insertId'];
    $case  = (int) $q->run(
        "INSERT INTO cases (case_code, customer_id, status) VALUES (?, ?, 'waiting_pickup')",
        "TEST-OC-$tag", $cust
    )['insertId'];
    $order = (int) $q->run(
        "INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount, deposit,
            appointment_date, frame_name, lens_l_name, lens_l_sku)
         VALUES (?, ?, NOW(), ?, 0, 0, ?, 'oldframe', 'Hoya Hivision Single', 'RX-0001')",
        $cust, $case, $price, date('Y-m-d', strtotime('+3 days'))
    )['insertId'];
    $q->run(
        'INSERT INTO case_deliveries (case_id, delivered_at) VALUES (?, NOW())',
        $case
    );
    /* หลักฐานก่อนส่งมอบ (กติกาจากระบบหลัก 10 พ.ย. 2026) — เทสต์นี้ดูเรื่องปิดออเดอร์ ไม่ใช่เรื่องหลักฐาน */
    foreach (['exam', 'centering'] as $k) {
        $q->run("INSERT INTO case_photos (case_id, kind, file_name) VALUES (?, ?, 'x.jpg')", $case, $k);
    }
    $q->run('INSERT INTO centerings (case_id, r_pd, l_pd, pd_total) VALUES (?, 31, 31, 62)', $case);
    return ['case' => $case, 'order' => $order, 'emp' => $emp];
}

function ocPay(Tx $q, array $f, float $amount): void
{
    $q->run(
        "INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, paid_at)
         VALUES (?, ?, 'full', 'Cash', ?, ?, NOW())",
        $f['case'], $f['order'], $amount, $f['emp']
    );
}

function ocDeliver(array $f): void
{
    Router::dispatch('POST', "/api/cases/{$f['case']}/processes/delivery/complete", [], []);
}

function ocOrder(array $f): array
{
    return Db::get('SELECT order_closed, order_close_income FROM custom_orders WHERE id = ?', $f['order']);
}

/** @return array{unfilled:list<int>,unclosed:list<int>} id ออเดอร์ในสองกล่องบนหน้าแรก */
function ocDashboard(): array
{
    $d = Router::dispatch('GET', '/api/dashboard', [], []);
    return [
        'unfilled' => array_map(fn($r) => (int) $r['id'], $d['unfilled']),
        'unclosed' => array_map(fn($r) => (int) $r['id'], $d['unclosed']),
    ];
}

test('จ่ายครบแล้วยืนยันส่งมอบ — ออเดอร์ปิดเอง ไม่รับเงินซ้ำ และหายจากหน้าแรก', function () {
    rollback(function (Tx $q) {
        $f = ocFixtures($q);
        ocPay($q, $f, 2100);
        ocDeliver($f);

        eq(Db::get('SELECT status FROM cases WHERE id = ?', $f['case'])['status'], 'completed', 'สถานะเคส');
        $o = ocOrder($f);
        eq([(int) $o['order_closed'], (float) $o['order_close_income']], [1, 0.0], 'ออเดอร์ปิด / รับเพิ่มตอนปิด');
        eq((float) Db::get('SELECT SUM(amount) s FROM payments WHERE order_id = ?', $f['order'])['s'], 2100.0, 'เงินรับรวม ไม่มีรายการเพิ่ม');
        $d = ocDashboard();
        ok(!in_array($f['order'], $d['unfilled'], true), 'ยังอยู่ในกล่องออเดอร์ว่าง');
        ok(!in_array($f['order'], $d['unclosed'], true), 'ยังอยู่ในกล่องยังไม่ปิดการขาย');
    });
});

test('ยังค้างเงินตอนส่งมอบ — ออเดอร์ยังไม่ปิด จ่ายส่วนที่เหลือแล้วปิดเอง', function () {
    rollback(function (Tx $q) {
        $f = ocFixtures($q);
        ocPay($q, $f, 2000);
        ocDeliver($f);
        eq((int) ocOrder($f)['order_closed'], 0, 'ค้าง 100 บาท ออเดอร์ต้องยังเปิด');
        ok(in_array($f['order'], ocDashboard()['unclosed'], true), 'ต้องอยู่ในกล่องยังไม่ปิดการขายให้คนตามเงิน');

        Router::dispatch('POST', '/api/payments', [], [
            'case_id' => $f['case'], 'order_id' => $f['order'], 'kind' => 'full',
            'method' => 'Cash', 'amount' => 100, 'received_by' => $f['emp'],
        ]);
        eq((int) ocOrder($f)['order_closed'], 1, 'จ่ายครบแล้วออเดอร์ปิด');
    });
});

test('เปิดขั้นส่งมอบกลับมาแก้ — ออเดอร์เปิดกลับ เคสกลับไปรอรับ', function () {
    rollback(function (Tx $q) {
        $f = ocFixtures($q);
        ocPay($q, $f, 2100);
        ocDeliver($f);
        Router::dispatch('POST', "/api/cases/{$f['case']}/processes/delivery/reopen", [], []);

        eq((int) ocOrder($f)['order_closed'], 0, 'ออเดอร์เปิดกลับ');
        eq(Db::get('SELECT status FROM cases WHERE id = ?', $f['case'])['status'], 'waiting_pickup', 'สถานะเคส');
    });
});

test('ออเดอร์ของขั้นตอน 6 ขั้น (กรอบเดิม + เลนส์เป็นชื่อ) ไม่นับเป็นออเดอร์ว่าง', function () {
    rollback(function (Tx $q) {
        $f = ocFixtures($q);
        ok(!in_array($f['order'], ocDashboard()['unfilled'], true), 'ถูกนับเป็นออเดอร์ว่าง');
        $q->run("UPDATE custom_orders SET lens_l_name = NULL, lens_l_sku = NULL WHERE id = ?", $f['order']);
        ok(in_array($f['order'], ocDashboard()['unfilled'], true), 'ไม่มีเลนส์เลยต้องเป็นออเดอร์ว่าง');
    });
});
