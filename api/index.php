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
require __DIR__ . '/services/SalesReport.php';
require __DIR__ . '/services/Xlsx.php';
require __DIR__ . '/services/SalesExport.php';
require __DIR__ . '/services/CaseSource.php';
require __DIR__ . '/services/ActivityLog.php';

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
    'workflow', 'processes', 'uploads', 'sales', 'pos', 'receipts', 'cashflow', 'reports', 'analytics',
    'bookings', 'settings', 'logs',
] as $group) {
    require __DIR__ . "/routes/$group.php";
}

/* CORS ของทั้งพอร์ต — ฝั่งคลังยกให้ host ตอบตอน mountUnder เพราะสอง
   Access-Control-Allow-Origin แย่กว่าไม่มีเลย เบราว์เซอร์ทิ้งทั้งคู่

   เครื่องอื่นในวง LAN (iPad ที่ร้าน เครื่องหลังร้าน) เข้ามาด้วย origin เป็นเลข IP
   ที่เปลี่ยนตาม DHCP จึงใช้กฎเดียวกับฝั่งคลัง: ที่อยู่ในวงส่วนตัวและเป็น http
   เท่านั้น เปิดด้วย API_ALLOW_LAN=1 · ยังต้องมีคุกกี้ session อยู่ดีจึงจะเห็นอะไร */
$corsOrigins = $config['cors_origins'];
$origin      = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && \Optic\Http::isLanOrigin($origin)) {
    $corsOrigins[] = $origin;
}
Http::cors($corsOrigins);

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
/* ระบบคลังและต้นทุน — ตารางเส้นทางของมันเอง ต่อท้ายพอร์ตเดียวกันนี้
   ทั้งสองฝั่งอยากใช้ /api เหมือนกัน ฝั่งคลังจึงหลบมาอยู่ใต้ /stock-api

   ต้องมาก่อนสองอย่างข้างล่าง: ก่อนบรรทัดที่เติม /api ให้อัตโนมัติ ไม่งั้นจะ
   กลายเป็น /api/stock-api/... แล้วไม่ตรงกับอะไรเลย · และก่อนประตูตรวจ session
   เพราะฝั่งคลังตรวจสิทธิ์เองทุกเส้นและตอบ reason ที่หน้าเว็บแยกแยะได้ */
/**
 * ธงบังคับเปลี่ยนรหัสผ่าน — ปิดทุกเส้นยกเว้นทางที่ใช้เปลี่ยนมันเอง
 *
 * ธงขึ้นตอนที่ *คนอื่น* เป็นคนตั้งรหัสให้ (ปุ่มรีเซ็ต · ช่องตั้งรหัสในหน้าแก้ไขผู้ใช้)
 * รหัสแบบนั้นมีคนที่สองรู้อยู่แล้ว จึงใช้ได้ครั้งเดียวเพื่อเข้ามาตั้งรหัสจริง ไม่ใช่
 * กลายเป็นรหัสถาวรที่บัญชีมีเจ้าของสองคนตลอดไป
 *
 * เรียกสองที่ เพราะ `/stock-api` ออกจากไฟล์นี้ไปก่อนด่านข้างล่างทั้งหมด — กันแต่
 * ฝั่งหน้าร้านแปลว่าคนที่ยังไม่เปลี่ยนรหัสยังใช้ระบบคลังได้ทั้งระบบ
 *
 * คำตอบมีทั้ง `error` และ `message` เพราะสองฝั่งอ่านคนละชื่อ (ฝั่งคลังใช้ซองของ
 * `Optic\ApiError`) — ส่งชื่อเดียวแปลว่าอีกฝั่งขึ้นกล่องเปล่า
 */
function requirePasswordChange(string $path, string $prefix): void
{
    $actor = StockModule::actor();
    if ($actor === null || !($actor['mustChangePassword'] ?? false)) {
        return;
    }
    foreach (['/auth/login', '/auth/logout', '/auth/me', '/auth/change-password'] as $free) {
        if ($path === $prefix . $free) {
            return;
        }
    }
    $msg = 'ต้องตั้งรหัสผ่านใหม่ก่อนใช้งานต่อ';
    Http::json(403, ['error' => $msg, 'message' => $msg, 'reason' => 'password_change_required']);
    exit;
}

