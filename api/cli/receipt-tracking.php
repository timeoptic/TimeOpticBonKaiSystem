<?php
/**
 * ใบเสร็จแบบ "ออกเมื่อกดออกใบเสร็จ" — ตั้งตาราง + ตรวจ/รีเซ็ตเลขเดือน ต.ค. 2569
 *
 *   php api/cli/receipt-tracking.php                      ดูอย่างเดียว: จัดกลุ่มใบเสร็จเลข ต.ค. ไม่แตะฐาน
 *   php api/cli/receipt-tracking.php --csv=out.csv        + เขียนรายการให้ผู้ดูแลอนุมัติ
 *   php api/cli/receipt-tracking.php --schema             สร้างตาราง/คอลัมน์ใหม่ (ทำซ้ำได้)
 *   php api/cli/receipt-tracking.php --reset-october --apply
 *                                                         รีเซ็ตเลข ต.ค. จริง (ต้องผ่าน --schema แล้ว)
 *
 * ทำไมต้องรีเซ็ต: 1–13 ต.ค. 2026 ระบบออกเลขตอนเปิดออเดอร์/ขาย POS ทุกบิลจึงมีเลข
 * แม้ยังไม่เคยออกใบให้ลูกค้า · ตั้งแต่ 13 ต.ค. เลขเกิดเมื่อกด "ออกใบเสร็จ" เท่านั้น
 * ร้านตัดสินใจ (13 ต.ค. 2026) ให้เลข ต.ค. เริ่มใหม่ แล้วออกใบ/พิมพ์ใหม่ทั้งหมด
 *
 * รีเซ็ตไม่ลบแถว: เลขเดิมย้ายไป legacy_no · status = VOIDED · ปลด order_id/sale_id
 * (source_type/source_id ยังจำว่าเป็นของบิลไหน) · ชื่อที่เคยพิมพ์ลงใบอยู่ในแถวเดิม
 * แล้วตัวนับของเดือนนั้นถอยกลับไปที่เลขสูงสุดที่ยังเหลืออยู่ (เลขท้ายเริ่มใหม่ทุกเดือน — ปกติคือ 0)
 *
 * ไม่มี print log ในระบบเดิม — "เคยกดพิมพ์" ดูจากหลักฐานเดียวที่มี คือชื่อลูกค้าบนใบ
 * (bill_name) ซึ่งถูกเขียนตอนกดปุ่มพิมพ์เท่านั้น · ไม่มีชื่อ ไม่ได้แปลว่าไม่เคยพิมพ์
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("cli only\n");
}

$config = require dirname(__DIR__) . '/config.php';
require dirname(__DIR__) . '/core/Http.php';
require dirname(__DIR__) . '/core/Db.php';
require dirname(__DIR__) . '/core/Helpers.php';
require dirname(__DIR__) . '/services/Migrate.php';
require dirname(__DIR__) . '/core/Router.php';
require dirname(__DIR__) . '/routes/receipts.php';
Db::configure($config['db']);

$opts   = getopt('', ['csv:', 'schema', 'reset-october', 'apply', 'month:']);
$month  = (string) ($opts['month'] ?? '2026-10');
$csv    = $opts['csv'] ?? null;
$schema = isset($opts['schema']);
$reset  = isset($opts['reset-october']);
$apply  = isset($opts['apply']);

if (!preg_match('/^(\d{4})-(\d{2})$/', $month, $m)) {
    exit("--month ต้องเป็น YYYY-MM\n");
}
$year = (int) $m[1];

if ($schema) {
    $changed = Migrate::receiptTracking();
    echo $changed ? 'schema: ' . implode(', ', $changed) . "\n" : "schema: ครบอยู่แล้ว\n";
}

$hasCol = static fn(string $c) => (int) Db::get(
    "SELECT COUNT(*) n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'receipts' AND column_name = ?",
    $c
)['n'] > 0;
$tracked = $hasCol('legacy_no');

/* ใบเสร็จที่ถือเลขของเดือนนี้ (Bill-2026-10-* / BillP-2026-10-*) — ทั้งที่ยังใช้อยู่และที่ยกเลิกไปแล้ว */
$tag  = sprintf('%d-%s', $year, $m[2]);
$rows = Db::all(
    "SELECT r.*, o.invoice_code, o.order_date, o.case_id, c.case_code, o.order_closed,
            s.pos_no, s.sale_date, s.status AS sale_status,
            (SELECT COUNT(*) FROM payments p WHERE p.order_id = r.order_id AND p.cancelled_at IS NULL AND p.amount > 0) AS pay_n,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = r.order_id AND p.cancelled_at IS NULL) AS pay_sum,
            (SELECT COUNT(*) FROM pos_payments pp WHERE pp.sale_id = r.sale_id AND pp.cancelled_at IS NULL AND pp.amount > 0) AS pos_pay_n
       FROM receipts r
       LEFT JOIN custom_orders o ON o.id = r.order_id
       LEFT JOIN cases c         ON c.id = o.case_id
       LEFT JOIN pos_sales s     ON s.id = r.sale_id
      WHERE r.receipt_no LIKE ? OR r.receipt_no LIKE ?
      ORDER BY r.receipt_no",
    "Bill-$tag-%",
    "BillP-$tag-%"
);

