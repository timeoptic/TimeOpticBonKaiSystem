<?php

declare(strict_types=1);

/**
 * ปุ่ม "ส่งรูป" ของขั้นวัด Center — ส่งรูปการวัด + หมายเหตุ เข้ากลุ่ม Telegram "รูปวัด Center"
 *
 * **ไม่มีเทสต์ตัวไหนในไฟล์นี้ยิงเข้ากลุ่มจริง** (กติกาเดียวกับ 70-notifications)
 * ทุกตัวหยุดที่ฟังก์ชันตัดสินใจ หรือหยุดที่ด่านที่ปฏิเสธก่อนถึง HTTP
 * เทสต์ของด่านหลัง ๆ (ล็อกกันส่งซ้ำ, ยังไม่ได้ตั้งกลุ่ม) ล้างค่ากลุ่มรูปวัด Center
 * ใน transaction ไว้ก่อนเสมอ ถ้าด่านไหนพังจะได้ตกที่ "ยังไม่ได้ตั้งค่า" ไม่ใช่ส่งออกไปจริง
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('ส่งรูปวัด Center เข้า Telegram');

/** เคสหนึ่งใบพร้อมลูกค้า */
function sendCase(Tx $q): array
{
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'ส่งรูป',
        '0000000000'
    )['insertId'];
    $code = 'TEST-SEND-' . bin2hex(random_bytes(4));
    $id = $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        $code,
        $cust,
        'centering',
        'new_glasses'
    )['insertId'];

    return ['id' => (int) $id, 'code' => $code];
}

/** แถวไฟล์ของเคส หนึ่งแถวต่อ mime — คืน id เรียงตามที่ส่งมา */
function sendPhotoRows(Tx $q, int $caseId, array $mimes, string $kind = 'centering'): array
{
    $ids = [];
    foreach ($mimes as $i => $mime) {
        $ids[] = (int) $q->run(
            'INSERT INTO case_photos (case_id, kind, file_name, mime_type) VALUES (?,?,?,?)',
            $caseId,
            $kind,
            'test_send_' . $i . '_' . bin2hex(random_bytes(3)) . ($mime === 'application/pdf' ? '.pdf' : '.jpg'),
            $mime
        )['insertId'];
    }
    return $ids;
}

/** วางไฟล์จริงลงดิสก์ให้แถวรูปของเคส — ด่าน "ไฟล์หาย" จะได้ผ่าน */
function sendPhotoFiles(Tx $q, int $caseId): void
{
    foreach ($q->all('SELECT file_name FROM case_photos WHERE case_id = ?', $caseId) as $p) {
        file_put_contents(uploadDir($caseId) . '/' . $p['file_name'], 'x');
    }
}

function sendPhotoFilesCleanup(int $caseId): void
{
    $dir = dirname(__DIR__) . "/uploads/$caseId";
    foreach (glob("$dir/test_send_*") ?: [] as $f) {
        unlink($f);
    }
    if (is_dir($dir) && (scandir($dir) ?: []) === ['.', '..']) {
        rmdir($dir);
    }
}

/**
 * ค่า Telegram ของการทดสอบ — ทับทุกคีย์ของทุกปลายทางใน transaction
 * `configure([])` ล้างค่าที่ .env ทับไว้ ไม่งั้น token จริงใน .env จะชนะค่าที่ตั้งตรงนี้
 */
function sendTelegramSettings(Tx $q, array $kv): void
{
    Telegram::configure([]);
    foreach (Telegram::TARGETS as $t) {
        $kv += [$t['token'] => '', $t['chat'] => ''];
    }
    foreach ($kv as $k => $v) {
        $q->run(
            'INSERT INTO app_settings (`key`, `value`) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
            $k,
            $v
        );
    }
    Telegram::invalidate();
}

/** เจ้าของร้านตัวจริงจากฐาน — เส้นทางนี้ต้องรู้ว่าใครเป็นคนกดส่ง */
function sendActor(): array
{
    $r = Db::get(
        "SELECT a.id, a.username, a.display_name, a.employee_id
           FROM admins a JOIN admin_roles r ON r.admin_id = a.id
          WHERE r.role = 'owner' AND a.is_active = 1 LIMIT 1"
    );
    if (!$r) {
        failTest('ไม่มีบัญชี owner ในฐาน');
    }
    $roles = \Optic\Auth::rolesOf((int) $r['id']);
    return [
        'id'          => (int) $r['id'],
        'username'    => $r['username'],
        'displayName' => $r['display_name'],
        'roles'       => $roles,
        'perms'       => \Optic\Roles::permsOf($roles),
        'employeeId'  => $r['employee_id'] === null ? null : (int) $r['employee_id'],
    ];
}

