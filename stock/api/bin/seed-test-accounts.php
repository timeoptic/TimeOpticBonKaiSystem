<?php

declare(strict_types=1);

/**
 *   php api/bin/seed-test-accounts.php --yes
 *
 * สร้างบัญชีตัวอย่างของทุกบทบาท รหัสผ่าน `1234` ทุกบัญชี สำหรับไล่ทดสอบว่า
 * แต่ละบทบาทเห็นอะไรและถูกพาไปหน้าไหน
 *
 * **รหัสผ่านสั้นกว่าขั้นต่ำ 10 ตัวที่ Users::create บังคับไว้** สคริปต์นี้เขียนลง
 * ตารางตรง ๆ จึงข้ามกฎนั้นได้ ซึ่งเป็นเหตุผลเดียวที่มันมีอยู่ และเป็นเหตุผลที่
 * มันต้องไม่ถูกรันบนเครื่องจริง — ลบบัญชีพวกนี้ทิ้งด้วย --remove ก่อนเปิดใช้งานจริง
 *
 * ต้องใส่ --yes เพราะบัญชีที่ทุกคนเดารหัสผ่านได้ ไม่ควรเกิดขึ้นจากการพิมพ์ผิด
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Auth;
use Optic\Db;
use Optic\Roles;

/** ชื่อผู้ใช้ => [บทบาท, ชื่อที่แสดง, ตำแหน่งงาน] */
const ACCOUNTS = [
    'test.sales' => [Roles::SALES,     'ทดสอบ · พนักงานขาย',  'reception,sales'],
    'test.stock' => [Roles::STOCK,     'ทดสอบ · พนักงานคลัง', 'stock'],
    'test.admin' => [Roles::ADMIN,     'ทดสอบ · แอดมิน',      'admin'],
    'test.owner' => [Roles::OWNER,     'ทดสอบ · เจ้าของร้าน', null],
    'test.super' => [Roles::SUPERUSER, 'ทดสอบ · ผู้ดูแลระบบ', null],
];

const PASSWORD = '1234';

$remove = in_array('--remove', $argv, true);
if (!$remove && !in_array('--yes', $argv, true)) {
    fwrite(STDERR, <<<TXT

    สคริปต์นี้สร้างบัญชีที่รหัสผ่านเป็น "1234" ทุกบัญชี สำหรับทดสอบเท่านั้น
    ยืนยันด้วย:  php api/bin/seed-test-accounts.php --yes
    ลบทิ้งด้วย:  php api/bin/seed-test-accounts.php --remove


    TXT);
    exit(1);
}

if ($remove) {
    $n = 0;
    foreach (array_keys(ACCOUNTS) as $username) {
        $n += Db::run('DELETE FROM admins WHERE username = ?', [$username]);
    }
    echo "\n  ลบบัญชีทดสอบแล้ว {$n} บัญชี\n\n";
    exit(0);
}

$hash = Auth::hashPassword(PASSWORD);

echo "\nบัญชีทดสอบ (รหัสผ่าน " . PASSWORD . " ทุกบัญชี)\n";
foreach (ACCOUNTS as $username => [$role, $displayName, $jobTitle]) {
    $existing = Db::value('SELECT id FROM admins WHERE username = ?', [$username]);
    if ($existing === null) {
        Db::run(
            'INSERT INTO admins (username, display_name, job_title, password_hash, role, is_active)
             VALUES (?, ?, ?, ?, ?, 1)',
            [$username, $displayName, $jobTitle, $hash, $role],
        );
        $what = 'สร้าง';
    } else {
        Db::run(
            'UPDATE admins SET display_name = ?, job_title = ?, password_hash = ?, role = ?, is_active = 1
             WHERE id = ?',
            [$displayName, $jobTitle, $hash, $role, (int) $existing],
        );
        $what = 'อัปเดต';
    }
    printf("  %-6s %-12s %-10s %s\n", $what, $username, $role, Roles::home($role));
}

echo "\n  ล็อกอินที่ /login/ แล้วระบบจะพาไปตามคอลัมน์ขวาสุด\n";
echo "  ลบทิ้งเมื่อเลิกทดสอบ: php api/bin/seed-test-accounts.php --remove\n\n";
