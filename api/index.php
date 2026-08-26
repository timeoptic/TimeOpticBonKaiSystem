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

require __DIR__ . '/services/Booking.php';
require __DIR__ . '/services/Telegram.php';
require __DIR__ . '/services/Migrate.php';
require __DIR__ . '/services/Scheduler.php';

Db::configure($config['db']);
Telegram::configure($config['telegram']);

/* route files — one per resource group, loaded in the order they appear
   in the UI. Adding a resource means adding a file here, nothing else. */
foreach ([
    'meta', 'dashboard', 'cases', 'customers', 'employees', 'prescriptions',
    'stock', 'locations', 'suppliers', 'orders', 'payments', 'lens_jobs',
    'workflow', 'uploads', 'sales', 'cashflow', 'reports', 'bookings', 'settings',
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

try {
    $body = ($method === 'GET') ? [] : Http::body();
    // null is a real answer here ("this case has no fitting row yet"), so it is
    // passed through rather than turned into an ok-envelope
    $result = Router::dispatch($method, $path, $_GET, $body);
    Http::json(200, $result);
} catch (HttpError $e) {
    Http::json($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log(sprintf('[%s %s] %s', $method, $path, $e->getMessage()));
    Http::json(500, ['error' => $e->getMessage()]);
}
