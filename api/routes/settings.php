<?php
/** Shop + Telegram settings, the notification log, and the reminder trigger. */
declare(strict_types=1);

/** ค่าที่ตั้งผ่าน .env ล็อกช่องในหน้าเว็บไว้ — คนแก้จะได้รู้ว่าไปแก้ที่ไหน */
function pinnedToEnv(string $name): bool
{
    return getenv($name) !== false && getenv($name) !== '';
}

GET('/api/settings', function () {
    $s = Telegram::settings(true);

    /* ค่าตั้งต้นของสรุปคิวส่งมอบ — เติมให้เฉพาะคีย์ที่ยังไม่เคยถูกบันทึก
       (`+` เก็บค่าฝั่งซ้ายไว้ ซึ่งตรงกันข้ามกับ array_merge ข้างล่าง)
       ไม่งั้นหน้าตั้งค่าจะขึ้นช่องเวลาว่าง ทั้งที่ระบบใช้ 19:00 อยู่จริง */
    $s += DeliveryDigest::DEFAULTS;

    /* ปลายทางทั้งหมด — หน้าตั้งค่าวาดตัวสลับจากรายการนี้ ไม่ได้พิมพ์ชื่อไว้เอง
       เพิ่มปลายทางที่ Telegram::TARGETS แล้วหน้าเว็บขึ้นตามโดยไม่ต้องแก้ */
    $targets = [];
    $mask    = [];
    foreach (Telegram::TARGETS as $key => $t) {
        $token = (string) ($s[$t['token']] ?? '');
        // แสดงแค่สี่ตัวท้าย พอให้คนดูแลแยกออกว่าเป็นบอทตัวไหน แต่ก็อปไปใช้ไม่ได้
        $mask[$t['token']] = $token !== '' ? '••••••' . substr($token, -4) : '';
        $targets[] = [
            'key'             => $key,
            'label'           => $t['label'],
            'token_key'       => $t['token'],
            'chat_key'        => $t['chat'],
            'token_env'       => $t['env']['token'],
            'chat_env'        => $t['env']['chat'],
            'token_from_env'  => pinnedToEnv($t['env']['token']),
            'chat_from_env'   => pinnedToEnv($t['env']['chat']),
            'configured'      => Telegram::isConfigured($key),
            'fell_back'       => Telegram::credentials($key)['fell_back'],
        ];
    }

    // array_merge, not `+` — the union operator keeps the left-hand value, so
    // the raw token would survive and be handed to the browser
    return array_merge($s, $mask, [
        'telegram_configured'     => Telegram::isConfigured(),
        'telegram_token_from_env' => pinnedToEnv('TELEGRAM_BOT_TOKEN'),
        'telegram_targets'        => $targets,
    ]);
});

PUT('/api/settings', function (array $req) {
    $body    = $req['body'];
    $allowed = ['telegram_enabled', 'reminder_default_minutes',
        'shop_name', 'shop_open_time', 'shop_close_time', 'slot_minutes',
        'delivery_digest_enabled', 'delivery_digest_time', 'delivery_digest_overdue_days',
        'delivery_digest_target'];

    /* chat id ของทุกปลายทางแก้ได้ตามปกติ ส่วน token ต้องผ่านด่านกันค่า mask ข้างล่าง */
    foreach (Telegram::TARGETS as $t) {
        $allowed[] = $t['chat'];
    }

    $patch = [];
    foreach ($allowed as $k) {
        if (array_key_exists($k, $body)) {
            $patch[$k] = $body[$k];
        }
    }
    foreach (Telegram::TARGETS as $t) {
        $tok = str_or($body[$t['token']] ?? null);
        if ($tok !== '' && !str_starts_with($tok, '••••')) {
            // keep the old token unless a real replacement was typed
            $patch[$t['token']] = $tok;
        }
    }
    Telegram::saveSettings($patch);
    return Router::dispatch('GET', '/api/settings');
});

POST('/api/settings/telegram/test', function (array $req) {
    $body   = $req['body'];
    $target = Telegram::target(str_or($body['target'] ?? null) ?: Telegram::MAIN);
    $keys   = Telegram::TARGETS[$target];

    $tok = str_or($body[$keys['token']] ?? $body['telegram_bot_token'] ?? null);
    if ($tok !== '' && !str_starts_with($tok, '••••')) {
        Telegram::saveSettings([$keys['token'] => $tok]);
    }
    $chat = str_or($body[$keys['chat']] ?? $body['telegram_chat_id'] ?? null);
    if ($chat !== '') {
        Telegram::saveSettings([$keys['chat'] => $chat]);
    }

    try {
        $bot = Telegram::verifyBot($target);
    } catch (Throwable $e) {
        bad('ตรวจสอบ bot token ไม่ผ่าน: ' . $e->getMessage());
    }

    $res = Telegram::send(
        "✅ <b>ทดสอบการเชื่อมต่อสำเร็จ</b>\nกลุ่มนี้คือปลายทาง <b>" . $keys['label'] . '</b>',
        ['kind' => 'test', 'force' => true, 'target' => $target]
    );
    if (!$res['ok']) {
        bad($res['error'] ?? 'ส่งข้อความทดสอบไม่สำเร็จ');
    }
    return [
        'ok'     => true,
        'target' => $target,
        'label'  => $keys['label'],
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
 * ปุ่ม "ส่งสรุปทดสอบ" ในหน้าตั้งค่า
 *
 * force = ข้ามทั้งสวิตช์และนาฬิกา และ **ไม่** ปักวันว่าส่งแล้ว — กดดูตอนบ่าย
 * แล้วรอบหนึ่งทุ่มยังมาตามปกติ ไม่งั้นการกดทดสอบจะกลืนสรุปของวันนั้นไปเงียบ ๆ
 */
POST('/api/delivery-digest/run', fn() => DeliveryDigest::runOnce(['force' => true]));

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
