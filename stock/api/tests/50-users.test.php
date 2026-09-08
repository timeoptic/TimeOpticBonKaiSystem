<?php

declare(strict_types=1);

use Optic\Auth;
use Optic\Db;
use Optic\Roles;
use Optic\Service\Users;

function uname(): string
{
    return 'u' . strtolower(bin2hex(random_bytes(4)));
}

/**
 * A product to hang a log row on, made here rather than borrowed.
 *
 * `SELECT id FROM products LIMIT 1` is the tempting version and it is wrong: the
 * catalogue is empty on a freshly wiped database, and a test that skips itself
 * when the shelf is bare is a test that stops guarding anything.
 */
function aProduct(): int
{
    $made = \Optic\Service\Catalog::createProduct([
        'sku'                => 'DEL-' . strtoupper(bin2hex(random_bytes(3))),
        'name'               => 'สินค้าไว้ผูกประวัติ',
        'product_type'       => 'Frame',
        'category_id'        => (int) Db::value('SELECT id FROM categories ORDER BY id LIMIT 1'),
        'base_selling_price' => '100',
    ], [Roles::OWNER]);

    return (int) $made['id'];
}

group('จัดการผู้ใช้');

test('ผู้ที่จัดการผู้ใช้ได้เท่านั้นที่ดูรายชื่อได้', function () {
    withRollback(function () {
        $rows = Users::list([Roles::OWNER])['users'];
        ok(count($rows) >= 6, 'ต้องเห็นทุกคน (เจ้าของ + พนักงานที่นำเข้ามา)');
        ok(count(Users::list([Roles::ADMIN])['users']) > 0, 'แอดมินดูรายชื่อได้');
        throwsReason('forbidden', fn() => Users::list([Roles::SALES])['users'], 'พนักงานขายดูรายชื่อ');
        throwsReason('forbidden', fn() => Users::list([Roles::STOCK])['users'], 'พนักงานคลังดูรายชื่อ');
    });
});

test('บัญชีที่สูงกว่าคนดู ไม่โผล่ในรายชื่อและแก้ไม่ได้', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('ผู้ดูแลระบบทดสอบ');
        $super = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::SUPERUSER]],
            [Roles::SUPERUSER],
        );

        $seenByAdmin = array_column(Users::list([Roles::ADMIN])['users'], 'username');
        ok(!in_array($u, $seenByAdmin, true), 'แอดมินต้องไม่เห็นบัญชีผู้ดูแลระบบ');
        ok(!in_array('owner', $seenByAdmin, true), 'แอดมินต้องไม่เห็นบัญชีเจ้าของร้าน');

        ok(in_array($u, array_column(Users::list([Roles::SUPERUSER])['users'], 'username'), true), 'ผู้ดูแลระบบเห็นบัญชีตัวเอง');

        throwsReason(
            'forbidden',
            fn() => Users::update(
                (int) $super['id'],
                ['roles' => [Roles::SUPERUSER], 'username' => $u, 'is_active' => true],
                [Roles::OWNER],
                1,
            ),
            'เจ้าของร้านแก้บัญชีผู้ดูแลระบบ',
        );
        throwsReason(
            'forbidden',
            fn() => Users::setPassword((int) $super['id'], ['password' => 'another-password'], [Roles::OWNER]),
            'เจ้าของร้านตั้งรหัสผ่านให้ผู้ดูแลระบบ',
        );
    });
});

test('ตั้งบทบาทสูงกว่าตัวเองไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('เจ้าของปลอม');
        throwsReason(
            'forbidden',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::OWNER]],
                [Roles::ADMIN],
            ),
            'แอดมินสร้างบัญชีเจ้าของร้าน',
        );
    });
});

test('รายชื่อบอกว่าใครล็อกอินได้บ้าง', function () {
    withRollback(function () {
        $rows = Users::list([Roles::OWNER])['users'];
        $owner = array_values(array_filter($rows, fn($r) => $r['username'] === 'owner'))[0] ?? null;
        ok($owner !== null, 'ต้องมีบัญชี owner');
        eq($owner['canSignIn'], true, 'owner ล็อกอินได้');

        $noLogin = array_values(array_filter($rows, fn($r) => $r['username'] === null));
        ok(count($noLogin) > 0, 'ต้องมีคนที่ยังไม่มีบัญชีล็อกอิน');
        eq($noLogin[0]['canSignIn'], false, 'คนที่ไม่มี username ล็อกอินไม่ได้');
    });
});

test('เพิ่มคนที่ยังไม่ต้องล็อกอินได้ — ต้องมีตัวตนไว้บันทึกว่าใครทำ', function () {
    withRollback(function () {
        $emp = anEmployee('ช่างใหม่', true, 'technician');
        $made = ['id' => Users::ensureFor($emp, 'ช่างใหม่', 'technician', true)];

        $row = Db::one('SELECT * FROM admins WHERE id = ?', [$made['id']]);
        eq($row['username'], null, 'ไม่มีชื่อผู้ใช้');
        eq($row['password_hash'], null, 'ไม่มีรหัสผ่าน');
        eq($row['job_title'], 'technician', 'ตำแหน่งงาน');
    });
});

test('เพิ่มคนพร้อมบัญชีล็อกอินแล้วเข้าระบบได้จริง', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('ฝ่ายบัญชีใหม่');
        Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::ADMIN]],
            [Roles::OWNER],
        );

        $actor = Auth::login($u, 'a-strong-password');
        eq($actor['roles'], [Roles::ADMIN], 'สิทธิ์ที่ได้');
        eq($actor['username'], $u, 'ชื่อผู้ใช้');
    });
});

test('ตั้งชื่อผู้ใช้แล้วต้องมีรหัสผ่านด้วย', function () {
    withRollback(function () {
        $emp = anEmployee('ไม่มีรหัส');
        throwsReason(
            'missing_field',
            fn() => Users::grantAccount($emp, ['username' => uname(), 'roles' => [Roles::SALES]], [Roles::OWNER]),
            'มี username แต่ไม่มีรหัส',
        );
    });
});

