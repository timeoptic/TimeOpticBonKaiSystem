<?php
/** Shop + Telegram settings, the notification log, and the reminder trigger. */
declare(strict_types=1);

GET('/api/settings', function () {
    $s     = Telegram::settings(true);
    $token = (string) ($s['telegram_bot_token'] ?? '');

    return $s + [
        // never hand the raw token back to the browser
        'telegram_bot_token'     => $token !== '' ? '••••••' . substr($token, -4) : '',
        'telegram_configured'    => Telegram::isConfigured(),
        'telegram_token_from_env' => getenv('TELEGRAM_BOT_TOKEN') !== false
            && getenv('TELEGRAM_BOT_TOKEN') !== '',
    ];
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
