<?php

declare(strict_types=1);

use Optic\ApiError;
use Optic\Auth;
use Optic\Db;
use Optic\Roles;

group('เข้าสู่ระบบ');

test('PHP อ่าน bcrypt แบบ $2b$ ที่ Node สร้างไว้ได้', function () {
    // ข้อนี้คือความเสี่ยงที่ระบุไว้ตั้งแต่ก่อนเริ่มย้าย ถ้าข้อนี้แดง
    // ทุกบัญชีที่มีอยู่จะล็อกอินไม่ได้ในวันที่เปลี่ยนระบบ
    $hash = (string) Db::value('SELECT password_hash FROM admins WHERE username = ?', ['owner']);
    ok(str_starts_with($hash, '$2b$'), "hash ในฐานข้อมูลต้องเป็น \$2b\$ — ได้ " . substr($hash, 0, 4));
    ok(Auth::verifyPassword('1234', $hash), 'ต้องยืนยันรหัสผ่านที่ถูกต้องได้');
    ok(!Auth::verifyPassword('ผิดแน่นอน', $hash), 'รหัสผิดต้องไม่ผ่าน');
});

test('hash ที่ PHP สร้างเองก็ยืนยันกลับได้', function () {
    $h = Auth::hashPassword('a-long-enough-password');
    ok(Auth::verifyPassword('a-long-enough-password', $h), 'ยืนยันได้');
    ok(!Auth::verifyPassword('a-long-enough-passwore', $h), 'ต่างหนึ่งตัวต้องไม่ผ่าน');
});

test('ล็อกอินด้วยบัญชีจริงได้ และได้ข้อมูลครบ', function () {
    withRollback(function () {
        $actor = Auth::login('owner', '1234');
        eq($actor['username'], 'owner', 'ชื่อผู้ใช้');
        eq($actor['role'], Roles::OWNER, 'สิทธิ์');
        eq($actor['roleLabel'], 'เจ้าของร้าน', 'ป้ายสิทธิ์ภาษาไทย');
        ok(is_int($actor['id']) && $actor['id'] > 0, 'ต้องมี id');
    });
});

test('รหัสผิดถูกปฏิเสธด้วย 401', function () {
    withRollback(function () {
        $e = throwsReason('bad_credentials', fn() => Auth::login('owner', 'ไม่ใช่รหัส'), 'รหัสผิด');
        eq($e->status, 401, 'รหัสสถานะ');
    });
});

test('ชื่อผู้ใช้ที่ไม่มีอยู่ ตอบเหมือนรหัสผิดทุกประการ', function () {
    withRollback(function () {
        // ข้อความต้องไม่บอกใบ้ว่าชื่อผู้ใช้นั้นมีอยู่จริงหรือไม่
        $a = throwsReason('bad_credentials', fn() => Auth::login('ไม่มีคนนี้', 'อะไรก็ได้'), 'ไม่มีชื่อนี้');
        $b = throwsReason('bad_credentials', fn() => Auth::login('owner', 'รหัสผิด'), 'รหัสผิด');
        eq($a->getMessage(), $b->getMessage(), 'ข้อความต้องเหมือนกัน');
    });
});

test('คนที่ไม่มีรหัสผ่านล็อกอินไม่ได้', function () {
    withRollback(function () {
        // พนักงานที่นำเข้ามาจาก employees มีตัวตนไว้ให้บันทึกว่าใครทำรายการ
        // แต่ยังไม่ได้ตั้งรหัส จึงต้องเข้าระบบไม่ได้
        $row = Db::one('SELECT id, display_name FROM admins WHERE password_hash IS NULL LIMIT 1');
        ok($row !== null, 'ต้องมีคนที่ยังไม่มีรหัสผ่านอยู่ในระบบ');

        Db::run('UPDATE admins SET username = ? WHERE id = ?', ['temp_no_pass', $row['id']]);
        throwsReason('bad_credentials', fn() => Auth::login('temp_no_pass', ''), 'ไม่มีรหัสผ่าน');
        throwsReason('bad_credentials', fn() => Auth::login('temp_no_pass', 'เดา'), 'เดารหัส');
    });
});

test('บัญชีที่ถูกปิดใช้งานล็อกอินไม่ได้', function () {
    withRollback(function () {
        Db::run('UPDATE admins SET is_active = 0 WHERE username = ?', ['owner']);
        throwsReason('bad_credentials', fn() => Auth::login('owner', '1234'), 'บัญชีปิดอยู่');
    });
});

group('สิทธิ์');