/**
 * กลุ่มตามข้อ 7 ของคำขอ — ใบหนึ่งอยู่ได้หลายกลุ่ม
 *   voided      ออกแล้วแต่ถูกยกเลิก (ลบออเดอร์ / ยกเลิกใบขาย)
 *   printed     เคยกดพิมพ์ (มีชื่อลูกค้าบนใบ)
 *   unknown     มีเลข แต่ไม่มีหลักฐานว่าเคยพิมพ์ — ได้เลขจากการเปิดออเดอร์อัตโนมัติ
 *   multi_pay   รับเงินหลายครั้ง (ใบเดียวต่อเคสครอบทุกก้อน)
 *   unpaid      ยังไม่มีการรับเงินเลย
 */
$groups = ['voided' => 0, 'printed' => 0, 'unknown' => 0, 'multi_pay' => 0, 'unpaid' => 0];
$out    = [];
foreach ($rows as $r) {
    $isPos   = $r['sale_id'] !== null || str_starts_with((string) $r['receipt_no'], 'BillP-');
    $voided  = $r['voided_at'] !== null;
    $printed = trim((string) $r['bill_name']) !== '';
    $payN    = (int) ($isPos ? $r['pos_pay_n'] : $r['pay_n']);
    $tags    = [];
    if ($voided) {
        $tags[] = 'voided';
    }
    $tags[] = $printed ? 'printed' : 'unknown';
    if ($payN > 1) {
        $tags[] = 'multi_pay';
    }
    if ($payN === 0 && !$voided) {
        $tags[] = 'unpaid';
    }
    foreach ($tags as $t) {
        $groups[$t]++;
    }
    $out[] = [
        'id'         => (int) $r['id'],
        'receipt_no' => (string) $r['receipt_no'],
        'type'       => $isPos ? 'POS' : 'CASE',
        'source'     => $isPos ? (string) ($r['pos_no'] ?? '') : (string) ($r['invoice_code'] ?? ''),
        'case_code'  => (string) ($r['case_code'] ?? ''),
        'bill_date'  => substr((string) ($isPos ? $r['sale_date'] : $r['order_date']), 0, 10),
        'total'      => (float) $r['total_amount'],
        'paid'       => $payN,
        'bill_name'  => (string) ($r['bill_name'] ?? ''),
        'tags'       => implode(' ', $tags),
        'reason'     => $voided
            ? 'ยกเลิกไปแล้ว — ย้ายเลขเดิมไปเก็บ ไม่ต้องออกใหม่'
            : ($printed
                ? 'เคยกดพิมพ์ (มีชื่อบนใบ) — ร้านจะพิมพ์ใหม่ด้วยเลขชุดใหม่'
                : 'ได้เลขจากการเปิดออเดอร์อัตโนมัติ ไม่มีหลักฐานว่าออกใบ — รอกดออกใบเสร็จ'),
        'void_reason' => (string) ($r['void_reason'] ?? ''),
    ];
}

