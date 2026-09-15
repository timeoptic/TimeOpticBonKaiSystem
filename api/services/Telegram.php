<?php
/**
 * Telegram notifications.
 *
 * send() never throws — it returns ['ok' => bool, 'error' => ?string] and
 * always writes a notification_log row so failures stay visible in the UI.
 */
declare(strict_types=1);

final class Telegram
{
    /**
     * เพดานความยาวของข้อความสรุป
     *
     * ลิมิตจริงของ Telegram คือ 4,096 ตัวอักษร และเป็นลิมิตที่ "ปฏิเสธทั้งก้อน"
     * ไม่ใช่ตัดท้ายให้ — ยาวเกินแล้วจะไม่ได้รับอะไรเลย เผื่อไว้ห้าร้อยตัวอักษร
     * เพราะเราวัดด้วย mb_strlen (จำนวนตัวอักษร) ส่วน entity ของ HTML tag
     * ที่ปนอยู่ในข้อความก็นับรวมในลิมิตของฝั่งนู้นด้วย
     */
    public const DIGEST_LIMIT = 3500;

    private static ?array $cache = null;
    private static float $cacheAt = 0;
    private static array $envOverride = [];

    /**
     * ปลายทางที่ส่งได้ — คนละบอท คนละกลุ่ม
     *
     * ร้านแยกกลุ่มกันจริงตามชนิดของเรื่อง: "TimeOptic คิวลูกค้า" คือเรื่องที่ต้อง
     * ขยับตอนนี้ ส่วน "TimeOptic รายงานการส่งมอบ" คือสรุปที่อ่านวันละครั้ง
     * ปนกันแล้วเรื่องด่วนจะจมอยู่ใต้รายงานห้าสิบบรรทัด
     *
     * `env` คือชื่อตัวแปรใน .env ที่ทับค่าในฐานข้อมูล — หน้าตั้งค่าอ่านไปแสดงว่า
     * ช่องไหนถูกล็อกอยู่เพราะอะไร แทนที่จะขึ้นช่องแก้ไม่ได้โดยไม่บอกเหตุผล
     */
    public const TARGETS = [
        'main' => [
            'label' => 'คิวลูกค้า',
            'token' => 'telegram_bot_token',
            'chat'  => 'telegram_chat_id',
            'env'   => ['token' => 'TELEGRAM_BOT_TOKEN', 'chat' => 'TELEGRAM_CHAT_ID'],
        ],
        'digest' => [
            'label' => 'รายงานการส่งมอบ',
            'token' => 'digest_telegram_bot_token',
            'chat'  => 'digest_telegram_chat_id',
            'env'   => ['token' => 'DIGEST_TELEGRAM_BOT_TOKEN', 'chat' => 'DIGEST_TELEGRAM_CHAT_ID'],
        ],
        /* ปุ่ม "ส่งรูป" ของขั้นวัด Center — รูปใบหน้าลูกค้ากับหมายเหตุ
           `fallback` false: ตั้งไม่ครบแล้วต้องส่งไม่ออก ห้ามไปโผล่ในกลุ่มคิวลูกค้าแทน
           `digest` false: ไม่ใช่กลุ่มที่เลือกรับสรุปคิวส่งมอบได้ */
        'centering' => [
            'label'    => 'รูปวัด Center',
            'token'    => 'centering_telegram_bot_token',
            'chat'     => 'centering_telegram_chat_id',
            'env'      => ['token' => 'CENTERING_TELEGRAM_BOT_TOKEN', 'chat' => 'CENTERING_TELEGRAM_CHAT_ID'],
            'fallback' => false,
            'digest'   => false,
        ],
    ];

    /** ปลายทางที่ใช้เมื่อไม่ได้ระบุ — ของเดิมทั้งหมดเป็นตัวนี้ */
    public const MAIN = 'main';

    public static function configure(array $tg): void
    {
        self::$envOverride = array_filter([
            'telegram_bot_token'        => $tg['bot_token'] ?? null,
            'telegram_chat_id'          => $tg['chat_id'] ?? null,
            'digest_telegram_bot_token' => $tg['digest_bot_token'] ?? null,
            'digest_telegram_chat_id'   => $tg['digest_chat_id'] ?? null,
            'centering_telegram_bot_token' => $tg['centering_bot_token'] ?? null,
            'centering_telegram_chat_id'   => $tg['centering_chat_id'] ?? null,
        ], fn($v) => $v !== null && $v !== '');
    }

