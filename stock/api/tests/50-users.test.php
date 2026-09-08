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
    ], Roles::OWNER);

    return (int) $made['id'];
}

group('จัดการผู้ใช้');

test('ผู้ที่จัดการผู้ใช้ได้เท่านั้นที่ดูรายชื่อได้', function () {
    withRollback(function () {
        $rows = Users::list(Roles::OWNER);
        ok(count($rows) >= 6, 'ต้องเห็นทุกคน (เจ้าของ + พนักงานที่นำเข้ามา)');
        ok(count(Users::list(Roles::ADMIN)) > 0, 'แอดมินดูรายชื่อได้');
        throwsReason('forbidden', fn() => Users::list(Roles::SALES), 'พนักงานขายดูรายชื่อ');
        throwsReason('forbidden', fn() => Users::list(Roles::STOCK), 'พนักงานคลังดูรายชื่อ');
    });
});

test('บัญชีที่สูงกว่าคนดู ไม่โผล่ในรายชื่อและแก้ไม่ได้', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('ผู้ดูแลระบบทดสอบ');
        $super = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::SUPERUSER],
            Roles::SUPERUSER,
        );

        $seenByAdmin = array_column(Users::list(Roles::ADMIN), 'username');
        ok(!in_array($u, $seenByAdmin, true), 'แอดมินต้องไม่เห็นบัญชีผู้ดูแลระบบ');
        ok(!in_array('owner', $seenByAdmin, true), 'แอดมินต้องไม่เห็นบัญชีเจ้าของร้าน');

        ok(in_array($u, array_column(Users::list(Roles::SUPERUSER), 'username'), true), 'ผู้ดูแลระบบเห็นบัญชีตัวเอง');

        throwsReason(
            'forbidden',
            fn() => Users::update(
                (int) $super['id'],
                ['role' => Roles::SUPERUSER, 'username' => $u, 'is_active' => true],
                Roles::OWNER,
                1,
            ),
            'เจ้าของร้านแก้บัญชีผู้ดูแลระบบ',
        );
        throwsReason(
            'forbidden',
            fn() => Users::setPassword((int) $super['id'], ['password' => 'another-password'], Roles::OWNER),
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
                ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::OWNER],
                Roles::ADMIN,
            ),
            'แอดมินสร้างบัญชีเจ้าของร้าน',
        );
    });
});

test('รายชื่อบอกว่าใครล็อกอินได้บ้าง', function () {
    withRollback(function () {
        $rows = Users::list(Roles::OWNER);
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
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::ADMIN],
            Roles::OWNER,
        );

        $actor = Auth::login($u, 'a-strong-password');
        eq($actor['role'], Roles::ADMIN, 'สิทธิ์ที่ได้');
        eq($actor['username'], $u, 'ชื่อผู้ใช้');
    });
});

test('ตั้งชื่อผู้ใช้แล้วต้องมีรหัสผ่านด้วย', function () {
    withRollback(function () {
        $emp = anEmployee('ไม่มีรหัส');
        throwsReason(
            'missing_field',
            fn() => Users::grantAccount($emp, ['username' => uname(), 'role' => Roles::SALES], Roles::OWNER),
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
                ['username' => uname(), 'password' => '1234', 'role' => Roles::SALES],
                Roles::OWNER,
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
                ['username' => 'owner', 'password' => 'a-strong-password', 'role' => Roles::SALES],
                Roles::OWNER,
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
                    ['username' => $bad, 'password' => 'a-strong-password', 'role' => Roles::SALES],
                    Roles::OWNER,
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
            ['role' => Roles::ADMIN, 'is_active' => true],
            Roles::OWNER,
            1,
        );

        $row = Db::one('SELECT role, display_name, job_title FROM admins WHERE id = ?', [$made['id']]);
        eq($row['role'], Roles::ADMIN, 'บทบาทที่ตั้ง');
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
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );
        Auth::login($u, 'a-strong-password');

        Users::update(
            $made['id'],
            ['role' => Roles::SALES, 'username' => $u, 'is_active' => false],
            Roles::OWNER,
            1,
        );

        throwsReason('bad_credentials', fn() => Auth::login($u, 'a-strong-password'), 'บัญชีถูกปิด');
    });
});

test('ปิดใช้งานบัญชีตัวเองไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'self_lockout',
            fn() => Users::update(1, ['role' => Roles::OWNER, 'username' => 'owner', 'is_active' => false], Roles::OWNER, 1),
            'ปิดบัญชีตัวเอง',
        );
    });
});

