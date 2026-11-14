<?php

declare(strict_types=1);

/**
 * ใบเสร็จออกเมื่อกด "ออกใบเสร็จ" เท่านั้น + ติดตามการสั่งพิมพ์ (ร้านขอ 13 ต.ค. 2026)
 *
 * TEST 01–10 ตามคำขอ · ชุดเลข Bill (เคส) กับ BillP (POS) เดินแยกกัน — ร้านเลือกเอง
 * (คำขอเดิมข้อ TEST 04 ให้ POS ต่อเลขจากเคส ร้านเปลี่ยนเป็นแยกชุด)
 * ใบเดียวต่อเคส ครอบการรับเงินทุกครั้ง
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('ใบเสร็จ — ออกเมื่อกดออกใบ + ประวัติการพิมพ์');

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

/** เจ้าของร้านตัวจริงจากฐาน — ทางเส้นใบเสร็จ/POS ต้องมีคนล็อกอิน */
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
    /* ปุ่มออกใบเสร็จกดได้เฉพาะรายชื่อใน Roles::RECEIPT_ISSUERS (หรือ superuser) — owner
       ในฐานทดสอบอาจชื่ออื่น จึงเติม superuser ให้ ไม่งั้นทุกเทสต์ที่ออกใบได้ 403 */
    if (!\Optic\Roles::issueReceipt($roles, $r['username'])) {
        $roles[] = 'superuser';
    }
    return \Optic\Auth::as([
        'id'          => (int) $r['id'],
        'username'    => $r['username'],
        'displayName' => $r['display_name'],
        'roles'       => $roles,
        'perms'       => \Optic\Roles::permsOf($roles),
        'employeeId'  => $r['employee_id'] === null ? null : (int) $r['employee_id'],
    ], $fn);
}

function rcptIssue(array $src, ?string $key = null): array
{
    return rcptAsOwner(fn() => Router::dispatch('POST', '/api/receipts/issue', [], $src + ['idem_key' => $key]));
}

function rcptSale(Tx $q, float $price = 300, array $payment = ['amount' => 300, 'method' => 'cash']): array
{
    $item = $q->get("SELECT id FROM pos_items WHERE sku = 'SRV-0001'");
    ok($item !== null, 'มีรายการ SRV-0001');
    return rcptAsOwner(fn() => Router::dispatch('POST', '/api/pos/sales', [], [
        'items'     => [['product_id' => (int) $item['id'], 'quantity' => 1, 'unit_price' => $price]],
        'delivered' => true,
        'payment'   => $payment,
    ]));
}

function rcptPrint(int $receiptId, string $key): array
{
    return rcptAsOwner(fn() => Router::dispatch('POST', "/api/receipts/$receiptId/prints", [], ['client_key' => $key]));
}

test('TEST 01: เปิดออเดอร์แต่ไม่ออกใบเสร็จ → ไม่มีเลข', function () {
    rollback(function (Tx $q) {
        $o = rcptOrder(rcptCustomer($q), '1200');
        eq(rcptOf($q, 'order_id', (int) $o['id']), null, 'ไม่มีแถวใบเสร็จ');
        $rc = rcptAsOwner(fn() => Router::dispatch('POST', '/api/receipts', [], ['order_id' => (int) $o['id']]));
        eq($rc['status'], 'NOT_ISSUED', 'เปิดหน้าใบเสร็จไม่ออกเลขให้');
        eq(rcptOf($q, 'order_id', (int) $o['id']), null, 'ยังไม่มีแถวหลังเปิดหน้า');
    });
});

test('TEST 02: ขาย POS แต่ไม่ออกใบเสร็จ → ไม่มีเลข', function () {
    rollback(function (Tx $q) {
        $sale = rcptSale($q);
        eq(rcptOf($q, 'sale_id', (int) $sale['id']), null, 'ไม่มีแถวใบเสร็จ');
    });
});

