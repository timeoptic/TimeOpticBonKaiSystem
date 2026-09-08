<?php

declare(strict_types=1);

/**
 *   php api/bin/seed-test-accounts.php --yes
 *
 * สร้างบัญชีตัวอย่างของทุกบทบาท รหัสผ่าน `1234` ทุกบัญชี สำหรับไล่ทดสอบว่า
 * แต่ละบทบาทเห็นอะไรและถูกพาไปหน้าไหน
 *
 * **รหัสผ่านสั้นกว่าขั้นต่ำ 10 ตัวที่ Users บังคับไว้ปกติ** สคริปต์นี้เขียนลง
 * ตารางตรง ๆ จึงข้ามกฎนั้นได้ ซึ่งเป็นเหตุผลเดียวที่มันมีอยู่ และเป็นเหตุผลที่
 * มันต้องไม่ถูกรันบนเครื่องจริง — ลบบัญชีพวกนี้ทิ้งด้วย --remove ก่อนเปิดใช้งานจริง
 *
 * ต้องใส่ --yes เพราะบัญชีที่ทุกคนเดารหัสผ่านได้ ไม่ควรเกิดขึ้นจากการพิมพ์ผิด
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Auth;
use Optic\Db;
use Optic\Roles;
use Optic\Service\Users;

/**
 * ชื่อผู้ใช้ => [บทบาทที่ถือ, ชื่อที่แสดง, ตำแหน่งงาน]
 *
 * `test.manager` ถือสองบทบาท เพราะการรวมสิทธิ์เป็นสิ่งที่ต้องมีคนไล่กดดูจริง —
 * เมทริกซ์ในเทสต์บอกได้ว่ากฎถูก แต่บอกไม่ได้ว่าเมนูทั้งสองฝั่งโผล่พร้อมกันแล้วใช้ได้ไหม
 */
const ACCOUNTS = [
    'test.sales'   => [[Roles::SALES],   'ทดสอบ · พนักงานขาย',   'reception,sales'],
    'test.trainee' => [[Roles::TRAINEE], 'ทดสอบ · พนักงานฝึกหัด', 'reception'],
    'test.stock'   => [[Roles::STOCK],   'ทดสอบ · พนักงานคลัง',  'stock'],
    'test.admin'   => [[Roles::ADMIN],   'ทดสอบ · แอดมิน',       'admin'],
    'test.manager' => [[Roles::SALES, Roles::ADMIN], 'ทดสอบ · ขาย+แอดมิน', 'manager'],
    'test.owner'   => [[Roles::OWNER],   'ทดสอบ · เจ้าของร้าน',  null],
    'test.super'   => [[Roles::SUPERUSER], 'ทดสอบ · ผู้ดูแลระบบ', null],
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
        /* บทบาทก่อน แล้วค่อยบัญชี — `admin_roles.admin_id` เป็น foreign key
           ลบสลับลำดับแล้วฐานปฏิเสธ ไม่ใช่ลบตามให้ */
        Db::run(
            'DELETE r FROM admin_roles r JOIN admins a ON a.id = r.admin_id WHERE a.username = ?',
            [$username],
        );
        $n += Db::run('DELETE FROM admins WHERE username = ?', [$username]);
    }
    echo "\n  ลบบัญชีทดสอบแล้ว {$n} บัญชี\n\n";
    exit(0);
}

$hash = Auth::hashPassword(PASSWORD);

echo "\nบัญชีทดสอบ (รหัสผ่าน " . PASSWORD . " ทุกบัญชี)\n";
foreach (ACCOUNTS as $username => [$roles, $displayName, $jobTitle]) {
    $existing = Db::value('SELECT id FROM admins WHERE username = ?', [$username]);
    if ($existing === null) {
        /* บัญชีทุกใบต้องมีพนักงานรองรับ — บัญชีทดสอบก็เป็นคนในสายตาของระบบ
           และจะโผล่ในรายชื่อพนักงาน ซึ่งเป็นสิ่งที่ตั้งใจ ไม่ใช่ผลข้างเคียง */
        Db::run('INSERT INTO employees (employee_name, roles, active) VALUES (?, ?, 1)', [$displayName, $jobTitle]);
        $employeeId = (int) Db::value('SELECT LAST_INSERT_ID()');
        $id = Users::ensureFor($employeeId, $displayName, $jobTitle, true);

        Db::run(
            'UPDATE admins SET username = ?, password_hash = ?, is_active = 1, must_change_password = 0
              WHERE id = ?',
            [$username, $hash, $id],
        );
        $what = 'สร้าง';
    } else {
        $id = (int) $existing;
        Db::run(
            'UPDATE admins SET display_name = ?, job_title = ?, password_hash = ?, is_active = 1,
                    must_change_password = 0
             WHERE id = ?',
            [$displayName, $jobTitle, $hash, $id],
        );
        $what = 'อัปเดต';
    }

    /* เขียนทับทั้งชุด ไม่ใช่เติม — บัญชีทดสอบต้องถือตรงตามตารางข้างบนเป๊ะ
       ไม่งั้นรันซ้ำหลังแก้ตารางแล้วจะได้บทบาทเก่าค้างอยู่ด้วย */
    Db::run('DELETE FROM admin_roles WHERE admin_id = ?', [$id]);
    foreach ($roles as $role) {
        Db::run('INSERT INTO admin_roles (admin_id, role) VALUES (?, ?)', [$id, $role]);
    }

    printf("  %-6s %-14s %-18s %s\n", $what, $username, Roles::text($roles), Roles::home($roles));
}

echo "\n  ล็อกอินที่ /login/ แล้วระบบจะพาไปตามคอลัมน์ขวาสุด\n";
echo "  ลบทิ้งเมื่อเลิกทดสอบ: php api/bin/seed-test-accounts.php --remove\n\n";