/** @return array{status:?int, reason:?string, msg:string} */
function sendRouteError(array $body): array
{
    StockModule::boot();
    try {
        \Optic\Auth::as(sendActor(), fn() => Router::dispatch('POST', '/api/centering-photos/send', [], $body));
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null, 'msg' => $e->getMessage()];
    }
    return ['status' => null, 'reason' => null, 'msg' => ''];
}

/* ------------------------------------------------------------------ *
 * ข้อความและการแบ่งไฟล์
 * ------------------------------------------------------------------ */

test('ข้อความสรุปมีรหัสเคส ชื่อลูกค้า จำนวนรูป หมายเหตุ ผู้ส่ง และเวลาส่ง', function () {
    $text = Telegram::centeringPhotosMessage([
        'case_code' => 'CASE-2026-00001',
        'customer'  => 'สมชาย ใจดี',
        'count'     => 5,
        'note'      => "ลูกค้าใช้สายตาข้างขวาเป็นหลัก\nปรับความโค้งขาแว่นก่อนวัด",
        'sent_by'   => 'Tik',
        'sent_at'   => '2026-09-15 10:30:00',
    ]);
    foreach (['CASE-2026-00001', 'สมชาย ใจดี', '5 รูป', 'ลูกค้าใช้สายตาข้างขวาเป็นหลัก',
        'ปรับความโค้งขาแว่นก่อนวัด', 'Tik', '15 ก.ย. 2569', '10:30'] as $part) {
        ok(str_contains($text, $part), "ข้อความต้องมี \"$part\" — ได้:\n$text");
    }
});

test('ไม่มีหมายเหตุ ข้อความเขียนว่า "ไม่มีหมายเหตุ"', function () {
    $text = Telegram::centeringPhotosMessage([
        'case_code' => 'CASE-2026-00002', 'customer' => 'ก ข', 'count' => 1,
        'note' => null, 'sent_by' => 'Tik', 'sent_at' => '2026-09-15 10:30:00',
    ]);
    ok(str_contains($text, 'ไม่มีหมายเหตุ'), "ข้อความต้องบอกว่าไม่มีหมายเหตุ — ได้:\n$text");
});

/* ข้อความส่งแบบ parse_mode HTML — "<" ในหมายเหตุที่ไม่ได้ escape ทำให้ Telegram
   ปฏิเสธทั้งข้อความ ("can't parse entities") รูปทั้งชุดจะส่งไม่ออกเพราะหมายเหตุบรรทัดเดียว */
test('เครื่องหมาย < > & ในหมายเหตุไม่กลายเป็นแท็ก HTML', function () {
    $text = Telegram::centeringPhotosMessage([
        'case_code' => 'CASE-2026-00003', 'customer' => 'ก ข', 'count' => 2,
        'note' => 'PD <32 & FH>18', 'sent_by' => 'Tik', 'sent_at' => '2026-09-15 10:30:00',
    ]);
    ok(str_contains($text, 'PD &lt;32 &amp; FH&gt;18'), "หมายเหตุต้องถูก escape — ได้:\n$text");
});

test('รูปหลายใบไปเป็นอัลบั้มเดียว ไฟล์ PDF ส่งแยกทีละไฟล์', function () {
    $plan = Telegram::mediaPlan([
        ['id' => 11, 'mime_type' => 'image/jpeg'],
        ['id' => 12, 'mime_type' => 'application/pdf'],
        ['id' => 13, 'mime_type' => 'image/png'],
        ['id' => 14, 'mime_type' => 'image/webp'],
    ]);
    eq($plan, [
        ['method' => 'sendMediaGroup', 'ids' => [11, 13, 14]],
        ['method' => 'sendDocument', 'ids' => [12]],
    ], 'แผนการส่ง');
});

/* sendMediaGroup รับ 2–10 ชิ้น — รูปใบเดียวส่งด้วยเส้นนี้จะโดนปฏิเสธ */
test('รูปใบเดียวใช้ sendPhoto ไม่ใช่อัลบั้ม', function () {
    eq(Telegram::mediaPlan([['id' => 21, 'mime_type' => 'image/jpeg']]), [
        ['method' => 'sendPhoto', 'ids' => [21]],
    ], 'แผนการส่งรูปใบเดียว');
});