test('รหัสผ่านสั้นเกินไปถูกปฏิเสธ', function () {
    withRollback(function () {
        $emp = anEmployee('รหัสสั้น');
        throwsReason(
            'weak_password',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => '1234', 'roles' => [Roles::SALES]],
                [Roles::OWNER],
            ),
            'รหัส 4 ตัว',
        );
    });
});

test('ชื่อผู้ใช้ซ้ำถูกปฏิเสธ', function () {
    withRollback(function () {
        $emp = anEmployee('ซ้ำ');
        throwsReason(
            'duplicate_username',
            fn() => Users::grantAccount(
                $emp,
                ['username' => 'owner', 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
                [Roles::OWNER],
            ),
            'username ซ้ำ',
        );
    });
});

test('ชื่อผู้ใช้ที่มีอักขระต้องห้ามถูกปฏิเสธ', function () {
    withRollback(function () {
        foreach (['ก ข', 'ab', 'has space'] as $bad) {
            $emp = anEmployee('x');
            throwsReason(
                'bad_username',
                fn() => Users::grantAccount(
                    $emp,
                    ['username' => $bad, 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
                    [Roles::OWNER],
                ),
                "username \"{$bad}\"",
            );
        }
    });
});

group('แก้ไขผู้ใช้');

test('เปลี่ยนบทบาทได้ โดยไม่แตะชื่อและตำแหน่งงาน — สองอย่างนั้นมาจากหน้าพนักงาน', function () {
    withRollback(function () {
        $emp = anEmployee('คนทดสอบ', true, 'admin,reception');
        $made = ['id' => Users::ensureFor($emp, 'คนทดสอบ', 'admin,reception', true)];

        Users::update(
            $made['id'],
            ['roles' => [Roles::ADMIN], 'is_active' => true],
            [Roles::OWNER],
            1,
        );

        $row = Db::one('SELECT display_name, job_title FROM admins WHERE id = ?', [$made['id']]);
        eq(Users::rolesOf($made['id']), [Roles::ADMIN], 'บทบาทที่ตั้ง');
        eq($row['display_name'], 'คนทดสอบ', 'ชื่อไม่เปลี่ยนเพราะ update() ไม่รับชื่อแล้ว');
        eq($row['job_title'], 'admin,reception', 'ตำแหน่งงานไม่เปลี่ยนเพราะ update() ไม่รับตำแหน่งงานแล้ว');
    });
});

test('ปิดใช้งานบัญชีแล้วล็อกอินไม่ได้', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('จะถูกปิด');
        $made = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
        );
        Auth::login($u, 'a-strong-password');

        Users::update(
            $made['id'],
            ['roles' => [Roles::SALES], 'username' => $u, 'is_active' => false],
            [Roles::OWNER],
            1,
        );

        throwsReason('bad_credentials', fn() => Auth::login($u, 'a-strong-password'), 'บัญชีถูกปิด');
    });
});

test('ปิดใช้งานบัญชีตัวเองไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'self_lockout',
            fn() => Users::update(1, ['roles' => [Roles::OWNER], 'username' => 'owner', 'is_active' => false], [Roles::OWNER], 1),
            'ปิดบัญชีตัวเอง',
        );
    });
});

test('ลดสิทธิ์ตัวเองไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'self_lockout',
            fn() => Users::update(1, ['roles' => [Roles::SALES], 'username' => 'owner', 'is_active' => true], [Roles::OWNER], 1),
            'ลดสิทธิ์ตัวเอง',
        );
    });
});

test('ต้องเหลือเจ้าของร้านที่ใช้งานได้อย่างน้อยหนึ่งคน', function () {
    withRollback(function () {
        /* เริ่มจากสถานะที่รู้แน่: เจ้าของร้านที่ใช้งานได้เหลือคนเดียวคือ id 1
           ก่อนหน้านี้เทสต์นี้เชื่อว่าฐานข้อมูลเป็นแบบนั้นอยู่แล้ว แล้วก็เงียบไป
           ทันทีที่มีบัญชีเจ้าของร้านเพิ่มเข้ามาอีกใบ (เช่น บัญชีทดสอบ) */
        Db::run("UPDATE admins a JOIN admin_roles r ON r.admin_id = a.id
                  SET a.is_active = 0 WHERE r.role = 'owner' AND a.id <> 1");

        // สร้างเจ้าของคนที่สองแล้วให้เขาปลดเจ้าของคนแรก จะได้ไม่ชนกฎ "ห้ามแก้ตัวเอง"
        $emp = anEmployee('เจ้าของสอง');
        $second = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::OWNER]],
            [Roles::OWNER],
        );

        // ตอนนี้มีสองคน ปลดคนแรกได้
        Users::update(1, ['roles' => [Roles::SALES], 'username' => 'owner', 'is_active' => true], [Roles::OWNER], $second['id']);

        // เหลือคนเดียว ปลดต่อไม่ได้แล้ว
        throwsReason(
            'last_owner',
            fn() => Users::update(
                $second['id'],
                ['roles' => [Roles::SALES], 'username' => 'x' . uname(), 'is_active' => true],
                [Roles::OWNER],
                1,
            ),
            'ปลดเจ้าของคนสุดท้าย',
        );
    });
});

group('ตั้งรหัสผ่าน');

test('เจ้าของร้านตั้งรหัสให้คนอื่นได้ และรหัสใหม่ใช้ได้จริง', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('เปลี่ยนรหัส');
        $made = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'first-password-x', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
        );

        Users::setPassword($made['id'], ['password' => 'second-password-x'], [Roles::OWNER]);

        throwsReason('bad_credentials', fn() => Auth::login($u, 'first-password-x'), 'รหัสเก่าต้องใช้ไม่ได้');
        $actor = Auth::login($u, 'second-password-x');
        eq($actor['id'], $made['id'], 'รหัสใหม่ใช้ได้');
    });
});

