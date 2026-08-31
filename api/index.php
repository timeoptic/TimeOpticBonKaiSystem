<?php
/**
 * TimeOptic API — front controller.
 *
 * Every /api/* request lands here. Apache routes them via .htaccess; the PHP
 * built-in dev server routes them via router.php.
 */
declare(strict_types=1);

mb_internal_encoding('UTF-8');
date_default_timezone_set('Asia/Bangkok');

// errors belong in the log and in the JSON body, never printed into it
ini_set('display_errors', '0');
error_reporting(E_ALL);

$config = require __DIR__ . '/config.php';

require __DIR__ . '/core/Http.php';
require __DIR__ . '/core/Db.php';
require __DIR__ . '/core/Helpers.php';
require __DIR__ . '/core/Router.php';
require __DIR__ . '/core/Sql.php';
require __DIR__ . '/core/Lookups.php';
require __DIR__ . '/core/StockModule.php';

require __DIR__ . '/services/Booking.php';
require __DIR__ . '/services/Telegram.php';
require __DIR__ . '/services/StockClient.php';
require __DIR__ . '/services/CaseStock.php';
require __DIR__ . '/services/Migrate.php';
require __DIR__ . '/services/Scheduler.php';

Db::configure($config['db']);
/* โหลดโค้ดฝั่งคลังจาก stock/ แล้วยกคอนเนกชันกับ session ให้ใช้ตัวเดียวกัน
   ต้องมาก่อนทุกอย่างที่แตะสิทธิ์ เพราะ Auth::start() เปิด session ที่นี่ */
StockModule::boot();
Telegram::configure($config['telegram']);
StockClient::configure($config['stock_api']);

/* route files — one per resource group, loaded in the order they appear
   in the UI. Adding a resource means adding a file here, nothing else. */
foreach ([
    'auth', 'meta', 'dashboard', 'cases', 'customers', 'employees', 'prescriptions',
    'stock', 'locations', 'suppliers', 'orders', 'payments',
    'workflow', 'processes', 'uploads', 'sales', 'cashflow', 'reports', 'bookings', 'settings',
] as $group) {
    require __DIR__ . "/routes/$group.php";
}

Http::cors($config['cors_origins']);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path   = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path   = rawurldecode($path);

// strip a sub-directory prefix so the API works under an Apache Alias too
$script = $_SERVER['SCRIPT_NAME'] ?? '';
$base   = rtrim(str_replace('\\', '/', dirname($script)), '/');
if ($base !== '' && $base !== '/' && str_starts_with($path, $base)) {
    $path = substr($path, strlen($base));
}
if ($path === '' || $path[0] !== '/') {
    $path = '/' . $path;
}
// an Alias pointing at api/ means the incoming path lacks the /api prefix
if (!str_starts_with($path, '/api/') && $path !== '/api') {
    $path = '/api' . ($path === '/' ? '' : $path);
}

/* ประตูเดียวของทั้ง API — ไม่มี session ก็ไม่ได้เข้า
   ยกเว้นสามเส้นที่ต้องเรียกได้ก่อนล็อกอิน ไม่งั้นจะล็อกอินไม่ได้เลย */
$open = in_array($path, ['/api/auth/login', '/api/auth/logout', '/api/auth/me'], true);
if (!$open && StockModule::actor() === null) {
    Http::json(401, ['error' => 'ต้องเข้าสู่ระบบก่อน', 'reason' => 'unauthenticated']);
    exit;
}

try {
    $body = ($method === 'GET') ? [] : Http::body();
    // null is a real answer here ("this case has no fitting row yet"), so it is
    // passed through rather than turned into an ok-envelope
    $result = Router::dispatch($method, $path, $_GET, $body);
    /* ต้นทุนออกจากที่นี่ได้เฉพาะคนที่มีสิทธิ์เห็น — ตัดที่ทางออก ไม่ใช่ซ่อนในหน้าเว็บ
       หน้าจอที่แค่ไม่วาดตัวเลข ก็ยังได้รับตัวเลขนั้นไปแล้ว เปิด DevTools ก็เห็น */
    Http::json(200, StockModule::redactCost($result, StockModule::actor()));
} catch (HttpError $e) {
    Http::json($e->status, ['error' => $e->getMessage()]);
} catch (\Optic\ApiError $e) {
    /* ฝั่งคลังตอบเป็น reason ที่โค้ดแตกเงื่อนไขได้ ส่งต่อทั้งคู่ ไม่ยุบเหลือข้อความ */
    Http::json($e->status, ['error' => $e->getMessage()] + $e->payload());
} catch (Throwable $e) {
    error_log(sprintf('[%s %s] %s', $method, $path, $e->getMessage()));
    Http::json(500, ['error' => $e->getMessage()]);
}
