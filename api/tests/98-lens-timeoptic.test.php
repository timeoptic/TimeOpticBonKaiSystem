<?php

declare(strict_types=1);

/**
 * Bewell → "คำขอจากสาขา" ของคลัง TimeOptic (services/TimeOpticRequests.php)
 *
 * ยิงใส่คลังปลอม (fixtures/fake-timeoptic-stock.php ผ่าน `php -S`) ไม่ใช่เว็บจริง · ทุกข้อ roll back
 * ใช้ lrFixture() / lrStatus() / lrStatusCode() จาก 98-lens-requisition (โหลดก่อนไฟล์นี้)
 */

group('ใบเบิกเลนส์ → คำขอจากสาขาของคลัง TimeOptic');

/** เปิดคลังปลอมครั้งเดียวทั้งไฟล์ · คืน [log, modeFile] */
function tosServer(): array
{
    static $ctx = null;
    if ($ctx !== null) {
        return $ctx;
    }
    $dir  = sys_get_temp_dir() . '/tos-' . bin2hex(random_bytes(3));
    @mkdir($dir);
    $log  = "$dir/log";
    $mode = "$dir/mode";
    $port = 18000 + random_int(0, 999);
    $env  = getenv() + ['FAKE_TOS_LOG' => $log, 'FAKE_TOS_MODE' => $mode];
    $env['FAKE_TOS_LOG']  = $log;
    $env['FAKE_TOS_MODE'] = $mode;
    $proc = proc_open(
        [PHP_BINARY, '-S', "127.0.0.1:$port", __DIR__ . '/fixtures/fake-timeoptic-stock.php'],
        [0 => ['pipe', 'r'], 1 => ['file', "$dir/out", 'a'], 2 => ['file', "$dir/out", 'a']],
        $pipes,
        null,
        $env
    );
    register_shutdown_function(static function () use ($proc) {
        proc_terminate($proc);
    });
    for ($i = 0; $i < 50; $i++) {
        $s = @fsockopen('127.0.0.1', $port, $no, $str, 0.2);
        if ($s) {
            fclose($s);
            break;
        }
        usleep(100000);
    }
    putenv('TIMEOPTIC_STOCK_USER=bewell-bot');
    putenv('TIMEOPTIC_STOCK_PASS=secret');
    putenv('TIMEOPTIC_BRANCH_ID=5335');
    return $ctx = [$log, $mode, "http://127.0.0.1:$port/stock-api"];
}

/** เริ่มข้อใหม่: ล้างบันทึก ตั้งโหมด → คืนฟังก์ชันอ่านคำขอที่คลังได้รับ */
function tosReset(string $mode = 'ok'): callable
{
    [$log, $file, $api] = tosServer();
    putenv("TIMEOPTIC_STOCK_API=$api");
    file_put_contents($log, '');
    file_put_contents($file, $mode);
    return static fn(): array => array_map(
        static fn($l) => json_decode($l, true),
        array_values(array_filter(explode("\n", (string) file_get_contents($log))))
    );
}

/** ใบเบิกจากรายการเลนส์ (มีรหัส LNS) ขวา/ซ้ายเลนส์ตัวเดียวกัน */
function tosReq(Tx $q, array $f): array
{
    $cat = (int) $q->run(
        "INSERT INTO lens_catalog (code, lens_name, lens_type, selling_price) VALUES (?, 'G Auto (1.50) -1.00/0.00', 'Single Vision', 1500)",
        'LNS-T' . strtoupper(bin2hex(random_bytes(3)))
    )['insertId'];
    return lrSync($f['order'], [
        ['eye' => 'R', 'lens_catalog_id' => $cat, 'unit_price' => 750],
        ['eye' => 'L', 'lens_catalog_id' => $cat, 'unit_price' => 750],
    ]);
}

function tosOff(): void
{
    putenv('TIMEOPTIC_STOCK_API=');
}

