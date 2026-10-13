<?php
/**
 * เรียงเลขใบเสร็จ (Bill / BillP) ใหม่ทั้งปี ตามวันที่บนใบ
 *
 *   php api/cli/renumber-receipts.php                    ดูอย่างเดียว ไม่แตะฐาน
 *   php api/cli/renumber-receipts.php --csv=out.csv      + เขียนทะเบียนเลขใหม่ให้บัญชีตรวจ
 *   php api/cli/renumber-receipts.php --apply            เขียนจริง (transaction เดียว)
 *   --year=2026                                          ปีที่จะเรียง (ค่าเริ่มต้น ปีนี้)
 *
 * เริ่มนับที่บิลวันที่ RECEIPT_START (1 ก.ย. 2026 — routes/receipts.php) ใบเสร็จของบิล
 * ก่อนวันนั้นที่เคยได้เลขไปแล้ว ถูกถอดเลขออก (receipt_no = NULL) ใบจะพิมพ์เลขบิลเดิม
 * ของระบบ Access แทน
 *
 * ทำไมต้องมี: ก่อน 1 ต.ค. 2026 เลขใบเสร็จออกตอนมีคนเปิดหน้าใบเสร็จครั้งแรก ใบที่
 * เปิดย้อนหลังจึงได้เลขท้ายแถว (บิล 08/09 ได้ Bill-2026-10-00041) และออเดอร์ที่ไม่มี
 * ใครเปิดหน้าใบเสร็จก็ไม่มีเลขเลย ตอนนี้เลขออกตอนเปิดออเดอร์/ขาย สคริปต์นี้ทำให้
 * ของเก่าทั้งปีเข้ากติกาเดียวกัน: ทุกออเดอร์และทุกใบขายของปีได้เลข เรียงตาม
 * วันที่บนใบ (order_date / sale_date) แล้วตามลำดับที่สร้าง (id)
 *
 * ใบเสร็จที่เคยพิมพ์ไปแล้วจะได้เลขใหม่ — ร้านตกลงพิมพ์ใหม่ทั้งหมด (1 ต.ค. 2026)
 * ชื่อที่พิมพ์ลงใบ (bill_name ฯลฯ) ติดแถวเดิมไป ไม่หาย
 *
 * ใบขาย POS ที่ยกเลิก กับใบเสร็จของออเดอร์ที่ถูกลบ ยังได้เลขในชุดและถูกตีตรายกเลิก
 *
 * ระหว่างเขียนจริง แถวตัวนับของปีถูกล็อกไว้ การเปิดออเดอร์/ขายที่เข้ามาพร้อมกัน
 * จะรอจนสคริปต์จบ (ไม่กี่วินาที) แล้วได้เลขต่อท้ายชุดใหม่
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("cli only\n");
}

/* เลิกใช้ตั้งแต่ 13 ต.ค. 2026 — สคริปต์นี้แจกเลขให้ทุกออเดอร์/ใบขายของปี ซึ่งขัดกับกติกาใหม่
   ที่เลขเกิดเมื่อกด "ออกใบเสร็จ" เท่านั้น · ใช้ api/cli/receipt-tracking.php แทน */
if (!in_array('--legacy-renumber', $argv, true)) {
    exit("เลิกใช้แล้ว — ใช้ api/cli/receipt-tracking.php (ถ้าจำเป็นจริง ใส่ --legacy-renumber)\n");
}

$config = require dirname(__DIR__) . '/config.php';
require dirname(__DIR__) . '/core/Http.php';
require dirname(__DIR__) . '/core/Db.php';
require dirname(__DIR__) . '/core/Helpers.php';
require dirname(__DIR__) . '/services/Migrate.php';
/* RECEIPT_START อยู่ในไฟล์เส้นทาง — โหลดทั้งไฟล์ (ประกาศเส้นทางเฉย ๆ ไม่มีอะไรรัน) */
require dirname(__DIR__) . '/core/Router.php';
require dirname(__DIR__) . '/routes/receipts.php';
defined('RECEIPT_START') || define('RECEIPT_START', '2026-09-01');
Db::configure($config['db']);

