<?php
/**
 * ส่งรายการตัด/คืนกรอบที่ค้างไปคลังของอีกสาขา (services/FrameRemote.php)
 *
 * ตั้ง Cron Job บน Hostinger ทุก 5 นาที:
 *   php /home/<user>/domains/<site>/public_html/api/cli/frame-remote-flush.php
 * ไม่มีอะไรค้าง = ไม่ยิงเน็ตเลย · รันซ้อนกันไม่ได้ (GET_LOCK)
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
require dirname(__DIR__) . '/services/StockClient.php';
require dirname(__DIR__) . '/services/FrameRemote.php';

date_default_timezone_set('Asia/Bangkok');
Db::configure($config['db']);

if (!FrameRemote::enabled()) {
    echo nowStamp() . " FRAME_STOCK_* not set — nothing to do\n";
    exit(0);
}
$res = FrameRemote::flush(200);
echo nowStamp() . ' ' . json_encode($res, JSON_UNESCAPED_UNICODE) . PHP_EOL;
exit($res['failed'] > 0 ? 2 : 0);