test('ตะกร้า: SKU เดียวกันสองข้างรวมเป็นจำนวน 2 · เลนส์ไม่มีรหัสส่งไม่ได้', function () {
    eq(
        TimeOpticRequests::basket([
            ['lens_code' => 'LNS-1', 'quantity' => 1],
            ['lens_code' => 'LNS-1', 'quantity' => 1],
            ['lens_code' => 'LNS-2', 'quantity' => 1],
        ]),
        [['sku' => 'LNS-1', 'quantity' => 2], ['sku' => 'LNS-2', 'quantity' => 1]],
        'ตะกร้า'
    );
    eq(lrStatusCode(fn() => TimeOpticRequests::basket([['lens_code' => null, 'brand' => 'HOYA']])), 409, 'ไม่มีรหัส');
});

test('กด "ส่งรายการเบิก" = ส่งคำขอเข้าคลังในนามสาขา Bewell แล้วเก็บเลข REQ', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $f = lrFixture($q);
        $r = tosReq($q, $f);
        $after = lrStatus((int) $r['id'], 'issued');
        eq($after['status'], 'issued', 'สถานะฝั่ง Bewell');
        eq($after['timeoptic_req_code'], 'REQ-00077', 'เลขคำขอ');
        eq($after['timeoptic_status'], 'pending', 'สถานะฝั่งคลัง');
        eq($after['timeoptic_status_label'], 'รอ TimeOptic ตรวจ', 'ป้าย');

        $calls = $seen();
        eq(array_column($calls, 'path'), ['/stock-api/auth/login', '/stock-api/issue-requests'], 'ล็อกอินก่อน แล้วส่งคำขอ');
        $sent = $calls[1]['body'];
        eq($sent['kind'], 'issue', 'ชนิดคำขอ');
        eq($sent['branch_id'], 5335, 'สาขา Bewell');
        eq(count($sent['body']['items']), 1, 'สองข้างรวมเป็นบรรทัดเดียว');
        eq($sent['body']['items'][0]['quantity'], 2, 'จำนวน');
        ok(str_contains($sent['body']['note'], $r['req_no']), 'หมายเหตุมีเลขใบเบิก: ' . $sent['body']['note']);
        ok(str_contains($sent['body']['note'], 'TEST-LR-'), 'หมายเหตุมีเลขเคส');
    });
});

test('เปลี่ยนสถานะต่อจากนั้นไม่ส่งซ้ำ', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $r = tosReq($q, lrFixture($q));
        lrStatus((int) $r['id'], 'issued');
        lrStatus((int) $r['id'], 'ordered');
        eq(count(array_filter($seen(), fn($c) => $c['path'] === '/stock-api/issue-requests')), 1, 'ส่งครั้งเดียว');
    });
});

test('ส่งไม่ผ่าน (ล็อกอินไม่ได้ / คลังล่ม) สถานะไม่ขยับ', function () {
    foreach (['login_fail', 'down'] as $mode) {
        tosReset($mode);
        rollback(function (Tx $q) use ($mode) {
            $r = tosReq($q, lrFixture($q));
            eq(lrStatusCode(fn() => lrStatus((int) $r['id'], 'issued')), 502, "$mode: ตอบ 502");
            $row = $q->get('SELECT status, timeoptic_req_id FROM lens_requisitions WHERE id = ?', (int) $r['id']);
            eq($row['status'], 'pending', "$mode: ยังรอเบิก");
            eq($row['timeoptic_req_id'], null, "$mode: ไม่มีเลขคำขอ");
        });
    }
});

test('ยกเลิกใบที่ส่งแล้ว → ยกเลิกคำขอในคลังด้วย', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $r = tosReq($q, lrFixture($q));
        lrStatus((int) $r['id'], 'issued');
        $after = lrStatus((int) $r['id'], 'cancelled', 'ลูกค้าเปลี่ยนใจ');
        eq($after['status'], 'cancelled', 'ฝั่ง Bewell');
        eq($after['timeoptic_status'], 'cancelled', 'ฝั่งคลัง');
        ok(in_array('/stock-api/issue-requests/77/cancel', array_column($seen(), 'path'), true), 'เรียกยกเลิกคำขอ 77');
    });
});

