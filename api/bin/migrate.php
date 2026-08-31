<?php

declare(strict_types=1);

/**
 *   php api/bin/migrate.php --dry     รายการที่ยังไม่ได้รัน
 *   php api/bin/migrate.php           รันที่เหลือทั้งหมด
 *
 * Applies the .sql files in api/migrations in filename order, once each.
 * Deliberately dumb: no rollback, no branching. Schema changes to a database
 * the shop-floor system shares are reviewed by hand, so the tool's only job is
 * to make sure a file runs exactly once and to say what it did.
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;

$dry = in_array('--dry', $argv, true);

Db::conn()->exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(160) NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (filename)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

$done = array_column(Db::all('SELECT filename FROM schema_migrations'), 'filename');

$files = glob(__DIR__ . '/../migrations/*.sql') ?: [];
sort($files);

$pending = array_values(array_filter(
    $files,
    static fn(string $f) => !in_array(basename($f), $done, true),
));

if ($pending === []) {
    echo "ไม่มี migration ค้าง — ทั้งหมด " . count($files) . " ไฟล์รันไปแล้ว\n";
    exit(0);
}

echo "ค้างอยู่ " . count($pending) . " ไฟล์:\n";
foreach ($pending as $f) {
    echo '  ' . basename($f) . "\n";
}

if ($dry) {
    echo "\n--dry — ยังไม่ได้รันอะไร\n";
    exit(0);
}

echo "\n";
foreach ($pending as $f) {
    $sql = file_get_contents($f);
    if ($sql === false) {
        fwrite(STDERR, 'อ่านไฟล์ไม่ได้: ' . $f . "\n");
        exit(1);
    }

    try {
        Db::conn()->exec($sql);
        Db::run('INSERT INTO schema_migrations (filename) VALUES (?)', [basename($f)]);
        echo '  รัน ' . basename($f) . " แล้ว\n";
    } catch (Throwable $e) {
        fwrite(STDERR, '  ล้มเหลวที่ ' . basename($f) . ': ' . $e->getMessage() . "\n");
        exit(1);
    }
}

echo "\nเสร็จแล้ว\n";
