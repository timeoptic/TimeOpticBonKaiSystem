<?php
/**
 * ไฟล์ Excel ที่ส่งออก ต้องให้ตัวเลขเดียวกับหน้ารายงานบนเว็บ
 *
 * ทั้งสองฝั่งอ่านฐานข้อมูลเดียวกันก็จริง แต่คนละคิวรี — `SalesReport` ตอบหน้าจอ
 * ส่วน `SalesExport` ประกอบไฟล์ (มันต้องการวันปิดงานกับเลขเคสเพิ่มมาเป็นคอลัมน์
 * ซึ่งหน้าจอไม่ได้ใช้) · สองคิวรีที่ต้องเหมือนกันแต่แก้กันคนละวันคือของที่เพี้ยน
 * ออกจากกันแน่นอน และเพี้ยนแบบไม่มีใครเห็น เพราะทั้งสองฝั่งยังคืนตัวเลขที่ดู
 * สมเหตุสมผลอยู่ · สคริปต์นี้เทียบให้ทั้งตาราง: ช่วงเวลา × ช่องทาง × สถานะงาน
 *
 * เคยเพี้ยนมาแล้วจริง ๆ: ตอนแรกไฟล์แบ่งเดือนด้วยวันปิดงาน ทำให้ปี 2026 ต่างจาก
 * หน้าเว็บ 58 ใบ ฿354,508 (บิลที่เปิดปี 2025 แล้วมาปิดปี 2026) — คนใช้เห็นเอง
 * ก่อนที่เราจะรู้ตัว
 *
 * อ่านอย่างเดียว ไม่เขียนอะไรลงฐานเลย รันบนเครื่องจริงได้
 *
 *   php api/cli/check-report-export.php
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("cli only\n");
}

$root = dirname(__DIR__, 2);
chdir($root);

$config = require "$root/api/config.php";

require "$root/api/core/Http.php";
require "$root/api/core/Db.php";
require "$root/api/core/Helpers.php";
require "$root/api/services/SalesReport.php";
require "$root/api/services/Xlsx.php";
require "$root/api/services/SalesExport.php";

date_default_timezone_set('Asia/Bangkok');
mb_internal_encoding('UTF-8');
Db::configure($config['db']);

$pass = 0;
$fail = 0;

/** ยอดที่หน้ารายงานบนเว็บจะโชว์ด้วยตัวกรองชุดนี้ */
function webTotals(string $from, string $to, string $channel, string $status): array
{
    $main = SalesReport::wantsMain($channel) ? SalesReport::mainBills($from, $to, $status) : [];
    $pos  = SalesReport::wantsPos($channel)  ? SalesReport::posBills($from, $to, $status)  : [];
    $all  = array_merge($main, $pos);
    return SalesReport::totals($all) + ['customers' => SalesReport::customers($all)['known']];
}

/** ยอดที่ไฟล์ Excel จะโชว์ด้วยตัวกรองชุดเดียวกัน */
function fileTotals(string $from, string $to, string $channel, string $status): array
{
    return SalesExport::totals(SalesExport::rows($from, $to, $channel, $status));
}

/**
 * ช่วงที่เอามาลอง — ต้องมีทั้งช่วงที่คร่อมปีและช่วงที่ไม่มีข้อมูลเลย
 *
 * ช่วงคร่อมปีคือกรณีที่จับความต่างของ "วันเปิดบิล vs วันปิดงาน" ได้ · ช่วงว่าง
 * คือกรณีที่ตัวเลขศูนย์เท่ากันได้ง่าย ๆ โดยที่โค้ดจริงพัง จึงต้องมีทั้งคู่
 */
$today  = today();
$year   = substr($today, 0, 4);
$ranges = [
    'วันนี้'            => [$today, $today],
    'เดือนนี้'          => [substr($today, 0, 7) . '-01', $today],
    'ปีนี้'             => ["$year-01-01", $today],
    'ปีที่แล้วทั้งปี'    => [($year - 1) . '-01-01', ($year - 1) . '-12-31'],
    'คร่อมปี'           => [($year - 1) . '-12-01', "$year-01-31"],
    'ทั้งหมดที่มี'       => ['2000-01-01', $today],
    'อนาคตที่ยังไม่มีของ' => [($year + 1) . '-01-01', ($year + 1) . '-12-31'],
];

echo "\nเทียบไฟล์ Excel กับหน้ารายงาน — ต้องเท่ากันทุกช่อง\n";
echo str_repeat('-', 78) . "\n";

