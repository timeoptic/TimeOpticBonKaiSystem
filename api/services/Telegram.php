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
    private static ?array $cache = null;
    private static float $cacheAt = 0;
    private static array $envOverride = [];

    public static function configure(array $tg): void
    {
        self::$envOverride = array_filter([
            'telegram_bot_token' => $tg['bot_token'] ?? null,
            'telegram_chat_id'   => $tg['chat_id'] ?? null,
        ], fn($v) => $v !== null && $v !== '');
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

    /** true when a token and chat id are present */
    public static function isConfigured(): bool
    {
        $s = self::settings();
        return !empty($s['telegram_bot_token']) && !empty($s['telegram_chat_id']);
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

        $s      = self::settings();
        $token  = $s['telegram_bot_token'] ?? '';
        $chatId = $s['telegram_chat_id'] ?? '';

        if (!$token || !$chatId) {
            return self::logged($kind, $bookingId, $chatId, $text, 0,
                'ยังไม่ได้ตั้งค่า Telegram (bot token / chat id)');
        }
        if (!$force && ($s['telegram_enabled'] ?? '0') !== '1') {
            return self::logged($kind, $bookingId, $chatId, $text, 0,
                'ปิดการแจ้งเตือน Telegram อยู่');
        }

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

        if ($curlErr !== null) {
            return self::logged($kind, $bookingId, $chatId, $text, 0, mb_substr($curlErr, 0, 250));
        }
        $data = json_decode((string) $body, true);
        if ($httpCode >= 400 || (is_array($data) && ($data['ok'] ?? null) === false)) {
            $err = $data['description'] ?? "HTTP $httpCode";
            return self::logged($kind, $bookingId, $chatId, $text, 0, mb_substr((string) $err, 0, 250));
        }
        return self::logged($kind, $bookingId, $chatId, $text, 1, null);
    }

    /** ask Telegram who the bot is — used by the "ทดสอบ" button */
    public static function verifyBot(): array
    {
        $s = self::settings(true);
        if (empty($s['telegram_bot_token'])) {
            throw new RuntimeException('ยังไม่ได้ใส่ bot token');
        }
        [$body, $httpCode, $curlErr] = self::post(
            "https://api.telegram.org/bot{$s['telegram_bot_token']}/getMe",
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

    /** @return array{0: ?string, 1: int, 2: ?string} body, status, curl error */
    private static function post(string $url, ?string $json): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 12,
            CURLOPT_CONNECTTIMEOUT => 8,
        ]);
        if ($json !== null) {
            curl_setopt_array($ch, [
                CURLOPT_POST       => true,
                CURLOPT_POSTFIELDS => $json,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            ]);
        }
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_errno($ch) ? curl_error($ch) : null;
        curl_close($ch);
        if ($err !== null && str_contains(strtolower($err), 'timed out')) {
            $err = 'หมดเวลาเชื่อมต่อ Telegram';
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
}
