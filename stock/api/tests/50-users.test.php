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
        $super = Users::create(
            ['display_name' => 'ผู้ดูแลระบบทดสอบ', 'role' => Roles::SUPERUSER, 'username' => $u,
             'password' => 'a-strong-password'],
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
                ['display_name' => 'ยึดบัญชี', 'role' => Roles::SUPERUSER, 'username' => $u, 'is_active' => true],
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
        throwsReason(
            'forbidden',
            fn() => Users::create(
                ['display_name' => 'เจ้าของปลอม', 'role' => Roles::OWNER, 'username' => uname(),
                 'password' => 'a-strong-password'],
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
        $out = Users::create(
            ['display_name' => 'ช่างใหม่', 'role' => Roles::SALES, 'job_title' => 'technician'],
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
            ['display_name' => 'ฝ่ายบัญชีใหม่', 'role' => Roles::ADMIN, 'username' => $u, 'password' => 'a-strong-password'],
            Roles::OWNER,
        );

        $actor = Auth::login($u, 'a-strong-password');
        eq($actor['role'], Roles::ADMIN, 'สิทธิ์ที่ได้');
        eq($actor['username'], $u, 'ชื่อผู้ใช้');
    });
});

test('ตั้งชื่อผู้ใช้แล้วต้องมีรหัสผ่านด้วย', function () {
    withRollback(function () {
        throwsReason(
            'missing_field',
            fn() => Users::create(['display_name' => 'ไม่มีรหัส', 'role' => Roles::SALES, 'username' => uname()], Roles::OWNER),
            'มี username แต่ไม่มีรหัส',
        );
    });
});