test('ตั้งรหัสให้คนที่ยังไม่มีชื่อผู้ใช้ไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ไม่มี username');
        $made = ['id' => Users::ensureFor($emp, 'ไม่มี username', null, true)];
        throwsReason(
            'no_username',
            fn() => Users::setPassword($made['id'], ['password' => 'a-strong-password'], [Roles::OWNER]),
            'ตั้งรหัสก่อนมีชื่อผู้ใช้',
        );
    });
});

test('ฝ่ายบัญชีตั้งรหัสให้คนอื่นไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'forbidden',
            fn() => Users::setPassword(1, ['password' => 'a-strong-password'], [Roles::ADMIN]),
            'accountant ตั้งรหัส',
        );
    });
});

group('ลบผู้ใช้ไม่ได้อีกแล้ว');

test('เมธอดลบผู้ใช้ไม่มีอยู่แล้ว', function () {
    ok(!method_exists(Users::class, 'delete'), 'Users::delete ต้องถูกถอดออก');
    ok(!method_exists(Users::class, 'create'), 'Users::create ต้องถูกถอดออก');
});

test('ฐานข้อมูลปฏิเสธบัญชีที่ไม่มีพนักงานรองรับ', function () {
    withRollback(function () {
        $threw = false;
        try {
            Db::run("INSERT INTO admins (display_name, is_active) VALUES ('ไม่มีพนักงาน', 1)");
        } catch (\PDOException $e) {
            $threw = true;
        }
        ok($threw, 'INSERT ที่ไม่ใส่ employee_id ต้องถูกฐานปฏิเสธ');
    });
});

test('บัญชีที่ชี้ไปยังพนักงานที่ไม่มีอยู่ ฐานปฏิเสธ', function () {
    withRollback(function () {
        $threw = false;
        try {
            Db::run("INSERT INTO admins (employee_id, display_name, is_active) VALUES (999999999, 'ผี', 1)");
        } catch (\PDOException $e) {
            $threw = true;
        }
        ok($threw, 'foreign key ต้องปฏิเสธ employee_id ที่ไม่มีจริง');
    });
});

test('เปิดบัญชีของคนที่ลาออกไปแล้วไม่ได้', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('ลาออกแล้วแต่อยากกลับ');
        $made = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
        );

        // Mirrors the real flow: the employee screen closes `employees.active`
        // first, then mirrors that into `admins` via syncFromEmployee().
        Db::run('UPDATE employees SET active = 0 WHERE id = ?', [$emp]);
        Users::syncFromEmployee($emp, 'ลาออกแล้วแต่อยากกลับ', null, false, 1);

        throwsReason(
            'employee_inactive',
            fn() => Users::update($made['id'], ['username' => $u, 'roles' => [Roles::SALES], 'is_active' => true], [Roles::OWNER], 1),
            'เปิดบัญชีของคนที่ลาออกแล้ว',
        );
    });
});

/* สามเคสด้านล่างนี้เคยเป็นส่วนหนึ่งของกลุ่ม "ลบผู้ใช้" เดิม — ปกป้องกฎที่ยังมีผล
   กับ revokeAccount() อยู่ (requireReach · Roles::require · notFound) จึงถูกแปลง
   เป็นเวอร์ชัน revoke แทนการลบทิ้งไปพร้อมกับกลุ่มเดิม */

test('ยกเลิกบัญชีที่สิทธิ์สูงกว่าตัวเองไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('เจ้าของที่แอดมินเอื้อมไม่ถึง');
        $owner = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::OWNER]],
            [Roles::OWNER],
        );
        throwsReason(
            'forbidden',
            fn() => Users::revokeAccount($owner['id'], [Roles::ADMIN], 1),
            'แอดมินยกเลิกบัญชีเจ้าของร้าน',
        );
    });
});

test('พนักงานยกเลิกบัญชีใครไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('เป้าหมาย');
        $made = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::STOCK]],
            [Roles::OWNER],
        );
        throwsReason('forbidden', fn() => Users::revokeAccount($made['id'], [Roles::SALES], 1), 'พนักงานขายยกเลิกบัญชี');
        throwsReason('forbidden', fn() => Users::revokeAccount($made['id'], [Roles::STOCK], 1), 'พนักงานคลังยกเลิกบัญชี');
    });
});

test('ยกเลิกบัญชีของคนที่ไม่มีอยู่จริง ตอบว่าไม่พบ', function () {
    withRollback(function () {
        throwsReason('not_found', fn() => Users::revokeAccount(999999, [Roles::OWNER], 1), 'ยกเลิกบัญชี id ที่ไม่มี');
    });
});

/**
 * พนักงานหนึ่งคนสำหรับเคสที่ต้องมีตัวตนรองรับบัญชี
 *
 * สร้างใหม่ทุกครั้งแทนการหยิบแถวแรกจากฐาน — เคสที่แก้พนักงานที่มีอยู่จริงจะ
 * ทำให้เคสอื่นที่หยิบแถวเดียวกันล้มแบบสลับไปมา และ withRollback() ย้อนคืนให้อยู่แล้ว
 */
function anEmployee(string $name, bool $active = true, ?string $roles = null): int
{
    Db::run(
        'INSERT INTO employees (employee_name, roles, active) VALUES (?, ?, ?)',
        [$name, $roles, $active ? 1 : 0],
    );
    return (int) Db::value('SELECT LAST_INSERT_ID()');
}

group('พนักงานคือข้อมูลหลัก');

