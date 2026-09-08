<?php
/**
 * ยืนยันขั้น "ขาย" แล้วของออกจากคลังจริงไหม
 *
 * เส้นที่ทดสอบคือ `POST /api/cases/{id}/processes/sales/complete` กับ
 * `.../reopen` ซึ่งเป็นจุดที่ต่อสาย `CaseStock` เข้ากับหน้าร้าน · ก่อนหน้านี้
 * `CaseStock::issueForCase` ไม่มีใครเรียกเลย กดขายแล้วจำนวนในคลังไม่ลด และไม่มี
 * แถวในสมุด — บั๊กที่มองไม่เห็นจากหน้าจอ เพราะทุกอย่างบอกว่าสำเร็จ
 *
 * ทุกอย่างอยู่ในทรานแซกชันเดียวที่ถอนทิ้งตอนจบ รวมถึงการตัดสต็อกเอง — บริการ
 * ฝั่งคลังถูกเรียกเป็นฟังก์ชันในโปรเซสเดียวกันและใช้คอนเนกชันเดียวกัน ไม่ได้อยู่
 * หลัง HTTP อีกแล้ว · สคริปต์ยังเรียกคืนของก่อนถอนอยู่ดี เผื่อวันที่มันกลับไป
 * อยู่คนละโปรเซส แถวใน `case_stock_issues` ที่ยังไม่มี `reversed_at` คือรายการ
 * ที่ต้องตามเก็บถ้าสคริปต์ตายกลางทาง
 *
 * วัดที่ยอดรวมของ SKU ไม่ใช่ล็อตที่ใบสั่งชี้ — ใบสั่งเก็บ id ของล็อต แต่ฝั่งคลัง
 * รับ SKU แล้วเลือกล็อตเองตาม FIFO ล็อตที่ถูกตัดจึงมักเป็นล็อตเก่ากว่า
 */
declare(strict_types=1);

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

Db::configure($config['db']);
StockModule::boot();
StockClient::configure($config['stock_api']);

require "$root/api/routes/cases.php";
require "$root/api/routes/processes.php";

$pass = 0;
$fail = 0;

function check(string $what, callable $fn): void
{
    global $pass, $fail;
    try {
        $fn();
        $pass++;
        echo "  ok   $what\n";
    } catch (Throwable $e) {
        $fail++;
        echo "  FAIL $what\n       " . get_class($e) . ': ' . $e->getMessage() . "\n";
    }
}

