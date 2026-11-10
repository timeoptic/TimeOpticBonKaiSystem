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