$opts  = getopt('', ['year:', 'apply', 'csv:']);
$year  = (int) ($opts['year'] ?? date('Y'));
$apply = isset($opts['apply']);
$csv   = $opts['csv'] ?? null;
/* เริ่มที่ RECEIPT_START ถ้าอยู่ในปีนี้ — บิลก่อนหน้านั้นไม่มีเลข Bill */
$from  = max("$year-01-01", RECEIPT_START);
$to    = ($year + 1) . '-01-01';

$hasDocCols = (int) Db::get(
    "SELECT COUNT(*) n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'receipts' AND column_name = 'voided_at'"
)['n'] > 0;

/** รายการของชุดหนึ่ง เรียงตามวันที่บนใบ — แต่ละแถว: key, date, ref, name, total, void, receipt */
function plan(string $kind, string $from, string $to, bool $hasDocCols): array
{
    $col  = $kind === 'order' ? 'order_id' : 'sale_id';
    $have = [];
    foreach (Db::all("SELECT * FROM receipts WHERE $col IS NOT NULL") as $r) {
        $have[(int) $r[$col]] = $r;
    }

    if ($kind === 'order') {
        $rows = Db::all(
            "SELECT o.id, o.order_date AS d, o.invoice_code, c.case_code,
                    o.total_price - o.discount AS total,
                    TRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)) AS name
               FROM custom_orders o
               LEFT JOIN cases c      ON c.id = o.case_id
               LEFT JOIN customers cu ON cu.id = o.customer_id
              WHERE o.order_date >= ? AND o.order_date < ?",
            $from,
            $to
        );
    } else {
        $rows = Db::all(
            "SELECT s.id, s.sale_date AS d, s.pos_no, s.total_amount AS total, s.status,
                    s.void_at, s.void_reason,
                    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''),
                             s.customer_name_snapshot, '') AS name
               FROM pos_sales s
               LEFT JOIN customers cu ON cu.id = s.customer_id
              WHERE s.sale_date >= ? AND s.sale_date < ?",
            $from,
            $to
        );
    }

    $out = [];
    foreach ($rows as $r) {
        $id   = (int) $r['id'];
        $void = $kind === 'sale' && $r['status'] === 'void';
        $out[] = [
            'kind'    => $kind,
            'id'      => $id,
            'date'    => (string) $r['d'],
            'ref'     => $kind === 'order'
                ? trim(($r['invoice_code'] ?? '') . ' ' . ($r['case_code'] ?? ''))
                : (string) $r['pos_no'],
            'name'    => (string) $r['name'],
            'total'   => round2((float) $r['total']),
            'void'    => $void ? ('ยกเลิกใบขาย ' . $r['pos_no'] . ' — ' . ($r['void_reason'] ?? '')) : null,
            'void_at' => $void ? ($r['void_at'] ?: nowStamp()) : null,
            'receipt' => $have[$id] ?? null,
        ];
    }

    /* ใบเสร็จที่ออเดอร์ถูกลบไปแล้ว (order_id เป็น NULL) — ยังอยู่ในชุดตามวันที่บนใบ */
    if ($hasDocCols && $kind === 'order') {
        foreach (Db::all(
            "SELECT * FROM receipts WHERE order_id IS NULL AND sale_id IS NULL
                AND receipt_no LIKE 'Bill-%' AND doc_date >= ? AND doc_date < ?",
            $from,
            $to
        ) as $r) {
            $out[] = [
                'kind' => 'order', 'id' => null, 'date' => (string) $r['doc_date'],
                'ref' => '', 'name' => (string) ($r['bill_name'] ?? ''),
                'total' => round2((float) $r['total_amount']),
                'void' => (string) ($r['void_reason'] ?: 'ออเดอร์ถูกลบ'),
                'void_at' => $r['voided_at'] ?: nowStamp(), 'receipt' => $r,
            ];
        }
    }

    usort($out, static fn($a, $b) => [$a['date'], $a['id'] ?? 0] <=> [$b['date'], $b['id'] ?? 0]);
    return $out;
}

