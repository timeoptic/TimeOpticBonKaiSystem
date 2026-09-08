<?php

declare(strict_types=1);

/**
 *   php api/cli/sweep-write-routes.php
 *
 * ยิงทุกเส้นที่เขียนข้อมูลของฝั่งหน้าร้าน (POST/PUT/DELETE) ด้วย Router ตัวจริง
 * ทั้งหมดอยู่ในทรานแซกชันเดียวที่ถูกถอนทิ้งตอนจบ ฐานข้อมูลจึงกลับไปเหมือนเดิม
 * ทุกแถว — ตรวจได้จากจำนวนแถวก่อนและหลังรัน ที่สคริปต์พิมพ์ให้เอง
 *
 * ทำไมต้องมี: ฝั่งคลังมีเทสต์ 239 ตัวครอบเส้นที่เขียนไว้หมดแล้ว ฝั่งหน้าร้าน
 * ไม่มีเลย เส้นที่เขียนข้อมูลจึงไม่เคยถูกยิงนอกจากตอนมีคนกดใช้งานจริง
 *
 * สิ่งที่ **ไม่** ยิง และเหตุผล — ไม่ใช่เส้นที่พัง แต่เป็นเส้นที่ผลไม่ได้อยู่ใน
 * ฐานข้อมูล จึง rollback คืนไม่ได้:
 *   ส่งข้อความ Telegram ออกไปจริง  /api/cases/:id/notify, /api/bookings/:id/remind,
 *                                  /api/reminders/run, /api/settings/telegram/test
 *   เขียนไฟล์ลงดิสก์               /api/uploads (multipart)
 *   ทำลาย session ของตัวเอง        /api/auth/login, /api/auth/logout
 */

$root = dirname(__DIR__, 2);
chdir($root);

$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/api/health';

$config = require "$root/api/config.php";

require "$root/api/core/Http.php";
require "$root/api/core/Db.php";
require "$root/api/core/Helpers.php";
require "$root/api/core/Router.php";
require "$root/api/core/Sql.php";
require "$root/api/core/Lookups.php";
require "$root/api/core/StockModule.php";
require "$root/api/services/Booking.php";
require "$root/api/services/Telegram.php";
require "$root/api/services/StockClient.php";
require "$root/api/services/CaseStock.php";
require "$root/api/services/Migrate.php";
require "$root/api/services/Scheduler.php";

Db::configure($config['db']);
StockModule::boot();
StockClient::configure($config['stock_api']);

foreach ([
    'auth', 'meta', 'dashboard', 'cases', 'customers', 'employees', 'prescriptions',
    'stock', 'locations', 'suppliers', 'orders', 'payments',
    'workflow', 'processes', 'uploads', 'sales', 'cashflow', 'reports', 'bookings', 'settings',
] as $group) {
    require "$root/api/routes/$group.php";
}

/** ผู้ใช้จริงจากตาราง admins ที่ถือบทบาทที่ขอ (บทบาทอยู่ที่ `admin_roles`) */
function actorWithRole(string $role): array
{
    $r = Db::get(
        'SELECT a.id, a.username, a.display_name, a.job_title, a.employee_id
           FROM admins a JOIN admin_roles r ON r.admin_id = a.id
          WHERE r.role = ? AND a.is_active = 1 LIMIT 1',
        $role,
    );
    if (!$r) {
        throw new RuntimeException("ไม่มีบัญชี role=$role ในฐานข้อมูล");
    }
    $roles = \Optic\Auth::rolesOf((int) $r['id']);
    return [
        'id'          => (int) $r['id'],
        'username'    => $r['username'],
        'displayName' => $r['display_name'],
        'jobTitle'    => $r['job_title'],
        'roles'       => $roles,
        'roleNames'   => \Optic\Roles::namesOf($roles),
        'roleText'    => \Optic\Roles::text($roles),
        'perms'       => \Optic\Roles::permsOf($roles),
        'home'        => \Optic\Roles::home($roles),
        'employeeId'  => $r['employee_id'] === null ? null : (int) $r['employee_id'],
        'mustChangePassword' => false,
    ];
}

$owner = actorWithRole('owner');

