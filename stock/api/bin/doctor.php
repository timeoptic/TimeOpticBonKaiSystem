<?php

declare(strict_types=1);

/**
 *   php api/bin/doctor.php
 *
 * Checks that this machine can actually run the project, and says what to do
 * about anything it can't. Run this first on a new machine — it answers most
 * "why doesn't it work" questions before they get asked.
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Env;

$problems = [];

function line(string $label, string $value, bool $ok = true): void
{
    printf("  %-26s %s %s\n", $label, $ok ? '✓' : '✗', $value);
}

echo "\nPHP\n";
line('binary', PHP_BINARY);
line('version', PHP_VERSION, PHP_VERSION_ID >= 80200);
if (PHP_VERSION_ID < 80200) {
    $problems[] = 'ต้องใช้ PHP 8.2 ขึ้นไป — ลงด้วย: winget install --id PHP.PHP.8.4';
}

$ini = php_ini_loaded_file();
line('php.ini', $ini !== false ? $ini : 'ไม่ได้โหลดไฟล์ใด', $ini !== false);
if ($ini === false) {
    $problems[] = 'ไม่มี php.ini — extension จะปิดทั้งหมด สร้างไฟล์ php.ini ในโฟลเดอร์เดียวกับ php.exe';
}

echo "\nส่วนขยายที่ต้องมี\n";
foreach (['pdo_mysql', 'mbstring', 'openssl', 'bcmath', 'json'] as $ext) {
    $has = extension_loaded($ext);
    line($ext, $has ? 'พร้อม' : 'ไม่พบ', $has);
    if (!$has) {
        $problems[] = "เปิด extension={$ext} ใน php.ini";
    }
}

echo "\nเขตเวลา\n";
$tz = date_default_timezone_get();
$tzOk = $tz === 'Asia/Bangkok';
line('date.timezone', $tz, $tzOk);
if (!$tzOk) {
    // received_date เป็น DATE และ created_at เป็น DATETIME ที่ไม่มีเขตเวลา
    // ถ้า PHP กับฐานข้อมูลคนละโซน วันที่รับเข้าล็อตจะเลื่อนไปหนึ่งวัน
    $problems[] = "ตั้ง date.timezone = Asia/Bangkok ใน php.ini (ตอนนี้เป็น {$tz})";
}

echo "\nฐานข้อมูล\n";
try {
    $c = Env::database();
    line('ปลายทาง', sprintf('%s@%s:%d/%s', $c['user'], $c['host'], $c['port'], $c['name']));

    $version = (string) Db::value('SELECT VERSION()');
    line('เซิร์ฟเวอร์', 'MariaDB/MySQL ' . $version);

    $mode = (string) Db::value('SELECT @@session.sql_mode');
    $strict = str_contains($mode, 'STRICT_TRANS_TABLES');
    line('sql_mode (session)', $strict ? 'STRICT_TRANS_TABLES เปิดอยู่' : 'ไม่ strict', $strict);
    if (!$strict) {
        $problems[] = 'session ไม่ได้บังคับ strict mode — ตรวจ Db::conn()';
    }

    $tables = ['categories', 'suppliers', 'products', 'stock_lots', 'inventory_logs', 'admins', 'stock_requests'];
    $found = array_column(
        Db::all(
            "SELECT table_name AS n FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
        ),
        'n',
    );
    $found = array_map('strtolower', $found);

    echo "\nตาราง\n";
    foreach ($tables as $t) {
        $has = in_array($t, $found, true);
        $n = $has ? (int) Db::value("SELECT COUNT(*) FROM `{$t}`") : 0;
        line($t, $has ? "{$n} แถว" : 'ไม่พบ', $has);
        if (!$has) {
            $problems[] = $t === 'stock_requests'
                ? 'ยังไม่ได้รัน migration — สั่ง: php api/bin/migrate.php'
                : "ไม่พบตาราง {$t} ในฐานข้อมูล";
        }
    }

    echo "\nความถูกต้องของข้อมูล\n";

    /*
     * ตารางของระบบนี้ทั้งหมด — `rx_orders` `branches` `branch_issues`
     * `stock_requests` เคยตกหล่นจากรายชื่อนี้ ทำให้ `fk_rx_log` ซึ่งเป็น
     * ของเราชี้หาของเราเอง ถูกนับเป็น FK ข้ามระบบมาตลอด
     */
    $mine = "'categories','suppliers','products','stock_lots','inventory_logs','admins',"
          . "'rx_orders','branches','branch_issues','stock_requests'";

    /*
     * FK ข้ามระบบที่ตั้งใจให้มี — หน้าร้านจองของและเบิกของไปผลิต ทั้งสองอย่าง
     * ชี้มาที่ล็อตของเรา และควรชี้ เพราะการลบล็อตทิ้งทั้งที่มีคนจองไว้คือบั๊ก
     * เส้นที่ไม่ได้อยู่ในรายชื่อนี้ต่างหากที่เป็นเรื่องต้องดู
     */
    $agreed = "'fk_pw_lot','fk_sr_lot','fk_cif_supplier'";

    $unexpected = Db::all(
        "SELECT DISTINCT constraint_name AS c, table_name AS t, referenced_table_name AS rt
           FROM information_schema.key_column_usage
          WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL
            AND constraint_name NOT IN ({$agreed})
            AND ((table_name IN ({$mine}) AND referenced_table_name NOT IN ({$mine}))
              OR (table_name NOT IN ({$mine}) AND referenced_table_name IN ({$mine})))"
    );
    $cross = count($unexpected);
    line(
        'FK ข้ามระบบที่ไม่ได้ตกลงกันไว้',
        $cross === 0 ? 'ไม่มี' : implode(', ', array_map(fn($r) => "{$r['t']}->{$r['rt']}", $unexpected)),
        $cross === 0,
    );
    if ($cross > 0) {
        $problems[] = 'มี foreign key ข้ามระบบที่ไม่ได้ตกลงกันไว้ — น่าจะมาจาก migration ของอีกฝั่ง';
    }

    $drift = Db::all(
        'SELECT l.lot_number FROM stock_lots l
         LEFT JOIN inventory_logs g ON g.lot_id = l.id
         GROUP BY l.id, l.lot_number, l.remaining_qty
         HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)'
    );
    line('ยอดคงเหลือตรงกับสมุด', $drift === [] ? 'ตรงทุกล็อต' : count($drift) . ' ล็อตไม่ตรง', $drift === []);
    if ($drift !== []) {
        $problems[] = 'ยอดคงเหลือไม่ตรงกับสมุด — ตรวจล็อต: ' . implode(', ', array_column($drift, 'lot_number'));
    }

    $canLogin = (int) Db::value('SELECT COUNT(*) FROM admins WHERE password_hash IS NOT NULL AND is_active = 1');
    line('บัญชีที่ล็อกอินได้', "{$canLogin} บัญชี", $canLogin > 0);
    if ($canLogin === 0) {
        $problems[] = 'ไม่มีบัญชีที่ล็อกอินได้เลย';
    }
} catch (Throwable $e) {
    line('การเชื่อมต่อ', $e->getMessage(), false);
    $problems[] = 'ต่อฐานข้อมูลไม่ได้ — ตรวจ DATABASE_URL ใน .env และไฟร์วอลล์ของเครื่องฐานข้อมูล';
}

echo "\n" . str_repeat('─', 56) . "\n";
if ($problems === []) {
    echo "พร้อมใช้งาน ไม่พบปัญหา\n\n";
    exit(0);
}

echo "พบ " . count($problems) . " เรื่องที่ต้องแก้:\n";
foreach ($problems as $p) {
    echo "  • {$p}\n";
}
echo "\n";
exit(1);