test('กฎสิทธิ์ของห้าบทบาท', function () {
    ok(Roles::manageAdmins(Roles::SUPERUSER), 'ผู้ดูแลระบบจัดการผู้ใช้ได้');
    ok(Roles::manageAdmins(Roles::OWNER), 'เจ้าของจัดการผู้ใช้ได้');
    ok(Roles::manageAdmins(Roles::ADMIN), 'แอดมินจัดการผู้ใช้ได้');
    ok(!Roles::manageAdmins(Roles::SALES), 'พนักงานขายจัดการผู้ใช้ไม่ได้');
    ok(!Roles::manageAdmins(Roles::STOCK), 'พนักงานคลังจัดการผู้ใช้ไม่ได้');

    ok(Roles::enterRxCost(Roles::OWNER), 'เจ้าของลงต้นทุนได้');
    ok(Roles::enterRxCost(Roles::ADMIN), 'แอดมินลงต้นทุนได้');
    ok(!Roles::enterRxCost(Roles::SALES), 'พนักงานขายลงต้นทุนไม่ได้');
    ok(!Roles::enterRxCost(Roles::STOCK), 'พนักงานคลังลงต้นทุนไม่ได้');

    ok(Roles::editCatalog(Roles::ADMIN), 'แอดมินแก้แคตตาล็อกได้');
    ok(!Roles::editCatalog(Roles::STOCK), 'พนักงานคลังแก้แคตตาล็อกไม่ได้');

    // เพิ่มของใหม่กับแก้ของเดิม คนละคำถาม — ของใหม่ถูกค้นพบตอนทำงาน
    ok(Roles::addProduct(Roles::SALES), 'พนักงานขายเพิ่มสินค้าได้');
    ok(Roles::addProduct(Roles::STOCK), 'พนักงานคลังเพิ่มสินค้าได้');
    ok(!Roles::addProduct('ผู้มาเยือน'), 'คนที่ไม่มีบทบาทในระบบเพิ่มไม่ได้');

    // งานระบบเป็นของผู้ดูแลระบบคนเดียว เจ้าของร้านจัดการคนของตัวเองได้เต็มที่
    // โดยไม่ต้องถือสิทธิ์ที่ทำให้ระบบล่มได้
    ok(Roles::manageSystem(Roles::SUPERUSER), 'ผู้ดูแลระบบทำงานระบบได้');
    ok(!Roles::manageSystem(Roles::OWNER), 'เจ้าของร้านไม่ได้ถือสิทธิ์งานระบบ');

    foreach (Roles::ALL as $r) {
        ok(Roles::moveStock($r), "{$r} ต้องบันทึกความเคลื่อนไหวได้");
    }
});

test('ตั้งบทบาทได้ไม่เกินบทบาทของตัวเอง', function () {
    ok(Roles::canGrant(Roles::OWNER, Roles::OWNER), 'เจ้าของตั้งเจ้าของคนที่สองได้');
    ok(Roles::canGrant(Roles::OWNER, Roles::ADMIN), 'เจ้าของตั้งแอดมินได้');
    ok(!Roles::canGrant(Roles::ADMIN, Roles::OWNER), 'แอดมินตั้งเจ้าของไม่ได้');
    ok(!Roles::canGrant(Roles::ADMIN, Roles::SUPERUSER), 'แอดมินตั้งผู้ดูแลระบบไม่ได้');
    ok(!Roles::canGrant(Roles::OWNER, Roles::SUPERUSER), 'เจ้าของตั้งผู้ดูแลระบบไม่ได้');
    ok(Roles::canGrant(Roles::ADMIN, Roles::SALES), 'แอดมินตั้งพนักงานขายได้');
    ok(Roles::canGrant(Roles::ADMIN, Roles::STOCK), 'แอดมินตั้งพนักงานคลังได้');
    /* canGrant ตอบแค่เรื่องลำดับบทบาท ไม่ได้ตอบว่าใครจัดการผู้ใช้ได้ — พนักงาน
       ถูกกันตั้งแต่ manageAdmins ก่อนจะมาถึงบรรทัดนี้ */
    ok(!Roles::manageAdmins(Roles::SALES), 'พนักงานขายไม่ผ่านด่านจัดการผู้ใช้ตั้งแต่แรก');
    ok(!Roles::canGrant(Roles::SALES, Roles::ADMIN), 'ถึงหลุดมาได้ ก็ตั้งบทบาทที่สูงกว่าไม่ได้');
});

test('หน้าแรกหลังล็อกอินตรงกับฝั่งที่ทำงาน', function () {
    eq(Roles::home(Roles::SALES), '/', 'พนักงานขายเข้าหน้าร้าน');
    eq(Roles::home(Roles::STOCK), '/stock/', 'พนักงานคลังเข้าฝั่งคลัง');
    foreach ([Roles::SUPERUSER, Roles::OWNER, Roles::ADMIN] as $r) {
        eq(Roles::home($r), '/hub/', "{$r} เลือกฝั่งเอง");
    }
});

test('ตำแหน่งงานไม่มีผลต่อสิทธิ์', function () {
    // employees.roles ของคนหนึ่งมีคำว่า "admin" อยู่ ถ้าเผลอเอา job_title
    // ไปตัดสินสิทธิ์ คนนั้นจะกลายเป็นเจ้าของร้านทันที
    $people = Db::all("SELECT display_name, job_title, role FROM admins WHERE job_title LIKE '%admin%'");
    ok(count($people) > 0, 'ต้องมีคนที่ job_title มีคำว่า admin ไว้ทดสอบ');
    foreach ($people as $p) {
        neq($p['role'], Roles::OWNER, "{$p['display_name']} ต้องไม่ได้สิทธิ์ owner จากคำว่า admin ใน job_title");
    }
});

test('Roles::require โยน 403 เมื่อไม่มีสิทธิ์', function () {
    $e = null;
    try {
        Roles::require(Roles::manageAdmins(Roles::SALES), 'จัดการผู้ใช้');
    } catch (ApiError $x) {
        $e = $x;
    }
    ok($e !== null, 'ต้องโยน');
    eq($e->status, 403, 'รหัสสถานะ');
    eq($e->reason, 'forbidden', 'เหตุผล');
});