/** แถวตัวอย่างจริงของตาราง สำหรับปั้น body ที่หน้าตาเหมือนของจริง */
function sampleRow(string $table): array
{
    return Db::get("SELECT * FROM `$table` ORDER BY id DESC LIMIT 1") ?? [];
}

/** ตัดคอลัมน์ที่ฐานข้อมูลเป็นคนตั้งเอง ออกจาก body */
function bodyFrom(array $row, array $drop = []): array
{
    $auto = ['id', 'created_at', 'updated_at', ...$drop];
    return array_diff_key($row, array_flip($auto));
}

$pass = 0;
$fail = [];
$skipped = [];

function hit(string $what, string $method, string $path, array $body = []): mixed
{
    global $pass, $fail, $owner;
    try {
        $out = \Optic\Auth::as($owner, fn() => Router::dispatch($method, $path, [], $body));
        $pass++;
        printf("  ✓ %-7s %-44s %s\n", $method, $path, $what);
        return $out;
    } catch (Throwable $e) {
        $fail[] = [$method, $path, $what, get_class($e) . ': ' . $e->getMessage()];
        printf("  ✗ %-7s %-44s %s\n        %s\n", $method, $path, $what, $e->getMessage());
        return null;
    }
}

/**
 * เส้นที่คำตอบที่ถูกต้องคือการปฏิเสธ
 *
 * ยิงแล้วสำเร็จ = ตก เพราะกฎที่ควรกันไว้ไม่ได้กัน · ยิงแล้วโดนปฏิเสธ = ผ่าน
 */
function refuses(string $what, string $method, string $path, array $body = []): void
{
    global $pass, $fail, $owner;
    try {
        \Optic\Auth::as($owner, fn() => Router::dispatch($method, $path, [], $body));
        $fail[] = [$method, $path, $what, 'ทำสำเร็จ ทั้งที่ควรถูกปฏิเสธ'];
        printf("  ✗ %-7s %-44s %s (ควรถูกปฏิเสธ)\n", $method, $path, $what);
    } catch (Throwable $e) {
        $pass++;
        printf("  ✓ %-7s %-44s %s — %s\n", $method, $path, $what, $e->getMessage());
    }
}

function skip(string $method, string $path, string $why): void
{
    global $skipped;
    $skipped[] = [$method, $path, $why];
    printf("  – %-7s %-44s %s\n", $method, $path, $why);
}

$before = [];
foreach (['customers', 'cases', 'custom_orders', 'bookings', 'prescriptions', 'employees',
          'suppliers', 'payments', 'sales', 'stock_lots'] as $t) {
    $before[$t] = (int) (Db::get("SELECT COUNT(*) n FROM `$t`")['n'] ?? 0);
}

$pdo = Db::pdo();
$pdo->beginTransaction();

