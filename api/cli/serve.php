<?php
/**
 * Startup check + banner, then hand over to the built-in server.
 * Run through api/../start-api.bat rather than directly.
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
require dirname(__DIR__) . '/services/Migrate.php';

date_default_timezone_set('Asia/Bangkok');
Db::configure($config['db']);

try {
    $info = Db::verifyConnection();
} catch (Throwable $e) {
    $c = $config['db'];
    fwrite(STDERR, "\n  ✖ เชื่อมต่อฐานข้อมูลไม่ได้\n");
    fwrite(STDERR, "     {$c['user']}@{$c['host']}:{$c['port']}/{$c['database']}\n");
    fwrite(STDERR, '     ' . $e->getMessage() . "\n");
    fwrite(STDERR, "\n  ตรวจสอบว่า MySQL/MariaDB ของ XAMPP รันอยู่ (XAMPP Control Panel → MySQL → Start)\n\n");
    exit(1);
}

try {
    $created = Migrate::run();
} catch (Throwable $e) {
    fwrite(STDERR, "\n  ✖ สร้างตารางสำหรับระบบจองคิวไม่สำเร็จ: " . $e->getMessage() . "\n\n");
    exit(1);
}

echo "\n";
echo "  TimeOptic API  —  PHP " . PHP_VERSION . "\n";
echo "  DB  MariaDB {$info['version']} · {$info['db']} · {$info['tables']} tables\n";
if ($created) {
    echo '  ✚  สร้างตารางใหม่: ' . implode(', ', $created) . "\n";
}
echo "  ⏰ ตัวเตือนคิว: ตั้ง Task Scheduler เรียก api/cli/reminder.php ทุก 1 นาที\n";
echo "\n";