$series = ['Bill' => plan('order', $from, $to, $hasDocCols), 'BillP' => plan('sale', $from, $to, $hasDocCols)];

/* ใบเสร็จที่มีเลขของปีนี้ แต่ไม่ได้อยู่ในแผน: บิลก่อน RECEIPT_START → ถอดเลขออก
   นอกจากนั้น (เช่นออเดอร์ปีก่อนที่ได้เลขปีนี้) จะชนกับเลขใหม่ — หยุดให้คนดูก่อน */
$planned = [];
foreach ($series as $items) {
    foreach ($items as $it) {
        if ($it['receipt']) {
            $planned[(int) $it['receipt']['id']] = true;
        }
    }
}
$unnumber = [];
$strays   = [];
foreach (Db::all(
    "SELECT r.id, r.receipt_no, r.order_id, r.sale_id, COALESCE(o.order_date, s.sale_date) AS d
       FROM receipts r
       LEFT JOIN custom_orders o ON o.id = r.order_id
       LEFT JOIN pos_sales s     ON s.id = r.sale_id
      WHERE r.receipt_no LIKE ? OR r.receipt_no LIKE ?",
    "Bill-$year-%",
    "BillP-$year-%"
) as $r) {
    if (isset($planned[(int) $r['id']])) {
        continue;
    }
    if ($r['d'] !== null && substr((string) $r['d'], 0, 10) < RECEIPT_START) {
        $unnumber[] = $r;
    } else {
        $strays[] = $r;
    }
}
if ($strays) {
    fwrite(STDERR, "หยุด: ใบเสร็จเหล่านี้มีเลขปี $year แต่ไม่อยู่ในรายการที่จะเรียง\n");
    foreach ($strays as $s) {
        fwrite(STDERR, "  #{$s['id']} {$s['receipt_no']} order={$s['order_id']} sale={$s['sale_id']} date={$s['d']}\n");
    }
    exit(2);
}
foreach ($unnumber as $r) {
    printf("ถอดเลข %s — บิลวันที่ %s ก่อน %s\n", $r['receipt_no'], substr((string) $r['d'], 0, 10), RECEIPT_START);
}

/* เลขใหม่ของทุกแถว */
foreach ($series as $prefix => &$items) {
    foreach ($items as $i => &$it) {
        $ts        = strtotime($it['date']);
        $it['new'] = sprintf('%s-%d-%s-%0' . CODE_PAD . 'd', $prefix, $year, date('m', $ts), $i + 1);
        $it['old'] = $it['receipt']['receipt_no'] ?? '';
    }
    unset($it);
}
unset($items);

/* สรุป */
foreach ($series as $prefix => $items) {
    $have  = count(array_filter($items, static fn($x) => $x['receipt'] !== null));
    $voids = count(array_filter($items, static fn($x) => $x['void'] !== null));
    printf(
        "%-6s %5d ใบ  (มีเลขอยู่แล้ว %d · ออกเลขใหม่ %d · ยกเลิก %d)  %s … %s\n",
        $prefix,
        count($items),
        $have,
        count($items) - $have,
        $voids,
        $items[0]['new'] ?? '-',
        $items ? $items[count($items) - 1]['new'] : '-'
    );
    $byMonth = [];
    foreach ($items as $it) {
        $m = substr($it['date'], 0, 7);
        $byMonth[$m] ??= [$it['new'], $it['new'], 0];
        $byMonth[$m][1] = $it['new'];
        $byMonth[$m][2]++;
    }
    foreach ($byMonth as $m => [$first, $last, $n]) {
        printf("         %s  %4d ใบ  %s … %s\n", $m, $n, $first, $last);
    }
    foreach ($items as $it) {
        if ($it['old'] !== '' && $it['old'] !== $it['new']) {
            printf("         เปลี่ยน %-20s → %-20s  %s  %s  %s\n", $it['old'], $it['new'], substr($it['date'], 0, 10), $it['ref'], $it['name']);
        }
    }
}