test('เพิ่มพนักงานแล้วได้แถวบัญชีที่ยังเข้าระบบไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ช่างใหม่', true, 'technician');
        $id = Users::ensureFor($emp, 'ช่างใหม่', 'technician', true);

        $row = Db::one('SELECT * FROM admins WHERE id = ?', [$id]);
        eq((int) $row['employee_id'], $emp, 'ผูกกับพนักงานคนที่สร้าง');
        eq($row['username'], null, 'ยังไม่มีชื่อผู้ใช้');
        eq($row['password_hash'], null, 'ยังไม่มีรหัสผ่าน');
        eq($row['display_name'], 'ช่างใหม่', 'ชื่อที่แสดงคัดลอกมาจากพนักงาน');
        eq($row['job_title'], 'technician', 'หน้าที่คัดลอกมาจากพนักงาน');
        eq((int) $row['is_active'], 1, 'เปิดใช้งานตามพนักงาน');
    });
});

test('เรียกซ้ำไม่สร้างแถวที่สอง', function () {
    withRollback(function () {
        $emp = anEmployee('เรียกซ้ำ');
        $first = Users::ensureFor($emp, 'เรียกซ้ำ', null, true);
        $again = Users::ensureFor($emp, 'ชื่ออื่น', 'x', false);

        eq($again, $first, 'คืน id เดิม');
        eq((int) Db::value('SELECT COUNT(*) FROM admins WHERE employee_id = ?', [$emp]), 1, 'มีแถวเดียว');
        eq(
            Db::value('SELECT display_name FROM admins WHERE id = ?', [$first]),
            'เรียกซ้ำ',
            'ไม่แก้ของเดิม — การแก้เป็นงานของ syncFromEmployee',
        );
    });
});

test('สร้างบัญชีให้พนักงานที่ไม่มีอยู่ไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'not_found',
            fn() => Users::ensureFor(999999999, 'ผี', null, true),
            'ผูกกับพนักงานที่ไม่มีอยู่',
        );
    });
});

test('ปิดพนักงานแล้วบัญชีถูกปิดตาม และล็อกอินไม่ได้ทันที', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('จะลาออก');
        $id = Users::ensureFor($emp, 'จะลาออก', null, true);
        Db::run(
            'UPDATE admins SET username = ?, password_hash = ? WHERE id = ?',
            [$u, Auth::hashPassword('a-strong-password'), $id],
        );
        /* เขียนแถวตรง ๆ แบบนี้ข้าม grantAccount() ไป บทบาทจึงต้องใส่เอง —
           บัญชีที่ไม่มีบทบาทเลยล็อกอินไม่ได้ตั้งแต่ Auth::login */
        Db::run("INSERT INTO admin_roles (admin_id, role) VALUES (?, 'sales')", [$id]);
        Auth::login($u, 'a-strong-password');

        Users::syncFromEmployee($emp, 'จะลาออก', null, false, 1);

        eq((int) Db::value('SELECT is_active FROM admins WHERE id = ?', [$id]), 0, 'บัญชีถูกปิด');
        throwsReason('bad_credentials', fn() => Auth::login($u, 'a-strong-password'), 'ล็อกอินหลังพนักงานลาออก');
    });
});

test('รับพนักงานกลับ บัญชียังปิดอยู่ — ต้องเปิดเองที่หน้าผู้ใช้', function () {
    withRollback(function () {
        $emp = anEmployee('กลับมาทำงาน');
        $id = Users::ensureFor($emp, 'กลับมาทำงาน', null, true);

        Users::syncFromEmployee($emp, 'กลับมาทำงาน', null, false, 1);
        Users::syncFromEmployee($emp, 'กลับมาทำงาน', null, true, 1);

        eq((int) Db::value('SELECT is_active FROM admins WHERE id = ?', [$id]), 0, 'บัญชียังปิดอยู่');
    });
});

test('แก้ชื่อพนักงานแล้วชื่อในบัญชีตามไปด้วย', function () {
    withRollback(function () {
        $emp = anEmployee('ชื่อเก่า');
        $id = Users::ensureFor($emp, 'ชื่อเก่า', null, true);

        Users::syncFromEmployee($emp, 'ชื่อใหม่', 'reception', true, 1);

        $row = Db::one('SELECT display_name, job_title FROM admins WHERE id = ?', [$id]);
        eq($row['display_name'], 'ชื่อใหม่', 'ชื่อที่แสดง');
        eq($row['job_title'], 'reception', 'หน้าที่');
    });
});

test('ปิดพนักงานที่เป็นบัญชีของตัวเองไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ตัวเอง');
        $id = Users::ensureFor($emp, 'ตัวเอง', null, true);

        throwsReason(
            'self_lockout',
            fn() => Users::syncFromEmployee($emp, 'ตัวเอง', null, false, $id),
            'ปิดพนักงานที่เป็นบัญชีที่กำลังใช้อยู่',
        );
        eq((int) Db::value('SELECT is_active FROM admins WHERE id = ?', [$id]), 1, 'บัญชีต้องไม่ถูกปิด');
    });
});

test('ปิดพนักงานที่เป็นเจ้าของร้านคนสุดท้ายไม่ได้', function () {
    withRollback(function () {
        Db::run("UPDATE admins a JOIN admin_roles r ON r.admin_id = a.id
                  SET a.is_active = 0 WHERE r.role = 'owner' AND a.id <> 1");
        $emp = anEmployee('เจ้าของร้าน');
        Db::run('UPDATE admins SET employee_id = ? WHERE id = 1', [$emp]);

        throwsReason(
            'last_owner',
            fn() => Users::syncFromEmployee($emp, 'เจ้าของร้าน', null, false, 2),
            'ปิดเจ้าของร้านคนสุดท้าย',
        );
        eq((int) Db::value('SELECT is_active FROM admins WHERE id = 1'), 1, 'บัญชีต้องไม่ถูกปิด');
    });
});

group('สร้างและยกเลิกบัญชีเข้าใช้งาน');

test('สร้างบัญชีให้พนักงานแล้วเข้าระบบได้จริง', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('พนักงานใหม่', true, 'reception,sales');

        $out = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
        );

        eq($out['employeeId'], $emp, 'คืน employeeId ของคนที่ได้บัญชี');
        eq($out['username'], $u, 'คืนชื่อผู้ใช้');

        $actor = Auth::login($u, 'a-strong-password');
        eq($actor['id'], $out['id'], 'ล็อกอินได้ด้วยบัญชีที่เพิ่งสร้าง');
        eq($actor['roles'], [Roles::SALES], 'สิทธิ์ที่ได้');
    });
});