    /** ชื่อปลายทางที่รู้จัก — อย่างอื่นถือเป็น main */
    public static function target(?string $t): string
    {
        return isset(self::TARGETS[(string) $t]) ? (string) $t : self::MAIN;
    }

    /**
     * token กับ chat ของปลายทางหนึ่ง
     *
     * ตั้งไม่ครบคู่ = ใช้ไม่ได้ทั้งคู่ แล้วตกกลับไปที่ main — ห้ามเอา token ใหม่
     * ไปคู่กับ chat เก่า เพราะบอทที่ยังไม่ได้ถูกเชิญเข้ากลุ่มนั้นจะส่งไม่ออก
     * และตกกลับดีกว่าเงียบ: การแจ้งเตือนที่หายไปเฉย ๆ ไม่มีใครมาบ่นให้รู้
     *
     * @return array{token:string, chat:string, target:string, fell_back:bool}
     */
    public static function credentials(?string $target = null): array
    {
        $s    = self::settings();
        $name = self::target($target);
        $read = static function (string $t) use ($s): array {
            $k = self::TARGETS[$t];
            return [trim((string) ($s[$k['token']] ?? '')), trim((string) ($s[$k['chat']] ?? ''))];
        };

        [$token, $chat] = $read($name);
        $fellBack = false;

        /* ปลายทางที่ประกาศ fallback false (กลุ่มรูปวัด Center) ตั้งไม่ครบ = ส่งไม่ออก */
        if (($token === '' || $chat === '') && $name !== self::MAIN && (self::TARGETS[$name]['fallback'] ?? true)) {
            [$token, $chat] = $read(self::MAIN);
            $fellBack = true;
        }
        return ['token' => $token, 'chat' => $chat, 'target' => $name, 'fell_back' => $fellBack];
    }

    public static function settings(bool $force = false): array
    {
        if (!$force && self::$cache !== null && (microtime(true) - self::$cacheAt) < 15.0) {
            return self::$cache;
        }
        $rows = Db::all('SELECT `key`, `value` FROM app_settings');
        $out = [];
        foreach ($rows as $r) {
            $out[$r['key']] = $r['value'];
        }
        // environment always wins, so a token can be kept out of the database
        $out = array_merge($out, self::$envOverride);
        self::$cache   = $out;
        self::$cacheAt = microtime(true);
        return $out;
    }

    public static function invalidate(): void
    {
        self::$cache = null;
    }

    public static function saveSettings(array $patch): array
    {
        foreach ($patch as $key => $value) {
            Db::run(
                'INSERT INTO app_settings (`key`, `value`) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
                (string) $key,
                (string) ($value ?? '')
            );
        }
        self::invalidate();
        return self::settings(true);
    }

    /** true when a token and chat id are present (ตกกลับไป main ได้ก็นับว่าใช้ได้) */
    public static function isConfigured(?string $target = null): bool
    {
        $c = self::credentials($target);
        return $c['token'] !== '' && $c['chat'] !== '';
    }

    /** …and the toggle is on */
    public static function isEnabled(): bool
    {
        $s = self::settings();
        return ($s['telegram_enabled'] ?? '0') === '1' && self::isConfigured();
    }

