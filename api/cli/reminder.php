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
require dirname(__DIR__) . '/services/DeliveryDigest.php';

date_default_timezone_set('Asia/Bangkok');

Db::configure($config['db']);
Telegram::configure($config['telegram']);

/**
 * เขียนลง reminder.log ที่รากโปรเจกต์
 *
 * งานตามเวลาไม่มีหน้าจอให้ดู เวลามันเงียบผิดปกติจึงไม่มีที่ให้ไปดูเลยว่าเกิดอะไร
 * — เขียน **เฉพาะรอบที่มีอะไรเกิดขึ้นจริง** ไม่ใช่ทุกนาที ไม่งั้นปีหนึ่งจะได้
 * ไฟล์ห้าแสนบรรทัดที่เป็นคำว่า "ไม่มีอะไร" ซึ่งกลบรอบที่สำคัญจนหาไม่เจอ
 */
function logLine(string $line): void
{
    @file_put_contents(
        dirname(__DIR__, 2) . '/reminder.log',
        nowStamp() . ' ' . $line . PHP_EOL,
        FILE_APPEND | LOCK_EX
    );
}

try {
    $res  = Scheduler::runOnce();
    $line = json_encode($res, JSON_UNESCAPED_UNICODE);
    echo nowStamp() . ' ' . $line . PHP_EOL;

    $digest = $res['digest'] ?? [];
    $quiet  = ($res['sent'] ?? 0) === 0
        && ($digest['sent'] ?? 0) === 0
        && ($digest['error'] ?? null) === null;
    if (!$quiet) {
        logLine($line);
    }
} catch (Throwable $e) {
    $msg = '[reminder] ' . $e->getMessage();
    fwrite(STDERR, nowStamp() . ' ' . $msg . PHP_EOL);
    logLine($msg);
    exit(1);
}
