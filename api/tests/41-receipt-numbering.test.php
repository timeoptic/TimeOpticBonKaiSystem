<?php

declare(strict_types=1);

/**
 * เลขใบเสร็จออกตอนเปิดออเดอร์ / ขาย POS — ไม่ใช่ตอนเปิดหน้าใบเสร็จ
 *
 * เรื่องจริง (1 ต.ค. 2026): บิลของคุณสุภา ลงวันที่ 08/09 แต่มีคนเพิ่งเปิดหน้าใบเสร็จ
 * วันที่ 1 ต.ค. จึงได้ Bill-2026-10-00041 ต่อท้ายบิลวันที่ 26/09 บัญชีไล่ตามไม่ได้
 * กติกาใหม่: เลขออกพร้อมออเดอร์ ปี/เดือนตามวันที่บนใบ ลบ/ยกเลิกแล้วเลขยังอยู่
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('เลขใบเสร็จออกตอนเปิดออเดอร์');

function rcptCustomer(Tx $q): int
{
    return (int) $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'เลขใบเสร็จ',
        '0000000000'
    )['insertId'];
}

function rcptOrder(int $cid, string $price, array $extra = []): array
{
    return Router::dispatch('POST', '/api/orders', [], [
        'customer_id' => $cid,
        'frame_name'  => 'กรอบทดสอบ',
        'frame_price' => $price,
    ] + $extra);
}

function rcptOf(Tx $q, string $col, int $id): ?array
{
    return $q->get("SELECT * FROM receipts WHERE $col = ?", $id);
}

/** เลขท้ายของเลขใบเสร็จ */
function rcptSeq(string $no): int
{
    return (int) substr($no, strrpos($no, '-') + 1);
}

/** เจ้าของร้านตัวจริงจากฐาน — POS ต้องมีคนล็อกอินที่ขายหน้าร้านได้ */
function rcptAsOwner(callable $fn): mixed
{
    StockModule::boot();
    $r = Db::get(
        "SELECT a.id, a.username, a.display_name, a.employee_id
           FROM admins a JOIN admin_roles r ON r.admin_id = a.id
          WHERE r.role = 'owner' AND a.is_active = 1 LIMIT 1"
    );
    if (!$r) {
        failTest('ไม่มีบัญชี owner ในฐาน');
    }
    $roles = \Optic\Auth::rolesOf((int) $r['id']);
    return \Optic\Auth::as([
        'id'          => (int) $r['id'],
        'username'    => $r['username'],
        'displayName' => $r['display_name'],
        'roles'       => $roles,
        'perms'       => \Optic\Roles::permsOf($roles),
        'employeeId'  => $r['employee_id'] === null ? null : (int) $r['employee_id'],
    ], $fn);
}

test('เปิดออเดอร์แล้วมีเลข Bill ทันที ปี/เดือนตามวันที่บนใบ', function () {
    rollback(function (Tx $q) {
        $o = rcptOrder(rcptCustomer($q), '1200', ['order_date' => '2026-09-08 10:36:17']);
        $r = rcptOf($q, 'order_id', (int) $o['id']);
        ok($r !== null, 'มีแถวใบเสร็จ');
        ok(str_starts_with($r['receipt_no'], 'Bill-2026-09-'), 'เลขเป็นเดือน 9 — ได้ ' . $r['receipt_no']);
        eq($r['doc_date'], '2026-09-08', 'doc_date');
        eq((float) $r['total_amount'], 1200.0, 'ยอด');
    });
});

test('สองออเดอร์ติดกันได้เลขต่อกัน', function () {
    rollback(function (Tx $q) {
        $cid = rcptCustomer($q);
        $a   = rcptOf($q, 'order_id', (int) rcptOrder($cid, '1000')['id']);
        $b   = rcptOf($q, 'order_id', (int) rcptOrder($cid, '2000')['id']);
        eq(rcptSeq($b['receipt_no']), rcptSeq($a['receipt_no']) + 1, 'เลขถัดไป');
    });
});

test('กดเปิดออเดอร์ซ้ำ ไม่เปลืองเลข', function () {
    rollback(function (Tx $q) {
        $cid = rcptCustomer($q);
        $a   = rcptOrder($cid, '999');
        $b   = rcptOrder($cid, '999');
        eq((int) $b['id'], (int) $a['id'], 'ใบเดิม');
        $next = rcptOf($q, 'order_id', (int) rcptOrder($cid, '1500')['id']);
        $mine = rcptOf($q, 'order_id', (int) $a['id']);
        eq(rcptSeq($next['receipt_no']), rcptSeq($mine['receipt_no']) + 1, 'ออเดอร์ถัดไปได้เลขต่อกัน ไม่ข้าม');
    });
});

