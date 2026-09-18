<?php

declare(strict_types=1);

/**
 *   php api/tests/run.php              รันทุกไฟล์
 *   php api/tests/run.php search       รันเฉพาะไฟล์ที่ชื่อมีคำว่า search
 *
 * Exits non-zero when anything fails, so it can gate a commit.
 *
 * Loads only the pieces of the API a test actually needs (config + Db +
 * helpers), not `index.php` — that file authenticates, boots the stock module
 * and dispatches a request, none of which belongs in a unit test.
 */

$config = require __DIR__ . '/../config.php';

require __DIR__ . '/../core/Http.php';
require __DIR__ . '/../core/Db.php';
require __DIR__ . '/../core/Helpers.php';
require __DIR__ . '/../core/StockSearch.php';
/* ตารางเส้นทาง + สองไฟล์ที่กระดานงานกับหน้าขั้นตอนใช้ร่วมกัน — เทสยิงผ่าน
   Router::dispatch() เหมือนที่เส้นทางอื่นเรียกกันเอง จึงได้ตรรกะตัวจริง ไม่ใช่
   สำเนาที่ลอกมาไว้ในเทส (ยังไม่โหลด index.php ด้วยเหตุผลข้างบน) */
require __DIR__ . '/../core/Router.php';
/* logEvent()/setStatus() กับชิ้นส่วน SQL ที่ routes/cases.php ใช้ตอนเขียน —
   เส้นทางที่อ่านอย่างเดียวไม่เคยแตะ ไฟล์นี้จึงไม่เคยถูกโหลดจนกระทั่งมีเทสต์
   ของการ "เปิดเคส" (60-case-create) */
require __DIR__ . '/../core/Sql.php';
require __DIR__ . '/../services/CaseSource.php';
require __DIR__ . '/../services/Booking.php';
require __DIR__ . '/../services/Scheduler.php';
require __DIR__ . '/../routes/processes.php';
require __DIR__ . '/../routes/cases.php';
/* POST /api/customers/:id/fill — "เติมข้อมูลลูกค้า" จากขั้นรับลูกค้า (32-customer-fill) */
require __DIR__ . '/../routes/customers.php';
require __DIR__ . '/../routes/uploads.php';
require __DIR__ . '/../routes/receipts.php';
require __DIR__ . '/../routes/bill-parties.php';
require __DIR__ . '/../routes/settings.php';
/* POST/GET /api/centerings อยู่ไฟล์นี้ — เทสต์ค่าการวัด Center (35-centering-corridor)
   ยิงเส้นทางตัวจริงเหมือนหน้าเว็บกดบันทึก Draft */
require __DIR__ . '/../routes/workflow.php';
/* ออเดอร์ + รายการตัวเลือกกลาง — เทสต์ประเภทกรอบ (36-order-frame-type) ยิง POST/PUT
   /api/orders ตัวจริง แล้วเทียบกับรายการที่ /api/meta ส่งให้หน้าเว็บ */
require __DIR__ . '/../core/Lookups.php';
require __DIR__ . '/../routes/orders.php';
require __DIR__ . '/../services/ActivityLog.php';
require __DIR__ . '/../services/Telegram.php';
require __DIR__ . '/../services/DeliveryDigest.php';
/* POS ขายหน้าร้าน (80-pos-items) — posActor() ถามคนล็อกอินผ่าน StockModule
   เทสต์จึงสวมบทด้วย \Optic\Auth::as() · SalesReport คือที่รายงานแยกกลุ่มสินค้า */
require __DIR__ . '/../core/StockModule.php';
require __DIR__ . '/../services/SalesReport.php';
require __DIR__ . '/../routes/pos.php';
/* หน้ารายงาน (90-report-customer-group) — ยิงเส้น /api/reports/* ตัวจริง
   · ไฟล์ Excel ของหน้าการรับเงิน (91-payment-export) เปิดไฟล์ที่สร้างได้ออกมาตรวจ */
require __DIR__ . '/../services/Xlsx.php';
require __DIR__ . '/../services/PaymentExport.php';
require __DIR__ . '/../routes/analytics.php';
/* รับเงินของเคส (95-payment-guards) — ยิง POST /api/payments ตัวจริง */
require __DIR__ . '/../routes/payments.php';
require __DIR__ . '/harness.php';

Db::configure($config['db']);

$filter = $argv[1] ?? null;

$files = glob(__DIR__ . '/*.test.php') ?: [];
sort($files);
if ($filter !== null) {
    $files = array_values(array_filter($files, static fn($f) => str_contains(basename($f), $filter)));
}

if ($files === []) {
    fwrite(STDERR, "ไม่พบไฟล์ทดสอบ\n");
    exit(1);
}

foreach ($files as $f) {
    require $f;
}

$started = microtime(true);
$lastGroup = null;

foreach (Harness::$cases as $case) {
    if ($case['group'] !== $lastGroup) {
        echo "\n" . $case['group'] . "\n";
        $lastGroup = $case['group'];
    }

    try {
        ($case['fn'])();
        Harness::$passed++;
        echo "  ✓ " . $case['name'] . "\n";
    } catch (AssertionFailed $e) {
        Harness::$failures[] = $case['group'] . ' › ' . $case['name'] . "\n      " . $e->getMessage();
        echo "  ✗ " . $case['name'] . "\n      " . $e->getMessage() . "\n";
    } catch (Throwable $e) {
        Harness::$failures[] = $case['group'] . ' › ' . $case['name']
            . "\n      " . $e::class . ': ' . $e->getMessage()
            . "\n      " . $e->getFile() . ':' . $e->getLine();
        echo "  ✗ " . $case['name'] . "  (" . $e::class . ": " . $e->getMessage() . ")\n";
    }
}

$ms = (int) round((microtime(true) - $started) * 1000);
$total = count(Harness::$cases);
$failed = count(Harness::$failures);

echo "\n" . str_repeat('─', 56) . "\n";
printf("ผ่าน %d/%d  ตก %d  (%d ms)\n", Harness::$passed, $total, $failed, $ms);

exit($failed === 0 ? 0 : 1);