test('TEST 03: เคสออกใบเสร็จ → ได้เลขถัดไปของชุด Bill เดือน/ปีตามวันที่กดออก', function () {
    rollback(function (Tx $q) {
        $cid = rcptCustomer($q);
        $a = rcptIssue(['order_id' => (int) rcptOrder($cid, '1000')['id']]);
        $b = rcptIssue(['order_id' => (int) rcptOrder($cid, '2000')['id']]);
        ok(str_starts_with($a['receipt_no'], 'Bill-' . date('Y-m') . '-'), 'เลขเดือนที่กดออก — ได้ ' . $a['receipt_no']);
        eq(rcptSeq($b['receipt_no']), rcptSeq($a['receipt_no']) + 1, 'เลขถัดไป');
        eq($a['source_type'], 'CASE', 'source_type');
        eq($a['status'], 'ISSUED', 'สถานะ');
        eq($a['doc_date'], date('Y-m-d'), 'วันที่บนใบ = วันที่กดออก');
        eq((float) $a['total_amount'], 1000.0, 'ยอดจากฐาน');
    });
});

test('TEST 04: POS ออกใบเสร็จถัดมา → ชุด BillP แยกจากเคส (ร้านเลือก)', function () {
    rollback(function (Tx $q) {
        $case = rcptIssue(['order_id' => (int) rcptOrder(rcptCustomer($q), '500')['id']]);
        $p1 = rcptIssue(['sale_id' => (int) rcptSale($q)['id']]);
        $p2 = rcptIssue(['sale_id' => (int) rcptSale($q)['id']]);
        ok(str_starts_with($p1['receipt_no'], 'BillP-'), 'POS ได้ BillP');
        eq(rcptSeq($p2['receipt_no']), rcptSeq($p1['receipt_no']) + 1, 'BillP เดินต่อกันเอง');
        eq($p1['source_type'], 'POS', 'source_type');
        $next = rcptIssue(['order_id' => (int) rcptOrder(rcptCustomer($q), '600')['id']]);
        eq(rcptSeq($next['receipt_no']), rcptSeq($case['receipt_no']) + 1, 'Bill ไม่ถูก POS กินเลข');
    });
});

test('เลขท้ายเริ่ม 00001 ใหม่ทุกเดือน แยกชุด Bill / BillP', function () {
    rollback(function (Tx $q) {
        eq(nextReceiptNo($q, 'Bill', '2031-03-05 10:00:00'), 'Bill-2031-03-00001', 'ใบแรกของเดือน');
        eq(nextReceiptNo($q, 'Bill', '2031-03-28 10:00:00'), 'Bill-2031-03-00002', 'ใบถัดไปเดือนเดียวกัน');
        eq(nextReceiptNo($q, 'BillP', '2031-03-28 10:00:00'), 'BillP-2031-03-00001', 'POS ชุดของตัวเอง');
        eq(nextReceiptNo($q, 'Bill', '2031-04-01 09:00:00'), 'Bill-2031-04-00001', 'เดือนใหม่เริ่ม 00001');
        eq(nextReceiptNo($q, 'Bill', '2031-03-30 10:00:00'), 'Bill-2031-03-00003', 'เดือนเก่ายังเดินต่อของมันเอง');
    });
});

test('TEST 05 + 10: เปิดใบเดิมวันหลัง/เดือนหลัง → เลขเดิม ไม่สร้างเลขของเดือนปัจจุบัน', function () {
    rollback(function (Tx $q) {
        $o  = rcptOrder(rcptCustomer($q), '800');
        $rc = rcptIssue(['order_id' => (int) $o['id']]);
        /* ทำเหมือนออกไว้ตั้งแต่เดือนก่อน */
        $q->run("UPDATE receipts SET receipt_no = 'Bill-2026-09-99001', doc_date = '2026-09-20', issued_at = '2026-09-20 10:00:00' WHERE id = ?", (int) $rc['id']);
        $view  = rcptAsOwner(fn() => Router::dispatch('POST', '/api/receipts', [], ['order_id' => (int) $o['id']]));
        $again = rcptIssue(['order_id' => (int) $o['id']], 'อีกเครื่อง');
        eq($view['receipt_no'], 'Bill-2026-09-99001', 'เปิดดูได้เลขเดิม');
        eq($again['receipt_no'], 'Bill-2026-09-99001', 'กดออกใบซ้ำได้ใบเดิม');
        eq($again['doc_date'], '2026-09-20', 'วันที่เดิม');
        eq((int) $q->get('SELECT COUNT(*) n FROM receipts WHERE order_id = ?', (int) $o['id'])['n'], 1, 'ยังมีใบเดียว');
    });
});