if ($path === '/stock-api' || str_starts_with($path, '/stock-api/')) {
    /* ฝั่งคลัง dispatch แล้ว exit เอง ไม่กลับมาที่ไฟล์นี้ — ตัวบันทึกปิดงานให้เอง
       ตอน shutdown · การเพิ่ม-ลบบัญชีผู้ใช้เดินทางนี้ จึงต้องบันทึกด้วย */
    ActivityLog::start($method, $path);
    StockModule::boot();
    requirePasswordChange($path, '/stock-api');
    \Optic\Http::mountUnder('/stock-api');
    require __DIR__ . '/../stock/api/public/index.php'; // ลงทะเบียนเส้นทางแล้ว dispatch เอง
    exit;                                              // เผื่อวันที่ dispatch เลิก exit เอง
}

// an Alias pointing at api/ means the incoming path lacks the /api prefix
if (!str_starts_with($path, '/api/') && $path !== '/api') {
    $path = '/api' . ($path === '/' ? '' : $path);
}

/* ประตูแรกสุด — บันทึกว่าใครทำอะไร (ดู services/ActivityLog.php)
 *
 * ต้องมาก่อนทุกด่านข้างล่าง เพราะสิ่งที่คนเปิดล็อกอยากเห็นที่สุดอย่างหนึ่งคือคำขอ
 * ที่ "ไม่ผ่าน" — 401 ที่แปลว่า session หมดอายุกลางงาน และ 403 ที่แปลว่ามีคนกด
 * เข้าหน้าที่ไม่ใช่ของตัวเอง · ทั้งสองอย่างจบด้วย exit() ตรงนั้น ไม่มีทางเดินมาถึง
 * บรรทัดสุดท้ายของไฟล์นี้ ตัวบันทึกจึงปิดงานตัวเองตอน shutdown
 */
ActivityLog::start($method, $path);

/* ประตูเดียวของทั้ง API — ไม่มี session ก็ไม่ได้เข้า
   ยกเว้นสามเส้นที่ต้องเรียกได้ก่อนล็อกอิน ไม่งั้นจะล็อกอินไม่ได้เลย */
$open = in_array($path, ['/api/auth/login', '/api/auth/logout', '/api/auth/me'], true);
if (!$open && StockModule::actor() === null) {
    Http::json(401, ['error' => 'ต้องเข้าสู่ระบบก่อน', 'reason' => 'unauthenticated']);
    exit;
}

/* คนที่กำลังกดอยู่ · null ได้เฉพาะสามเส้นที่เปิดไว้ก่อนล็อกอิน — ด่านข้างบนกันแล้ว
   อ่านครั้งเดียวแล้วส่งต่อให้ด่านที่เหลือ ไม่ใช่ถามใหม่ทุกด่าน */
$actor = $open ? null : StockModule::actor();

requirePasswordChange($path, '/api');

/* ประตูที่สอง — ฝั่งที่ใช่
 *
 * คนที่ไม่มีสิทธิ์ `frontdesk.use` (พนักงานคลังล้วน) ไม่มีอะไรให้ทำใน /api เลย —
 * เคส ใบวัดสายตา POS การรับเงิน คิวจอง ล้วนเป็นงานหน้าร้านทั้งหมด · กันทั้งกลุ่ม
 * ที่นี่ ไม่ใช่ไล่เติมบรรทัดในทุกเส้น และนี่คือที่ที่ `case.view_all` ถูกบังคับจริง
 * ส่วนหน้าจอที่ซ่อนเมนูให้เป็นแค่มารยาท
 *
 * หน้าจอฝั่งคลังคุยกับ `/stock-api` อย่างเดียว (`frontend-next/stockmod/lib/api.ts`)
 * ด่านนี้จึงไม่ตัดงานของพนักงานคลังสักอย่าง
 */
if ($actor !== null && !\Optic\Roles::useFrontdesk($actor['roles'])) {
    Http::json(403, [
        'error'  => 'บัญชีนี้เป็นของฝั่งคลัง ใช้งานระบบหน้าร้านไม่ได้',
        'reason' => 'frontdesk_only',
    ]);
    exit;
}

/* ประตูที่สาม — งานของแอดมิน
 *
 * เงินของร้านและข้อมูลระบบ (พนักงาน ซัพพลายเออร์ รายงาน การตั้งค่า) ไม่ใช่งาน
 * ของคนหน้าร้าน · กันที่นี่ที่เดียวด้วยคำนำหน้าเส้นทาง ไม่ใช่ไปเติมบรรทัดตรวจสิทธิ์
 * ในทุกเส้นของห้าไฟล์ เพราะเส้นที่ยี่สิบแปดที่ใครเขียนเพิ่มวันหน้าจะถูกกันเองโดย
 * ไม่ต้องมีใครจำได้ · ซ่อนเมนูฝั่งหน้าเว็บเป็นแค่มารยาท ด่านจริงอยู่ตรงนี้
 *
 * `/api/settings` เปิดให้อ่านได้ทุกคนแต่แก้ไม่ได้ — ใบสั่งตัดแว่นพิมพ์เวลาเปิดร้าน
 * จากที่นั่น (print/order/page.jsx) ซึ่งพนักงานขายเป็นคนกดพิมพ์ · เวลาเปิดร้าน
 * ไม่ใช่ความลับ แต่การแก้มันเป็นเรื่องของคนดูแลระบบ
 */