test('ยกเลิกใบที่คลังตัดไปแล้ว — ฝั่ง Bewell ยกเลิกได้ ไทม์ไลน์บอกให้คุยเรื่องคืนเลนส์', function () {
    tosReset();
    rollback(function (Tx $q) {
        $r = tosReq($q, lrFixture($q));
        lrStatus((int) $r['id'], 'issued');
        file_put_contents(tosServer()[1], 'approved');
        $after = lrStatus((int) $r['id'], 'cancelled', 'ยกเลิก');
        eq($after['status'], 'cancelled', 'ฝั่ง Bewell');
        eq($after['timeoptic_status'], 'approved', 'ฝั่งคลังยังตัดแล้ว');
        $note = $q->get(
            "SELECT note FROM case_events WHERE entity = 'lens_requisition' AND entity_id = ? ORDER BY id DESC LIMIT 1",
            (int) $r['id']
        )['note'];
        ok(str_contains($note, 'คืนเลนส์'), "ไทม์ไลน์: $note");
    });
});

test('ลบออเดอร์/ยกเลิกเคส (cancelFor) ก็ยกเลิกคำขอในคลังด้วย', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $f = lrFixture($q);
        $r = tosReq($q, $f);
        lrStatus((int) $r['id'], 'issued');
        LensRequisition::cancelFor($q, 'order', $f['order'], 'order_deleted', 'ลบออเดอร์', null);
        $row = $q->get('SELECT status, timeoptic_status FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        eq([$row['status'], $row['timeoptic_status']], ['cancelled', 'cancelled'], 'ทั้งสองฝั่ง');
    });
});