/* เคสเก่ามีรูปวัดเกิน 10 ใบมาก่อนวันบังคับลิมิต — อัลบั้มเดียวรับได้แค่ 10 */
test('รูป 11 ใบแบ่งเป็นอัลบั้ม 10 ใบ แล้วตามด้วยรูปเดี่ยว', function () {
    $rows = [];
    for ($i = 1; $i <= 11; $i++) {
        $rows[] = ['id' => $i, 'mime_type' => 'image/jpeg'];
    }
    eq(Telegram::mediaPlan($rows), [
        ['method' => 'sendMediaGroup', 'ids' => range(1, 10)],
        ['method' => 'sendPhoto', 'ids' => [11]],
    ], 'แผนการส่งรูป 11 ใบ');
});

/* ------------------------------------------------------------------ *
 * ปลายทาง
 * ------------------------------------------------------------------ */

/* ปลายทางอื่นตั้งไม่ครบแล้วตกกลับไปกลุ่มคิวลูกค้า แต่รูปวัดของลูกค้าห้ามไปโผล่ในกลุ่มนั้น */
test('กลุ่มรูปวัด Center ยังไม่ได้ตั้ง ไม่ตกกลับไปกลุ่มคิวลูกค้า', function () {
    rollback(function (Tx $q) {
        sendTelegramSettings($q, ['telegram_bot_token' => '1:main', 'telegram_chat_id' => '-100']);
        $c = Telegram::credentials('centering');
        eq($c['token'], '', 'token ของกลุ่มรูปวัด');
        eq($c['chat'], '', 'chat ของกลุ่มรูปวัด');
        eq($c['fell_back'], false, 'ตกกลับไปกลุ่มหลัก');
        eq(Telegram::isConfigured('centering'), false, 'ถือว่าตั้งค่าแล้ว');
        /* ของเดิมยังตกกลับเหมือนเดิม */
        eq(Telegram::credentials('digest')['fell_back'], true, 'รายงานส่งมอบตกกลับไปกลุ่มหลัก');
    });
    Telegram::invalidate();
});

test('ตั้งกลุ่มรูปวัด Center ครบคู่ ได้ token กับ chat ของกลุ่มนั้น', function () {
    rollback(function (Tx $q) {
        sendTelegramSettings($q, [
            'telegram_bot_token' => '1:main', 'telegram_chat_id' => '-100',
            'centering_telegram_bot_token' => '2:center', 'centering_telegram_chat_id' => '-555',
        ]);
        $c = Telegram::credentials('centering');
        eq([$c['token'], $c['chat']], ['2:center', '-555'], 'token/chat ของกลุ่มรูปวัด');
    });
    Telegram::invalidate();
});

test('หน้าตั้งค่าเห็นปลายทางรูปวัด Center ว่าไม่ตกกลับ และไม่ใช่ตัวเลือกของสรุปคิวส่งมอบ', function () {
    rollback(function (Tx $q) {
        sendTelegramSettings($q, []);
        $s = Router::dispatch('GET', '/api/settings');
        $byKey = array_column($s['telegram_targets'], null, 'key');
        ok(isset($byKey['centering']), 'ต้องมีปลายทาง centering ในรายการ');
        eq($byKey['centering']['label'], 'รูปวัด Center', 'ชื่อปลายทาง');
        eq($byKey['centering']['fallback'], false, 'ปลายทางรูปวัดตกกลับได้');
        eq($byKey['centering']['digest'], false, 'ปลายทางรูปวัดเลือกเป็นกลุ่มสรุปคิวส่งมอบได้');
        eq($byKey['digest']['digest'], true, 'กลุ่มรายงานส่งมอบยังเลือกได้');
    });
    Telegram::invalidate();
});

test('ตั้งกลุ่มสรุปคิวส่งมอบเป็นรูปวัด Center ไว้ ระบบใช้กลุ่มรายงานส่งมอบแทน', function () {
    rollback(function (Tx $q) {
        sendTelegramSettings($q, ['delivery_digest_target' => 'centering']);
        eq(DeliveryDigest::target(), 'digest', 'ปลายทางของสรุปคิวส่งมอบ');
    });
    Telegram::invalidate();
});