    /**
     * @return array{ok: bool, error: ?string}
     */
    public static function send(string $text, array $opt = []): array
    {
        $kind      = $opt['kind'] ?? 'manual';
        $bookingId = $opt['booking_id'] ?? null;
        $force     = (bool) ($opt['force'] ?? false);
        $target    = self::target($opt['target'] ?? null);

        $s      = self::settings();
        $cred   = self::credentials($target);
        $token  = $cred['token'];
        $chatId = $cred['chat'];

        /* ตกกลับไป main แล้ว การส่งครั้งนี้เป็นของ main จริง ๆ — ถ้าย้ายกลุ่ม
           ทีหลังต้องเขียนทับคีย์ของ main ไม่ใช่ของปลายทางที่ตั้งไม่ครบ */
        if ($cred['fell_back']) {
            $target = self::MAIN;
        }

        if (!$token || !$chatId) {
            return self::logged($kind, $bookingId, $chatId, $text, 0,
                'ยังไม่ได้ตั้งค่า Telegram (bot token / chat id)');
        }
        if (!$force && ($s['telegram_enabled'] ?? '0') !== '1') {
            return self::logged($kind, $bookingId, $chatId, $text, 0,
                'ปิดการแจ้งเตือน Telegram อยู่');
        }

        $r = self::dispatch($token, (string) $chatId, $text);

        /*
         * กลุ่มธรรมดาที่ถูกอัปเกรดเป็นซูเปอร์กรุ๊ปจะได้ chat id ใหม่ ของเดิมใช้ไม่ได้อีก
         * ("group chat was upgraded to a supergroup chat") — Telegram ส่ง id ใหม่มาให้
         * ใน parameters.migrate_to_chat_id จึงย้ายตามแล้วส่งซ้ำอีกครั้งเดียว
         * ไม่งั้นการแจ้งเตือนจะเงียบไปทั้งหมดจนกว่าจะมีคนไปแก้ค่าเอง
         */
        if ($r['migrate_to'] !== null) {
            $chatId = self::adoptChat($target, $r['migrate_to']);
            $r      = self::dispatch($token, $chatId, $text);
        }

        return self::logged($kind, $bookingId, $chatId, $text, $r['ok'] ? 1 : 0, $r['error']);
    }

    /**
     * ส่งรูปวัด Center (ปุ่ม "ส่งรูป") — ข้อความสรุปหนึ่งข้อความ แล้วรูปตาม mediaPlan()
     * โดยตอบกลับ (reply) ข้อความนั้น พนักงานสองคนส่งพร้อมกัน รูปของสองเคสจะไม่ปนกัน
     *
     * คนกดจากหน้าเคสเองโดยตั้งใจ จึงไม่ดูสวิตช์รวม telegram_enabled (เหมือนปุ่มเตือนคิวเอง)
     * แต่ไม่ตกกลับไปกลุ่มอื่นเด็ดขาด — ดู TARGETS['centering']['fallback']
     *
     * ข้อความผ่านแล้วรูปล้มกลางทาง = ล้มทั้งชุด คนกดส่งใหม่ได้ กลุ่มอาจเห็นหัวข้อซ้ำ
     * ซึ่งดีกว่าบอกว่าสำเร็จทั้งที่รูปไปไม่ครบ · ลง notification_log หนึ่งแถวต่อการกด
     *
     * @param list<array{id:int, mime_type:string, path:string, name:string}> $files
     * @return array{ok: bool, error: ?string}
     */
    public static function sendCenteringPhotos(string $text, array $files): array
    {
        $target = 'centering';
        $cred   = self::credentials($target);
        $token  = $cred['token'];
        $chatId = $cred['chat'];
        if ($token === '' || $chatId === '') {
            return self::logged('centering_photos', null, $chatId, $text, 0,
                'ยังไม่ได้ตั้งค่า Telegram กลุ่มรูปวัด Center');
        }

        $r = self::dispatch($token, $chatId, $text);
        if ($r['migrate_to'] !== null) {
            $chatId = self::adoptChat($target, $r['migrate_to']);
            $r      = self::dispatch($token, $chatId, $text);
        }
        if (!$r['ok']) {
            return self::logged('centering_photos', null, $chatId, $text, 0, $r['error']);
        }

        $byId = array_column($files, null, 'id');
        foreach (self::mediaPlan($files) as $step) {
            $form = ['chat_id' => $chatId];
            if ($r['message_id'] !== null) {
                $form['reply_parameters'] = json_encode([
                    'message_id'                  => $r['message_id'],
                    'allow_sending_without_reply' => true,
                ]);
            }
            if ($step['method'] === 'sendMediaGroup') {
                $media = [];
                foreach ($step['ids'] as $i => $id) {
                    $form["photo$i"] = self::attach($byId[$id]);
                    $media[] = ['type' => 'photo', 'media' => "attach://photo$i"];
                }
                $form['media'] = json_encode($media);
            } else {
                $field        = $step['method'] === 'sendPhoto' ? 'photo' : 'document';
                $form[$field] = self::attach($byId[$step['ids'][0]]);
            }

            [$body, $httpCode, $curlErr] = self::post(
                "https://api.telegram.org/bot{$token}/{$step['method']}",
                null,
                $form
            );
            $sent = self::reply($body, $httpCode, $curlErr);
            if (!$sent['ok']) {
                return self::logged('centering_photos', null, $chatId, $text, 0, $sent['error']);
            }
        }
        return self::logged('centering_photos', null, $chatId, $text, 1, null);
    }