test('ดึงสถานะล่าสุด: ตัดแล้วได้เลขใบเบิก', function () {
    tosReset();
    rollback(function (Tx $q) {
        $r = tosReq($q, lrFixture($q));
        lrStatus((int) $r['id'], 'issued');
        $res = Router::dispatch('POST', '/api/lens-requisitions/timeoptic-refresh', [], []);
        ok($res['updated'] >= 1, 'อัปเดตอย่างน้อยหนึ่งใบ');
        $row = $q->get('SELECT timeoptic_status, timeoptic_note FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        eq($row['timeoptic_status'], 'approved', 'สถานะ');
        eq($row['timeoptic_note'], 'ใบเบิก REQ-00077', 'หมายเหตุ');
    });
});

test('คลังตัดบางส่วน: แยกสถานะตัดบางส่วน/รอของ บอกทีละข้าง · ยกเลิกที่รอแล้วบอกเหตุผล', function () {
    $eyes = TimeOpticRequests::eyesOf([
        ['lens_code' => 'LNS-0264', 'eye' => 'R'],
        ['lens_code' => 'LNS-0263', 'eye' => 'L'],
    ]);
    $partial = TimeOpticRequests::shape([
        'id' => 152, 'status' => 'approved',
        'result'  => ['referenceDoc' => 'REQ-00152', 'lines' => [['sku' => 'LNS-0263', 'quantity' => 1]]],
        'waiting' => [['sku' => 'LNS-0264', 'quantity' => 1]],
    ], $eyes);
    eq([$partial['status'], $partial['note']], ['partial', 'ตัดแล้ว: L LNS-0263 · รอของ: R LNS-0264'], 'ตัดข้างซ้าย ขวารอ');

    $all = TimeOpticRequests::shape([
        'id' => 153, 'status' => 'approved',
        'result'  => ['lines' => []],
        'waiting' => [['sku' => 'LNS-0264', 'quantity' => 1], ['sku' => 'LNS-0263', 'quantity' => 1]],
    ], $eyes);
    eq([$all['status'], $all['note']], ['waiting', 'รอของ: R LNS-0264, L LNS-0263'], 'ทั้งใบรอของ');

    $pair = TimeOpticRequests::shape([
        'id' => 154, 'status' => 'approved',
        'result'  => ['lines' => [['sku' => 'LNS-1', 'quantity' => 1]]],
        'waiting' => [['sku' => 'LNS-1', 'quantity' => 1]],
    ], TimeOpticRequests::eyesOf([['lens_code' => 'LNS-1', 'eye' => 'R'], ['lens_code' => 'LNS-1', 'eye' => 'L']]));
    eq($pair['note'], 'ตัดแล้ว: LNS-1 · รอของ: LNS-1', 'SKU เดียวกันสองข้าง ตัดไปหนึ่ง ไม่เดาข้าง');

    $dropped = TimeOpticRequests::shape([
        'id' => 155, 'status' => 'approved',
        'result' => [
            'referenceDoc' => 'REQ-00155',
            'lines'   => [['sku' => 'LNS-0263', 'quantity' => 1]],
            'dropped' => [['reason' => 'เลิกผลิต', 'lines' => [['sku' => 'LNS-0264', 'quantity' => 1]]]],
        ],
        'waiting' => [],
    ], $eyes);
    eq(
        [$dropped['status'], $dropped['note']],
        ['approved', 'ใบเบิก REQ-00155 · ตัดแล้ว: L LNS-0263 · ยกเลิกที่รอของ: R LNS-0264 (เลิกผลิต)'],
        'ยกเลิกที่รอ ส่วนที่ตัดอยู่ตามเดิม',
    );

    $none = TimeOpticRequests::shape([
        'id' => 156, 'status' => 'approved',
        'result'  => ['lines' => [], 'dropped' => [['reason' => 'สาขายกเลิกคำขอ', 'lines' => [['sku' => 'LNS-0264', 'quantity' => 1]]]]],
        'waiting' => [],
    ], $eyes);
    eq($none['status'], 'cancelled', 'ไม่ได้ตัดอะไรเลยแล้วยกเลิกที่รอ = ยกเลิก');

    eq(TimeOpticRequests::shape(['id' => 1, 'status' => 'approved', 'result' => ['referenceDoc' => 'REQ-1']])['note'], 'ใบเบิก REQ-1', 'คำขอแบบเดิมไม่เปลี่ยน');
});

test('ดึงสถานะล่าสุด: คลังตัดบางส่วน → ใบได้สถานะตัดบางส่วน · ลงไทม์ไลน์เคส', function () {
    tosReset('partial');
    rollback(function (Tx $q) {
        $r = tosReq($q, lrFixture($q));
        lrStatus((int) $r['id'], 'issued');
        Router::dispatch('POST', '/api/lens-requisitions/timeoptic-refresh', [], []);
        $row = $q->get('SELECT timeoptic_status, timeoptic_note FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        eq([$row['timeoptic_status'], $row['timeoptic_note']], ['partial', 'ตัดแล้ว: LNS-C · รอของ: LNS-W'], 'สถานะ + หมายเหตุ');
        $ev = $q->get("SELECT action, note FROM case_events WHERE entity = 'lens_requisition' AND entity_id = ? ORDER BY id DESC LIMIT 1", (int) $r['id']);
        eq($ev['action'], 'lens_timeoptic_status', 'ไทม์ไลน์');
        ok(str_contains((string) $ev['note'], 'TimeOptic ตัดบางส่วน · รอของ'), 'ไทม์ไลน์บอกสถานะ: ' . $ev['note']);

        $again = Router::dispatch('POST', '/api/lens-requisitions/timeoptic-refresh', [], []);
        eq(
            (int) $q->get("SELECT COUNT(*) AS n FROM case_events WHERE action = 'lens_timeoptic_status' AND entity_id = ?", (int) $r['id'])['n'],
            1,
            'ดึงซ้ำไม่ลงซ้ำ',
        );
    });
});

test('ยืนยันขั้นขาย = ส่งคำขอเข้าคลังทันที ใบยังรอเบิก · กดซ้ำไม่ส่งซ้ำ · เลื่อนสถานะต่อก็ไม่ส่งซ้ำ', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $f = lrFixture($q);
        $r = tosReq($q, $f);
        LensRequisition::markUsed($q, $f['case'], null);
        eq(TimeOpticRequests::sendForCase($q, $f['case'], null), [], 'ไม่มีใบที่ส่งไม่ผ่าน');
        $row = $q->get('SELECT status, timeoptic_req_code, timeoptic_status FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        eq([$row['status'], $row['timeoptic_req_code'], $row['timeoptic_status']], ['pending', 'REQ-00077', 'pending'], 'ใบหลังขาย');

        TimeOpticRequests::sendForCase($q, $f['case'], null);
        lrStatus((int) $r['id'], 'issued');
        eq(count(array_filter($seen(), fn($c) => $c['path'] === '/stock-api/issue-requests')), 1, 'ส่งครั้งเดียว');
    });
});

