<?php

declare(strict_types=1);

/**
 *   php api/tests/run.php              รันทุกไฟล์
 *   php api/tests/run.php stock        รันเฉพาะไฟล์ที่ชื่อมีคำว่า stock
 *
 * Exits non-zero when anything fails, so it can gate a commit.
 */

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/harness.php';

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
echo sprintf("ผ่าน %d / %d   ใช้เวลา %d ms\n", Harness::$passed, $total, $ms);

/* กันไม่ให้ shutdown ของโปรเซสยิงแจ้งเตือนของใกล้หมดเข้ากลุ่มจริง — เคสที่ไม่ได้
   ห่อด้วย withRollback() ก็ยังจดสินค้าไว้ได้ · เข็มขัดเส้นที่สอง เส้นแรกอยู่ที่นั่น */
\Optic\Service\LowStock::reset();

if ($failed > 0) {
    echo "\nที่ไม่ผ่าน:\n";
    foreach (Harness::$failures as $f) {
        echo "  • " . $f . "\n";
    }
    exit(1);
}

echo "ผ่านทั้งหมด\n";
exit(0);