test('สร้างบัญชีให้พนักงานที่ไม่มีอยู่ไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'not_found',
            fn() => Users::grantAccount(
                999999999,
                ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
                [Roles::OWNER],
            ),
            'สร้างบัญชีให้พนักงานที่ไม่มีอยู่',
        );
    });
});

test('สร้างบัญชีให้พนักงานที่ลาออกแล้วไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ลาออกไปแล้ว', false);
        throwsReason(
            'employee_inactive',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
                [Roles::OWNER],
            ),
            'สร้างบัญชีให้คนที่ลาออกแล้ว',
        );
    });
});

test('พนักงานคนเดียวมีสองบัญชีไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('มีบัญชีแล้ว');
        Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
        );

        throwsReason(
            'account_exists',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
                [Roles::OWNER],
            ),
            'สร้างบัญชีใบที่สองให้คนเดิม',
        );
    });
});

test('สร้างบัญชีต้องมีทั้งชื่อผู้ใช้และรหัสผ่าน', function () {
    withRollback(function () {
        $emp = anEmployee('ขาดของ');
        throwsReason(
            'missing_field',
            fn() => Users::grantAccount($emp, ['password' => 'a-strong-password', 'roles' => [Roles::SALES]], [Roles::OWNER]),
            'ไม่มีชื่อผู้ใช้',
        );
        throwsReason(
            'missing_field',
            fn() => Users::grantAccount($emp, ['username' => uname(), 'roles' => [Roles::SALES]], [Roles::OWNER]),
            'ไม่มีรหัสผ่าน',
        );
    });
});

test('สร้างบัญชีด้วยชื่อผู้ใช้ที่คนอื่นใช้อยู่แล้วไม่ได้', function () {
    withRollback(function () {
        $u = uname();
        Users::grantAccount(
            anEmployee('คนแรก'),
            ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
        );

        throwsReason(
            'duplicate_username',
            fn() => Users::grantAccount(
                anEmployee('คนที่สอง'),
                ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
                [Roles::OWNER],
            ),
            'ชื่อผู้ใช้ซ้ำกับพนักงานอีกคน',
        );
    });
});

test('ตั้งบทบาทสูงกว่าตัวเองตอนสร้างบัญชีไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('อยากเป็นเจ้าของ');
        throwsReason(
            'forbidden',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::OWNER]],
                [Roles::ADMIN],
            ),
            'แอดมินสร้างบัญชีเจ้าของร้าน',
        );
    });
});

test('ยกเลิกบัญชีแล้วเข้าระบบไม่ได้ แต่แถวยังอยู่ให้ประวัติอ่านชื่อ', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('จะถูกยกเลิกบัญชี');
        $out = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::STOCK]],
            [Roles::OWNER],
        );
        $product = aProduct();
        Db::run(
            'INSERT INTO inventory_logs (product_id, action_type, quantity, created_by, created_by_kind)
             VALUES (?, ?, ?, ?, ?)',
            [$product, 'ADJUST', 1, $out['id'], 'admin'],
        );

        Users::revokeAccount($out['id'], [Roles::OWNER], 1);

        throwsReason('bad_credentials', fn() => Auth::login($u, 'a-strong-password'), 'ล็อกอินหลังถูกยกเลิกบัญชี');

        $row = Db::one('SELECT username, password_hash, display_name FROM admins WHERE id = ?', [$out['id']]);
        ok($row !== null, 'แถวยังอยู่');
        eq($row['username'], null, 'ชื่อผู้ใช้ถูกล้าง');
        eq($row['password_hash'], null, 'รหัสผ่านถูกล้าง');
        eq($row['display_name'], 'จะถูกยกเลิกบัญชี', 'ชื่อยังอ่านได้');
    });
});

test('ยกเลิกบัญชีที่ยังไม่มีบัญชีไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ยังไม่มีบัญชี');
        $id = Users::ensureFor($emp, 'ยังไม่มีบัญชี', null, true);

        throwsReason(
            'no_account',
            fn() => Users::revokeAccount($id, [Roles::OWNER], 1),
            'ยกเลิกบัญชีที่ไม่มีอยู่',
        );
    });
});

test('ยกเลิกบัญชีตัวเองไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ยกเลิกตัวเอง');
        $out = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
        );

        throwsReason(
            'self_lockout',
            fn() => Users::revokeAccount($out['id'], [Roles::OWNER], $out['id']),
            'ยกเลิกบัญชีที่กำลังใช้อยู่',
        );
    });
});