if ($csv !== null) {
    $fh = fopen($csv, 'wb');
    fwrite($fh, "\xEF\xBB\xBF");
    fputcsv($fh, ['เลขที่ใบเสร็จ', 'วันที่', 'ชนิด', 'อ้างอิง', 'ลูกค้า', 'ยอดรวม', 'สถานะ', 'เลขเดิม'], ',', '"', '');
    foreach ($series as $items) {
        foreach ($items as $it) {
            fputcsv($fh, [
                $it['new'],
                substr($it['date'], 0, 10),
                $it['kind'] === 'order' ? 'เคสแว่น' : 'POS',
                $it['ref'],
                $it['name'],
                number_format($it['total'], 2, '.', ''),
                $it['void'] !== null ? 'ยกเลิก' : '',
                $it['old'],
            ], ',', '"', '');
        }
    }
    fclose($fh);
    echo "CSV: $csv\n";
}

if (!$apply) {
    echo "\n(ดูอย่างเดียว — ใส่ --apply เพื่อเขียนจริง)\n";
    exit(0);
}

/* DDL ทำ implicit commit จึงต้องมาก่อน transaction */
$changed = Migrate::receiptNumbering();
if ($changed) {
    echo 'schema: ' . implode(', ', $changed) . "\n";
}

Db::tx(function (Tx $q) use ($series, $year, $unnumber) {
    /* ล็อกตัวนับก่อน — ออเดอร์ที่เปิดเข้ามาระหว่างนี้รอ แล้วได้เลขต่อท้ายชุดใหม่ */
    foreach (array_keys($series) as $prefix) {
        $q->run('INSERT IGNORE INTO receipt_counters (prefix, year, last_no) VALUES (?, ?, 0)', $prefix, $year);
        $q->get('SELECT last_no FROM receipt_counters WHERE prefix = ? AND year = ? FOR UPDATE', $prefix, $year);
    }
    /* ย้ายเลขเดิมของปีออกไปเป็นชื่อชั่วคราวก่อน ไม่งั้นเลขใหม่ชนเลขเก่าของแถวอื่น */
    $q->run(
        "UPDATE receipts SET receipt_no = CONCAT('#renum-', id) WHERE receipt_no LIKE ? OR receipt_no LIKE ?",
        "Bill-$year-%",
        "BillP-$year-%"
    );
    foreach ($unnumber as $r) {
        $q->run('UPDATE receipts SET receipt_no = NULL, doc_date = ? WHERE id = ?', substr((string) $r['d'], 0, 10), (int) $r['id']);
    }
    foreach ($series as $prefix => $items) {
        foreach ($items as $it) {
            $col = $it['kind'] === 'order' ? 'order_id' : 'sale_id';
            if ($it['receipt']) {
                $q->run(
                    'UPDATE receipts SET receipt_no = ?, doc_date = ? WHERE id = ?',
                    $it['new'],
                    substr($it['date'], 0, 10),
                    (int) $it['receipt']['id']
                );
            } else {
                $q->run(
                    "INSERT INTO receipts (receipt_no, $col, doc_date, total_amount, issued_by)
                     VALUES (?, ?, ?, ?, NULL)",
                    $it['new'],
                    $it['id'],
                    substr($it['date'], 0, 10),
                    $it['total']
                );
            }
            if ($it['void'] !== null && $it['id'] !== null) {
                $q->run(
                    "UPDATE receipts SET voided_at = COALESCE(voided_at, ?), void_reason = ? WHERE $col = ?",
                    $it['void_at'],
                    mb_substr($it['void'], 0, 255),
                    $it['id']
                );
            }
        }
        $q->run('UPDATE receipt_counters SET last_no = ? WHERE prefix = ? AND year = ?', count($items), $prefix, $year);
    }
    $left = (int) $q->get("SELECT COUNT(*) n FROM receipts WHERE receipt_no LIKE '#renum-%'")['n'];
    if ($left) {
        throw new RuntimeException("ยังเหลือ $left ใบที่ไม่ได้เลขใหม่ — ยกเลิกทั้งหมด");
    }
});
echo "\nเขียนแล้ว\n";
