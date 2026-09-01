<?php
/**
 * TimeOptic API — configuration.
 * Values come from the environment first so nothing secret has to live in git.
 * Defaults match a stock XAMPP install.
 */
declare(strict_types=1);

function env(string $key, ?string $default = null): ?string
{
    $v = getenv($key);
    if ($v === false || $v === '') {
        return $default;
    }
    return $v;
}

// .env support (same file the Node version used)
$envFile = dirname(__DIR__) . '/.env';
if (is_readable($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v, " \t\"'");
        if (getenv($k) === false) {
            putenv("$k=$v");
        }
    }
}

return [
    'db' => [
        'host'     => env('DB_HOST', '127.0.0.1'),
        'port'     => (int) env('DB_PORT', '3306'),
        'user'     => env('DB_USER', 'root'),
        'password' => env('DB_PASS', ''),
        'database' => env('DB_NAME', 'timeoptic'),
        'charset'  => 'utf8mb4',
    ],
    /* ระบบคลัง — โปรเจกต์แยก คนละเครื่อง เข้าถึงได้ทาง HTTP อย่างเดียว
       (เครื่องเขา 192.168.1.108:8080 · MySQL ของเขาต่อตรงไม่ได้ · แชร์ session
       ผ่านไฟล์ก็ไม่ได้เพราะคนละเครื่อง) จึงต้องมีบัญชีไว้ล็อกอินใน config
       วันที่ย้ายมาเครื่องเดียวกันแล้ว ให้เอา username/password ออกแล้วส่งต่อ
       คุกกี้ optic_session ของคนที่กดแทน — StockClient รองรับทั้งสองทาง

       base_url มาจาก DHCP ห้าม hard-code ลงโค้ด · start.bat ฝั่งคลังพิมพ์ IP ให้ทุกครั้ง
       mode: live = ยิงจริง · dry = ประกอบ payload แล้วบันทึกไว้เฉย ๆ ไม่ยิง · off = ปิด */
    'stock_api' => [
        'base_url' => rtrim((string) env('STOCK_API_URL', ''), '/'),
        'username' => env('STOCK_API_USER'),
        'password' => env('STOCK_API_PASS'),
        'source'   => env('STOCK_API_SOURCE', 'frontdesk'),
        'timeout'  => (int) env('STOCK_API_TIMEOUT', '10'),
        'mode'     => env('STOCK_API_MODE', 'off'),
    ],
    'telegram' => [
        // env always wins over the app_settings table
        'bot_token' => env('TELEGRAM_BOT_TOKEN'),
        'chat_id'   => env('TELEGRAM_CHAT_ID'),
    ],
    // origins allowed to call the API (Next.js dev server)
    // เครื่องอื่นในวง LAN (iPad/มือถือ) เข้ามาด้วย origin เป็นเลข IP ของเครื่องนี้
    // ซึ่งเปลี่ยนได้ตาม DHCP จึงเติมเพิ่มจาก .env ได้ที่ CORS_ORIGINS (คั่นด้วย ,)
    'cors_origins' => array_values(array_filter(array_merge(
        array_map('trim', explode(',', (string) env('CORS_ORIGINS', ''))),
        [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3005',
        'http://127.0.0.1:3005',
        // เว็บของโปรเจกต์รวม ทั้งหน้าร้านและ /stock อยู่ที่พอร์ตนี้พอร์ตเดียว
        'http://localhost:3010',
        'http://127.0.0.1:3010',
        ]
    ))),
];