test('TEST 06: พิมพ์ซ้ำ 5 ครั้ง → เลขเดิม มีประวัติ 5 แถว ไม่มีเลขใหม่', function () {
    rollback(function (Tx $q) {
        $rc   = rcptIssue(['order_id' => (int) rcptOrder(rcptCustomer($q), '900')['id']]);
        $max0 = $q->get('SELECT MAX(id) m FROM receipts')['m'];
        for ($i = 1; $i <= 5; $i++) {
            $log = rcptPrint((int) $rc['id'], "k$i");
            eq((int) $log['attempt_no'], $i, "ครั้งที่ $i");
            eq($log['receipt_no'], $rc['receipt_no'], 'เลขเดิม');
            eq($log['status'], 'REQUESTED', 'สถานะตอนกด');
        }
        eq($q->get('SELECT MAX(id) m FROM receipts')['m'], $max0, 'ไม่มีใบเสร็จใหม่');
        $dup = rcptPrint((int) $rc['id'], 'k5');
        eq((int) $dup['attempt_no'], 5, 'กดซ้อนด้วย key เดิมไม่เพิ่มแถว');
        eq((int) $q->get('SELECT COUNT(*) n FROM receipt_print_logs WHERE receipt_id = ?', (int) $rc['id'])['n'], 5, 'ประวัติ 5 แถว');
        $view = rcptAsOwner(fn() => Router::dispatch('POST', '/api/receipts', [], ['order_id' => (int) $rc['order_id']]));
        eq($view['print_count'], 5, 'จำนวนครั้ง');
        eq($view['total_amount'], $rc['total_amount'], 'ยอดไม่เปลี่ยน');
    });
});

test('TEST 07: สั่งพิมพ์แล้วกล่องพิมพ์ปิด → UNKNOWN ไม่ใช่ CONFIRMED · ยืนยันแล้วไม่ถูกทับ', function () {
    rollback(function (Tx $q) {
        $rc  = rcptIssue(['order_id' => (int) rcptOrder(rcptCustomer($q), '400')['id']]);
        $log = rcptPrint((int) $rc['id'], 'x1');
        $put = fn(array $b) => rcptAsOwner(fn() => Router::dispatch('PUT', '/api/receipt-prints/' . (int) $log['id'], [], $b));
        eq($put(['status' => 'UNKNOWN'])['status'], 'UNKNOWN', 'ปิดกล่องพิมพ์ = ไม่ทราบผล');
        $failed = $put(['status' => 'FAILED', 'failure_reason' => 'กดยกเลิก']);
        eq($failed['status'], 'FAILED', 'พนักงานบอกว่าไม่ออก');
        eq($failed['failure_reason'], 'กดยกเลิก', 'เหตุผล');
        eq($put(['status' => 'UNKNOWN'])['status'], 'FAILED', 'UNKNOWN มาช้าไม่ทับผลที่ยืนยันแล้ว');
        $threw = false;
        try {
            $put(['status' => 'CONFIRMED_BY_PREVIEW']);
        } catch (Throwable $e) {
            $threw = true;
        }
        ok($threw, 'สถานะแปลกถูกปฏิเสธ');
    });
});