/* ------------------------------------------------------------------ *
 * ด่านของเส้นทาง POST /api/centering-photos/send
 * ------------------------------------------------------------------ */

test('เคสไม่มีอยู่ ตอบ 404', function () {
    rollback(function (Tx $q) {
        $r = sendRouteError(['case_id' => 999999999, 'case_code' => 'X', 'photo_ids' => [1]]);
        eq($r['status'], 404, 'สถานะ');
    });
});

test('ยังไม่มีรูปวัด ตอบ 400 "กรุณาเพิ่มรูปภาพก่อนส่ง"', function () {
    rollback(function (Tx $q) {
        $case = sendCase($q);
        sendPhotoRows($q, $case['id'], ['image/jpeg'], 'payment');
        $r = sendRouteError(['case_id' => $case['id'], 'case_code' => $case['code'], 'photo_ids' => []]);
        eq([$r['status'], $r['reason']], [400, 'no_photos'], 'สถานะ/เหตุผล');
        eq($r['msg'], 'กรุณาเพิ่มรูปภาพก่อนส่ง', 'ข้อความ');
    });
});

test('หน้าจอเปิดเคสอื่นค้างไว้ (รหัสเคสไม่ตรง) ตอบ 409', function () {
    rollback(function (Tx $q) {
        $case = sendCase($q);
        $ids = sendPhotoRows($q, $case['id'], ['image/jpeg']);
        $r = sendRouteError(['case_id' => $case['id'], 'case_code' => 'CASE-อื่น', 'photo_ids' => $ids]);
        eq([$r['status'], $r['reason']], [409, 'case_changed'], 'สถานะ/เหตุผล');
    });
});

test('มีคนเพิ่มรูปหลังเปิด popup (รูปในเคสไม่ตรงกับที่ตรวจ) ตอบ 409', function () {
    rollback(function (Tx $q) {
        $case = sendCase($q);
        $ids = sendPhotoRows($q, $case['id'], ['image/jpeg', 'image/jpeg', 'image/png']);
        $r = sendRouteError(['case_id' => $case['id'], 'case_code' => $case['code'], 'photo_ids' => [$ids[0], $ids[1]]]);
        eq([$r['status'], $r['reason']], [409, 'photos_changed'], 'สถานะ/เหตุผล');
    });
});

test('ส่ง id ของสลิปโอนเงินปนมา ตอบ 409 ไม่ส่งไฟล์ที่ไม่ใช่รูปวัด', function () {
    rollback(function (Tx $q) {
        $case = sendCase($q);
        $mine = sendPhotoRows($q, $case['id'], ['image/jpeg']);
        $slip = sendPhotoRows($q, $case['id'], ['image/jpeg'], 'payment');
        $r = sendRouteError([
            'case_id' => $case['id'], 'case_code' => $case['code'], 'photo_ids' => [$mine[0], $slip[0]],
        ]);
        eq([$r['status'], $r['reason']], [409, 'photos_changed'], 'สถานะ/เหตุผล');
    });
});

test('ไฟล์รูปหายจากดิสก์ ตอบ 409 ก่อนส่งอะไรออกไป', function () {
    rollback(function (Tx $q) {
        $case = sendCase($q);
        $ids = sendPhotoRows($q, $case['id'], ['image/jpeg', 'image/jpeg']);
        $r = sendRouteError(['case_id' => $case['id'], 'case_code' => $case['code'], 'photo_ids' => $ids]);
        eq([$r['status'], $r['reason']], [409, 'file_missing'], 'สถานะ/เหตุผล');
    });
});

/* กดยืนยันซ้ำจากอีกเครื่อง / อีกแท็บ ระหว่างที่รอบแรกยังคุยกับ Telegram อยู่
   ตัวล็อกถืออยู่ในอีก connection หนึ่ง เหมือนคำขออีกตัวที่ยังทำงานไม่จบ */