test('รหัสผ่านสั้นเกินไปถูกปฏิเสธ', function () {
    withRollback(function () {
        throwsReason(
            'weak_password',
            fn() => Users::create(
                ['display_name' => 'รหัสสั้น', 'role' => Roles::SALES, 'username' => uname(), 'password' => '1234'],
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
                ['display_name' => 'ซ้ำ', 'role' => Roles::SALES, 'username' => 'owner', 'password' => 'a-strong-password'],
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
                    ['display_name' => 'x', 'role' => Roles::SALES, 'username' => $bad, 'password' => 'a-strong-password'],
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
        $made = Users::create(['display_name' => 'คนทดสอบ', 'role' => Roles::SALES], Roles::OWNER);

        Users::update(
            $made['id'],
            ['display_name' => 'คนทดสอบ', 'role' => Roles::ADMIN, 'job_title' => 'admin,reception', 'is_active' => true],
            Roles::OWNER,
            1,
        );

        $row = Db::one('SELECT role, job_title FROM admins WHERE id = ?', [$made['id']]);
        eq($row['role'], Roles::ADMIN, 'บทบาทที่ตั้ง');
        eq($row['job_title'], 'admin,reception', 'ตำแหน่งงานเก็บคำว่า admin ไว้ได้โดยไม่กลายเป็นสิทธิ์');
    });
});

test('ปิดใช้งานบัญชีแล้วล็อกอินไม่ได้', function () {
    withRollback(function () {
        $u = uname();
        $made = Users::create(
            ['display_name' => 'จะถูกปิด', 'role' => Roles::SALES, 'username' => $u, 'password' => 'a-strong-password'],
            Roles::OWNER,
        );
        Auth::login($u, 'a-strong-password');

        Users::update(
            $made['id'],
            ['display_name' => 'จะถูกปิด', 'role' => Roles::SALES, 'username' => $u, 'is_active' => false],
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
            fn() => Users::update(1, ['display_name' => 'เจ้าของร้าน', 'role' => Roles::SALES, 'username' => 'owner', 'is_active' => true], Roles::OWNER, 1),
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
        $second = Users::create(
            ['display_name' => 'เจ้าของสอง', 'role' => Roles::OWNER, 'username' => uname(), 'password' => 'a-strong-password'],
            Roles::OWNER,
        );

        // ตอนนี้มีสองคน ปลดคนแรกได้
        Users::update(1, ['display_name' => 'เจ้าของร้าน', 'role' => Roles::SALES, 'username' => 'owner', 'is_active' => true], Roles::OWNER, $second['id']);

        // เหลือคนเดียว ปลดต่อไม่ได้แล้ว
        throwsReason(
            'last_owner',
            fn() => Users::update(
                $second['id'],
                ['display_name' => 'เจ้าของสอง', 'role' => Roles::SALES, 'username' => 'x' . uname(), 'is_active' => true],
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
            ['display_name' => 'เปลี่ยนรหัส', 'role' => Roles::SALES, 'username' => $u, 'password' => 'first-password-x'],
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
        $made = Users::create(['display_name' => 'ไม่มี username', 'role' => Roles::SALES], Roles::OWNER);
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

group('ลบผู้ใช้');

test('ลบคนที่ยังไม่เคยทำอะไรในระบบได้', function () {
    withRollback(function () {
        $made = Users::create(['display_name' => 'คีย์ผิด ลบทิ้ง', 'role' => Roles::STOCK], Roles::OWNER);

        $gone = Users::delete($made['id'], Roles::OWNER, 1);
        eq($gone['id'], $made['id'], 'คืน id ของคนที่ลบ');
        eq(Db::value('SELECT COUNT(*) FROM admins WHERE id = ?', [$made['id']]), 0, 'แถวต้องหายไปจริง');
    });
});

test('คนที่เคยคีย์รายการแล้ว ลบไม่ได้ — ประวัติต้องอ่านย้อนหลังได้', function () {
    withRollback(function () {
        $made = Users::create(['display_name' => 'เคยคีย์ของ', 'role' => Roles::STOCK], Roles::OWNER);
        $product = aProduct();

        Db::run(
            'INSERT INTO inventory_logs (product_id, action_type, quantity, created_by, created_by_kind)
             VALUES (?, ?, ?, ?, ?)',
            [$product, 'ADJUST', 1, $made['id'], 'admin'],
        );

        $e = throwsReason(
            'user_has_history',
            fn() => Users::delete($made['id'], Roles::OWNER, 1),
            'ลบคนที่เคยคีย์รายการ',
        );
        eq($e->payload()['traces'], 1, 'บอกจำนวนร่องรอยที่ค้างอยู่');
    });
});

test('คนที่เคยรับของไป ลบไม่ได้ ถึงจะไม่เคยคีย์อะไรเลย', function () {
    withRollback(function () {
        /* คนที่ไม่มีบัญชีล็อกอินมีไว้เพื่อการนี้โดยเฉพาะ — เป็นชื่อผู้รับของ
           ไม่ใช่คนคีย์ ถ้านับแค่ created_by คนกลุ่มนี้จะลบได้ทั้งที่ประวัติชี้อยู่ */
        $made = Users::create(['display_name' => 'ช่างที่มารับของ', 'role' => Roles::STOCK], Roles::OWNER);
        $product = aProduct();

        Db::run(
            'INSERT INTO inventory_logs (product_id, action_type, quantity, created_by, created_by_kind, issued_to_admin_id)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$product, 'OUT', -1, 1, 'admin', $made['id']],
        );

        throwsReason(
            'user_has_history',
            fn() => Users::delete($made['id'], Roles::OWNER, 1),
            'ลบคนที่เคยรับของ',
        );
    });
});

test('ลบบัญชีตัวเองไม่ได้', function () {
    withRollback(function () {
        $made = Users::create(['display_name' => 'ลบตัวเอง', 'role' => Roles::OWNER], Roles::OWNER);
        throwsReason(
            'self_lockout',
            fn() => Users::delete($made['id'], Roles::OWNER, $made['id']),
            'ลบบัญชีที่กำลังใช้อยู่',
        );
    });
});

test('ลบเจ้าของร้านคนสุดท้ายไม่ได้', function () {
    withRollback(function () {
        Db::run("UPDATE admins SET is_active = 0 WHERE role = 'owner' AND id <> 1");
        // เจ้าของคนที่สองไว้เป็นคนกด จะได้ไม่ชนกฎ "ห้ามลบตัวเอง"
        $second = Users::create(
            ['display_name' => 'เจ้าของสอง', 'role' => Roles::OWNER, 'username' => uname(), 'password' => 'a-strong-password'],
            Roles::OWNER,
        );

        // ตอนนี้มีสองคน ลบคนที่สองได้ (ยังไม่เคยทำอะไร) แล้วเหลือคนเดียว
        Users::delete($second['id'], Roles::OWNER, 1);

        $third = Users::create(['display_name' => 'เจ้าของสาม', 'role' => Roles::OWNER], Roles::OWNER);
        Db::run('UPDATE admins SET is_active = 0 WHERE id = ?', [$third['id']]);

        throwsReason(
            'last_owner',
            fn() => Users::delete(1, Roles::OWNER, $third['id']),
            'ลบเจ้าของร้านที่ใช้งานได้คนสุดท้าย',
        );
    });
});

test('ลบบัญชีที่สิทธิ์สูงกว่าตัวเองไม่ได้', function () {
    withRollback(function () {
        $owner = Users::create(['display_name' => 'เจ้าของที่แอดมินเอื้อมไม่ถึง', 'role' => Roles::OWNER], Roles::OWNER);
        throwsReason(
            'forbidden',
            fn() => Users::delete($owner['id'], Roles::ADMIN, 1),
            'แอดมินลบบัญชีเจ้าของร้าน',
        );
    });
});

test('พนักงานลบใครไม่ได้', function () {
    withRollback(function () {
        $made = Users::create(['display_name' => 'เป้าหมาย', 'role' => Roles::STOCK], Roles::OWNER);
        throwsReason('forbidden', fn() => Users::delete($made['id'], Roles::SALES, 1), 'พนักงานขายลบผู้ใช้');
        throwsReason('forbidden', fn() => Users::delete($made['id'], Roles::STOCK, 1), 'พนักงานคลังลบผู้ใช้');
    });
});

test('ลบคนที่ไม่มีอยู่จริง ตอบว่าไม่พบ', function () {
    withRollback(function () {
        throwsReason('not_found', fn() => Users::delete(999999, Roles::OWNER, 1), 'ลบ id ที่ไม่มี');
    });
});