test('ยกเลิกบัญชีเจ้าของร้านที่เข้าระบบได้คนสุดท้ายไม่ได้', function () {
    withRollback(function () {
        Db::run("UPDATE admins a JOIN admin_roles r ON r.admin_id = a.id
                  SET a.is_active = 0 WHERE r.role = 'owner' AND a.id <> 1");

        throwsReason(
            'last_owner',
            fn() => Users::revokeAccount(1, [Roles::OWNER], 2),
            'ยกเลิกบัญชีเจ้าของร้านคนสุดท้าย',
        );
    });
});

/* กฎเจ้าของร้านคนสุดท้ายมีสองแบบ และเทสต์ข้างบนแยกสองแบบนี้ไม่ออก เพราะมันปิดบัญชี
   อีกใบทิ้ง ซึ่งทำให้ทั้งสองแบบนับได้ศูนย์เหมือนกัน · เคสที่แยกออกจริงคือเจ้าของร้าน
   ที่เปิดใช้งานอยู่แต่ไม่มีรหัสผ่าน — นับว่า "ใช้งานอยู่" แต่ไม่นับว่า "เข้าระบบได้" */
test('เจ้าของร้านที่เปิดอยู่แต่ไม่มีรหัสผ่าน ไม่นับว่าเป็นคนที่เข้าระบบได้', function () {
    withRollback(function () {
        /* สร้างเจ้าของร้านทั้งสองคนเอง ไม่พึ่งบัญชีที่ seed มา — เทสต์นี้ต้องการคู่ที่
           ต่างกันตรงจุดที่กำลังวัดพอดี และบัญชี id 1 ยังไม่ผูกกับพนักงานจนกว่าจะถึง
           migration 027 การอ้างถึงมันตอนนี้คือการอ้างถึงสถานะที่ยังมาไม่ถึง */
        Db::run("UPDATE admins a JOIN admin_roles r ON r.admin_id = a.id
                  SET a.is_active = 0 WHERE r.role = 'owner'");

        $empReal = anEmployee('เจ้าของที่เข้าระบบได้');
        $real = Users::grantAccount(
            $empReal,
            ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::OWNER]],
            [Roles::OWNER],
        );

        $empGhost = anEmployee('เจ้าของที่ยังไม่มีบัญชี');
        $ghost = Users::ensureFor($empGhost, 'เจ้าของที่ยังไม่มีบัญชี', null, true);
        Db::run("INSERT INTO admin_roles (admin_id, role) VALUES (?, 'owner')", [$ghost]);

        /* ยกเลิกบัญชีของคนที่เข้าระบบได้ไม่ได้ — คนที่เหลือเปิดใช้งานอยู่ก็จริง
           แต่ไม่มีรหัสผ่าน จึงเข้าระบบไม่ได้ ร้านจะไม่เหลือใครเปิดประตูเข้ามา */
        throwsReason(
            'last_owner',
            fn() => Users::revokeAccount($real['id'], [Roles::OWNER], $ghost),
            'ยกเลิกบัญชีเจ้าของร้านคนสุดท้ายที่เข้าระบบได้',
        );

        /* แต่การ "ปิดใช้งาน" คนเดียวกันผ่าน เพราะคำถามของมันคือยังเหลือเจ้าของร้านที่
           ใช้งานอยู่ไหม ซึ่งตอบว่าเหลือ · สองท่อนนี้คือหลักฐานว่าสองคำถามให้คำตอบ
           ต่างกันจริง และ revokeAccount() ถามข้อที่ถูก — วันที่มีคนถอด signInOnly ออก
           ท่อนบนจะเลิกโยน แล้วเทสต์นี้จะแดงทันที ซึ่งเป็นเหตุผลเดียวที่มันมีอยู่ */
        Users::syncFromEmployee($empReal, 'เจ้าของที่เข้าระบบได้', null, false, $ghost);
        eq((int) Db::value('SELECT is_active FROM admins WHERE id = ?', [$real['id']]), 0, 'ปิดใช้งานผ่าน');
    });
});

group('หลายบทบาทในคนเดียว');

test('ให้หลายบทบาทตอนสร้างบัญชี แล้วสิทธิ์รวมกันจริง', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('ผู้จัดการ', true, 'manager');
        $out = Users::grantAccount(
            $emp,
            [
                'username' => $u,
                'password' => 'a-strong-password',
                'roles'    => [Roles::SALES, Roles::ADMIN],
            ],
            [Roles::OWNER],
            1,
        );

        eq(Users::rolesOf($out['id']), [Roles::ADMIN, Roles::SALES], 'เก็บครบสองใบ เรียงตามยศ');

        $actor = Auth::login($u, 'a-strong-password');
        eq($actor['roleText'], 'Admin + Sales', 'ข้อความบทบาทที่หน้าจอเอาไปแสดง');
        ok(Roles::useFrontdesk($actor['roles']), 'ได้ฝั่งหน้าร้าน');
        ok(Roles::seeCost($actor['roles']), 'ได้สิทธิ์เห็นต้นทุนจากใบแอดมิน');
        ok(!Roles::enterRxCost($actor['roles']), 'แต่ยังกรอกต้นทุนไม่ได้ ไม่มีใบไหนให้สิทธิ์นั้น');
    });
});

test('เพิ่มและถอดบทบาททีหลังได้ โดยใบที่ถืออยู่แล้วไม่ถูกเขียนใหม่', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('เริ่มจากขาย');
        $out = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
            1,
        );

        $firstGrant = Db::value(
            "SELECT granted_at FROM admin_roles WHERE admin_id = ? AND role = 'sales'",
            [$out['id']],
        );

        Users::update(
            $out['id'],
            ['username' => $u, 'roles' => [Roles::SALES, Roles::STOCK], 'is_active' => true],
            [Roles::OWNER],
            1,
        );
        eq(Users::rolesOf($out['id']), [Roles::SALES, Roles::STOCK], 'เพิ่มใบที่สอง');

        /* ใบเดิมต้องไม่ถูกลบแล้วเขียนใหม่ ไม่งั้น "ใครให้สิทธิ์นี้เมื่อไหร่" จะกลาย
           เป็นชื่อคนที่เผลอกดบันทึกโดยไม่ได้แก้อะไร */
        eq(
            Db::value("SELECT granted_at FROM admin_roles WHERE admin_id = ? AND role = 'sales'", [$out['id']]),
            $firstGrant,
            'granted_at ของใบเดิมไม่ถูกแตะ',
        );

        Users::update(
            $out['id'],
            ['username' => $u, 'roles' => [Roles::STOCK], 'is_active' => true],
            [Roles::OWNER],
            1,
        );
        eq(Users::rolesOf($out['id']), [Roles::STOCK], 'ถอดใบแรกออกแล้ว');
    });
});

