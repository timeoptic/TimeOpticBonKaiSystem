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
        eq($actor['roles'], [Roles::OWNER], 'สิทธิ์');
        eq($actor['roleNames'], ['Owner'], 'ป้ายบทบาท');
        eq($actor['roleText'], 'Owner', 'ข้อความบทบาทในตารางและในบันทึกการใช้งาน');
        eq($actor['mustChangePassword'], false, 'ไม่ติดธงบังคับเปลี่ยนรหัส');
        /* สิทธิ์ที่คำนวณแล้วเดินทางไปกับ actor — หน้าเว็บจะได้ไม่ต้องถือสำเนาของกฎ
           ไว้อีกชุดแล้วลืมแก้ตอนเพิ่มบทบาท */
        ok(in_array('cost.edit', $actor['perms'], true), 'เจ้าของร้านได้ cost.edit ติดมาด้วย');
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

test('กฎสิทธิ์ของเจ็ดบทบาท', function () {
    ok(Roles::manageAdmins([Roles::SUPERUSER]), 'ผู้ดูแลระบบจัดการผู้ใช้ได้');
    ok(Roles::manageAdmins([Roles::OWNER]), 'เจ้าของจัดการผู้ใช้ได้');
    ok(Roles::manageAdmins([Roles::ADMIN]), 'แอดมินจัดการผู้ใช้ได้');
    ok(!Roles::manageAdmins([Roles::SALES]), 'พนักงานขายจัดการผู้ใช้ไม่ได้');
    ok(!Roles::manageAdmins([Roles::STOCK]), 'พนักงานคลังจัดการผู้ใช้ไม่ได้');

    /* เห็นต้นทุนกับกรอกต้นทุนเป็นคนละสิทธิ์ และแอดมินอยู่คนละฝั่งของสองข้อนี้
       — ตัวเลขที่กำไรทั้งร้านคำนวณจากมันเป็นของเจ้าของร้าน แต่ผู้จัดการยังต้อง
       อ่านรายงานออก · คู่นี้คือเหตุผลที่ทั้งไฟล์ Roles.php เลิกใช้บันไดยศ */
    ok(Roles::enterRxCost([Roles::OWNER]), 'เจ้าของลงต้นทุนได้');
    ok(!Roles::enterRxCost([Roles::ADMIN]), 'แอดมินลงต้นทุนไม่ได้');
    ok(Roles::seeCost([Roles::ADMIN]), 'แต่แอดมินยังเห็นต้นทุนได้');
    ok(!Roles::enterRxCost([Roles::SALES]), 'พนักงานขายลงต้นทุนไม่ได้');
    ok(!Roles::seeCost([Roles::SALES]), 'พนักงานขายไม่เห็นต้นทุน');
    ok(!Roles::enterRxCost([Roles::STOCK]), 'พนักงานคลังลงต้นทุนไม่ได้');

    ok(Roles::editCatalog([Roles::ADMIN]), 'แอดมินแก้แคตตาล็อกได้');
    ok(!Roles::editCatalog([Roles::STOCK]), 'พนักงานคลังแก้แคตตาล็อกไม่ได้');

    // เพิ่มของใหม่กับแก้ของเดิม คนละคำถาม — ของใหม่ถูกค้นพบตอนทำงาน
    ok(Roles::addProduct([Roles::SALES]), 'พนักงานขายเพิ่มสินค้าได้');
    ok(Roles::addProduct([Roles::STOCK]), 'พนักงานคลังเพิ่มสินค้าได้');
    ok(!Roles::addProduct(['ผู้มาเยือน']), 'บทบาทที่ระบบไม่รู้จักเพิ่มไม่ได้');
    ok(!Roles::addProduct([]), 'คนที่ยังไม่ได้กำหนดสิทธิ์เพิ่มไม่ได้');

    // งานระบบเป็นของผู้ดูแลระบบคนเดียว เจ้าของร้านจัดการคนของตัวเองได้เต็มที่
    // โดยไม่ต้องถือสิทธิ์ที่ทำให้ระบบล่มได้
    ok(Roles::manageSystem([Roles::SUPERUSER]), 'ผู้ดูแลระบบทำงานระบบได้');
    ok(!Roles::manageSystem([Roles::OWNER]), 'เจ้าของร้านไม่ได้ถือสิทธิ์งานระบบ');

    /* ทุกบทบาทบันทึกความเคลื่อนไหวได้ ยกเว้นบัญชี — คนที่ตรวจตัวเลขกับคนที่
       ทำให้ตัวเลขเกิด ไม่ควรเป็นคนเดียวกัน · ยกเว้นไว้ตรงนี้อย่างเปิดเผย ไม่ใช่
       ลบลูปทิ้งแล้วเหลือแต่ข้อที่นึกออก */
    foreach (Roles::ALL as $r) {
        if ($r === Roles::ACCOUNTING) {
            ok(!Roles::moveStock([$r]), 'บัญชีบันทึกความเคลื่อนไหวไม่ได้');
            continue;
        }
        ok(Roles::moveStock([$r]), "{$r} ต้องบันทึกความเคลื่อนไหวได้");
    }
});