test('ยืนยันขั้นขายแต่คลังล่ม — ขายผ่าน ใบยังไม่มีเลขคำขอ ไทม์ไลน์บอกเหตุ', function () {
    tosReset('down');
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $r = tosReq($q, $f);
        LensRequisition::markUsed($q, $f['case'], null);
        $failed = TimeOpticRequests::sendForCase($q, $f['case'], null);
        eq(count($failed), 1, 'หนึ่งใบส่งไม่ผ่าน');
        $row = $q->get('SELECT status, timeoptic_req_id FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        eq([$row['status'], $row['timeoptic_req_id']], ['pending', null], 'ใบยังรอเบิก ไม่มีเลข');
        $ev = $q->get("SELECT action FROM case_events WHERE entity = 'lens_requisition' AND entity_id = ? ORDER BY id DESC LIMIT 1", (int) $r['id']);
        eq($ev['action'], 'lens_timeoptic_send_failed', 'ไทม์ไลน์');

        tosReset();
        eq(lrStatus((int) $r['id'], 'issued')['timeoptic_req_code'], 'REQ-00077', 'ส่งใหม่ทางเดิมได้');
    });
});

test('เปิดขั้นขายกลับมาแก้ = ถอนคำขอที่ยังรอตรวจ · ยืนยันใหม่ส่งใบใหม่', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $f = lrFixture($q);
        $r = tosReq($q, $f);
        LensRequisition::markUsed($q, $f['case'], null);
        TimeOpticRequests::sendForCase($q, $f['case'], null);
        TimeOpticRequests::withdrawForCase($q, $f['case'], null);
        LensRequisition::unmarkUsed($q, $f['case'], null);
        $row = $q->get('SELECT timeoptic_req_id FROM lens_requisitions WHERE id = ?', (int) $r['id']);
        eq($row['timeoptic_req_id'], null, 'ล้างเลขคำขอ');
        ok(in_array('/stock-api/issue-requests/77/cancel', array_column($seen(), 'path'), true), 'ยกเลิกคำขอ 77 ในคลัง');

        LensRequisition::markUsed($q, $f['case'], null);
        TimeOpticRequests::sendForCase($q, $f['case'], null);
        eq(count(array_filter($seen(), fn($c) => $c['path'] === '/stock-api/issue-requests')), 2, 'ส่งใบใหม่');
    });
});

test('เปลี่ยนเลนส์หลังขาย: ถอนคำขอเดิม ส่งใบใหม่ · บันทึกซ้ำเลนส์เดิมไม่ส่ง · คลังตัดแล้วเปลี่ยนไม่ได้', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $f = lrFixture($q);
        $r = tosReq($q, $f);
        LensRequisition::markUsed($q, $f['case'], null);
        TimeOpticRequests::sendForCase($q, $f['case'], null);
        $items = $q->all('SELECT lens_catalog_id FROM lens_requisition_items WHERE requisition_id = ?', (int) $r['id']);
        $cat   = (int) $items[0]['lens_catalog_id'];
        $posts = fn() => count(array_filter($seen(), fn($c) => $c['path'] === '/stock-api/issue-requests'));

        lrSync($f['order'], [
            ['eye' => 'R', 'lens_catalog_id' => $cat, 'unit_price' => 750],
            ['eye' => 'L', 'lens_catalog_id' => $cat, 'unit_price' => 750],
        ]);
        eq($posts(), 1, 'เลนส์เดิม ไม่ส่งซ้ำ');

        lrSync($f['order'], [['eye' => 'R', 'lens_catalog_id' => $cat, 'unit_price' => 750]]);
        eq($posts(), 2, 'เลนส์เปลี่ยน ส่งใบใหม่');
        ok(in_array('/stock-api/issue-requests/77/cancel', array_column($seen(), 'path'), true), 'ถอนคำขอเดิม');
        $sent = array_values(array_filter($seen(), fn($c) => $c['path'] === '/stock-api/issue-requests'))[1]['body'];
        eq($sent['body']['items'][0]['quantity'], 1, 'รายการใหม่ข้างเดียว');

        file_put_contents(tosServer()[1], 'approved');
        eq(lrStatusCode(fn() => lrSync($f['order'], [
            ['eye' => 'R', 'lens_catalog_id' => $cat, 'unit_price' => 750],
            ['eye' => 'L', 'lens_catalog_id' => $cat, 'unit_price' => 750],
        ])), 409, 'คลังตัดแล้ว เปลี่ยนไม่ได้');
    });
});