printf("ใบเสร็จที่ถือเลขเดือน %s: %d ใบ (Bill %d · BillP %d)\n", $tag, count($out),
    count(array_filter($out, fn($r) => $r['type'] === 'CASE')),
    count(array_filter($out, fn($r) => $r['type'] === 'POS')));
foreach ([
    'voided'    => 'ออกแล้วแต่ถูกยกเลิก',
    'printed'   => 'เคยกดพิมพ์ (มีชื่อลูกค้าบนใบ)',
    'unknown'   => 'มีเลข ไม่มีหลักฐานว่าเคยพิมพ์',
    'multi_pay' => 'รับเงินหลายครั้ง',
    'unpaid'    => 'ยังไม่มีการรับเงิน',
] as $k => $label) {
    printf("  %-10s %4d  %s\n", $k, $groups[$k], $label);
}

if ($csv) {
    $fh = fopen($csv, 'w');
    fwrite($fh, "\xEF\xBB\xBF");
    fputcsv($fh, array_keys($out[0] ?? ['id' => 0]), ',', '"', '');
    foreach ($out as $r) {
        fputcsv($fh, $r, ',', '"', '');
    }
    fclose($fh);
    echo "CSV: $csv\n";
}

if (!$reset) {
    exit(0);
}
if (!$tracked) {
    exit("ยังไม่มีคอลัมน์ legacy_no — สั่ง --schema ก่อน\n");
}
if (!$apply) {
    echo "\n(ดูอย่างเดียว — ใส่ --apply เพื่อรีเซ็ตจริง)\n";
    exit(0);
}

$why = "รีเซ็ตเลข $tag — ออกใบใหม่ (ร้านสั่ง 13 ต.ค. 2026)";
$mon = (int) $m[2];
$res = Db::tx(function (Tx $q) use ($rows, $year, $mon, $why) {
    foreach (RECEIPT_PREFIX as $prefix) {
        $q->run('INSERT IGNORE INTO receipt_counters (prefix, year, month, last_no) VALUES (?, ?, ?, 0)', $prefix, $year, $mon);
        $q->get('SELECT last_no FROM receipt_counters WHERE prefix = ? AND year = ? AND month = ? FOR UPDATE', $prefix, $year, $mon);
    }
    foreach ($rows as $r) {
        $q->run(
            "UPDATE receipts
                SET legacy_no = receipt_no, receipt_no = NULL, status = 'VOIDED',
                    voided_at = COALESCE(voided_at, NOW()),
                    void_reason = CASE WHEN void_reason IS NULL THEN ? ELSE CONCAT(void_reason, ' · ', ?) END,
                    order_id = NULL, sale_id = NULL
              WHERE id = ?",
            $why,
            $why,
            (int) $r['id']
        );
    }
    $counters = [];
    foreach (RECEIPT_PREFIX as $prefix) {
        $max = (int) $q->get(
            "SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(receipt_no, '-', -1) AS UNSIGNED)), 0) n
               FROM receipts WHERE receipt_no LIKE ?",
            sprintf('%s-%d-%02d-%%', $prefix, $year, $mon)
        )['n'];
        $q->run('UPDATE receipt_counters SET last_no = ? WHERE prefix = ? AND year = ? AND month = ?', $max, $prefix, $year, $mon);
        $counters[$prefix] = $max;
    }
    return $counters;
});
printf("รีเซ็ตแล้ว %d ใบ · ตัวนับปี %d: %s\n", count($rows), $year,
    implode(', ', array_map(fn($p, $n) => "$p → เลขถัดไป " . ($n + 1), array_keys($res), $res)));