const ADMIN_PREFIXES = [
    '/api/income', '/api/expense',          // การเงิน
    '/api/employees', '/api/suppliers',     // ข้อมูลระบบ
    '/api/reports', '/api/notifications', '/api/reminders',
    '/api/logs',                            // บันทึกการใช้งาน — ใครทำอะไร
];
if ($actor !== null) {
    $isAdmin  = \Optic\Roles::adminZone($actor['roles']);
    $prefixed = static fn(string $p): bool => $path === $p || str_starts_with($path, $p . '/');

    $needsAdmin = false;
    foreach (ADMIN_PREFIXES as $p) {
        if ($prefixed($p)) {
            $needsAdmin = true;
            break;
        }
    }
    // การตั้งค่า: อ่านได้ทุกคน เขียนเฉพาะแอดมิน
    if (!$needsAdmin && $prefixed('/api/settings') && $method !== 'GET') {
        $needsAdmin = true;
    }

    if ($needsAdmin && !$isAdmin) {
        Http::json(403, [
            'error'  => 'เมนูนี้สำหรับผู้ดูแลระบบเท่านั้น',
            'reason' => 'forbidden',
        ]);
        exit;
    }
}

/* คำขอที่ยังอ่านไม่ได้ตอนนี้ ("Invalid JSON body") ก็ยังต้องมีร่องรอย — ตัวแปรนี้
   จึงต้องมีค่าอยู่แล้วก่อนเข้า try ไม่ใช่ประกาศข้างใน */
$body = [];
try {
    $body = ($method === 'GET') ? [] : Http::body();
    // null is a real answer here ("this case has no fitting row yet"), so it is
    // passed through rather than turned into an ok-envelope
    $result = Router::dispatch($method, $path, $_GET, $body);
    /* ต้นทุนออกจากที่นี่ได้เฉพาะคนที่มีสิทธิ์เห็น — ตัดที่ทางออก ไม่ใช่ซ่อนในหน้าเว็บ
       หน้าจอที่แค่ไม่วาดตัวเลข ก็ยังได้รับตัวเลขนั้นไปแล้ว เปิด DevTools ก็เห็น */
    Http::json(200, StockModule::redactCost($result, StockModule::actor()));
    /* บันทึกหลังส่งคำตอบออกไปแล้วเสมอ — คนกดปุ่มไม่ต้องรอการเขียนล็อก และล็อกที่
       พังก็ทำอะไรกับคำตอบที่ส่งไปแล้วไม่ได้ ซึ่งเป็นผลที่ตั้งใจ */
    ActivityLog::finish(200, $body, $result);
} catch (HttpError $e) {
    Http::json($e->status, ['error' => $e->getMessage()]);
    ActivityLog::finish($e->status, $body, null, $e->getMessage());
} catch (\Optic\ApiError $e) {
    /* ฝั่งคลังตอบเป็น reason ที่โค้ดแตกเงื่อนไขได้ ส่งต่อทั้งคู่ ไม่ยุบเหลือข้อความ */
    Http::json($e->status, ['error' => $e->getMessage()] + $e->payload());
    ActivityLog::finish($e->status, $body, null, $e->getMessage());
} catch (StockApiError $e) {
    /* คำปฏิเสธของฝั่งคลังที่เดินผ่าน StockClient มา — มันห่อ ApiError ไว้อีกชั้น
       ถ้าไม่ดักตรงนี้จะไปตกที่ Throwable ข้างล่างแล้วกลายเป็น 500 ทั้งที่เป็นเรื่อง
       ที่คนกดแก้ได้เอง เช่น "ต้องระบุรุ่นเลนส์ที่จะสั่ง" */
    Http::json($e->status ?: 400, ['error' => $e->getMessage(), 'reason' => $e->reason] + $e->payload);
    ActivityLog::finish($e->status ?: 400, $body, null, $e->getMessage());
} catch (Throwable $e) {
    error_log(sprintf('[%s %s] %s', $method, $path, $e->getMessage()));
    Http::json(500, ['error' => $e->getMessage()]);
    ActivityLog::finish(500, $body, null, $e->getMessage());
}