test('ลดสิทธิ์ตัวเองไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'self_lockout',
            fn() => Users::update(1, ['role' => Roles::SALES, 'username' => 'owner', 'is_active' => true], Roles::OWNER, 1),
            'ลดสิทธิ์ตัวเอง',
        );
    });
});

test('ต้องเหลือเจ้าของร้านที่ใช้งานได้อย่างน้อยหนึ่งคน', function () {
    withRollback(function () {
        /* เริ่มจากสถานะที่รู้แน่: เจ้าของร้านที่ใช้งานได้เหลือคนเดียวคือ id 1
           ก่อนหน้านี้เทสต์นี้เชื่อว่าฐานข้อมูลเป็นแบบนั้นอยู่แล้ว แล้วก็เงียบไป
           ทันทีที่มีบัญชีเจ้าของร้านเพิ่มเข้ามาอีกใบ (เช่น บัญชีทดสอบ) */
        Db::run("UPDATE admins SET is_active = 0 WHERE role = 'owner' AND id <> 1");

        // สร้างเจ้าของคนที่สองแล้วให้เขาปลดเจ้าของคนแรก จะได้ไม่ชนกฎ "ห้ามแก้ตัวเอง"
        $emp = anEmployee('เจ้าของสอง');
        $second = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::OWNER],
            Roles::OWNER,
        );

        // ตอนนี้มีสองคน ปลดคนแรกได้
        Users::update(1, ['role' => Roles::SALES, 'username' => 'owner', 'is_active' => true], Roles::OWNER, $second['id']);

        // เหลือคนเดียว ปลดต่อไม่ได้แล้ว
        throwsReason(
            'last_owner',
            fn() => Users::update(
                $second['id'],
                ['role' => Roles::SALES, 'username' => 'x' . uname(), 'is_active' => true],
                Roles::OWNER,
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
            ['username' => $u, 'password' => 'first-password-x', 'role' => Roles::SALES],
            Roles::OWNER,
        );

        Users::setPassword($made['id'], ['password' => 'second-password-x'], Roles::OWNER);

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
            fn() => Users::setPassword($made['id'], ['password' => 'a-strong-password'], Roles::OWNER),
            'ตั้งรหัสก่อนมีชื่อผู้ใช้',
        );
    });
});

test('ฝ่ายบัญชีตั้งรหัสให้คนอื่นไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'forbidden',
            fn() => Users::setPassword(1, ['password' => 'a-strong-password'], Roles::ADMIN),
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
            Db::run("INSERT INTO admins (display_name, role, is_active) VALUES ('ไม่มีพนักงาน', 'sales', 1)");
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
            Db::run("INSERT INTO admins (employee_id, display_name, role, is_active) VALUES (999999999, 'ผี', 'sales', 1)");
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
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );

        // Mirrors the real flow: the employee screen closes `employees.active`
        // first, then mirrors that into `admins` via syncFromEmployee().
        Db::run('UPDATE employees SET active = 0 WHERE id = ?', [$emp]);
        Users::syncFromEmployee($emp, 'ลาออกแล้วแต่อยากกลับ', null, false, 1);

        throwsReason(
            'employee_inactive',
            fn() => Users::update($made['id'], ['username' => $u, 'role' => Roles::SALES, 'is_active' => true], Roles::OWNER, 1),
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
            ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::OWNER],
            Roles::OWNER,
        );
        throwsReason(
            'forbidden',
            fn() => Users::revokeAccount($owner['id'], Roles::ADMIN, 1),
            'แอดมินยกเลิกบัญชีเจ้าของร้าน',
        );
    });
});

test('พนักงานยกเลิกบัญชีใครไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('เป้าหมาย');
        $made = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::STOCK],
            Roles::OWNER,
        );
        throwsReason('forbidden', fn() => Users::revokeAccount($made['id'], Roles::SALES, 1), 'พนักงานขายยกเลิกบัญชี');
        throwsReason('forbidden', fn() => Users::revokeAccount($made['id'], Roles::STOCK, 1), 'พนักงานคลังยกเลิกบัญชี');
    });
});

