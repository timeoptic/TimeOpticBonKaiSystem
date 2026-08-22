<?php
/**
 * Booking reminder sweep, for Windows Task Scheduler.
 *
 *   C:\xampp\php\php.exe C:\test\timeoptic-web\api\cli\reminder.php
 *
 * The Node version ran this on a 30-second setInterval inside the server
 * process. PHP has no such process, so schedule this every minute instead.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("cli only\n");
}

$config = require dirname(__DIR__) . '/config.php';

require dirname(__DIR__) . '/core/Http.php';
require dirname(__DIR__) . '/core/Db.php';
require dirname(__DIR__) . '/core/Helpers.php';
require dirname(__DIR__) . '/services/Booking.php';
require dirname(__DIR__) . '/services/Telegram.php';
require dirname(__DIR__) . '/services/Scheduler.php';

date_default_timezone_set('Asia/Bangkok');

Db::configure($config['db']);
Telegram::configure($config['telegram']);

try {
    $res = Scheduler::runOnce();
    echo nowStamp() . ' ' . json_encode($res, JSON_UNESCAPED_UNICODE) . PHP_EOL;
} catch (Throwable $e) {
    fwrite(STDERR, nowStamp() . ' [reminder] ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