test('บทบาทบัญชี — เงินและรายงาน ไม่แตะคนและการตั้งค่า', function () {
    $acc = [Roles::ACCOUNTING];

    // สิ่งที่เข้ามาทำ
    ok(Roles::moneyZone($acc), 'เข้ากลุ่มการเงินได้');
    ok(Roles::seeCost($acc), 'เห็นต้นทุน');
    ok(Roles::seeBranchMoney($acc), 'เห็นยอดและกำไรจากสาขา');
    ok(Roles::settleBranch($acc), 'บันทึกรับเงินจากสาขาได้');
    ok(Roles::useStock($acc), 'เข้าฝั่งคลังไปดูมูลค่าคลังกับยอดสาขาได้');

    // สิ่งที่กันไว้ — งานคน งานระบบ และทุกอย่างที่ทำให้ตัวเลขเปลี่ยน
    ok(!Roles::systemZone($acc), 'ไม่เข้ากลุ่มข้อมูลระบบ');
    ok(!Roles::manageAdmins($acc), 'จัดการผู้ใช้ไม่ได้');
    ok(!Roles::manageSystem($acc), 'งานระบบไม่ได้');
    ok(!Roles::enterRxCost($acc), 'กรอกต้นทุนไม่ได้ — ตรวจตัวเลขที่ตัวเองตั้งไม่ได้');
    ok(!Roles::editCatalog($acc), 'แก้แคตตาล็อกไม่ได้');
    ok(!Roles::addProduct($acc), 'เพิ่มสินค้าไม่ได้');
    ok(!Roles::manageBranches($acc), 'เพิ่ม/แก้สาขาไม่ได้');

    /* ไม่มี frontdesk.use — ด่านที่สองใน api/index.php ปล่อยให้เดินเฉพาะเส้นทาง
       กลุ่มการเงิน ที่เหลือของ /api ปิดเหมือนพนักงานคลัง */
    ok(!Roles::useFrontdesk($acc), 'ไม่มีสิทธิ์ระบบหน้าร้าน');
    ok(!Roles::viewAllCases($acc), 'ไม่เห็นเคสลูกค้า');

    eq(Roles::home($acc), '/income/', 'ลงที่หน้ารายรับ ซึ่งเป็นงานแรกของวัน');
    eq(Roles::rank($acc), Roles::rank([Roles::SALES]), 'ยศเท่าพนักงาน — คนละงาน ไม่ใช่คนละชั้น');
    ok(Roles::canGrant([Roles::ADMIN], Roles::ACCOUNTING), 'แอดมินตั้งบทบาทบัญชีให้คนอื่นได้');
});

test('แยก admin.zone เป็นสองโซนแล้ว สิทธิ์ของคนเดิมไม่ขยับ', function () {
    /* แอดมิน เจ้าของร้าน ผู้ดูแลระบบ ต้องได้ทั้งสองโซน — ไม่งั้นการแยกครั้งนี้
       คือการยึดสิทธิ์คืนจากคนที่มีอยู่ โดยไม่มีใครสั่ง */
    foreach ([Roles::ADMIN, Roles::OWNER, Roles::SUPERUSER] as $r) {
        ok(Roles::moneyZone([$r]), "{$r} ยังเข้ากลุ่มการเงินได้");
        ok(Roles::systemZone([$r]), "{$r} ยังเข้ากลุ่มข้อมูลระบบได้");
    }

    // และคนที่ไม่เคยมี ก็ยังไม่มี
    foreach ([Roles::SALES, Roles::TRAINEE, Roles::STOCK] as $r) {
        ok(!Roles::moneyZone([$r]), "{$r} ไม่ได้กลุ่มการเงิน");
        ok(!Roles::systemZone([$r]), "{$r} ไม่ได้กลุ่มข้อมูลระบบ");
    }

    // ชื่อ admin.zone ต้องไม่เหลือค้างอยู่ในตารางสิทธิ์อีก
    ok(!in_array('admin.zone', Roles::permsOf([Roles::OWNER]), true), 'ไม่มี admin.zone หลงเหลือ');
});