test('TEST 08: มัดจำ + จ่ายส่วนที่เหลือ → ใบเดียว ผูกเงินทั้งสองก้อน', function () {
    rollback(function (Tx $q) {
        $o  = rcptOrder(rcptCustomer($q), '3000', ['deposit' => '1000', 'deposit_pay_type' => 'Cash']);
        $rc = rcptIssue(['order_id' => (int) $o['id']]);
        eq(count($rc['payments']), 1, 'ตอนออกใบมีมัดจำก้อนเดียว');
        $q->run(
            "INSERT INTO payments (order_id, kind, method, amount) VALUES (?, 'final', 'Cash', 2000)",
            (int) $o['id']
        );
        $view = rcptAsOwner(fn() => Router::dispatch('POST', '/api/receipts', [], ['order_id' => (int) $o['id']]));
        eq((int) $view['id'], (int) $rc['id'], 'ใบเดิม');
        eq(count($view['payments']), 2, 'ก้อนที่จ่ายทีหลังถูกผูกเข้าใบเดิม');
        eq((float) $view['paid_total'], 3000.0, 'รับเงินรวม');
        eq((float) $view['total_amount'], 3000.0, 'ยอดบิลบนใบไม่เปลี่ยน');
    });
});

test('TEST 09: สองเครื่องกดออกใบพร้อมกัน → ใบเดียว เลขไม่ซ้ำ', function () {
    rollback(function (Tx $q) {
        $o = rcptOrder(rcptCustomer($q), '700');
        $a = rcptIssue(['order_id' => (int) $o['id']], 'เครื่อง-A');
        $b = rcptIssue(['order_id' => (int) $o['id']], 'เครื่อง-B');
        eq((int) $b['id'], (int) $a['id'], 'ใบเดียวกัน');
        eq($b['receipt_no'], $a['receipt_no'], 'เลขเดียวกัน');
        $c = rcptIssue(['order_id' => (int) rcptOrder(rcptCustomer($q), '710')['id']], 'เครื่อง-A');
        ok($c['receipt_no'] !== $a['receipt_no'], 'ออเดอร์อื่นได้เลขของตัวเอง แม้ key ซ้ำกับเครื่องเดิม');
        eq((int) $q->get('SELECT COUNT(*) n FROM receipts WHERE receipt_no = ?', $a['receipt_no'])['n'], 1, 'เลขไม่ซ้ำในฐาน');
    });
});

test('ลบออเดอร์ → ใบยังอยู่ VOIDED จำที่มา · ใบที่ยกเลิกพิมพ์ไม่ได้', function () {
    rollback(function (Tx $q) {
        $o  = rcptOrder(rcptCustomer($q), '650');
        $rc = rcptIssue(['order_id' => (int) $o['id']]);
        Router::dispatch('DELETE', '/api/orders/' . (int) $o['id']);
        $after = $q->get('SELECT * FROM receipts WHERE id = ?', (int) $rc['id']);
        eq($after['receipt_no'], $rc['receipt_no'], 'เลขเดิม');
        eq($after['status'], 'VOIDED', 'สถานะ');
        eq($after['order_id'], null, 'ปลดจากออเดอร์');
        eq((int) $after['source_id'], (int) $o['id'], 'ยังจำว่าเป็นของออเดอร์ไหน');
        $threw = false;
        try {
            rcptPrint((int) $rc['id'], 'v1');
        } catch (Throwable $e) {
            $threw = true;
        }
        ok($threw, 'พิมพ์ใบที่ยกเลิกไม่ได้');
    });
});

test('ใบขาย POS ที่ยกเลิกแล้ว ออกใบเสร็จไม่ได้', function () {
    rollback(function (Tx $q) {
        $sale = rcptSale($q);
        rcptAsOwner(fn() => Router::dispatch('POST', '/api/pos/sales/' . (int) $sale['id'] . '/void', [], ['reason' => 'ทดสอบ']));
        $threw = false;
        try {
            rcptIssue(['sale_id' => (int) $sale['id']]);
        } catch (Throwable $e) {
            $threw = true;
        }
        ok($threw, 'ถูกปฏิเสธ');
    });
});