test('บัญชีที่เข้าระบบได้ต้องเหลือสิทธิ์อย่างน้อยหนึ่งอย่าง', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('จะถูกถอดหมด');
        $out = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
            1,
        );

        throwsReason(
            'no_roles',
            fn() => Users::update($out['id'], ['username' => $u, 'roles' => [], 'is_active' => true], [Roles::OWNER], 1),
            'ถอดสิทธิ์จนไม่เหลือ',
        );
    });
});

test('สิทธิ์ที่ระบบไม่รู้จักถูกปฏิเสธ ไม่ใช่ถูกเมิน', function () {
    withRollback(function () {
        $emp = anEmployee('สิทธิ์แปลก');
        throwsReason(
            'bad_role',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'roles' => ['wizard']],
                [Roles::OWNER],
                1,
            ),
            'สิทธิ์ที่ไม่มีในระบบ',
        );
        throwsReason(
            'bad_role',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'roles' => 'sales'],
                [Roles::OWNER],
                1,
            ),
            'ส่งมาเป็นสตริงไม่ใช่รายการ',
        );
    });
});

test('ถอดบทบาทเจ้าของร้านออกจากคนสุดท้ายไม่ได้ แม้บัญชียังเปิดอยู่', function () {
    withRollback(function () {
        Db::run("UPDATE admins a JOIN admin_roles r ON r.admin_id = a.id
                  SET a.is_active = 0 WHERE r.role = 'owner' AND a.id <> 1");

        /* ต่างจากเคส "ปิดบัญชี" ตรงที่บัญชียังเปิดอยู่ทุกประการ เปลี่ยนแค่รายการ
           บทบาท — ถ้ากฎไปผูกกับ is_active อย่างเดียว ทางนี้จะลอดผ่านไปได้ */
        throwsReason(
            'last_owner',
            fn() => Users::update(
                1,
                ['username' => 'owner', 'roles' => [Roles::ADMIN], 'is_active' => true],
                [Roles::OWNER],
                2,
            ),
            'ถอดบทบาทเจ้าของร้านคนสุดท้าย',
        );
    });
});

test('ถือ Owner + Admin แล้วถอดแค่ Admin ออกได้ เจ้าของร้านยังอยู่', function () {
    withRollback(function () {
        Db::run("UPDATE admins a JOIN admin_roles r ON r.admin_id = a.id
                  SET a.is_active = 0 WHERE r.role = 'owner' AND a.id <> 1");
        Db::run("INSERT IGNORE INTO admin_roles (admin_id, role) VALUES (1, 'admin')");

        Users::update(
            1,
            ['username' => 'owner', 'roles' => [Roles::OWNER], 'is_active' => true],
            [Roles::SUPERUSER],
            2,
        );
        eq(Users::rolesOf(1), [Roles::OWNER], 'เหลือแต่เจ้าของร้าน');
    });
});

test('ยกเลิกบัญชีแล้วบทบาทถูกถอดไปด้วย', function () {
    withRollback(function () {
        $emp = anEmployee('ยกเลิกแล้วสิทธิ์ต้องหาย');
        $out = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::ADMIN]],
            [Roles::OWNER],
            1,
        );

        Users::revokeAccount($out['id'], [Roles::OWNER], 1);

        /* สิทธิ์แอดมินที่ค้างอยู่บนแถวที่เข้าระบบไม่ได้ คือสิทธิ์ที่จะคืนมาเองในวันที่
           มีคนเปิดบัญชีให้ใหม่ โดยไม่มีใครตั้งใจให้คืน */
        eq(Users::rolesOf($out['id']), [], 'ไม่เหลือบทบาท');
    });
});

test('รายชื่อแยกคนที่มีบัญชีออกจากพนักงานที่ยังไม่มี', function () {
    withRollback(function () {
        $emp = anEmployee('ยังไม่มีบัญชี');
        $waiting = Users::ensureFor($emp, 'ยังไม่มีบัญชี', 'technician', true);

        $out = Users::list([Roles::OWNER]);

        $userIds = array_column($out['users'], 'id');
        $candIds = array_column($out['candidates'], 'id');

        ok(!in_array($waiting, $userIds, true), 'คนที่ยังไม่มีบัญชีไม่อยู่ในตารางผู้ใช้');
        ok(in_array($waiting, $candIds, true), 'แต่อยู่ในรายการที่เลือกได้ตอนเพิ่มผู้ใช้');

        $owner = array_values(array_filter($out['users'], fn($r) => $r['username'] === 'owner'))[0] ?? null;
        ok($owner !== null, 'ต้องมีบัญชี owner ในตาราง');
        eq($owner['roles'], [Roles::OWNER], 'บทบาทติดมากับแถว');
        eq($owner['roleText'], 'Owner', 'ข้อความบทบาทสำหรับคอลัมน์ Role');
    });
});

test('พนักงานที่ลาออกแล้วไม่โผล่ในรายการที่เลือกได้', function () {
    withRollback(function () {
        $emp = anEmployee('ลาออกแล้ว', false);
        $gone = Users::ensureFor($emp, 'ลาออกแล้ว', null, false);

        $out = Users::list([Roles::OWNER]);
        ok(
            !in_array($gone, array_column($out['candidates'], 'id'), true),
            'คนที่ลาออกแล้วต้องไม่อยู่ในช่องเลือกของฟอร์มเพิ่มผู้ใช้',
        );
    });
});

group('รีเซ็ตและเปลี่ยนรหัสผ่าน');