/** ใบสั่งตัด RX ในคลังของ Bewell ผูกกับออเดอร์ข้าง $side → inventory_logs.id */
function tosRx(Tx $q, int $order, string $side = 'r', string $sph = '-2.25'): int
{
    $cat = (int) $q->get('SELECT id FROM categories ORDER BY id LIMIT 1')['id'];
    $pid = (int) $q->run(
        "INSERT INTO products (sku, category_id, product_type, name, brand, is_custom_made) VALUES (?, ?, 'lens', ?, 'HOYA', 1)",
        'RXT-' . strtoupper(bin2hex(random_bytes(3))),
        $cat,
        'HOYA Nulux 1.60 RX test'
    )['insertId'];
    $log = (int) $q->run(
        "INSERT INTO inventory_logs (product_id, action_type, quantity, sale_price, reference_doc, created_at)
         VALUES (?, 'RX_ORDER', -1, 2500, ?, NOW())",
        $pid,
        'RX-T' . random_int(1000, 9999)
    )['insertId'];
    $q->run(
        'INSERT INTO rx_orders (log_id, eye_side, sph, cyl, axis, add_power, sale_price) VALUES (?, ?, ?, -0.50, 180, NULL, 2500)',
        $log,
        $side === 'r' ? 'right' : 'left',
        $sph
    );
    $q->run("UPDATE custom_orders SET lens_{$side}_rx_id = ? WHERE id = ?", $log, $order);
    return $log;
}

test('ยืนยันขาย: ใบสั่งตัด RX ส่งเป็นคำขอ kind = rx พร้อมค่าสายตา · กดซ้ำไม่ส่งซ้ำ', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $f = lrFixture($q);
        tosRx($q, $f['order'], 'r');
        eq(TimeOpticRx::sendForCase($q, $f['case'], null), [], 'ส่งผ่าน');
        TimeOpticRx::sendForCase($q, $f['case'], null);
        $posts = array_values(array_filter($seen(), fn($c) => $c['path'] === '/stock-api/issue-requests'));
        eq(count($posts), 1, 'ส่งครั้งเดียว');
        $b = $posts[0]['body'];
        eq([$b['kind'], $b['branch_id']], ['rx', 5335], 'ชนิด + สาขา');
        eq([$b['body']['brand'], $b['body']['eye_side'], $b['body']['sph'], $b['body']['axis']], ['HOYA', 'right', '-2.25', '180'], 'รายละเอียด');
        ok(str_contains($b['body']['lens_model'], 'Nulux'), 'รุ่นเลนส์');
        ok(str_contains($b['body']['note'], 'TEST-LR-'), 'หมายเหตุมีเลขเคส');
        $row = $q->get('SELECT req_code, status, active FROM timeoptic_rx_requests WHERE order_id = ?', $f['order']);
        eq([$row['req_code'], $row['status'], (int) $row['active']], ['REQ-00077', 'pending', 1], 'แถวคำขอ');
    });
});