test('พนักงานฝึกหัดได้ชุดสิทธิ์เดียวกับพนักงานขายทุกช่อง', function () {
    /* เทียบทั้งชุด ไม่ใช่ทีละข้อที่นึกออก — สองบทบาทนี้ต่างกันแค่ป้าย และวันที่
       ใครเผลอให้สิทธิ์ข้อหนึ่งกับ sales อย่างเดียว เทสต์นี้ต้องแดง ไม่ใช่เงียบ */
    eq(Roles::permsOf([Roles::TRAINEE]), Roles::permsOf([Roles::SALES]), 'ชุดสิทธิ์');
    eq(Roles::rank([Roles::TRAINEE]), Roles::rank([Roles::SALES]), 'ยศ');
});

test('สิทธิ์ของคนหนึ่งคนคือยูเนียนของทุกบทบาทที่ถือ', function () {
    $both = [Roles::SALES, Roles::ADMIN];

    ok(Roles::useFrontdesk($both), 'ได้ฝั่งหน้าร้านจากบทบาทขาย');
    ok(Roles::useStock($both), 'ได้ฝั่งคลังจากบทบาทแอดมิน');
    ok(Roles::seeCost($both), 'เห็นต้นทุนจากบทบาทแอดมิน');
    ok(Roles::manageAdmins($both), 'จัดการผู้ใช้จากบทบาทแอดมิน');
    ok(!Roles::enterRxCost($both), 'ยังกรอกต้นทุนไม่ได้ ไม่มีบทบาทไหนให้สิทธิ์นั้น');

    /* ยูเนียนต้องไม่ทำให้ได้อะไรเกินกว่าที่แต่ละใบให้ — ผลรวมของสองชุดต้องเท่ากับ
       สองชุดรวมกันพอดี ไม่ใช่ "อะไรก็ได้เพราะถือหลายใบ" */
    $expected = array_values(array_unique(array_merge(
        Roles::permsOf([Roles::SALES]),
        Roles::permsOf([Roles::ADMIN]),
    )));
    sort($expected);
    $actual = Roles::permsOf($both);
    sort($actual);
    eq($actual, $expected, 'ยูเนียนพอดี ไม่เกินไม่ขาด');

    // ยศตามใบที่สูงที่สุด — ใช้ตอบว่าตั้งบทบาทให้ใครได้เท่านั้น
    eq(Roles::rank($both), Roles::rank([Roles::ADMIN]), 'ยศตามใบที่สูงสุด');
});

test('พนักงานคลังไม่มีสิทธิ์ฝั่งหน้าร้านและไม่เห็นเคส', function () {
    ok(!Roles::useFrontdesk([Roles::STOCK]), 'ไม่มี frontdesk.use');
    ok(!Roles::viewAllCases([Roles::STOCK]), 'ไม่มี case.view_all');
    ok(Roles::useStock([Roles::STOCK]), 'แต่เข้าระบบคลังได้');

    // ที่เหลือเห็นเคสได้ทุกใบ — หน้าร้านต้องรับงานต่อจากกันได้
    foreach ([Roles::SALES, Roles::TRAINEE, Roles::ADMIN, Roles::OWNER] as $r) {
        ok(Roles::viewAllCases([$r]), "{$r} เห็นเคสทั้งหมด");
    }
});

test('บทบาทที่ระบบไม่รู้จักถูกทิ้ง ไม่ใช่ปล่อยผ่าน', function () {
    eq(Roles::clean(['sales', 'wizard', 'sales']), [Roles::SALES], 'ทิ้งของแปลกและตัวซ้ำ');
    eq(Roles::clean([]), [], 'ว่างก็คือว่าง');
    eq(Roles::rank(['wizard']), 0, 'ยศของบทบาทที่ไม่รู้จักคือศูนย์');
    ok(!Roles::has(['wizard'], 'cost.view'), 'และไม่ได้สิทธิ์อะไรเลย');

    // เรียงจากสิทธิ์มากไปน้อยเสมอ ไม่ใช่ตามลำดับที่ส่งเข้ามา
    eq(Roles::clean(['sales', 'owner']), [Roles::OWNER, Roles::SALES], 'เรียงตามยศ');
    eq(Roles::text([Roles::OWNER, Roles::ADMIN]), 'Owner + Admin', 'ข้อความบนแท็ก');
});