    /** @param array{mime_type:string, path:string, name:string} $f */
    private static function attach(array $f): CURLFile
    {
        return new CURLFile($f['path'], $f['mime_type'], $f['name']);
    }

    /**
     * กลุ่มธรรมดาที่ถูกอัปเกรดเป็นซูเปอร์กรุ๊ป — จำ chat id ใหม่ของปลายทางนั้นไว้ แล้วคืน id ใหม่
     */
    private static function adoptChat(string $target, string $newChat): string
    {
        $chatKey = self::TARGETS[$target]['chat'];
        $envName = self::TARGETS[$target]['env']['chat'];
        $pinned  = isset(self::$envOverride[$chatKey]);
        self::saveSettings([$chatKey => $newChat]);
        if ($pinned) {
            // env ทับค่าที่เพิ่งบันทึกเสมอ จำใส่ override ไว้ให้โปรเซสนี้ใช้ต่อได้
            self::$envOverride[$chatKey] = $newChat;
            self::invalidate();
            self::logged('telegram_migrate', null, $newChat, '', 0,
                "กลุ่มถูกอัปเกรดเป็นซูเปอร์กรุ๊ป — แก้ {$envName} ใน .env เป็น {$newChat} "
                . 'ไม่งั้นค่าเก่าจะกลับมาทับทุกครั้งที่รีสตาร์ท');
        }
        return $newChat;
    }

    /**
     * ยิง sendMessage หนึ่งครั้ง — ไม่แตะ notification_log
     *
     * @return array{ok: bool, error: ?string, migrate_to: ?string, message_id: ?int}
     */
    private static function dispatch(string $token, string $chatId, string $text): array
    {
        $payload = json_encode([
            'chat_id'                  => $chatId,
            'text'                     => $text,
            'parse_mode'               => 'HTML',
            'disable_web_page_preview' => true,
        ], JSON_UNESCAPED_UNICODE);

        [$body, $httpCode, $curlErr] = self::post(
            "https://api.telegram.org/bot{$token}/sendMessage",
            $payload
        );
        return self::reply($body, $httpCode, $curlErr);
    }

    /**
     * อ่านคำตอบของ Bot API หนึ่งครั้ง — ข้อความกับรูปใช้ร่วมกัน
     *
     * @return array{ok: bool, error: ?string, migrate_to: ?string, message_id: ?int}
     */
    private static function reply(?string $body, int $httpCode, ?string $curlErr): array
    {
        if ($curlErr !== null) {
            return ['ok' => false, 'error' => mb_substr($curlErr, 0, 250), 'migrate_to' => null, 'message_id' => null];
        }
        $data = json_decode((string) $body, true);
        if ($httpCode >= 400 || (is_array($data) && ($data['ok'] ?? null) === false)) {
            $err       = $data['description'] ?? "HTTP $httpCode";
            $migrateTo = $data['parameters']['migrate_to_chat_id'] ?? null;
            return [
                'ok'         => false,
                'error'      => mb_substr((string) $err, 0, 250),
                'migrate_to' => is_int($migrateTo) || (is_string($migrateTo) && $migrateTo !== '')
                    ? (string) $migrateTo
                    : null,
                'message_id' => null,
            ];
        }
        $messageId = $data['result']['message_id'] ?? null;
        return ['ok' => true, 'error' => null, 'migrate_to' => null, 'message_id' => is_int($messageId) ? $messageId : null];
    }

    /** ask Telegram who the bot is — used by the "ทดสอบ" button, ปลายทางละตัว */
    public static function verifyBot(?string $target = null): array
    {
        self::settings(true);
        $token = self::credentials($target)['token'];
        if ($token === '') {
            throw new RuntimeException('ยังไม่ได้ใส่ bot token');
        }
        [$body, $httpCode, $curlErr] = self::post(
            "https://api.telegram.org/bot{$token}/getMe",
            null
        );
        if ($curlErr !== null) {
            throw new RuntimeException($curlErr);
        }
        $data = json_decode((string) $body, true);
        if (!is_array($data) || ($data['ok'] ?? false) !== true) {
            throw new RuntimeException($data['description'] ?? "HTTP $httpCode");
        }
        return $data['result'];
    }