function expect(bool $ok, string $msg): void
{
    if (!$ok) {
        throw new RuntimeException($msg);
    }
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

/**
 * อ่านด้วยคอนเนกชันเดียวกับที่เขียน
 *
 * โค้ดฝั่งคลังไม่ได้อยู่หลัง HTTP อีกแล้ว — มันถูกเรียกเป็นฟังก์ชันในโปรเซส
 * เดียวกันและใช้คอนเนกชันฐานข้อมูลตัวเดียวกัน (ดู `core/StockModule.php`) การ
 * ตัดสต็อกจึงเกิดใน *ทรานแซกชันเดียวกับสคริปต์นี้* และถูกถอนพร้อมกันตอนจบ
 *
 * เคยลองวัดด้วยคอนเนกชันที่สองเพื่อ "ดูของจริง" แล้วได้ค่าเดิมทุกครั้ง เพราะ
 * แถวที่ยังไม่ commit คนอื่นไม่เห็น — เป็นการวัดที่ผิด ไม่ใช่โค้ดที่ผิด
 */
/* วัดที่ "ของทั้งหมดของ SKU นี้" ไม่ใช่ล็อตใดล็อตหนึ่ง — ใบสั่งชี้ไปที่ล็อต แต่
   ฝั่งคลังรับ SKU แล้วเลือกล็อตเองตาม FIFO ล็อตที่ถูกตัดจึงมักไม่ใช่ล็อตที่ชี้ */
$remaining = static fn(string $sku): int => (int) Db::get(
    'SELECT COALESCE(SUM(l.remaining_qty), 0) n FROM stock_lots l
       JOIN products p ON p.id = l.product_id WHERE p.sku = ?',
    $sku,
)['n'];
$movements = static fn(string $sku): int => (int) Db::get(
    'SELECT COUNT(*) n FROM inventory_logs g
       JOIN stock_lots l ON l.id = g.lot_id
       JOIN products p ON p.id = l.product_id WHERE p.sku = ?',
    $sku,
)['n'];

echo "\nขายหน้าร้านแล้วสต็อกลดจริงไหม (POST /api/cases/{id}/processes/sales/complete)\n";

if (StockClient::mode() !== 'live') {
    echo "  ข้าม — STOCK_API_MODE=" . StockClient::mode() . " ไม่ใช่ live จึงไม่มีการตัดจริงให้วัด\n\n";
    exit(0);
}

$lot = Db::get('SELECT id, sku, product_name FROM v_stock_lot WHERE remaining_qty > 2 ORDER BY id DESC LIMIT 1');
if (!$lot) {
    echo "  ข้าม — ไม่มีล็อตที่มีของเหลือพอให้ทดสอบ\n\n";
    exit(0);
}
$lotId = (int) $lot["id"];
$sku = (string) $lot["sku"];
$before = $remaining($sku);
$logsBefore = $movements($sku);

$pdo = Db::pdo();
$pdo->beginTransaction();

$caseId = null;

try {
    /* เคสกับออเดอร์ที่ชี้ไปที่ล็อตจริง — ช่อง frame_product_id เก็บ id ของ *ล็อต*
       ตาม schema เดิม (ดู docblock ของ CaseStock) ไม่ใช่ id ของสินค้า */
    $customer = Db::get('SELECT id FROM customers ORDER BY id DESC LIMIT 1');
    $employee = Db::get('SELECT id FROM employees WHERE active = 1 ORDER BY id LIMIT 1');
    expect((bool) $customer && (bool) $employee, 'ต้องมีลูกค้าและพนักงานอย่างน้อยอย่างละหนึ่ง');

    $case = \Optic\Auth::as($owner, fn() => Router::dispatch('POST', '/api/cases', [], [
        'customer_id' => (int) $customer['id'],
        'received_by' => (int) $employee['id'],
    ]));
    $caseId = (int) $case['id'];

    /* ขั้นการขายจะยืนยันไม่ได้ถ้าไม่มีชื่อกรอบ ชื่อเลนส์ และราคารวม — ใส่ให้ครบ
       เพื่อให้เทสต์ไปหยุดที่เรื่องสต็อก ไม่ใช่ที่ด่านตรวจความครบของใบสั่ง
       เลนส์ใส่แต่ชื่อ ไม่ผูกล็อต จึงมีบรรทัดเดียวที่ต้องตัดจริงคือกรอบ */
    Db::run(
        'INSERT INTO custom_orders (case_id, customer_id, employee_id, order_date,
            frame_product_id, frame_name, frame_price, lens_name, total_price)
         VALUES (?, ?, ?, NOW(), ?, ?, 0, ?, 1)',
        $caseId,
        (int) $customer['id'],
        (int) $employee['id'],
        $lotId,
        (string) $lot['product_name'],
        'เลนส์ทดสอบ (ไม่ผูกล็อต)',
    );

    check('แผนการตัดอ่านออกว่าจะตัดอะไร', function () use ($caseId) {
        $plan = CaseStock::plan(caseDetail($caseId));
        expect(count($plan) === 1, 'ต้องมีหนึ่งบรรทัด (กรอบ) — ได้ ' . count($plan));
        expect($plan[0]['missing'] === null, 'หา SKU ของล็อตไม่เจอ: ' . (string) $plan[0]['missing']);
    });

    check('ยืนยันขั้นขายแล้วยอดคงเหลือลดลงหนึ่งชิ้น', function () use ($caseId, $sku, $before, $remaining, $owner, $employee) {
        \Optic\Auth::as($owner, fn() => Router::dispatch(
            'POST',
            "/api/cases/$caseId/processes/sales/complete",
            [],
            ['employee_id' => (int) $employee['id']],
        ));
        $after = $remaining($sku);
        expect($after === $before - 1, "ยอดคงเหลือควรเป็น " . ($before - 1) . " แต่ได้ $after");
    });

    check('มีแถวในสมุดความเคลื่อนไหวเพิ่มขึ้น', function () use ($sku, $logsBefore, $movements) {
        $after = $movements($sku);
        expect($after === $logsBefore + 1, "แถวในสมุดควรเพิ่มหนึ่ง — ก่อน $logsBefore หลัง $after");
    });

    check('จดไว้ที่ case_stock_issues ว่าตัดอะไรไปแล้ว', function () use ($caseId) {
        $n = (int) Db::get('SELECT COUNT(*) n FROM case_stock_issues WHERE case_id = ?', $caseId)['n'];
        expect($n === 1, "ควรมีหนึ่งแถว ได้ $n");
    });

    check('กดยืนยันซ้ำไม่ตัดรอบสอง', function () use ($caseId, $sku, $before, $remaining, $owner) {
        \Optic\Auth::as($owner, fn() => Router::dispatch('POST', "/api/cases/$caseId/processes/sales/reopen", [], []));
        \Optic\Auth::as($owner, fn() => Router::dispatch('POST', "/api/cases/$caseId/processes/sales/complete", [], []));
        $after = $remaining($sku);
        expect($after === $before - 1, "ยอดควรยังเป็น " . ($before - 1) . " แต่ได้ $after");
    });

    check('เปิดขั้นขายกลับมาแก้แล้วของกลับเข้าคลัง', function () use ($caseId, $sku, $before, $remaining, $owner) {
        \Optic\Auth::as($owner, fn() => Router::dispatch('POST', "/api/cases/$caseId/processes/sales/reopen", [], []));
        $after = $remaining($sku);
        expect($after === $before, "ยอดควรกลับไปเป็น $before แต่ได้ $after");
    });
} finally {
    /* คืนของก่อนถอน transaction เสมอ — แถวใน case_stock_issues กำลังจะหายไปกับ
       การถอน แต่ของที่ตัดออกไปแล้วอยู่ในตารางของฝั่งคลัง ซึ่งไม่ได้อยู่ในนี้ */
    if ($caseId !== null) {
        try {
            CaseStock::returnForCase(caseDetail($caseId), 'จบการตรวจสอบ — คืนของทั้งหมด');
        } catch (Throwable $e) {
            echo "  ! คืนของอัตโนมัติไม่สำเร็จ: " . $e->getMessage() . "\n";
        }
    }
    $pdo->rollBack();
}

$after = $remaining($sku);
$logsAfter = $movements($sku);

echo "\n" . str_repeat('-', 56) . "\n";
echo $after === $before
    ? "ยอดคงเหลือกลับเท่าเดิม ($before ชิ้น) · แถวในสมุดกลับไปที่ $logsAfter\n"
    : "⚠ ยอดคงเหลือไม่กลับเท่าเดิม: ก่อน $before หลัง $after — ต้องตามคืนด้วยมือ\n";
printf("ผ่าน %d / %d\n\n", $pass, $pass + $fail);

exit($fail === 0 && $after === $before ? 0 : 1);