test('ตั้งบทบาทได้ไม่เกินบทบาทของตัวเอง', function () {
    ok(Roles::canGrant([Roles::OWNER], Roles::OWNER), 'เจ้าของตั้งเจ้าของคนที่สองได้');
    ok(Roles::canGrant([Roles::OWNER], Roles::ADMIN), 'เจ้าของตั้งแอดมินได้');
    ok(!Roles::canGrant([Roles::ADMIN], Roles::OWNER), 'แอดมินตั้งเจ้าของไม่ได้');
    ok(!Roles::canGrant([Roles::ADMIN], Roles::SUPERUSER), 'แอดมินตั้งผู้ดูแลระบบไม่ได้');
    ok(!Roles::canGrant([Roles::OWNER], Roles::SUPERUSER), 'เจ้าของตั้งผู้ดูแลระบบไม่ได้');
    ok(Roles::canGrant([Roles::ADMIN], Roles::SALES), 'แอดมินตั้งพนักงานขายได้');
    ok(Roles::canGrant([Roles::ADMIN], Roles::STOCK), 'แอดมินตั้งพนักงานคลังได้');
    /* canGrant ตอบแค่เรื่องลำดับบทบาท ไม่ได้ตอบว่าใครจัดการผู้ใช้ได้ — พนักงาน
       ถูกกันตั้งแต่ manageAdmins ก่อนจะมาถึงบรรทัดนี้ */
    ok(!Roles::manageAdmins([Roles::SALES]), 'พนักงานขายไม่ผ่านด่านจัดการผู้ใช้ตั้งแต่แรก');
    ok(!Roles::canGrant([Roles::SALES], Roles::ADMIN), 'ถึงหลุดมาได้ ก็ตั้งบทบาทที่สูงกว่าไม่ได้');
});

test('หน้าแรกหลังล็อกอินตรงกับฝั่งที่ทำงาน', function () {
    /* มีฝั่งเดียว = ส่งถึงที่ทำงานเลย ไม่ต้องผ่านหน้าเลือก */
    eq(Roles::home([Roles::SALES]), '/', 'พนักงานขายเข้าหน้าร้าน');
    eq(Roles::home([Roles::TRAINEE]), '/', 'พนักงานฝึกหัดเข้าหน้าร้าน เหมือนพนักงานขาย');
    eq(Roles::home([Roles::STOCK]), '/stock/dashboard/', 'พนักงานคลังเข้าแดชบอร์ดคลัง');

    /* มีสองฝั่ง = ถามก่อน · เดาแทนไม่ได้ว่าวันนี้เปิดมาทำอะไร และการเดาผิดแปลว่า
       ต้องเดินย้อนออกจากฝั่งที่ไม่ได้ตั้งใจเข้าทุกเช้า */
    foreach ([Roles::SUPERUSER, Roles::OWNER, Roles::ADMIN] as $r) {
        eq(Roles::home([$r]), '/hub/', "{$r} ลงหน้าเลือกระบบ");
    }
    eq(Roles::home([Roles::SALES, Roles::STOCK]), '/hub/', 'ถือสองฝั่งก็ลงหน้าเลือกระบบ');
});

test('ตำแหน่งงานไม่มีผลต่อสิทธิ์', function () {
    // employees.roles ของคนหนึ่งมีคำว่า "admin" อยู่ ถ้าเผลอเอา job_title
    // ไปตัดสินสิทธิ์ คนนั้นจะกลายเป็นเจ้าของร้านทันที
    $people = Db::all("SELECT id, display_name, job_title FROM admins WHERE job_title LIKE '%admin%'");
    ok(count($people) > 0, 'ต้องมีคนที่ job_title มีคำว่า admin ไว้ทดสอบ');
    foreach ($people as $p) {
        $roles = Auth::rolesOf((int) $p['id']);
        ok(
            !in_array(Roles::OWNER, $roles, true),
            "{$p['display_name']} ต้องไม่ได้สิทธิ์ owner จากคำว่า admin ใน job_title",
        );
    }
});

test('Roles::require โยน 403 เมื่อไม่มีสิทธิ์', function () {
    $e = null;
    try {
        Roles::require(Roles::manageAdmins([Roles::SALES]), 'จัดการผู้ใช้');
    } catch (ApiError $x) {
        $e = $x;
    }
    ok($e !== null, 'ต้องโยน');
    eq($e->status, 403, 'รหัสสถานะ');
    eq($e->reason, 'forbidden', 'เหตุผล');
});