    /**
     * ชุดใบรับรองที่ใช้ตรวจ https ของ Telegram — คืน null เมื่อ PHP มีของตัวเองแล้ว
     *
     * PHP บน Windows ไม่ได้มาพร้อมชุด CA และไม่ได้อ่านคลังใบรับรองของ Windows
     * เครื่องที่มีแอนตี้ไวรัสหรือพร็อกซีดักอ่าน TLS จะยิ่งชัด เพราะใบที่ยื่นมาเป็น
     * ของตัวกลาง ซึ่งมีอยู่ในคลังของ Windows แต่ PHP ไม่เห็น ผลคือ curl error 19
     * "self-signed certificate in certificate chain" ตอนกดปุ่มทดสอบ Telegram
     *
     * ตั้ง `CA_BUNDLE` ใน .env ชี้ไปที่ไฟล์ .pem ที่ส่งออกจากคลังของ Windows
     * **ห้ามแก้ด้วยการปิด CURLOPT_SSL_VERIFYPEER** นั่นคือยอมรับใบอะไรก็ได้
     * รวมถึงของคนที่แอบสวมเป็น Telegram แล้วอ่าน bot token ที่ส่งไปกับ URL
     */
    private static function caBundle(): ?string
    {
        foreach ([getenv('CA_BUNDLE'), ini_get('curl.cainfo'), ini_get('openssl.cafile')] as $path) {
            if (is_string($path) && $path !== '' && is_readable($path)) {
                return $path;
            }
        }
        return null;
    }