test('เปิดหน้าใบเสร็จได้เลขเดิมที่ออกตอนเปิดออเดอร์', function () {
    rollback(function (Tx $q) {
        $o  = rcptOrder(rcptCustomer($q), '800');
        $r  = rcptOf($q, 'order_id', (int) $o['id']);
        $rc = rcptAsOwner(fn() => Router::dispatch('POST', '/api/receipts', [], ['order_id' => (int) $o['id']]));
        eq($rc['receipt_no'], $r['receipt_no'], 'เลขเดิม');
    });
});

test('ลบออเดอร์ เลขใบเสร็จยังอยู่และตีตรายกเลิก', function () {
    rollback(function (Tx $q) {
        $o  = rcptOrder(rcptCustomer($q), '700');
        $r  = rcptOf($q, 'order_id', (int) $o['id']);
        Router::dispatch('DELETE', '/api/orders/' . (int) $o['id']);
        $after = $q->get('SELECT * FROM receipts WHERE id = ?', (int) $r['id']);
        ok($after !== null, 'แถวยังอยู่');
        eq($after['receipt_no'], $r['receipt_no'], 'เลขเดิม');
        eq($after['order_id'], null, 'ปลดจากออเดอร์');
        ok($after['voided_at'] !== null, 'ตีตรายกเลิก');
        ok(str_contains((string) $after['void_reason'], (string) $o['invoice_code']), 'จำว่าเป็นของออเดอร์ไหน');
    });
});

test('ขาย POS ได้เลข BillP ทันที ยกเลิกแล้วเลขยังอยู่', function () {
    rollback(function (Tx $q) {
        $item = $q->get("SELECT id FROM pos_items WHERE sku = 'SRV-0001'");
        ok($item !== null, 'มีรายการ SRV-0001');
        $sale = rcptAsOwner(fn() => Router::dispatch('POST', '/api/pos/sales', [], [
            'items'     => [['product_id' => (int) $item['id'], 'quantity' => 1, 'unit_price' => 300]],
            'delivered' => true,
            'payment'   => ['amount' => 300, 'method' => 'cash'],
        ]));
        $r = rcptOf($q, 'sale_id', (int) $sale['id']);
        ok($r !== null && str_starts_with($r['receipt_no'], 'BillP-'), 'มีเลข BillP');
        eq($r['doc_date'], substr((string) $sale['sale_date'], 0, 10), 'doc_date = วันขาย');

        rcptAsOwner(fn() => Router::dispatch('POST', '/api/pos/sales/' . (int) $sale['id'] . '/void', [], ['reason' => 'ทดสอบ']));
        $after = rcptOf($q, 'sale_id', (int) $sale['id']);
        eq($after['receipt_no'], $r['receipt_no'], 'เลขเดิม');
        ok($after['voided_at'] !== null, 'ตีตรายกเลิก');
    });
});

test('บิลก่อน 1 ก.ย. 2026 ไม่ได้เลข Bill — หน้าใบเสร็จได้เลขบิลเดิมแทน', function () {
    rollback(function (Tx $q) {
        $o = rcptOrder(rcptCustomer($q), '900', ['order_date' => '2026-08-15 10:00:00', 'invoice_code' => 'C260815100000']);
        $r = rcptOf($q, 'order_id', (int) $o['id']);
        ok($r !== null, 'มีแถวไว้จำชื่อบนใบ');
        eq($r['receipt_no'], null, 'ไม่มีเลข Bill');

        $next = rcptOf($q, 'order_id', (int) rcptOrder(rcptCustomer($q), '950')['id']);
        ok(str_starts_with((string) $next['receipt_no'], 'Bill-'), 'ออเดอร์ปัจจุบันยังได้เลขตามปกติ');

        $rc = rcptAsOwner(fn() => Router::dispatch('POST', '/api/receipts', [], ['order_id' => (int) $o['id']]));
        eq($rc['receipt_no'], 'C260815100000', 'หน้าใบเสร็จพิมพ์เลขบิลเดิม');
        eq($q->get('SELECT receipt_no FROM receipts WHERE id = ?', (int) $r['id'])['receipt_no'], null, 'ในฐานยังว่าง');
    });
});
