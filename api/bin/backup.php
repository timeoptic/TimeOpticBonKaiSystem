<?php

declare(strict_types=1);

/**
 * Writes every base table to one .sql file that can be pasted back.
 *
 * Here because the database this project points at lives on a machine in the
 * shop and `mysqldump` is not on the developer's PATH — and because the one
 * thing that must exist before a script truncates anything is a way back. The
 * output is plain `INSERT` statements wrapped in a transaction with foreign key
 * checks off, so it restores in any order.
 *
 * Views are skipped: they hold no rows, and their definitions are not this
 * script's to reproduce.
 *
 *   php api/bin/backup.php              เขียนลง api/var/backup-<เวลา>.sql
 *   php api/bin/backup.php path/to.sql  เขียนลงไฟล์ที่ระบุ
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;

$out = $argv[1] ?? __DIR__ . '/../var/backup-' . date('Ymd-His') . '.sql';

$dir = dirname($out);
if (!is_dir($dir)) {
    mkdir($dir, 0777, true);
}

$pdo = Db::conn();

$tables = [];
foreach (Db::all('SHOW FULL TABLES') as $row) {
    $values = array_values($row);
    // SHOW FULL TABLES names its first column after the database, so the values
    // are read by position: [name, type].
    if (($values[1] ?? '') === 'BASE TABLE') {
        $tables[] = (string) $values[0];
    }
}

$fh = fopen($out, 'wb');
if ($fh === false) {
    fwrite(STDERR, "เขียนไฟล์ {$out} ไม่ได้\n");
    exit(1);
}

fwrite($fh, "-- timeoptic · สำรองข้อมูล " . date('c') . "\n");
fwrite($fh, "-- คืนค่า: mysql -h <host> -u <user> -p <db> < " . basename($out) . "\n\n");
fwrite($fh, "SET FOREIGN_KEY_CHECKS = 0;\nSET NAMES utf8mb4;\nSTART TRANSACTION;\n\n");

$total = 0;
foreach ($tables as $table) {
    $rows = Db::all("SELECT * FROM `{$table}`");
    fwrite($fh, "-- {$table}: " . count($rows) . " แถว\n");
    fwrite($fh, "DELETE FROM `{$table}`;\n");

    foreach ($rows as $row) {
        $cols = array_map(static fn(string $c): string => "`{$c}`", array_keys($row));
        $vals = array_map(
            static fn(mixed $v): string => $v === null ? 'NULL' : $pdo->quote((string) $v),
            array_values($row),
        );
        fwrite($fh, "INSERT INTO `{$table}` (" . implode(',', $cols) . ') VALUES ('
            . implode(',', $vals) . ");\n");
        $total++;
    }
    fwrite($fh, "\n");
}

fwrite($fh, "COMMIT;\nSET FOREIGN_KEY_CHECKS = 1;\n");
fclose($fh);

printf(
    "สำรองแล้ว %d ตาราง %s แถว\n  %s  (%s)\n",
    count($tables),
    number_format($total),
    realpath($out) ?: $out,
    number_format((int) (filesize($out) / 1024)) . ' KB',
);