    /**
     * `$form` คือ multipart ที่มี CURLFile (รูปวัด Center) — อัปโหลดรูปหลายเมกะไบต์
     * ใช้เวลาเกินสิบสองวินาทีของข้อความธรรมดาได้ จึงให้เวลานานกว่า
     *
     * @return array{0: ?string, 1: int, 2: ?string} body, status, curl error
     */
    private static function post(string $url, ?string $json, ?array $form = null): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $form !== null ? 120 : 12,
            CURLOPT_CONNECTTIMEOUT => 8,
        ]);
        $ca = self::caBundle();
        if ($ca !== null) {
            curl_setopt($ch, CURLOPT_CAINFO, $ca);
        }
        if ($json !== null) {
            curl_setopt_array($ch, [
                CURLOPT_POST       => true,
                CURLOPT_POSTFIELDS => $json,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            ]);
        }
        if ($form !== null) {
            curl_setopt_array($ch, [
                CURLOPT_POST       => true,
                CURLOPT_POSTFIELDS => $form,
            ]);
        }
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_errno($ch) ? curl_error($ch) : null;
        curl_close($ch);
        if ($err !== null && str_contains(strtolower($err), 'timed out')) {
            $err = 'หมดเวลาเชื่อมต่อ Telegram';
        } elseif ($err !== null && str_contains(strtolower($err), 'certificate')) {
            $err = 'ตรวจใบรับรองของ Telegram ไม่ผ่าน — ตั้ง CA_BUNDLE ใน .env '
                 . 'ให้ชี้ไปที่ไฟล์ .pem ที่ส่งออกจากคลังใบรับรองของ Windows';
        }
        return [is_string($body) ? $body : null, $code, $err];
    }

    private static function logged(
        string $kind,
        ?int $bookingId,
        ?string $target,
        string $message,
        int $ok,
        ?string $error
    ): array {
        try {
            Db::run(
                "INSERT INTO notification_log (channel, kind, booking_id, target, message, ok, error)
                 VALUES ('telegram', ?, ?, ?, ?, ?, ?)",
                $kind,
                $bookingId,
                $target ?: null,
                $message,
                $ok,
                $error
            );
        } catch (Throwable) {
            // logging must never break the caller
        }
        return ['ok' => (bool) $ok, 'error' => $error];
    }

    /* ------------------------------------------------------------------ *
     * message templates
     * ------------------------------------------------------------------ */

    private static function esc(mixed $v): string
    {
        return htmlspecialchars((string) ($v ?? ''), ENT_NOQUOTES, 'UTF-8');
    }

    public static function reminderMessage(array $b, int $minutes): string
    {
        $name = trim(implode(' ', array_filter([$b['first_name'] ?? null, $b['last_name'] ?? null])));
        if ($name === '') {
            $name = 'ลูกค้า (ไม่ระบุชื่อ)';
        }
        $time = substr((string) ($b['booking_time'] ?? ''), 0, 5);

        $lines = [
            "⏰ <b>ใกล้ถึงคิวแล้ว — อีก {$minutes} นาที</b>",
            '',
            '🕒 <b>' . self::esc($time) . '</b> น. · ' . self::esc($b['booking_date'] ?? ''),
            '👤 ' . self::esc($name) . (!empty($b['phone']) ? ' · ☎ ' . self::esc($b['phone']) : ''),
            '💼 ' . self::esc($b['service_label'] ?? $b['service_type'] ?? ''),
        ];
        if (!empty($b['assigned_name'])) {
            $lines[] = '🧑‍💼 ผู้ดูแล: ' . self::esc($b['assigned_name']);
        }
        $lines[] = !empty($b['customer_id'])
            ? '🗂 ลูกค้าเก่า (รหัส #' . (int) $b['customer_id'] . ')'
            : '🆕 ลูกค้าใหม่';
        if (!empty($b['intake_note'])) {
            $lines[] = '';
            $lines[] = "📝 <b>บันทึกเบื้องต้น</b>\n" . self::esc($b['intake_note']);
        }
        if (!empty($b['step_notes'])) {
            $lines[] = '';
            $lines[] = "📋 <b>ข้อมูลที่ถามไว้</b>\n" . self::esc($b['step_notes']);
        }
        if (!empty($b['notes'])) {
            $lines[] = '';
            $lines[] = 'ℹ️ ' . self::esc($b['notes']);
        }
        $lines[] = '';
        $lines[] = 'รหัสจอง ' . self::esc($b['booking_code'] ?? '');
        return implode("\n", $lines);
    }

    public static function bookingCreatedMessage(array $b): string
    {
        $name = trim(implode(' ', array_filter([$b['first_name'] ?? null, $b['last_name'] ?? null])));
        if ($name === '') {
            $name = 'ลูกค้า (ไม่ระบุชื่อ)';
        }
        $time = substr((string) ($b['booking_time'] ?? ''), 0, 5);

        $parts = [
            '🆕 <b>มีการจองคิวใหม่</b>',
            '',
            '🗓 ' . self::esc($b['booking_date'] ?? '') . ' เวลา <b>' . self::esc($time) . '</b> น.',
            '👤 ' . self::esc($name) . (!empty($b['phone']) ? ' · ☎ ' . self::esc($b['phone']) : ''),
            '💼 ' . self::esc($b['service_label'] ?? $b['service_type'] ?? ''),
        ];
        if (!empty($b['intake_note'])) {
            $parts[] = "\n📝 " . self::esc($b['intake_note']);
        }
        $parts[] = "\nรหัสจอง " . self::esc($b['booking_code'] ?? '');
        return implode("\n", array_filter($parts, fn($p) => $p !== ''));
    }

    /* ------------------------------------------------------------------ *
     * ปุ่ม "ส่งรูป" ของขั้นวัด Center (ดู POST /api/centering-photos/send)
     * ------------------------------------------------------------------ */

    /**
     * ข้อความสรุปที่นำหน้ารูป — รูปทั้งชุดตอบกลับข้อความนี้
     *
     * หมายเหตุว่างก็เขียนว่า "ไม่มีหมายเหตุ" คนในกลุ่มจะได้ไม่ต้องเดาว่าหายไประหว่างทางไหม
     *
     * @param array{case_code:string, customer:string, count:int, note:?string,
     *              sent_by:string, sent_at:string} $p
     */
    public static function centeringPhotosMessage(array $p): string
    {
        $note     = trim((string) ($p['note'] ?? ''));
        $customer = trim((string) ($p['customer'] ?? ''));
        $at       = (string) ($p['sent_at'] ?? '');

        return implode("\n", [
            '📸 <b>รูปวัด Center</b>',
            '',
            '🗂 เคส <b>' . self::esc($p['case_code'] ?? '') . '</b>',
            '👤 ' . self::esc($customer !== '' ? $customer : 'ลูกค้า (ไม่ระบุชื่อ)'),
            '🖼 ' . (int) ($p['count'] ?? 0) . ' รูป',
            '',
            '📝 <b>หมายเหตุ</b>',
            $note !== '' ? self::esc($note) : 'ไม่มีหมายเหตุ',
            '',
            'ส่งโดย ' . self::esc($p['sent_by'] ?? '') . ' · ' . self::thaiDate($at) . ' ' . substr($at, 11, 5) . ' น.',
        ]);
    }

    /**
     * แบ่งไฟล์เป็นคำสั่งของ Bot API
     *
     * รูปรวมเป็นอัลบั้มละไม่เกินสิบ (sendMediaGroup รับ 2–10 ชิ้น) เศษใบเดียวใช้ sendPhoto
     * ไฟล์ที่ไม่ใช่รูป (PDF) อยู่อัลบั้มเดียวกับรูปไม่ได้ ส่งทีละไฟล์ด้วย sendDocument
     *
     * @param list<array{id:int, mime_type:?string}> $files
     * @return list<array{method:string, ids:list<int>}>
     */
    public static function mediaPlan(array $files): array
    {
        $photos = [];
        $docs   = [];
        foreach ($files as $f) {
            if (str_starts_with((string) ($f['mime_type'] ?? ''), 'image/')) {
                $photos[] = (int) $f['id'];
            } else {
                $docs[] = (int) $f['id'];
            }
        }

        $plan = [];
        foreach (array_chunk($photos, 10) as $chunk) {
            $plan[] = ['method' => count($chunk) === 1 ? 'sendPhoto' : 'sendMediaGroup', 'ids' => $chunk];
        }
        foreach ($docs as $id) {
            $plan[] = ['method' => 'sendDocument', 'ids' => [$id]];
        }
        return $plan;
    }

    /* ------------------------------------------------------------------ *
     * สรุปคิวส่งมอบรอบหนึ่งทุ่ม (ดู api/services/DeliveryDigest.php)
     * ------------------------------------------------------------------ */

    private const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

    private const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

    /** 2026-09-10 → "10 ก.ย. 2569" (พ.ศ. เพราะพนักงานอ่านปีนี้ ไม่ใช่ ค.ศ.) */
    private static function thaiDate(?string $ymd, bool $withDayName = false): string
    {
        $ts = $ymd ? strtotime(substr($ymd, 0, 10)) : false;
        if ($ts === false) {
            return 'ไม่ระบุวัน';
        }
        $out = (int) date('j', $ts) . ' ' . self::TH_MONTHS[(int) date('n', $ts) - 1]
             . ' ' . ((int) date('Y', $ts) + 543);

        return $withDayName ? self::TH_DAYS[(int) date('w', $ts)] . 'ที่ ' . $out : $out;
    }

    private static function custName(array $r): string
    {
        $name = trim(implode(' ', array_filter([
            $r['first_name'] ?? null, $r['mid_name'] ?? null, $r['last_name'] ?? null,
        ])));
        return $name !== '' ? $name : 'ลูกค้า (ไม่ระบุชื่อ)';
    }

    /**
     * ต่อหัวข้อความเข้ากับรายการ แล้วแบ่งเป็นหลายข้อความเมื่อยาวเกินลิมิต
     *
     * ของเดิมตัดทิ้งแล้วเขียนว่า "…และอีก 21 ราย" ซึ่งแปลว่ายี่สิบเอ็ดคนที่ของ
     * ค้างอยู่ไม่มีใครเห็นชื่อ — คนที่ต้องโทรตามอ่านไม่ครบก็ตามไม่ครบ
     * **ไม่ตัดอะไรทิ้งอีกแล้ว** ยาวแค่ไหนก็แบ่งไปจนหมด
     *
     * ทุกก้อนติดเลข (2/3) ไว้ที่หัว เพราะข้อความที่จบกลางคันโดยไม่บอกว่ามีต่อ
     * ดูเหมือนรายการที่จบแล้วเป๊ะ ๆ
     *
     * เรื่องจำนวนข้อความไปคุมที่จังหวะการส่งแทน (ดู DeliveryDigest::sendAll)
     * ไม่ใช่ด้วยการตัดข้อมูลออก
     *
     * @param  list<string> $items บล็อกละหนึ่งรายการ ประกอบเลขลำดับมาแล้ว
     * @return list<string>
     */
    private static function paginate(string $head, array $items): array
    {
        $total = count($items);
        $pages = [];
        $i     = 0;

        /* กันที่ไว้ให้ "(n/n)" ที่ยังไม่รู้ค่า — จำนวนก้อนรู้แน่ก็ต่อเมื่อแบ่งเสร็จแล้ว */
        $room = self::DIGEST_LIMIT - mb_strlen($head) - 12;

        while ($i < $total) {
            $body = '';
            while ($i < $total && mb_strlen($body . "\n\n" . $items[$i]) <= $room) {
                $body .= "\n\n" . $items[$i];
                $i++;
            }
            /* รายการเดียวยาวเกินหนึ่งข้อความ — ไม่น่าเกิดกับข้อมูลจริง แต่ถ้าเกิด
               แล้วปล่อยไว้จะวนไม่จบ ยัดใส่ไปแล้วให้ Telegram เป็นคนบ่น */
            if ($body === '') {
                $body = "\n\n" . $items[$i];
                $i++;
            }
            $pages[] = $body;
        }

        $n = count($pages);
        foreach ($pages as $k => $body) {
            $pages[$k] = ($n > 1 ? $head . ' (' . ($k + 1) . '/' . $n . ')' : $head) . $body;
        }
        return $pages;
    }

    /** บรรทัดเวลานัด — ตอนนี้ร้านบันทึกแค่วัน เวลาจึงต่อท้ายเฉพาะตอนที่มีจริง */
    private static function apptWhen(array $r): string
    {
        $when = self::thaiDate($r['appointment_date'] ?? null);
        $time = substr((string) ($r['appointment_time'] ?? ''), 0, 5);
        return $time !== '' ? $when . ' ' . $time . ' น.' : $when;
    }

    /**
     * ① คิวส่งมอบของวันที่กำหนด
     *
     * ว่างก็ยังส่ง — ข้อความที่มาตรงเวลาทุกวันคือหลักฐานว่าตัวแจ้งเตือนยังไม่ตาย
     * ถ้าเงียบเพราะไม่มีคิว กับเงียบเพราะเครื่องดับ จะแยกกันไม่ออก
     */
    /** @return list<string> หนึ่งใบเสมอเมื่อคิวว่าง มากกว่านั้นเมื่อรายการยาว */
    public static function deliveryQueueMessages(array $rows, string $date): array
    {
        $label = match ($date) {
            date('Y-m-d', strtotime(today() . ' +1 day')) => 'พรุ่งนี้',
            today() => 'วันนี้',
            default => '',
        };
        $title = trim('📦 <b>คิวส่งมอบ' . $label . '</b>');
        $head  = $title . "\n" . self::thaiDate($date, true);

        if ($rows === []) {
            return [$head . "\n\nไม่มีคิวส่งมอบ"];
        }
        $head .= ' · ' . count($rows) . ' ราย';

        $items = [];
        foreach ($rows as $i => $r) {
            $rush = !empty($r['is_rush']) ? '⚡ ' : '';
            $items[] = ($i + 1) . '. ' . $rush . '<b>' . self::esc($r['invoice_code'] ?? '—') . '</b>'
                . ' · ' . self::esc(self::custName($r))
                . "\n    🗓 " . self::esc(self::apptWhen($r))
                . ' · ' . self::esc($r['status_label_th'] ?? '');
        }
        return self::paginate($head, $items);
    }

    /**
     * ② ของที่เลยวันนัดแล้วยังอยู่ที่ร้าน
     *
     * คืนลิสต์ว่างเมื่อไม่มีของค้าง — ผู้เรียกจะได้ไม่ต้องส่งข้อความเปล่ามารบกวน
     * ใส่เบอร์โทรมาด้วยเพราะรายการนี้จบด้วยการหยิบโทรศัพท์ ไม่ใช่แค่รับรู้
     *
     * @return list<string>
     */
    public static function deliveryOverdueMessages(array $rows, int $days): array
    {
        if ($rows === []) {
            return [];
        }
        $head = '⚠️ <b>เลยกำหนดส่งมอบ</b>' . "\n"
              . count($rows) . ' ราย (นับย้อน ' . $days . ' วัน)';

        $items = [];
        foreach ($rows as $i => $r) {
            $phone = trim((string) ($r['phone'] ?? ''));
            $items[] = ($i + 1) . '. <b>' . self::esc($r['invoice_code'] ?? '—') . '</b>'
                . ' · ' . self::esc(self::custName($r))
                . "\n    🗓 นัด " . self::esc(self::apptWhen($r))
                . ' · เลยมา ' . (int) ($r['days_late'] ?? 0) . ' วัน'
                . ($phone !== '' ? ' · ☎ ' . self::esc($phone) : '');
        }
        return self::paginate($head, $items);
    }
}