try {
    echo "\nลูกค้า\n";
    $customer = hit('สร้างลูกค้าใหม่', 'POST', '/api/customers', [
        'first_name' => 'ทดสอบ', 'last_name' => 'กวาดเส้นทาง',
        'phone' => '0800000001', 'email' => 'sweep@example.test',
    ]);
    $customerId = (int) ($customer['id'] ?? 0);
    hit('ถามว่าซ้ำกับใครไหม', 'POST', '/api/customers/duplicates', [
        'first_name' => 'ทดสอบ', 'last_name' => 'กวาดเส้นทาง', 'phone' => '0800000001',
    ]);
    hit('แก้ลูกค้า', 'PUT', "/api/customers/$customerId", [
        'first_name' => 'ทดสอบ', 'last_name' => 'กวาดเส้นทาง (แก้แล้ว)', 'phone' => '0800000002',
    ]);

    echo "\nเคสและขั้นตอนงาน\n";
    /* ขั้นตอน "รับลูกค้า" ยืนยันไม่ได้ถ้าไม่มีพนักงานผู้รับเรื่อง จึงต้องมีคนจริง
       ติดมาตั้งแต่ตอนเปิดเคส ไม่งั้นการทดสอบจะไปหยุดที่กฎ ไม่ใช่ที่เส้นทาง */
    $employeeRow = Db::get('SELECT id FROM employees WHERE active = 1 ORDER BY id LIMIT 1');
    $employeeRef = (int) ($employeeRow['id'] ?? 0);

    $case = hit('เปิดเคสใหม่', 'POST', '/api/cases', [
        'customer_id' => $customerId, 'received_by' => $employeeRef,
    ]);
    $caseId = (int) ($case['id'] ?? $case['case']['id'] ?? 0);
    hit('แก้เคส', 'PUT', "/api/cases/$caseId", [
        'customer_id' => $customerId, 'received_by' => $employeeRef,
    ]);
    hit('บันทึกโน้ตในเคส', 'POST', "/api/cases/$caseId/note", ['note' => 'กวาดเส้นทาง']);
    hit('เปลี่ยนสถานะเคส', 'POST', "/api/cases/$caseId/status", ['status' => 'waiting_exam']);
    hit('เริ่มขั้นตอนรับลูกค้า', 'POST', "/api/cases/$caseId/processes/reception/start", []);
    hit('ตั้งสถานะขั้นตอน', 'POST', "/api/cases/$caseId/processes/reception/state", ['status' => 'in_progress']);
    hit('ยืนยันขั้นตอนรับลูกค้า', 'POST', "/api/cases/$caseId/processes/reception/complete", []);
    hit('เปิดขั้นตอนกลับมาแก้', 'POST', "/api/cases/$caseId/processes/reception/reopen", []);
    skip('POST', "/api/cases/:id/notify", 'ส่ง Telegram ออกไปจริง ถอนคืนไม่ได้');

    echo "\nค่าสายตาและงานวัด\n";
    $rx = hit('บันทึกค่าสายตา', 'POST', '/api/prescriptions', [
        'customer_id' => $customerId, 'case_id' => $caseId,
        'od_sph' => '-1.25', 'os_sph' => '-1.50',
    ]);
    $rxId = (int) ($rx['id'] ?? 0);
    if ($rxId) {
        hit('แก้ค่าสายตา', 'PUT', "/api/prescriptions/$rxId", [
            'customer_id' => $customerId, 'case_id' => $caseId, 'od_sph' => '-1.75',
        ]);
        hit('ยืนยันค่าสายตา', 'POST', "/api/prescriptions/$rxId/confirm", []);
    }
    hit('บันทึกวัด Center', 'POST', '/api/centerings', ['case_id' => $caseId, 'pd_right' => 32, 'pd_left' => 32]);
    hit('บันทึกฟิตกรอบ', 'POST', '/api/frame-fittings', ['case_id' => $caseId, 'note' => 'กวาดเส้นทาง']);
    hit('บันทึกส่งมอบ', 'POST', '/api/case-deliveries', ['case_id' => $caseId, 'note' => 'กวาดเส้นทาง']);

    echo "\nออเดอร์ · ชำระเงิน · ขาย\n";
    $order = hit('เปิดออเดอร์', 'POST', '/api/orders', [
        'customer_id' => $customerId, 'case_id' => $caseId, 'total_price' => 1000,
    ]);
    $orderId = (int) ($order['id'] ?? 0);
    if ($orderId) {
        hit('แก้ออเดอร์', 'PUT', "/api/orders/$orderId", ['customer_id' => $customerId, 'total_price' => 1200]);
        hit('ตั้งนัดรับ', 'PUT', "/api/orders/$orderId/appointment", ['appointment_date' => date('Y-m-d')]);
        hit('บันทึกว่าของมาแล้ว', 'POST', "/api/orders/$orderId/fill", []);
        hit('ปิดออเดอร์', 'POST', "/api/orders/$orderId/close", []);
        hit('เปิดออเดอร์กลับมา', 'POST', "/api/orders/$orderId/reopen", []);
    }
    $payment = hit('รับชำระเงิน', 'POST', '/api/payments', [
        'case_id' => $caseId, 'customer_id' => $customerId, 'amount' => 500, 'method' => 'cash',
        'received_by' => $employeeRef,
    ]);
    $paymentId = (int) ($payment['id'] ?? 0);
    /* การขายหน้าร้านผูกกับล็อตจริงหนึ่งชิ้น ไม่ใช่ยอดเงินลอย ๆ — ต้องหยิบล็อตที่
       ยังไม่ถูกขายมาใช้ ไม่งั้นจะไปหยุดที่ "กรุณาเลือกสินค้าจากคลัง" */
    $freeLot = Db::get('SELECT id FROM v_stock_lot WHERE sold = 0 ORDER BY id DESC LIMIT 1');
    $sale = $freeLot === null ? null : hit('บันทึกการขาย', 'POST', '/api/sales', [
        'customer_id' => $customerId,
        'product_stock_id' => (int) $freeLot['id'],
        'price' => 500,
        'pay_type' => 'Cash',
    ]);
    $saleId = (int) ($sale['id'] ?? 0);

    echo "\nคิวจอง\n";
    $booking = hit('จองคิว', 'POST', '/api/bookings', [
        'customer_id' => $customerId, 'customer_name' => 'ทดสอบ กวาดเส้นทาง',
        'phone' => '0800000001', 'booking_date' => date('Y-m-d'), 'booking_time' => '10:00',
    ]);
    $bookingId = (int) ($booking['id'] ?? 0);
    if ($bookingId) {
        hit('แก้คิว', 'PUT', "/api/bookings/$bookingId", [
            'customer_name' => 'ทดสอบ กวาดเส้นทาง', 'phone' => '0800000001',
            'booking_date' => date('Y-m-d'), 'booking_time' => '11:00',
        ]);
        hit('เปลี่ยนสถานะคิว', 'POST', "/api/bookings/$bookingId/status", ['status' => 'confirmed']);
        $note = hit('เขียนโน้ตในคิว', 'POST', "/api/bookings/$bookingId/notes", ['note' => 'กวาดเส้นทาง']);
        $noteId = (int) ($note['id'] ?? 0);
        if ($noteId) {
            hit('ลบโน้ตในคิว', 'DELETE', "/api/bookings/$bookingId/notes/$noteId", []);
        }
        hit('เปิดเคสจากคิว', 'POST', "/api/bookings/$bookingId/open-case", []);
        skip('POST', "/api/bookings/:id/remind", 'ส่ง Telegram ออกไปจริง ถอนคืนไม่ได้');
    }

    echo "\nข้อมูลระบบ\n";
    $employee = hit('เพิ่มพนักงาน', 'POST', '/api/employees', [
        'employee_name' => 'ทดสอบกวาด', 'roles' => 'sales',
    ]);
    $employeeId = (int) ($employee['id'] ?? 0);
    if ($employeeId) {
        hit('แก้พนักงาน', 'PUT', "/api/employees/$employeeId", [
            'employee_name' => 'ทดสอบกวาด2', 'roles' => 'sales', 'active' => 0,
        ]);
    }
    $supplier = hit('เพิ่มผู้ขาย', 'POST', '/api/suppliers', ['name' => 'ทดสอบ กวาดเส้นทาง']);
    $supplierId = (int) ($supplier['id'] ?? 0);
    if ($supplierId) {
        hit('แก้ผู้ขาย', 'PUT', "/api/suppliers/$supplierId", [
            'name' => 'ทดสอบ กวาดเส้นทาง 2', 'active' => 0,
        ]);
    }
    $location = hit('เพิ่มตำแหน่งเก็บของ', 'POST', '/api/locations', [
        'product_name' => 'ทดสอบ กวาดเส้นทาง', 'location' => 'ชั้น A1',
    ]);
    $locationId = (int) ($location['id'] ?? 0);
    if ($locationId) {
        hit('แก้ตำแหน่งเก็บของ', 'PUT', "/api/locations/$locationId", [
            'product_name' => 'ทดสอบ กวาดเส้นทาง', 'location' => 'ชั้น B2',
        ]);
        hit('ลบตำแหน่งเก็บของ', 'DELETE', "/api/locations/$locationId", []);
    }
    hit('บันทึกการตั้งค่า', 'PUT', '/api/settings', ['reminder_default_minutes' => 60]);
    skip('POST', '/api/settings/telegram/test', 'ยิงออกไปที่ Telegram จริง');
    skip('POST', '/api/reminders/run', 'ส่งข้อความเตือนออกไปจริง');
    skip('POST', '/api/uploads', 'อัปโหลดไฟล์ลงดิสก์ ไม่ได้อยู่ในทรานแซกชัน');
    skip('DELETE', '/api/uploads/:id', 'คู่กับเส้นอัปโหลดที่ข้ามไป');
    skip('POST', '/api/auth/login', 'เปลี่ยน session ของตัวเองระหว่างรัน');
    skip('POST', '/api/auth/logout', 'เปลี่ยน session ของตัวเองระหว่างรัน');

    echo "\nคลังสินค้าฝั่งหน้าร้าน (เส้นที่วิ่งผ่านบริการของฝั่งคลัง)\n";
    $sku = 'SWEEP-' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 6));
    $lot = hit('รับของเข้าใหม่', 'POST', '/api/stock', [
        'sku' => $sku, 'product_type' => 'Frame', 'product_name' => 'ทดสอบ กวาดเส้นทาง',
        'product_price' => 990, 'product_expense' => 300, 'quantity' => 2,
    ]);
    /* เส้นรับของเข้าตอบเป็น ['ok' => true, 'ids' => [...]] ไม่ใช่แถวของล็อต */
    $lotId = (int) ($lot['ids'][0] ?? 0);
    if ($lotId) {
        hit('แก้ล็อต', 'PUT', "/api/stock/$lotId", [
            'product_type' => 'Frame', 'product_name' => 'ทดสอบ กวาดเส้นทาง', 'product_price' => 1090,
        ]);
        hit('ลบล็อต', 'DELETE', "/api/stock/$lotId", []);
    }

    echo "\nลบของที่สร้างไว้ระหว่างทาง (เส้น DELETE ที่เหลือ)\n";
    if ($saleId) {
        hit('ลบการขาย', 'DELETE', "/api/sales/$saleId", []);
    }
    if ($paymentId) {
        hit('ลบการชำระเงิน', 'DELETE', "/api/payments/$paymentId", []);
    }
    if ($orderId) {
        hit('ลบออเดอร์', 'DELETE', "/api/orders/$orderId", []);
    }

    /* สองเส้นนี้ "ต้อง" ปฏิเสธ — คิวที่เปิดเคสไปแล้วและลูกค้าที่มีเคสค้างอยู่ ลบทิ้ง
       แล้วประวัติจะชี้ไปที่แถวที่ไม่มีอยู่ · ผ่าน = ปฏิเสธถูกต้อง ไม่ใช่ลบสำเร็จ */
    echo "\nเส้นที่ต้องปฏิเสธ (ลบแล้วประวัติจะขาด)\n";
    if ($bookingId) {
        refuses('ลบคิวที่เปิดเคสไปแล้วไม่ได้', 'DELETE', "/api/bookings/$bookingId");
    }
    if ($customerId) {
        refuses('ลบลูกค้าที่มีเคสไม่ได้', 'DELETE', "/api/customers/$customerId");
    }
} finally {
    $pdo->rollBack();
}

$after = [];
foreach (array_keys($before) as $t) {
    $after[$t] = (int) (Db::get("SELECT COUNT(*) n FROM `$t`")['n'] ?? 0);
}

echo "\n" . str_repeat('─', 72) . "\n";
$moved = [];
foreach ($before as $t => $n) {
    if ($after[$t] !== $n) {
        $moved[] = "$t: $n → {$after[$t]}";
    }
}
echo $moved === []
    ? "ถอน transaction แล้ว จำนวนแถวทุกตารางเท่าเดิม\n"
    : "⚠ จำนวนแถวเปลี่ยน: " . implode(', ', $moved) . "\n";

printf("ผ่าน %d / %d เส้น · ข้ามโดยตั้งใจ %d เส้น\n", $pass, $pass + count($fail), count($skipped));

if ($fail !== []) {
    echo "\nที่ไม่ผ่าน:\n";
    foreach ($fail as [$m, $p, $what, $why]) {
        echo "  • $m $p — $what\n    $why\n";
    }
    exit(1);
}
