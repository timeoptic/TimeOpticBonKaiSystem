<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Env;

group('พื้นฐาน — env และการต่อฐานข้อมูล');

test('อ่าน DATABASE_URL จาก .env ได้', function () {
    $c = Env::database();
    ok($c['host'] !== '', 'host ต้องไม่ว่าง');
    ok($c['name'] !== '', 'ชื่อฐานข้อมูลต้องไม่ว่าง');
    ok($c['port'] > 0, 'port ต้องเป็นเลขบวก');
});

test('ตัวแปรสภาพแวดล้อมจริงชนะค่าในไฟล์', function () {
    putenv('OPTIC_TEST_KEY=from-env');
    eq(Env::get('OPTIC_TEST_KEY'), 'from-env', 'ค่าจาก getenv');
    putenv('OPTIC_TEST_KEY');
});

test('ต่อ MariaDB ได้', function () {
    $v = Db::value('SELECT VERSION()');
    ok(is_string($v) && $v !== '', 'ต้องได้เวอร์ชันกลับมา');
});

test('บังคับ STRICT_TRANS_TABLES บน session แล้ว', function () {
    $mode = (string) Db::value('SELECT @@session.sql_mode');
    ok(str_contains($mode, 'STRICT_TRANS_TABLES'), "sql_mode ของ session ต้องมี STRICT_TRANS_TABLES — ได้ {$mode}");
});

test('strict mode ทำให้ค่า UNSIGNED ติดลบเป็น error ไม่ใช่ปัดเป็น 0', function () {
    // นี่คือเหตุผลทั้งหมดที่ต้องบังคับ strict mode — ถ้าไม่บังคับ MariaDB จะ
    // ปัดค่าให้เป็น 0 พร้อม warning แล้วสต็อกจะเพี้ยนโดยไม่มีใครรู้
    $pdo = Db::conn();
    $pdo->exec('CREATE TEMPORARY TABLE t_unsigned_check (n INT UNSIGNED NOT NULL)');
    $pdo->exec('INSERT INTO t_unsigned_check (n) VALUES (3)');

    $threw = false;
    try {
        $pdo->exec('UPDATE t_unsigned_check SET n = n - 5');
    } catch (\PDOException) {
        $threw = true;
    }
    $pdo->exec('DROP TEMPORARY TABLE t_unsigned_check');

    ok($threw, 'การลบจนติดลบต้องโยน error');
});

test('ตารางของโมดูลครบทั้งหกตาราง', function () {
    $want = ['categories', 'suppliers', 'products', 'stock_lots', 'inventory_logs', 'admins'];
    $rows = Db::all(
        "SELECT table_name AS n FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
    );
    $have = array_map(static fn($r) => strtolower((string) $r['n']), $rows);

    foreach ($want as $t) {
        ok(in_array($t, $have, true), "ต้องมีตาราง {$t}");
    }
});

/**
 * This used to assert that no foreign key crossed between these tables and the
 * shop-floor system's, on the reasoning that two systems sharing a database
 * should not be welded together.
 *
 * They are not two systems any more — the decision was taken to merge them into
 * one project — so that rule now forbids something ordinary. A foreign key
 * between the tables of one system is how a database says what is true.
 *
 * What survives from it is the part that was never about system boundaries: a
 * delete somewhere else must not silently rewrite the stock history. CASCADE
 * removes a ledger row; SET NULL keeps the row and blanks the fact it recorded,
 * which is worse — the row still looks complete. Both are refused here for
 * anything pointing at the three tables that hold history. Lookup tables like
 * `suppliers` are deliberately not covered: a record whose supplier has been
 * removed is still a true record with one unknown field.
 */
test('ไม่มี foreign key ที่ลบแล้วไปแก้ประวัติสต็อกเงียบๆ', function () {
    $history = "'products','stock_lots','inventory_logs'";
    $bad = Db::all(
        "SELECT rc.table_name, rc.constraint_name, rc.delete_rule, rc.referenced_table_name
         FROM information_schema.referential_constraints rc
         WHERE rc.constraint_schema = DATABASE()
           AND rc.referenced_table_name IN ({$history})
           AND rc.delete_rule IN ('CASCADE', 'SET NULL')"
    );

    foreach ($bad as $r) {
        ok(false, sprintf(
            '%s (%s -> %s) ตั้ง ON DELETE %s — ต้องเป็น RESTRICT',
            $r['constraint_name'],
            $r['table_name'],
            $r['referenced_table_name'],
            $r['delete_rule'],
        ));
    }

    eq(count($bad), 0, 'จำนวน FK ที่ลบแล้วแก้ประวัติได้');
});

test('สมุดสต็อกยังตรงกับยอดคงเหลือทุกล็อต', function () {
    $bad = Db::all(
        'SELECT l.lot_number, l.remaining_qty, COALESCE(SUM(g.quantity), 0) AS ledger
         FROM stock_lots l
         LEFT JOIN inventory_logs g ON g.lot_id = l.id
         GROUP BY l.id, l.lot_number, l.remaining_qty
         HAVING l.remaining_qty <> ledger'
    );
    eq(count($bad), 0, 'ล็อตที่ยอดไม่ตรงกับสมุด');
});