test('ยกเลิกบัญชีของคนที่ไม่มีอยู่จริง ตอบว่าไม่พบ', function () {
    withRollback(function () {
        throwsReason('not_found', fn() => Users::revokeAccount(999999, Roles::OWNER, 1), 'ยกเลิกบัญชี id ที่ไม่มี');
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
        Db::run("UPDATE admins SET is_active = 0 WHERE role = 'owner' AND id <> 1");
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
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );

        eq($out['employeeId'], $emp, 'คืน employeeId ของคนที่ได้บัญชี');
        eq($out['username'], $u, 'คืนชื่อผู้ใช้');

        $actor = Auth::login($u, 'a-strong-password');
        eq($actor['id'], $out['id'], 'ล็อกอินได้ด้วยบัญชีที่เพิ่งสร้าง');
        eq($actor['role'], Roles::SALES, 'สิทธิ์ที่ได้');
    });
});

test('สร้างบัญชีให้พนักงานที่ไม่มีอยู่ไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'not_found',
            fn() => Users::grantAccount(
                999999999,
                ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
                Roles::OWNER,
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
                ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
                Roles::OWNER,
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
            ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );

        throwsReason(
            'account_exists',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
                Roles::OWNER,
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
            fn() => Users::grantAccount($emp, ['password' => 'a-strong-password', 'role' => Roles::SALES], Roles::OWNER),
            'ไม่มีชื่อผู้ใช้',
        );
        throwsReason(
            'missing_field',
            fn() => Users::grantAccount($emp, ['username' => uname(), 'role' => Roles::SALES], Roles::OWNER),
            'ไม่มีรหัสผ่าน',
        );
    });
});

test('สร้างบัญชีด้วยชื่อผู้ใช้ที่คนอื่นใช้อยู่แล้วไม่ได้', function () {
    withRollback(function () {
        $u = uname();
        Users::grantAccount(
            anEmployee('คนแรก'),
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );

        throwsReason(
            'duplicate_username',
            fn() => Users::grantAccount(
                anEmployee('คนที่สอง'),
                ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::SALES],
                Roles::OWNER,
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
                ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::OWNER],
                Roles::ADMIN,
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
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::STOCK],
            Roles::OWNER,
        );
        $product = aProduct();
        Db::run(
            'INSERT INTO inventory_logs (product_id, action_type, quantity, created_by, created_by_kind)
             VALUES (?, ?, ?, ?, ?)',
            [$product, 'ADJUST', 1, $out['id'], 'admin'],
        );

        Users::revokeAccount($out['id'], Roles::OWNER, 1);

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
            fn() => Users::revokeAccount($id, Roles::OWNER, 1),
            'ยกเลิกบัญชีที่ไม่มีอยู่',
        );
    });
});

test('ยกเลิกบัญชีตัวเองไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ยกเลิกตัวเอง');
        $out = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );

        throwsReason(
            'self_lockout',
            fn() => Users::revokeAccount($out['id'], Roles::OWNER, $out['id']),
            'ยกเลิกบัญชีที่กำลังใช้อยู่',
        );
    });
});

test('ยกเลิกบัญชีเจ้าของร้านที่เข้าระบบได้คนสุดท้ายไม่ได้', function () {
    withRollback(function () {
        Db::run("UPDATE admins SET is_active = 0 WHERE role = 'owner' AND id <> 1");

        throwsReason(
            'last_owner',
            fn() => Users::revokeAccount(1, Roles::OWNER, 2),
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
        Db::run("UPDATE admins SET is_active = 0 WHERE role = 'owner'");

        $empReal = anEmployee('เจ้าของที่เข้าระบบได้');
        $real = Users::grantAccount(
            $empReal,
            ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::OWNER],
            Roles::OWNER,
        );

        $empGhost = anEmployee('เจ้าของที่ยังไม่มีบัญชี');
        $ghost = Users::ensureFor($empGhost, 'เจ้าของที่ยังไม่มีบัญชี', null, true);
        Db::run("UPDATE admins SET role = 'owner' WHERE id = ?", [$ghost]);

        /* ยกเลิกบัญชีของคนที่เข้าระบบได้ไม่ได้ — คนที่เหลือเปิดใช้งานอยู่ก็จริง
           แต่ไม่มีรหัสผ่าน จึงเข้าระบบไม่ได้ ร้านจะไม่เหลือใครเปิดประตูเข้ามา */
        throwsReason(
            'last_owner',
            fn() => Users::revokeAccount($real['id'], Roles::OWNER, $ghost),
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
