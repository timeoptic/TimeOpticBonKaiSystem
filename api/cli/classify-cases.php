<?php
/**
 * จัดประเภทเคสจากโน้ต แล้วเก็บกวาดเคสออนไลน์
 *
 *   php api/cli/classify-cases.php [--dry-run] [--no-delete]
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ทำไมการลบต้องผ่านที่นี่ ไม่ใช่ลบตอนกดบันทึกเคส
 * ─────────────────────────────────────────────────────────────────────────
 *
 * การจัดประเภททำงานอัตโนมัติทุกครั้งที่สร้างหรือแก้เคส (ดู routes/cases.php)
 * แต่ **การลบเดินผ่านคำสั่งนี้ทางเดียว** ด้วยเหตุผลสองข้อ:
 *
 *   1. พนักงานพิมพ์โน้ตแล้วกดบันทึก แล้วเคสหายไปต่อหน้า — อ่านยังไงก็เป็นบั๊ก
 *      ไม่ใช่ฟีเจอร์ และคนจะเลิกพิมพ์โน้ตทันทีที่เจอครั้งแรก
 *   2. คำค้นแก้ได้ที่หน้าตั้งค่า · คำกว้างไปคำเดียวลบของจริงทิ้งเป็นร้อยเคส
 *      ตรงนี้มี `--dry-run` ให้ดูก่อนเสมอ และเขียนสำเนาไว้ก่อนลบทุกครั้ง
 *
 * ผลที่ร้านต้องการ ("ไม่ต้องนำไปนับรวมใน Case ปกติ") เกิดขึ้นทันทีที่จัดประเภท
 * อยู่แล้ว เพราะรายงานกรองด้วย customer_category ไม่ได้กรองด้วยการมีอยู่ของแถว
 *
 * ─────────────────────────────────────────────────────────────────────────
 * สิ่งที่หายไปตอนลบเคส (ตรวจจาก information_schema แล้ว)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   CASCADE  → หายถาวร 14 ตาราง: case_events · case_processes · case_photos ·
 *              centerings · frame_fittings · case_deliveries · qc_checks ·
 *              lens_jobs · production_jobs · stock_reservations …
 *   SET NULL → ไม่หายแต่ขาดจากเคส: custom_orders · payments · prescriptions ·
 *              bookings — เงินยังอยู่ แต่ตอบไม่ได้ว่ามาจากเคสไหน
 *
 * จึงเขียนสำเนาของทุกเคสที่จะลบลงไฟล์ JSON Lines ก่อนลบ พร้อม id ของออเดอร์
 * และรายการรับเงินที่ผูกอยู่ — อย่างน้อยตามกลับได้ว่าเคยมีอะไร
 */
declare(strict_types=1);

$opts     = getopt('', ['dry-run', 'no-delete', 'log:']);
$dryRun   = isset($opts['dry-run']);
$noDelete = isset($opts['no-delete']);
$logPath  = (string) ($opts['log'] ?? (dirname(__DIR__) . '/uploads/deleted-cases.jsonl'));

$config = require __DIR__ . '/../config.php';
require __DIR__ . '/../core/Db.php';
require __DIR__ . '/../core/Helpers.php';
require __DIR__ . '/../services/CaseSource.php';
Db::configure($config['db']);

$kw = CaseSource::keywords();

echo "คำค้นที่ใช้อยู่:\n";
foreach ($kw as $type => $list) {
    printf("  %-12s %s\n", CaseSource::LABELS[$type] ?? $type, implode(' · ', $list));
}
echo "\n";

/* ดึงชื่อกรอบกับชื่อเลนส์มาด้วย — ร้านตั้งชื่อกรอบว่า "Online Frame" สำหรับของ
   ที่ขายผ่านแพลตฟอร์ม ซึ่งเป็นสัญญาณที่ชัดกว่าโน้ต · อ่านแต่ `cases.notes`
   อย่างเดียวจับได้ 4 เคสจาก 1,200 */
$rows = Db::all(
    "SELECT k.id, k.case_code, k.notes, k.referral_source, k.customer_category,
            CONCAT_WS(' ', o.frame_name, o.lens_name) AS extra
       FROM cases k LEFT JOIN custom_orders o ON o.case_id = k.id
      ORDER BY k.id"
);
printf("เคสทั้งหมด %s เคส\n\n", number_format(count($rows)));

$plan    = [];
$tally   = [];
$changed = 0;
foreach ($rows as $r) {
    $d   = CaseSource::detect($r['notes'], $r['referral_source'], $kw, $r['extra']);
    $new = $d['sourceType'];
    $old = CaseSource::valid($r['customer_category']);
    $tally[$new] = ($tally[$new] ?? 0) + 1;
    if ($old !== $new) {
        $changed++;
    }
    $plan[] = ['id' => (int) $r['id'], 'code' => $r['case_code'], 'old' => $old,
        'new' => $new, 'matched' => $d['matched'], 'reason' => $d['reason'], 'notes' => $r['notes']];
}

echo "ผลการจัดประเภท:\n";
arsort($tally);
foreach ($tally as $k => $v) {
    printf("  %-14s %6s เคส  (%.1f%%)\n", CaseSource::LABELS[$k] ?? $k,
        number_format($v), $v / max(1, count($rows)) * 100);
}
printf("  ค่าที่จะเปลี่ยนจากเดิม %s เคส\n\n", number_format($changed));

