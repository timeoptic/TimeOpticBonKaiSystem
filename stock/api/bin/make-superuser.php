<?php

declare(strict_types=1);

/**
 *   php api/bin/make-superuser.php <username>
 *
 * สร้าง (หรือเลื่อน) บัญชีผู้ดูแลระบบ แล้วถามรหัสผ่านจากแป้นพิมพ์
 *
 * ไม่รับรหัสผ่านเป็นอาร์กิวเมนต์โดยตั้งใจ — อาร์กิวเมนต์ไปโผล่ใน history ของ
 * เชลล์และในรายการโปรเซสของทั้งเครื่อง ส่วนไฟล์ก็ไปโผล่ใน git ได้ · พิมพ์เอง
 * ตอนรัน แล้วรหัสผ่านจะอยู่แค่ในหน่วยความจำของโปรเซสนี้จนกว่าจะถูก hash
 *
 * บัญชีผู้ดูแลระบบไม่ใช่บัญชีของร้าน — มันอยู่เหนือเจ้าของร้าน และไม่โผล่ใน
 * หน้าจัดการผู้ใช้ของใครนอกจากผู้ดูแลระบบด้วยกัน
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Auth;
use Optic\Db;
use Optic\Roles;
use Optic\Service\Users;

$username = trim((string) ($argv[1] ?? ''));
if ($username === '') {
    fwrite(STDERR, "ใช้: php api/bin/make-superuser.php <username>\n");
    exit(1);
}
if (!preg_match('/^[a-z0-9_.-]{3,64}$/i', $username)) {
    fwrite(STDERR, "ชื่อผู้ใช้ต้องเป็น a-z 0-9 _ . - ยาว 3–64 ตัว\n");
    exit(1);
}

/** อ่านรหัสผ่านโดยไม่แสดงบนจอ เท่าที่เทอร์มินัลนี้ทำได้ */
function askSecret(string $prompt): string
{
    echo $prompt;
    if (DIRECTORY_SEPARATOR === '\\') {
        /* PowerShell อ่านให้แบบไม่โชว์ตัวอักษร — cmd.exe ธรรมดาทำไม่ได้
           ถ้าเรียกไม่สำเร็จ ตกไปใช้การอ่านแบบเห็นตัวอักษรข้างล่าง */
        $ps = 'powershell -NoProfile -Command "$p = Read-Host -AsSecureString; '
            . '[Runtime.InteropServices.Marshal]::PtrToStringAuto('
            . '[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))"';
        $out = shell_exec($ps);
        if (is_string($out) && trim($out) !== '') {
            echo "\n";
            return trim($out);
        }
    } else {
        shell_exec('stty -echo 2>/dev/null');
    }
    $line = fgets(STDIN);
    if (DIRECTORY_SEPARATOR !== '\\') {
        shell_exec('stty echo 2>/dev/null');
        echo "\n";
    }
    return trim((string) $line);
}

/**
 * ให้บทบาทผู้ดูแลระบบ โดยไม่แตะบทบาทอื่นที่บัญชีนี้ถืออยู่
 *
 * บัญชีกู้ระบบมักเป็นบัญชีที่มีอยู่แล้ว — เขียนทับทั้งชุดแปลว่าเจ้าของร้านที่รัน
 * สคริปต์นี้กับบัญชีตัวเอง จะเสียบทบาทเจ้าของร้านไปเงียบ ๆ
 */
function grantSuperuser(int $adminId): void
{
    Db::run(
        'INSERT IGNORE INTO admin_roles (admin_id, role) VALUES (?, ?)',
        [$adminId, Roles::SUPERUSER],
    );
}

$existing = Db::one('SELECT id, display_name FROM admins WHERE username = ?', [$username]);

echo "\nบัญชีผู้ดูแลระบบ\n";
echo $existing === null
    ? "  จะสร้างบัญชีใหม่ชื่อ “{$username}”\n"
    : "  มีบัญชีนี้อยู่แล้ว ({$existing['display_name']} · " . Roles::text(Auth::rolesOf((int) $existing['id'])) . ") จะเลื่อนเป็นผู้ดูแลระบบและตั้งรหัสผ่านใหม่\n";

$password = askSecret('  รหัสผ่าน (อย่างน้อย 10 ตัว): ');
if (mb_strlen($password) < 10) {
    fwrite(STDERR, "รหัสผ่านสั้นเกินไป ต้องอย่างน้อย 10 ตัว\n");
    exit(1);
}
if (askSecret('  พิมพ์อีกครั้ง: ') !== $password) {
    fwrite(STDERR, "สองครั้งไม่ตรงกัน ยังไม่ได้เปลี่ยนอะไร\n");
    exit(1);
}

$hash = Auth::hashPassword($password);

if ($existing === null) {
    $displayName = trim((string) ($argv[2] ?? '')) ?: $username;

    /* บัญชีทุกใบต้องมีพนักงานรองรับตั้งแต่ migration 027 — บัญชีกู้ระบบก็ไม่ยกเว้น
       สร้างพนักงานให้ก่อนแล้วค่อยเติมชื่อผู้ใช้กับรหัสผ่านลงในแถวที่ได้ · เจ้าของร้าน
       เปลี่ยนชื่อคนนี้ทีหลังได้ที่หน้าพนักงาน */
    Db::run('INSERT INTO employees (employee_name, active) VALUES (?, 1)', [mb_substr($displayName, 0, 120)]);
    $employeeId = (int) Db::value('SELECT LAST_INSERT_ID()');
    $id = Users::ensureFor($employeeId, $displayName, null, true);

    Db::run(
        'UPDATE admins SET username = ?, password_hash = ?, is_active = 1, must_change_password = 0
          WHERE id = ?',
        [$username, $hash, $id],
    );
    grantSuperuser($id);
    echo "\n  สร้างแล้ว — ล็อกอินด้วย “{$username}” ได้เลย\n\n";
} else {
    Db::run(
        'UPDATE admins SET password_hash = ?, is_active = 1, must_change_password = 0 WHERE id = ?',
        [$hash, (int) $existing['id']],
    );
    grantSuperuser((int) $existing['id']);
    echo "\n  อัปเดตแล้ว — บัญชี “{$username}” เป็นผู้ดูแลระบบและใช้รหัสผ่านใหม่\n\n";
}