test('รีเซ็ตแล้วได้รหัสใหม่ที่ใช้ล็อกอินได้ และติดธงบังคับเปลี่ยน', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('ลืมรหัส');
        $out = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'old-password-xx', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
            1,
        );

        $reset = Users::resetPassword($out['id'], [Roles::OWNER]);

        ok(mb_strlen($reset['password']) >= 10, 'รหัสที่สุ่มต้องผ่านขั้นต่ำเดียวกับที่บังคับคนอื่น');
        ok(str_starts_with($reset['password'], 'TO'), 'ขึ้นต้นด้วย TO ให้อ่านออกว่าเป็นรหัสของร้าน');

        throwsReason('bad_credentials', fn() => Auth::login($u, 'old-password-xx'), 'รหัสเดิมต้องใช้ไม่ได้');

        $actor = Auth::login($u, $reset['password']);
        eq($actor['mustChangePassword'], true, 'ล็อกอินได้ แต่ติดธงบังคับเปลี่ยน');
    });
});

test('รหัสที่สุ่มไม่ซ้ำกันสองครั้งติด และไม่มีตัวอักษรที่อ่านสับสน', function () {
    $a = Users::generatePassword();
    $b = Users::generatePassword();
    neq($a, $b, 'สองครั้งต้องไม่เหมือนกัน');

    /* กฎ "ไม่มีตัวที่อ่านสับสน" ใช้กับส่วนที่สุ่ม ไม่ใช่กับหัว `TO2026@` ซึ่งคนอ่าน
       เป็นคำกับปี ไม่ได้อ่านทีละตัว — เอา O กับ 0 ในหัวมานับด้วยจะเป็นการวัดผิดที่ */
    $tail = substr($a, strpos($a, '@') + 1);
    ok(strlen($tail) >= 6, 'ส่วนที่สุ่มต้องยาวพอ');
    eq(preg_match('/[lIO01]/', $tail), 0, 'ส่วนที่สุ่มไม่มี l I O 0 1 ที่แยกไม่ออกด้วยตา');
});

test('เจ้าตัวเปลี่ยนรหัสเองแล้วธงลง', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('เปลี่ยนเอง');
        $out = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'first-password-x', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
            1,
        );
        $reset = Users::resetPassword($out['id'], [Roles::OWNER]);

        Users::changeOwnPassword($out['id'], [
            'current_password' => $reset['password'],
            'password'         => 'chosen-by-me-x',
        ]);

        eq((int) Db::value('SELECT must_change_password FROM admins WHERE id = ?', [$out['id']]), 0, 'ธงลงแล้ว');
        $actor = Auth::login($u, 'chosen-by-me-x');
        eq($actor['mustChangePassword'], false, 'ล็อกอินได้ตามปกติ');
    });
});

test('เปลี่ยนรหัสตัวเองต้องรู้รหัสเดิม และตั้งซ้ำของเดิมไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ไม่รู้รหัสเดิม');
        $out = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'the-real-password', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
            1,
        );

        /* เครื่องที่ร้านถูกเปิดค้างไว้ทั้งวัน — คนที่เดินผ่านมาแล้วตั้งรหัสใหม่ได้
           ในสองคลิก คือคนที่ยึดบัญชีไปได้เลย */
        throwsReason(
            'bad_credentials',
            fn() => Users::changeOwnPassword($out['id'], [
                'current_password' => 'guessing',
                'password'         => 'brand-new-password',
            ]),
            'เดารหัสเดิม',
        );
        throwsReason(
            'same_password',
            fn() => Users::changeOwnPassword($out['id'], [
                'current_password' => 'the-real-password',
                'password'         => 'the-real-password',
            ]),
            'ตั้งรหัสเดิมซ้ำ',
        );
    });
});

test('แอดมินตั้งรหัสให้คนอื่น ก็ติดธงบังคับเปลี่ยนเหมือนกัน', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('ถูกตั้งรหัสให้');
        $out = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'first-password-x', 'roles' => [Roles::SALES]],
            [Roles::OWNER],
            1,
        );

        /* รหัสที่คนอื่นเป็นคนตั้ง คือรหัสที่มีคนที่สองรู้อยู่แล้ว — ปล่อยให้เป็นรหัส
           ถาวรแปลว่าบัญชีนั้นมีเจ้าของสองคนตลอดไป */
        Users::setPassword($out['id'], ['password' => 'set-by-admin-x'], [Roles::OWNER]);

        $actor = Auth::login($u, 'set-by-admin-x');
        eq($actor['mustChangePassword'], true, 'ติดธงเหมือนทางรีเซ็ต');
    });
});

test('รีเซ็ตรหัสให้บัญชีที่สูงกว่าตัวเองไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('เจ้าของที่แอดมินเอื้อมไม่ถึง');
        $owner = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'roles' => [Roles::OWNER]],
            [Roles::OWNER],
            1,
        );

        /* ตั้งรหัสให้บัญชีที่สูงกว่า = เข้าใช้บัญชีนั้นได้ทันที จึงเป็นทางลัดไปสู่
           สิทธิ์ที่สูงกว่า และถูกปิดด้วยกฎเดียวกับการตั้งบทบาท */
        throwsReason(
            'forbidden',
            fn() => Users::resetPassword($owner['id'], [Roles::ADMIN]),
            'แอดมินรีเซ็ตรหัสเจ้าของร้าน',
        );
    });
});

test('บัญชีที่ไม่มีสิทธิ์เลย ล็อกอินไม่ได้ตั้งแต่แรก', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('มีรหัสแต่ไม่มีสิทธิ์');
        $id = Users::ensureFor($emp, 'มีรหัสแต่ไม่มีสิทธิ์', null, true);
        Db::run(
            'UPDATE admins SET username = ?, password_hash = ? WHERE id = ?',
            [$u, Auth::hashPassword('a-strong-password'), $id],
        );

        /* ปล่อยให้เข้ามาได้ แล้วทุกหน้าตอบว่าไม่มีสิทธิ์ คนที่เจอจะอ่านว่าระบบพัง
           บอกความจริงตั้งแต่หน้าล็อกอินดีกว่า */
        throwsReason('no_roles', fn() => Auth::login($u, 'a-strong-password'), 'ล็อกอินโดยไม่มีสิทธิ์');
    });
});