test('บิลก่อน 1 ก.ย. 2026 → ออกใบได้แต่ไม่ได้เลข Bill ใบพิมพ์เลขบิลเดิม', function () {
    rollback(function (Tx $q) {
        $o  = rcptOrder(rcptCustomer($q), '900', ['order_date' => '2026-08-15 10:00:00', 'invoice_code' => 'C260815100000']);
        $rc = rcptIssue(['order_id' => (int) $o['id']]);
        eq($rc['receipt_no'], 'C260815100000', 'ใบพิมพ์เลขบิลเดิม');
        eq($q->get('SELECT receipt_no FROM receipts WHERE id = ?', (int) $rc['id'])['receipt_no'], null, 'ในฐานไม่มีเลข Bill');
    });
});

test('ส่วนใบเสร็จของหน้าเคส: ทุกออเดอร์ของเคส ทั้งที่ออกแล้วและยังไม่ออก', function () {
    rollback(function (Tx $q) {
        $cid  = rcptCustomer($q);
        $case = (int) $q->run(
            "INSERT INTO cases (case_code, customer_id) VALUES (?, ?)",
            'CASE-TEST-RCPT',
            $cid
        )['insertId'];
        $a = rcptOrder($cid, '1000', ['case_id' => $case]);
        $q->run('UPDATE custom_orders SET case_id = ? WHERE id = ?', $case, (int) $a['id']);
        $b = rcptOrder($cid, '2000', ['case_id' => $case, 'frame_name' => 'กรอบสอง']);
        $q->run('UPDATE custom_orders SET case_id = ? WHERE id = ?', $case, (int) $b['id']);
        rcptIssue(['order_id' => (int) $a['id']]);
        $list = rcptAsOwner(fn() => Router::dispatch('GET', '/api/receipts/for', ['case_id' => $case]));
        eq(count($list), 2, 'สองออเดอร์');
        ok($list[0]['receipt'] !== null && $list[0]['receipt']['print_status'] === 'NOT_REQUESTED', 'ใบแรกออกแล้ว ยังไม่เคยสั่งพิมพ์');
        eq($list[1]['receipt'], null, 'ใบสองยังไม่ออก');
    });
});

test('ปุ่มออกใบเสร็จ: ออกได้เฉพาะเจ้าของร้าน + Pom Tik Bow Japiica + superuser — sales คนอื่นได้ 403 ไม่เกิดเลข', function () {
    ok(\Optic\Roles::issueReceipt(['sales', 'stock'], 'Bow'), 'Bow (sales) ออกได้');
    ok(\Optic\Roles::issueReceipt(['owner'], ' pom '), 'ชื่อไม่สนตัวพิมพ์/ช่องว่าง');
    ok(\Optic\Roles::issueReceipt(['superuser'], 'admin'), 'superuser ออกได้เสมอ');
    ok(!\Optic\Roles::issueReceipt(['sales'], 'Mild'), 'sales คนอื่นออกไม่ได้');
    ok(\Optic\Roles::issueReceipt(['owner'], 'someone'), 'เจ้าของร้านออกได้ทุกสาขา (สั่ง 14 พ.ย. 2026)');
    ok(!\Optic\Roles::issueReceipt(['admin'], 'someone'), 'แอดมินที่ไม่อยู่ในรายชื่อออกไม่ได้');
    ok(!\Optic\Roles::issueReceipt(['admin', 'sales'], 'someone'), 'แอดมิน + sales ที่ไม่อยู่ในรายชื่อออกไม่ได้');

    rollback(function (Tx $q) {
        $order = rcptOrder(rcptCustomer($q), '1000');
        $status = null;
        try {
            \Optic\Auth::as([
                'id' => 0, 'username' => 'Mild', 'displayName' => 'Mild',
                'roles' => ['sales'], 'perms' => \Optic\Roles::permsOf(['sales']), 'employeeId' => null,
            ], fn() => Router::dispatch('POST', '/api/receipts/issue', [], ['order_id' => (int) $order['id']]));
        } catch (HttpError $e) {
            $status = $e->status;
        }
        eq($status, 403, 'sales ที่ไม่อยู่ในรายชื่อโดน 403');
        eq($q->get('SELECT COUNT(*) n FROM receipts WHERE order_id = ?', (int) $order['id'])['n'] ?? null, 0, 'ไม่เกิดเลข');
    });
});

