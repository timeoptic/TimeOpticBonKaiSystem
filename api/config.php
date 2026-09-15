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

/* .env — มองหาสองที่ ตามลำดับ (same file the Node version used)
     1. รากโปรเจกต์          `<repo>/.env`            ตอนรันบนเครื่องในร้าน
     2. เหนือ document root  `<public_html>/../.env`  ตอนขึ้นโฮสต์
   ข้อ 2 มีเพราะบนโฮสต์ api/ ไปนั่งอยู่ใน public_html แปลว่า dirname(__DIR__)
   คือโฟลเดอร์ที่เว็บเสิร์ฟได้ ไฟล์ที่มีรหัสฐานข้อมูลจึงจะเหลือ .htaccess เป็นด่าน
   เดียว — แก้พลาดบรรทัดเดียววันหลังก็เปิดอ่านจากเน็ตได้ เก็บไว้นอก doc root
   ไม่มีทางเสิร์ฟตั้งแต่ต้น

   ไฟล์ที่เจอก่อนชนะรายคีย์ (putenv เฉพาะคีย์ที่ยังไม่มีค่า) และตัวแปรจริงของ
   ระบบชนะทั้งสองไฟล์เสมอ */
foreach ([dirname(__DIR__) . '/.env', dirname(__DIR__, 2) . '/.env'] as $envFile) {
    if (!is_readable($envFile)) {
        continue;
    }
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
    /* สามปลายทาง คนละบอท คนละกลุ่ม (ดู Telegram::TARGETS)
         TELEGRAM_*           → กลุ่ม "TimeOptic คิวลูกค้า" เรื่องที่ต้องขยับตอนนี้
         DIGEST_TELEGRAM_*    → กลุ่ม "TimeOptic รายงานการส่งมอบ" สรุปวันละครั้ง
         CENTERING_TELEGRAM_* → กลุ่มรูปวัด Center จากปุ่ม "ส่งรูป" (ไม่ตกกลับไปกลุ่มไหน)
       ฝั่งคลังมีตัวส่งของตัวเองอ่าน STOCK_TELEGRAM_* คนละชุดกับที่นี่ */
    'telegram' => [
        // env always wins over the app_settings table
        'bot_token'           => env('TELEGRAM_BOT_TOKEN'),
        'chat_id'             => env('TELEGRAM_CHAT_ID'),
        'digest_bot_token'    => env('DIGEST_TELEGRAM_BOT_TOKEN'),
        'digest_chat_id'      => env('DIGEST_TELEGRAM_CHAT_ID'),
        'centering_bot_token' => env('CENTERING_TELEGRAM_BOT_TOKEN'),
        'centering_chat_id'   => env('CENTERING_TELEGRAM_CHAT_ID'),
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