/* เคสออนไลน์ พร้อมของที่ผูกอยู่ — ต้องเห็นก่อนว่าจะลบอะไรไป */
$online = array_values(array_filter($plan, static fn($p) => $p['new'] === CaseSource::ONLINE));
$victims = [];
$money = 0.0;
foreach ($online as $p) {
    $o = Db::get(
        'SELECT COUNT(*) n, COALESCE(SUM(total_price - discount), 0) m FROM custom_orders WHERE case_id = ?',
        $p['id']
    );
    $pay = Db::get(
        'SELECT COUNT(*) n, COALESCE(SUM(amount), 0) m FROM payments WHERE case_id = ?',
        $p['id']
    );
    $victims[] = $p + ['orders' => (int) $o['n'], 'order_amount' => (float) $o['m'],
        'payments' => (int) $pay['n'], 'paid_amount' => (float) $pay['m']];
    $money += (float) $o['m'];
}

printf("เคสออนไลน์ที่เข้าเงื่อนไขลบ: %s เคส · ออเดอร์ที่ผูกอยู่รวม %s บาท\n",
    number_format(count($victims)), number_format($money, 2));
foreach (array_slice($victims, 0, 20) as $v) {
    printf("  #%-6s %-14s ออเดอร์ %d ใบ (%s บาท) · รับเงิน %d รายการ (%s บาท)  [%s]\n",
        $v['id'], $v['code'], $v['orders'], number_format($v['order_amount'], 2),
        $v['payments'], number_format($v['paid_amount'], 2), implode(',', $v['matched']));
    printf("     %s\n", str_replace(["\r", "\n"], ' ', mb_substr((string) $v['notes'], 0, 96)));
}
if (count($victims) > 20) {
    printf("  … และอีก %s เคส\n", number_format(count($victims) - 20));
}
echo "\n";

if ($dryRun) {
    echo "*** DRY RUN — ไม่ได้เขียนหรือลบอะไรเลย ***\n";
    if ($victims) {
        echo "รันจริงด้วย:  php api/cli/classify-cases.php\n";
        echo "จัดประเภทอย่างเดียว ไม่ลบ:  php api/cli/classify-cases.php --no-delete\n";
    }
    exit(0);
}

Db::pdo()->beginTransaction();
try {
    /* เขียนค่าใหม่เฉพาะแถวที่เปลี่ยน — UPDATE ทั้ง 8,919 แถวโดยไม่จำเป็นทำให้
       updated_at ขยับหมด แล้วดูไม่ออกว่าเคสไหนถูกแตะจริง */
    $upd = 0;
    foreach ($plan as $p) {
        if ($p['old'] === $p['new']) {
            continue;
        }
        Db::run('UPDATE cases SET customer_category = ? WHERE id = ?', $p['new'], $p['id']);
        $upd++;
    }
    printf("จัดประเภทแล้ว %s เคส\n", number_format($upd));

    $deleted = 0;
    if (!$noDelete && $victims) {
        /* สำเนาก่อนลบ — ต่อท้ายไฟล์เสมอ ไม่เขียนทับของเดิม เพราะการกวาดครั้งก่อน
           ก็เป็นหลักฐานเหมือนกัน */
        $dir = dirname($logPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
        $fh = fopen($logPath, 'ab');
        if ($fh === false) {
            throw new RuntimeException("เขียนไฟล์สำเนาไม่ได้: $logPath");
        }
        foreach ($victims as $v) {
            $full = Db::get('SELECT * FROM cases WHERE id = ?', $v['id']);
            $snap = [
                'deleted_at'  => date('c'),
                'reason'      => 'auto-classify: online',
                'matched'     => $v['matched'],
                'case'        => $full,
                'order_ids'   => array_column(
                    Db::all('SELECT id FROM custom_orders WHERE case_id = ?', $v['id']),
                    'id'
                ),
                'payment_ids' => array_column(
                    Db::all('SELECT id FROM payments WHERE case_id = ?', $v['id']),
                    'id'
                ),
                'rx_ids'      => array_column(
                    Db::all('SELECT id FROM prescriptions WHERE case_id = ?', $v['id']),
                    'id'
                ),
            ];
            fwrite($fh, json_encode($snap, JSON_UNESCAPED_UNICODE) . "\n");
        }
        fclose($fh);
        printf("เขียนสำเนา %s เคสไว้ที่ %s\n", number_format(count($victims)), $logPath);

        foreach ($victims as $v) {
            Db::run('DELETE FROM cases WHERE id = ?', $v['id']);
            $deleted++;
        }
        printf("ลบเคสออนไลน์ %s เคส\n", number_format($deleted));
    } elseif ($noDelete && $victims) {
        printf("ข้ามการลบ (--no-delete) · เคสออนไลน์ %s เคสยังอยู่ แต่ถูกกรองออกจากรายงานแล้ว\n",
            number_format(count($victims)));
    }

    Db::pdo()->commit();
    echo "\nเรียบร้อย\n";
} catch (Throwable $e) {
    if (Db::pdo()->inTransaction()) {
        Db::pdo()->rollBack();
    }
    fwrite(STDERR, "ล้มเหลว ย้อนกลับทั้งหมดแล้ว: " . $e->getMessage() . "\n");
    exit(1);
}