test('เลือกวันที่บนใบตอนออก: เลขเป็นชุดของเดือนที่เลือก เดินต่อจากเลขสูงสุดของเดือนนั้น', function () {
    rollback(function (Tx $q) {
        $cid = rcptCustomer($q);
        $n   = 0;
        /* ราคาไม่ซ้ำกันทุกใบ — ออเดอร์หน้าตาเหมือนกันของลูกค้าเดียวกันถูกกันซ้ำเป็นใบเดิม */
        $mk  = function (string $date) use ($q, $cid, &$n): int {
            $id = (int) rcptOrder($cid, (string) (1500 + ++$n))['id'];
            $q->run('UPDATE custom_orders SET order_date = ? WHERE id = ?', "$date 10:00:00", $id);
            return $id;
        };
        /* ใบที่ถือเลขสูงสุดของ ต.ค. อยู่แล้ว — ใบย้อนหลังต้องได้เลขถัดจากนี้ ไม่ชนกัน */
        $prev = rcptIssue(['order_id' => $mk('2026-10-02'), 'doc_date' => '2026-10-02']);
        ok(str_starts_with($prev['receipt_no'], 'Bill-2026-10-'), 'ได้เลข ต.ค. — ' . $prev['receipt_no']);
        eq($prev['doc_date'], '2026-10-02', 'วันที่บนใบตามที่เลือก');
        eq(substr((string) $prev['issued_at'], 0, 10), date('Y-m-d'), 'issued_at ยังเป็นวันที่กดจริง');

        $next = rcptIssue(['order_id' => $mk('2026-10-05'), 'doc_date' => '2026-10-28']);
        eq(rcptSeq($next['receipt_no']), rcptSeq($prev['receipt_no']) + 1, 'เดินต่อในชุด ต.ค.');

        $today = rcptIssue(['order_id' => $mk(date('Y-m-d'))]);
        ok(str_starts_with($today['receipt_no'], 'Bill-' . date('Y-m') . '-'), 'ไม่ส่งวันที่ = วันนี้');
        eq($today['doc_date'], date('Y-m-d'), 'วันที่บนใบ = วันนี้');
    });
});

test('เลือกวันที่บนใบ: ล่วงหน้า / ก่อน 1 ก.ย. 2026 / ก่อนวันที่บนบิล / รูปแบบผิด → 400 ไม่เกิดเลข', function () {
    rollback(function (Tx $q) {
        $id = (int) rcptOrder(rcptCustomer($q), '900')['id'];
        $q->run('UPDATE custom_orders SET order_date = ? WHERE id = ?', '2026-10-10 10:00:00', $id);
        foreach ([
            date('Y-m-d', strtotime('+1 day')) => 'ล่วงหน้า',
            '2026-08-31'                       => 'ก่อนเริ่มชุดเลข',
            '2026-10-09'                       => 'ก่อนวันที่บนบิล',
            '2026-13-01'                       => 'เดือนไม่มีจริง',
            '10/10/2026'                       => 'รูปแบบผิด',
        ] as $d => $why) {
            $status = null;
            try {
                rcptIssue(['order_id' => $id, 'doc_date' => $d]);
            } catch (HttpError $e) {
                $status = $e->status;
            }
            eq($status, 400, "$why ($d) โดนปฏิเสธ");
        }
        eq(rcptOf($q, 'order_id', $id), null, 'ไม่มีใบเกิดขึ้น');
        $ok = rcptIssue(['order_id' => $id, 'doc_date' => '2026-10-10']);
        ok(str_starts_with($ok['receipt_no'], 'Bill-2026-10-'), 'วันเดียวกับบิลออกได้');
    });
});