foreach ($ranges as $label => [$from, $to]) {
    foreach (SalesReport::CHANNELS as $channel) {
        foreach (SalesReport::STATUSES as $status) {
            $web  = webTotals($from, $to, $channel, $status);
            $file = fileTotals($from, $to, $channel, $status);

            $diff = [];
            foreach (['bills', 'revenue', 'paid', 'balance', 'avg', 'customers'] as $key) {
                $a = $web[$key];
                $b = $file[$key];
                /* เทียบเงินด้วยความคลาดเคลื่อนหนึ่งสตางค์ ไม่ใช่ === เพราะทั้งสอง
                   ฝั่งบวกเลขทศนิยมคนละลำดับ · ส่วนจำนวนใบต้องเท่ากันเป๊ะ */
                $same = is_int($a) ? $a === $b : abs((float) $a - (float) $b) < 0.005;
                if (!$same) {
                    $diff[] = sprintf('%s: เว็บ %s ≠ ไฟล์ %s', $key, (string) $a, (string) $b);
                }
            }

            $what = sprintf('%-20s %-5s %-7s', $label, $channel, $status);
            if ($diff) {
                $fail++;
                echo "  FAIL $what\n";
                foreach ($diff as $d) {
                    echo "        $d\n";
                }
            } else {
                $pass++;
                printf("  ok   %s %6d ใบ %16s บาท\n", $what, $web['bills'], number_format($web['revenue'], 2));
            }
        }
    }
}

/* ยอดรวมของทุกเดือนในไฟล์ ต้องเท่ากับยอดรวมทั้งช่วง — แถวไหนตกไปอยู่นอกชีท
   ทุกใบ (วันที่เพี้ยนจนหลุดกรอบ) จะถูกจับตรงนี้ */
echo str_repeat('-', 78) . "\n";
[$from, $to] = $ranges['ปีนี้'];
$rows  = SalesExport::rows($from, $to, 'all', 'all');
$all   = SalesExport::totals($rows);
$byMon = [];
foreach ($rows as $r) {
    $byMon[substr($r['date'], 0, 7)][] = $r;
}
$sumBills   = 0;
$sumRevenue = 0.0;
foreach (SalesExport::months($from, $to) as $ym) {
    $t           = SalesExport::totals($byMon[$ym] ?? []);
    $sumBills   += $t['bills'];
    $sumRevenue += $t['revenue'];
}
$monthsOk = $sumBills === $all['bills'] && abs($sumRevenue - $all['revenue']) < 0.005;
$monthsOk ? $pass++ : $fail++;
printf(
    "  %s ผลรวมทุกชีทรายเดือน = ยอดรวมทั้งช่วง (%d ใบ %s บาท)\n",
    $monthsOk ? 'ok  ' : 'FAIL',
    $sumBills,
    number_format($sumRevenue, 2)
);

/* ไฟล์ที่เขียนออกมาต้องเป็น zip ที่เปิดได้จริง ไม่ใช่แค่ตัวเลขถูก */
$bytes  = SalesExport::workbook($from, $to, 'all', 'all')->toBytes();
$tmp    = tempnam(sys_get_temp_dir(), 'xlsxchk');
file_put_contents($tmp, $bytes);
$zip    = new ZipArchive();
$zipOk  = $zip->open($tmp, ZipArchive::CHECKCONS) === true;
$sheets = 0;
if ($zipOk) {
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $part = (string) $zip->getNameIndex($i);
        /* นับเฉพาะตัวชีทเอง ไม่เอาแฟ้ม _rels ที่อยู่ในโฟลเดอร์เดียวกัน */
        if (str_starts_with($part, 'xl/worksheets/sheet')) {
            $sheets++;
        }
        /* XML ที่พังตัวเดียวทำให้ Excel ปฏิเสธทั้งไฟล์ ตรวจให้ครบทุกส่วน */
        $doc = new DOMDocument();
        libxml_use_internal_errors(true);
        if (!$doc->loadXML((string) $zip->getFromIndex($i))) {
            $zipOk = false;
        }
        libxml_clear_errors();
    }
    $zip->close();
}
@unlink($tmp);
$zipOk ? $pass++ : $fail++;
printf(
    "  %s ไฟล์ที่สร้างเปิดได้ (%d ชีท · %.1f KB)\n",
    $zipOk ? 'ok  ' : 'FAIL',
    $sheets,
    strlen($bytes) / 1024
);

echo str_repeat('-', 78) . "\n";
printf("ผ่าน %d / %d\n\n", $pass, $pass + $fail);

exit($fail === 0 ? 0 : 1);
