<?php
/** Shop + Telegram settings, the notification log, and the reminder trigger. */
declare(strict_types=1);

GET('/api/settings', function () {
    $s     = Telegram::settings(true);
    $token = (string) ($s['telegram_bot_token'] ?? '');

    // array_merge, not `+` — the union operator keeps the left-hand value, so
    // the raw token would survive and be handed to the browser
    return array_merge($s, [
        'telegram_bot_token'      => $token !== '' ? '••••••' . substr($token, -4) : '',
        'telegram_configured'     => Telegram::isConfigured(),
        'telegram_token_from_env' => getenv('TELEGRAM_BOT_TOKEN') !== false
            && getenv('TELEGRAM_BOT_TOKEN') !== '',
    ]);
});

PUT('/api/settings', function (array $req) {
    $body    = $req['body'];
    $allowed = ['telegram_enabled', 'telegram_chat_id', 'reminder_default_minutes',
        'shop_name', 'shop_open_time', 'shop_close_time', 'slot_minutes'];

    $patch = [];
    foreach ($allowed as $k) {
        if (array_key_exists($k, $body)) {
            $patch[$k] = $body[$k];
        }
    }
    $tok = str_or($body['telegram_bot_token'] ?? null);
    if ($tok !== '' && !str_starts_with($tok, '••••')) {
        // keep the old token unless a real replacement was typed
        $patch['telegram_bot_token'] = $tok;
    }
    Telegram::saveSettings($patch);
    return Router::dispatch('GET', '/api/settings');
});

POST('/api/settings/telegram/test', function (array $req) {
    $body = $req['body'];
    $tok  = str_or($body['telegram_bot_token'] ?? null);
    if ($tok !== '' && !str_starts_with($tok, '••••')) {
        Telegram::saveSettings(['telegram_bot_token' => $tok]);
    }
    if (str_or($body['telegram_chat_id'] ?? null) !== '') {
        Telegram::saveSettings(['telegram_chat_id' => str_or($body['telegram_chat_id'])]);
    }

    try {
        $bot = Telegram::verifyBot();
    } catch (Throwable $e) {
        bad('ตรวจสอบ bot token ไม่ผ่าน: ' . $e->getMessage());
    }

    $res = Telegram::send(
        "✅ <b>ทดสอบการเชื่อมต่อสำเร็จ</b>\nTimeOptic พร้อมส่งแจ้งเตือนคิวลูกค้าแล้ว",
        ['kind' => 'test', 'force' => true]
    );
    if (!$res['ok']) {
        bad($res['error'] ?? 'ส่งข้อความทดสอบไม่สำเร็จ');
    }
    return [
        'ok'  => true,
        'bot' => [
            'username'   => $bot['username'] ?? null,
            'first_name' => $bot['first_name'] ?? null,
        ],
    ];
});

GET('/api/notifications', fn(array $r) => Db::all(
    'SELECT n.*, b.booking_code FROM notification_log n
       LEFT JOIN bookings b ON b.id = n.booking_id
      ORDER BY n.created_at DESC LIMIT ?',
    min(int_or($r['query']['limit'] ?? null, 100), 500)
));

POST('/api/reminders/run', fn() => Scheduler::runOnce());

/**
 * คำค้นที่ใช้จัดประเภทเคสจากโน้ต — แก้ได้โดยไม่ต้องแตะโค้ด (สเปกข้อ 6)
 *
 * อยู่ใต้ `/api/settings` ซึ่งอ่านได้ทุกคนแต่เขียนได้เฉพาะแอดมิน (ประตูที่สองใน
 * index.php กันด้วยคำนำหน้าเส้นทาง + เมธอด) — คนหน้าร้านจึงเห็นว่าระบบใช้คำอะไร
 * ตัดสิน แต่แก้ไม่ได้
 */
GET('/api/settings/case-keywords', fn() => [
    'keywords' => CaseSource::keywords(),
    'defaults' => CaseSource::DEFAULTS,
    'labels'   => (object) CaseSource::LABELS,
    /* บอกด้วยว่าคำชุดนี้ตอนนี้จับได้กี่เคส — เปลี่ยนคำแล้วเห็นผลทันทีโดยไม่ต้อง
       ไปรัน CLI ก่อน · คำกว้างไปคำเดียวทำให้ตัวเลข "ออนไลน์" พุ่งขึ้นให้เห็น
       ก่อนที่จะมีใครสั่งลบ */
    'preview'  => CaseSource::tally(),
]);

PUT('/api/settings/case-keywords', function (array $req) {
    $body = $req['body'];
    $patch = [];
    foreach (array_keys(CaseSource::SETTING_KEYS) as $type) {
        if (array_key_exists($type, $body)) {
            $patch[$type] = $body[$type];
        }
    }
    if (!$patch) {
        bad('ไม่มีคำค้นที่จะบันทึก');
    }
    return ['keywords' => CaseSource::saveKeywords($patch), 'preview' => CaseSource::tally()];
});
