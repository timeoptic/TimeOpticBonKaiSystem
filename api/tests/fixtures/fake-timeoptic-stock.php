<?php

declare(strict_types=1);

/**
 * คลัง TimeOptic ปลอม สำหรับ 98-lens-timeoptic.test.php — รันด้วย `php -S` ไม่แตะเว็บจริง
 *
 * จำทุกคำขอที่เข้ามาลงไฟล์ FAKE_TOS_LOG (หนึ่งบรรทัด JSON ต่อคำขอ) ให้เทสต์อ่านย้อนดู
 * พฤติกรรมเลือกผ่านไฟล์ FAKE_TOS_MODE: ok | login_fail | down | approved
 */

$log  = getenv('FAKE_TOS_LOG') ?: sys_get_temp_dir() . '/fake-tos.log';
$mode = trim((string) @file_get_contents(getenv('FAKE_TOS_MODE') ?: sys_get_temp_dir() . '/fake-tos.mode')) ?: 'ok';
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$body = json_decode((string) file_get_contents('php://input'), true);

file_put_contents($log, json_encode([
    'method' => $_SERVER['REQUEST_METHOD'],
    'path'   => $path,
    'query'  => $_SERVER['QUERY_STRING'] ?? '',
    'cookie' => $_COOKIE['sid'] ?? null,
    'body'   => $body,
], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);

header('Content-Type: application/json');

function out(int $code, array $v): never
{
    http_response_code($code);
    echo json_encode($v, JSON_UNESCAPED_UNICODE);
    exit;
}

$req = static fn(int $id, string $status, array $extra = []) => array_replace([
    'id' => $id, 'code' => sprintf('REQ-%05d', $id), 'status' => $status,
    'body' => [], 'original' => [], 'edited' => false, 'result' => [], 'rejectReason' => null, 'undone' => null,
], $extra);

if ($mode === 'down') {
    out(503, ['reason' => 'down', 'message' => 'ปิดปรับปรุง']);
}
if ($path === '/stock-api/auth/login') {
    if ($mode === 'login_fail' || ($body['username'] ?? '') !== 'bewell-bot') {
        out(401, ['reason' => 'bad_credentials', 'message' => 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง']);
    }
    setcookie('sid', 'S1', ['path' => '/']);
    out(200, ['actor' => ['id' => 900]]);
}
if (($_COOKIE['sid'] ?? '') !== 'S1') {
    out(401, ['reason' => 'unauthenticated', 'message' => 'ต้องล็อกอินก่อน']);
}
if ($path === '/stock-api/issue-requests' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (($body['branch_id'] ?? null) !== 5335) {
        out(400, ['reason' => 'branch_excluded', 'message' => 'สาขานี้ส่งคำขอไม่ได้']);
    }
    out(200, ['request' => $req(77, 'pending')]);
}
if (preg_match('#^/stock-api/issue-requests/(\d+)/cancel$#', $path, $m)) {
    if ($mode === 'approved') {
        out(409, ['reason' => 'not_pending', 'message' => 'คำขอนี้ถูกตรวจไปแล้ว']);
    }
    out(200, ['request' => $req((int) $m[1], 'cancelled')]);
}
if ($path === '/stock-api/issue-requests/mine' && $mode === 'partial') {
    /* คลังของไม่พอ — ตัดไปตัวเดียว อีกตัวรอของ */
    out(200, ['requests' => [
        $req(77, 'approved', [
            'result'  => ['referenceDoc' => 'REQ-00077', 'lines' => [['sku' => 'LNS-C', 'quantity' => 1]]],
            'waiting' => [['sku' => 'LNS-W', 'quantity' => 1, 'name' => 'ตัวที่หมด', 'onHand' => 0, 'available' => 0]],
        ]),
    ]]);
}
if ($path === '/stock-api/issue-requests/mine') {
    out(200, ['requests' => [
        $req(77, 'approved', ['result' => ['referenceDoc' => 'REQ-00077']]),
        $req(78, 'rejected', ['rejectReason' => 'ของหมด']),
    ]]);
}
out(404, ['reason' => 'not_found', 'message' => "ไม่พบเส้นทาง $path"]);