test('RX: คลังล่มตอนยืนยันขาย — ไม่ขวาง ลงไทม์ไลน์ ไม่มีแถวคำขอ', function () {
    tosReset('down');
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        tosRx($q, $f['order'], 'l');
        eq(count(TimeOpticRx::sendForCase($q, $f['case'], null)), 1, 'หนึ่งข้างส่งไม่ผ่าน');
        eq($q->get('SELECT COUNT(*) AS n FROM timeoptic_rx_requests WHERE order_id = ?', $f['order'])['n'], 0, 'ไม่มีแถว');
        $ev = $q->get("SELECT action FROM case_events WHERE case_id = ? ORDER BY id DESC LIMIT 1", $f['case']);
        eq($ev['action'], 'rx_timeoptic_send_failed', 'ไทม์ไลน์');
    });
});

test('RX: ยกเลิก/เปลี่ยนใบสั่งหลังขาย = ถอนคำขอเดิม ส่งใบใหม่ · เปิดขั้นขาย = ถอน · ลบออเดอร์ = ถอน', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $f = lrFixture($q);
        $q->run("INSERT INTO case_processes (case_id, process, status, completed_at) VALUES (?, 'sales', 'completed', NOW())
                 ON DUPLICATE KEY UPDATE status = 'completed', completed_at = NOW()", $f['case']);
        $old = tosRx($q, $f['order'], 'r');
        TimeOpticRx::sendForCase($q, $f['case'], null);
        $q->run('UPDATE rx_orders SET cancelled_at = NOW() WHERE log_id = ?', $old);
        tosRx($q, $f['order'], 'r', '-3.00');
        TimeOpticRx::syncOrderTx($q, $f['order'], null);
        $cancels = fn() => count(array_filter($seen(), fn($c) => str_ends_with($c['path'], '/cancel')));
        $posts   = fn() => count(array_filter($seen(), fn($c) => $c['path'] === '/stock-api/issue-requests'));
        eq([$cancels(), $posts()], [1, 2], 'ถอนเดิม 1 ส่งใหม่ 1');
        eq($q->get('SELECT COUNT(*) AS n FROM timeoptic_rx_requests WHERE order_id = ? AND active = 1', $f['order'])['n'], 1, 'คำขอปัจจุบันใบเดียว');

        TimeOpticRx::withdrawForCase($q, $f['case'], null);
        eq($q->get('SELECT COUNT(*) AS n FROM timeoptic_rx_requests WHERE order_id = ? AND active = 1', $f['order'])['n'], 0, 'เปิดขั้นขาย = ถอน');
        TimeOpticRx::sendForCase($q, $f['case'], null);
        eq($posts(), 3, 'ยืนยันใหม่ส่งใบใหม่');

        TimeOpticRx::cancelFor($q, 'order', $f['order'], 'ลบออเดอร์', null);
        eq($q->get('SELECT COUNT(*) AS n FROM timeoptic_rx_requests WHERE order_id = ? AND active = 1', $f['order'])['n'], 0, 'ลบออเดอร์ = ถอน');
        eq($cancels(), 3, 'ยกเลิกในคลังครบ');
    });
});

test('RX: บันทึกออเดอร์ของเคสที่ยังไม่ขาย ไม่ส่ง', function () {
    $seen = tosReset();
    rollback(function (Tx $q) use ($seen) {
        $f = lrFixture($q);
        tosRx($q, $f['order'], 'r');
        TimeOpticRx::syncOrderTx($q, $f['order'], null);
        eq($seen(), [], 'ไม่มีคำขอออกไป');
    });
});

test('ไม่ได้ตั้งค่าการเชื่อม = ใบเบิกทำงานแบบเดิม ไม่ยิงอะไรออกไป', function () {
    $seen = tosReset();
    tosOff();
    try {
        rollback(function (Tx $q) use ($seen) {
            $r = tosReq($q, lrFixture($q));
            $after = lrStatus((int) $r['id'], 'issued');
            eq($after['status'], 'issued', 'สถานะ');
            eq($after['timeoptic_req_id'], null, 'ไม่มีเลขคำขอ');
            eq($seen(), [], 'ไม่มีคำขอออกไป');
        });
    } finally {
        tosOff(); // ไฟล์เทสต์ถัดไปต้องไม่เห็นคลังปลอม
    }
});
