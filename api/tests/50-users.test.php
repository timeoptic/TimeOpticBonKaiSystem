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

group('จัดการผู้ใช้');

test('เจ้าของร้านเท่านั้นที่ดูรายชื่อได้', function () {
    withRollback(function () {
        $rows = Users::list(Roles::OWNER);
        ok(count($rows) >= 6, 'ต้องเห็นทุกคน (เจ้าของ + พนักงานที่นำเข้ามา)');
        throwsReason('forbidden', fn() => Users::list(Roles::ACCOUNTANT), 'ฝ่ายบัญชีดูรายชื่อ');
        throwsReason('forbidden', fn() => Users::list(Roles::STAFF), 'พนักงานดูรายชื่อ');
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
        $out = Users::create(
            ['display_name' => 'ช่างใหม่', 'role' => Roles::STAFF, 'job_title' => 'technician'],
            Roles::OWNER,
        );
        eq($out['canSignIn'], false, 'ยังล็อกอินไม่ได้');

        $row = Db::one('SELECT * FROM admins WHERE id = ?', [$out['id']]);
        eq($row['username'], null, 'ไม่มีชื่อผู้ใช้');
        eq($row['password_hash'], null, 'ไม่มีรหัสผ่าน');
        eq($row['job_title'], 'technician', 'ตำแหน่งงาน');
    });
});

test('เพิ่มคนพร้อมบัญชีล็อกอินแล้วเข้าระบบได้จริง', function () {
    withRollback(function () {
        $u = uname();
        Users::create(
            ['display_name' => 'ฝ่ายบัญชีใหม่', 'role' => Roles::ACCOUNTANT, 'username' => $u, 'password' => 'a-strong-password'],
            Roles::OWNER,
        );

        $actor = Auth::login($u, 'a-strong-password');
        eq($actor['role'], Roles::ACCOUNTANT, 'สิทธิ์ที่ได้');
        eq($actor['username'], $u, 'ชื่อผู้ใช้');
    });
});

test('ตั้งชื่อผู้ใช้แล้วต้องมีรหัสผ่านด้วย', function () {
    withRollback(function () {
        throwsReason(
            'missing_field',
            fn() => Users::create(['display_name' => 'ไม่มีรหัส', 'role' => Roles::STAFF, 'username' => uname()], Roles::OWNER),
            'มี username แต่ไม่มีรหัส',
        );
    });
});

test('รหัสผ่านสั้นเกินไปถูกปฏิเสธ', function () {
    withRollback(function () {
        throwsReason(
            'weak_password',
            fn() => Users::create(
                ['display_name' => 'รหัสสั้น', 'role' => Roles::STAFF, 'username' => uname(), 'password' => '1234'],
                Roles::OWNER,
            ),
            'รหัส 4 ตัว',
        );
    });
});

test('ชื่อผู้ใช้ซ้ำถูกปฏิเสธ', function () {
    withRollback(function () {
        throwsReason(
            'duplicate_username',
            fn() => Users::create(
                ['display_name' => 'ซ้ำ', 'role' => Roles::STAFF, 'username' => 'owner', 'password' => 'a-strong-password'],
                Roles::OWNER,
            ),
            'username ซ้ำ',
        );
    });
});

test('ชื่อผู้ใช้ที่มีอักขระต้องห้ามถูกปฏิเสธ', function () {
    withRollback(function () {
        foreach (['ก ข', 'ab', 'has space'] as $bad) {
            throwsReason(
                'bad_username',
                fn() => Users::create(
                    ['display_name' => 'x', 'role' => Roles::STAFF, 'username' => $bad, 'password' => 'a-strong-password'],
                    Roles::OWNER,
                ),
                "username \"{$bad}\"",
            );
        }
    });
});

group('แก้ไขผู้ใช้');

test('เปลี่ยนบทบาทและตำแหน่งงานได้ และสองอย่างนี้แยกกัน', function () {
    withRollback(function () {
        $made = Users::create(['display_name' => 'คนทดสอบ', 'role' => Roles::STAFF], Roles::OWNER);

        Users::update(
            $made['id'],
            ['display_name' => 'คนทดสอบ', 'role' => Roles::ACCOUNTANT, 'job_title' => 'admin,reception', 'is_active' => true],
            Roles::OWNER,
            1,
        );

        $row = Db::one('SELECT role, job_title FROM admins WHERE id = ?', [$made['id']]);
        eq($row['role'], Roles::ACCOUNTANT, 'บทบาทที่ตั้ง');
        eq($row['job_title'], 'admin,reception', 'ตำแหน่งงานเก็บคำว่า admin ไว้ได้โดยไม่กลายเป็นสิทธิ์');
    });
});

test('ปิดใช้งานบัญชีแล้วล็อกอินไม่ได้', function () {
    withRollback(function () {
        $u = uname();
        $made = Users::create(
            ['display_name' => 'จะถูกปิด', 'role' => Roles::STAFF, 'username' => $u, 'password' => 'a-strong-password'],
            Roles::OWNER,
        );
        Auth::login($u, 'a-strong-password');

        Users::update(
            $made['id'],
            ['display_name' => 'จะถูกปิด', 'role' => Roles::STAFF, 'username' => $u, 'is_active' => false],
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
            fn() => Users::update(1, ['display_name' => 'เจ้าของร้าน', 'role' => Roles::OWNER, 'username' => 'owner', 'is_active' => false], Roles::OWNER, 1),
            'ปิดบัญชีตัวเอง',
        );
    });
});

test('ลดสิทธิ์ตัวเองไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'self_lockout',
            fn() => Users::update(1, ['display_name' => 'เจ้าของร้าน', 'role' => Roles::STAFF, 'username' => 'owner', 'is_active' => true], Roles::OWNER, 1),
            'ลดสิทธิ์ตัวเอง',
        );
    });
});

test('ต้องเหลือเจ้าของร้านที่ใช้งานได้อย่างน้อยหนึ่งคน', function () {
    withRollback(function () {
        // สร้างเจ้าของคนที่สองแล้วให้เขาปลดเจ้าของคนแรก จะได้ไม่ชนกฎ "ห้ามแก้ตัวเอง"
        $second = Users::create(
            ['display_name' => 'เจ้าของสอง', 'role' => Roles::OWNER, 'username' => uname(), 'password' => 'a-strong-password'],
            Roles::OWNER,
        );

        // ตอนนี้มีสองคน ปลดคนแรกได้
        Users::update(1, ['display_name' => 'เจ้าของร้าน', 'role' => Roles::STAFF, 'username' => 'owner', 'is_active' => true], Roles::OWNER, $second['id']);

        // เหลือคนเดียว ปลดต่อไม่ได้แล้ว
        throwsReason(
            'last_owner',
            fn() => Users::update(
                $second['id'],
                ['display_name' => 'เจ้าของสอง', 'role' => Roles::STAFF, 'username' => 'x' . uname(), 'is_active' => true],
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
        $made = Users::create(
            ['display_name' => 'เปลี่ยนรหัส', 'role' => Roles::STAFF, 'username' => $u, 'password' => 'first-password-x'],
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
        $made = Users::create(['display_name' => 'ไม่มี username', 'role' => Roles::STAFF], Roles::OWNER);
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
            fn() => Users::setPassword(1, ['password' => 'a-strong-password'], Roles::ACCOUNTANT),
            'accountant ตั้งรหัส',
        );
    });
});