test('มีการส่งของเคสนี้ค้างอยู่ ตอบ 409 ไม่ส่งซ้ำ', function () {
    global $config;
    $caseId = null;
    try {
        rollback(function (Tx $q) use ($config, &$caseId) {
            sendTelegramSettings($q, []);
            $case = sendCase($q);
            $caseId = $case['id'];
            $ids = sendPhotoRows($q, $case['id'], ['image/jpeg', 'image/jpeg']);
            sendPhotoFiles($q, $case['id']);

            $c = $config['db'];
            $other = new PDO(
                sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $c['host'], $c['port'], $c['database'], $c['charset']),
                $c['user'],
                $c['password']
            );
            $got = $other->query('SELECT GET_LOCK(' . $other->quote(centeringSendLock($case['id'])) . ', 0)')->fetchColumn();
            eq((int) $got, 1, 'อีก connection ถือล็อกได้');

            $r = sendRouteError(['case_id' => $case['id'], 'case_code' => $case['code'], 'photo_ids' => $ids]);
            eq([$r['status'], $r['reason']], [409, 'sending'], 'สถานะ/เหตุผล');
            $other = null;
        });
    } finally {
        Telegram::invalidate();
        if ($caseId) {
            sendPhotoFilesCleanup($caseId);
        }
    }
});

test('ยังไม่ได้ตั้งกลุ่มรูปวัด Center ตอบ 400 และไม่ส่งเข้ากลุ่มอื่นแทน', function () {
    $caseId = null;
    try {
        rollback(function (Tx $q) use (&$caseId) {
            sendTelegramSettings($q, ['telegram_bot_token' => '1:main', 'telegram_chat_id' => '-100']);
            $case = sendCase($q);
            $caseId = $case['id'];
            $ids = sendPhotoRows($q, $case['id'], ['image/jpeg']);
            sendPhotoFiles($q, $case['id']);
            $r = sendRouteError(['case_id' => $case['id'], 'case_code' => $case['code'], 'photo_ids' => $ids]);
            eq([$r['status'], $r['reason']], [400, 'not_configured'], 'สถานะ/เหตุผล');
        });
    } finally {
        Telegram::invalidate();
        if ($caseId) {
            sendPhotoFilesCleanup($caseId);
        }
    }
});

/* ------------------------------------------------------------------ *
 * บันทึกการส่งลงไทม์ไลน์ของเคส
 * ------------------------------------------------------------------ */

test('ส่งสำเร็จ ไทม์ไลน์เคสเก็บ caseId, caseNumber, centerImages, centerNote, sentBy, sentAt', function () {
    rollback(function (Tx $q) {
        $case = sendCase($q);
        centeringSendRecord($q, [
            'case_id'   => $case['id'],
            'case_code' => $case['code'],
            'photo_ids' => [31, 30],
            'note'      => 'ปรับขาแว่นก่อนวัด',
            'actor'     => ['id' => 7, 'displayName' => 'Tik', 'employeeId' => null],
            'sent_at'   => '2026-09-15 10:30:00',
            'ok'        => true,
            'error'     => null,
        ]);
        $ev = $q->get('SELECT * FROM case_events WHERE case_id = ? ORDER BY id DESC LIMIT 1', $case['id']);
        eq($ev['action'] ?? null, 'centering_photos_sent', 'action');
        eq(json_decode((string) $ev['payload'], true), [
            'caseId'       => $case['id'],
            'caseNumber'   => $case['code'],
            'centerImages' => [31, 30],
            'centerNote'   => 'ปรับขาแว่นก่อนวัด',
            'sentBy'       => ['id' => 7, 'name' => 'Tik'],
            'sentAt'       => '2026-09-15 10:30:00',
            'ok'           => true,
            'error'        => null,
        ], 'payload');
    });
});

test('ส่งไม่สำเร็จ ไทม์ไลน์ลงเป็นการส่งที่ล้มพร้อมสาเหตุ', function () {
    rollback(function (Tx $q) {
        $case = sendCase($q);
        centeringSendRecord($q, [
            'case_id' => $case['id'], 'case_code' => $case['code'], 'photo_ids' => [1],
            'note' => null, 'actor' => ['id' => 7, 'displayName' => 'Tik', 'employeeId' => null],
            'sent_at' => '2026-09-15 10:30:00', 'ok' => false, 'error' => 'หมดเวลาเชื่อมต่อ Telegram',
        ]);
        $ev = $q->get('SELECT * FROM case_events WHERE case_id = ? ORDER BY id DESC LIMIT 1', $case['id']);
        eq($ev['action'] ?? null, 'centering_photos_send_failed', 'action');
        eq(json_decode((string) $ev['payload'], true)['error'] ?? null, 'หมดเวลาเชื่อมต่อ Telegram', 'สาเหตุ');
    });
});
