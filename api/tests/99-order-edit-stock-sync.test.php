<?php

declare(strict_types=1);

/**
 * บันทึกแก้ไขออเดอร์หลังยืนยันรายการขายแล้ว — สต็อกต้องตามออเดอร์ทันที
 *
 * ร้านเจอ 3 ต.ค. 2026: ยืนยันขายไปแล้ว กลับมาเปลี่ยนเลนส์ กด "บันทึกการแก้ไข" ของเก่าไม่คืน
 * ของใหม่ไม่ตัด ต้องกดแก้ไขขั้นขายแล้วยืนยันอีกรอบสต็อกถึงขยับ · PUT /api/orders/:id
 * เขียนแค่ออเดอร์ ไม่เคยเรียก CaseStock
 *
 * ทดสอบในโหมด dry — ไม่ยิงคลังจริง แค่ดูว่าตอนบันทึกระบบไปเรียกตัดสต็อกหรือไม่
 */

group('บันทึกแก้ไขออเดอร์ = ปรับสต็อกตามเมื่อยืนยันขายแล้ว');

function stockSyncCase(Tx $q, bool $salesConfirmed): int
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "SYNC-$tag")['insertId'];
    $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-SYNC-$tag", $cust)['insertId'];
    $order = (int) $q->run(
        'INSERT INTO custom_orders (customer_id, case_id, order_date, frame_name, total_price) VALUES (?,?,NOW(),?,?)',
        $cust,
        $case,
        'กรอบทดสอบ',
        1000
    )['insertId'];
    if ($salesConfirmed) {
        $q->run(
            "INSERT INTO case_processes (case_id, process, status, completed_at) VALUES (?, 'sales', 'completed', NOW())",
            $case
        );
    }
    return $order;
}

function withDryStock(callable $fn): void
{
    StockClient::configure(['mode' => 'dry']);
    try {
        $fn();
    } finally {
        StockClient::configure(['mode' => 'live']); // ค่าเดียวกับ run.php
    }
}

test('ยืนยันขายแล้ว กดบันทึกแก้ไข → เรียกปรับสต็อก', function () {
    withDryStock(fn() => rollback(function (Tx $q) {
        $order = stockSyncCase($q, true);
        $res = syncSoldStock($order, null);
        ok(is_array($res), 'ต้องเรียก CaseStock::issueForCase');
        eq($res['mode'] ?? null, 'dry', 'โหมด');
    }));
});

test('ยังไม่ยืนยันขาย กดบันทึกแก้ไข → ไม่แตะสต็อก (ตัดตอนยืนยัน)', function () {
    withDryStock(fn() => rollback(function (Tx $q) {
        $order = stockSyncCase($q, false);
        eq(syncSoldStock($order, null), null, 'ไม่ควรเรียกตัดสต็อก');
    }));
});

test('ออเดอร์ไม่ผูกเคส → ไม่แตะสต็อก', function () {
    withDryStock(fn() => rollback(function (Tx $q) {
        $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', 'SYNC-nocase')['insertId'];
        $order = (int) $q->run('INSERT INTO custom_orders (customer_id, order_date, frame_name) VALUES (?,NOW(),?)', $cust, 'x')['insertId'];
        eq(syncSoldStock($order, null), null, 'ไม่มีเคส');
    }));
});

test('PUT /api/orders/:id เรียกปรับสต็อกจริง (ไม่ใช่แค่มีฟังก์ชัน)', function () {
    $src = file_get_contents(__DIR__ . '/../routes/orders.php');
    $put = substr($src, strpos($src, "PUT('/api/orders/:id', function"));
    $put = substr($put, 0, strpos($put, "\n});"));
    ok(str_contains($put, 'syncSoldStock('), 'PUT ต้องเรียก syncSoldStock');
});

/*
 * ร้านเจอ 3 ต.ค. 2026 (CASE-2026-00243): เปลี่ยนเลนส์สต็อกทั้งสองข้างเป็นเลนส์สั่งตัด RX แล้วกด
 * บันทึก ของเก่าไม่คืน · ออเดอร์ไม่เหลือช่องสต็อกสักช่อง issueForCase เลยออกตั้งแต่บรรทัดแรก
 * ("ไม่มีอะไรให้ตัด") โดยไม่ดูว่ามีของที่ตัดไว้แล้วต้องคืน
 */
test('เปลี่ยนเลนส์สต็อกเป็น RX หมดทุกช่อง → ของที่ตัดไว้ต้องถูกคืน', function () {
    withDryStock(fn() => rollback(function (Tx $q) {
        $order = stockSyncCase($q, true);
        $case  = (int) $q->get('SELECT case_id FROM custom_orders WHERE id = ?', $order)['case_id'];
        foreach (['lensR', 'lensL'] as $slot) {
            $q->run(
                "INSERT INTO case_stock_issues (case_id, order_id, slot, kind, sku, product_name, quantity, idem_key, issued_at)
                 VALUES (?, ?, ?, 'issue', 'TST-SYNC-LNS', 'เลนส์ทดสอบ', 1, ?, NOW())",
                $case,
                $order,
                $slot,
                "test-sync-$order-$slot"
            );
        }
        $res = syncSoldStock($order, null);
        eq($res['undo'] ?? null, ['lensR', 'lensL'], 'ช่องที่ต้องคืน');
    }));
});
