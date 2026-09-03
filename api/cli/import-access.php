<?php
/**
 * นำเข้าข้อมูลจริงจากฐาน Access เดิม (TimeOptic3.9_Backend.accdb)
 *
 *   php api/cli/import-access.php --csv=<โฟลเดอร์ CSV> [--dry-run]
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ทำไมรับ CSV ไม่ใช่อ่าน .accdb ตรง ๆ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * PHP บน Windows อ่าน .accdb ได้เฉพาะผ่าน ODBC ที่ต้องลง driver ตรงรุ่นกับ PHP
 * (32/64 บิต) ซึ่งเป็นเงื่อนไขที่พังง่ายและ debug ยาก · ขั้นดึงข้อมูลจึงแยกไปอยู่
 * ที่ PowerShell + ACE OLEDB (มีมากับ Access อยู่แล้ว) แล้วส่งต่อเป็น CSV UTF-8
 * ดูสคริปต์ฝั่งนั้นที่ scratchpad/export-access.ps1
 *
 * ผลพลอยได้ที่สำคัญกว่านั้น: CSV กลางทำให้ *ตรวจสอบซ้ำได้* — รันซ้ำกี่รอบก็ได้
 * ผลเหมือนเดิม และเทียบไฟล์กับผลลัพธ์ในฐานได้ตรง ๆ เวลาตัวเลขไม่ตรง
 *
 * ─────────────────────────────────────────────────────────────────────────
 * กติกาที่ยึดทั้งไฟล์
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  1. **ไม่แก้โครงสร้างฐานแม้แต่คอลัมน์เดียว** ทุกอย่างลงช่องที่มีอยู่แล้ว
 *  2. **คง ID เดิมจาก Access ทุกตาราง** — `tblCustomOrder.FrameProductID` ชี้ไปที่
 *     `tblStock.ID` และอีกสามคอลัมน์ก็เช่นกัน · ถ้าปล่อยให้ MySQL แจก id ใหม่
 *     ต้องทำตารางแปลง id ทุกตัวแล้วไล่ remap ซึ่งพลาดง่ายและตรวจยาก
 *  3. **แถวที่ FK หาปลายทางไม่เจอ ไม่ทำให้ทั้งงานล้ม** — ค่าที่เป็น NULL ได้จะถูก
 *     ตั้งเป็น NULL, ที่เป็น NULL ไม่ได้ (เช่น customer_id ของออเดอร์) จะข้ามทั้งแถว
 *     แล้วรายงานจำนวนที่ข้ามไว้ท้ายงาน · เงียบ ๆ ข้ามคือสิ่งที่ทำให้ไม่มีใครรู้ว่า
 *     ข้อมูลหายไปเท่าไหร่
 *  4. **ทั้งหมดอยู่ใน transaction เดียว** ล้มกลางทางแล้วฐานกลับไปเหมือนเดิม
 *
 * ─────────────────────────────────────────────────────────────────────────
 * สิ่งที่ Access ไม่มี และถูกสร้างขึ้นที่นี่
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   payments  Access เก็บเงินเป็นคอลัมน์บนใบออเดอร์ (Deposit / OrderCloseIncome)
 *             ไม่ใช่ ledger · ระบบนี้ถือว่า `payments` คือความจริงเรื่องเงิน
 *             (`paid = SUM(payments.amount)`) ถ้าไม่สร้าง ออเดอร์ทุกใบจะอ่านว่า
 *             ค้างชำระเต็มจำนวน
 *
 *   cases     Access ไม่มีคอนเซ็ปต์เคส · สร้างหนึ่งเคสต่อหนึ่งออเดอร์ โดยใช้ id
 *             เดียวกับออเดอร์ · สถานะมาจาก `OrderClosed` เท่านั้น ไม่เดาขั้นตอน
 *             ที่ไม่มีข้อมูลรองรับ
 *
 *   products  Access เก็บสต็อกแบบแบน (หนึ่งแถว = ของหนึ่งชิ้น) ส่วนที่นี่แยก
 *             แคตตาล็อกออกจากล็อต · สินค้าหนึ่งรายการ = หนึ่งคู่ (ProductType,
 *             ProductName) ที่ไม่ซ้ำกัน แล้วทุกแถวของ Access กลายเป็นล็อตจำนวน 1
 */
declare(strict_types=1);

$opts = getopt('', ['csv:', 'dry-run', 'yes']);
$csvDir = rtrim((string) ($opts['csv'] ?? ''), "\\/");
$dryRun = isset($opts['dry-run']);

if ($csvDir === '' || !is_dir($csvDir)) {
    fwrite(STDERR, "ใช้: php api/cli/import-access.php --csv=<โฟลเดอร์> [--dry-run]\n");
    exit(1);
}

$config = require __DIR__ . '/../config.php';
$c = $config['db'];
$pdo = new PDO(
    sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], $c['port'], $c['database']),
    $c['user'],
    $c['password'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

// ---------------------------------------------------------------- helpers

/** อ่าน CSV ทั้งไฟล์เป็นอาเรย์ของ assoc — ไฟล์ใหญ่สุดคือ 54k แถว พอไหว */
function readCsv(string $path): array
{
    $fh = fopen($path, 'rb');
    if ($fh === false) {
        throw new RuntimeException("เปิดไฟล์ไม่ได้: $path");
    }
    $head = fgetcsv($fh, 0, ',', '"', '');
    if ($head === false) {
        fclose($fh);
        return [];
    }
    /* กัน BOM เผื่อวันหน้ามีใครส่งไฟล์ที่มี BOM มา — คอลัมน์แรกจะชื่อเพี้ยนเงียบ ๆ */
    $head[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string) $head[0]);
    $rows = [];
    while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
        if (count($r) === 1 && ($r[0] === null || $r[0] === '')) {
            continue;
        }
        $rows[] = array_combine($head, array_pad(array_slice($r, 0, count($head)), count($head), null));
    }
    fclose($fh);
    return $rows;
}

/** ค่าว่างจาก CSV คือ NULL ไม่ใช่สตริงว่าง */
function s(?string $v): ?string
{
    $v = $v === null ? '' : trim($v);
    return $v === '' ? null : $v;
}

function i(?string $v): ?int
{
    $v = s($v);
    return $v === null ? null : (int) $v;
}

function f(?string $v, float $default = 0.0): float
{
    $v = s($v);
    return $v === null ? $default : (float) $v;
}

/** ตัดให้พอดีคอลัมน์ · คืนส่วนที่ถูกตัดด้วย ผู้เรียกจะได้เก็บไว้ที่อื่นไม่ให้หาย */
function fit(?string $v, int $max, ?string &$overflow = null): ?string
{
    $overflow = null;
    $v = s($v);
    if ($v === null) {
        return null;
    }
    if (mb_strlen($v) <= $max) {
        return $v;
    }
    $overflow = $v;
    return mb_substr($v, 0, $max);
}

/** 'yyyy-mm-dd hh:mm:ss' หรือ null */
function dt(?string $v): ?string
{
    $v = s($v);
    if ($v === null) {
        return null;
    }
    $t = strtotime($v);
    return $t === false ? null : date('Y-m-d H:i:s', $t);
}

function d(?string $v): ?string
{
    $x = dt($v);
    return $x === null ? null : substr($x, 0, 10);
}

/**
 * ค่าสายตาเป็นข้อความ ไม่ใช่ตัวเลข
 *
 * คอลัมน์ค่าสายตาในสคีมานี้เป็น VARCHAR โดยตั้งใจ (ดู README) เพราะรับค่าอย่าง
 * 'plano' ได้ · Access เก็บเป็น double จึงต้องจัดรูปเองให้อ่านเหมือนที่พนักงาน
 * เคยเห็น: มีเครื่องหมายบวกนำหน้าค่าบวก และทศนิยมสองตำแหน่งเสมอ
 */
function power(?string $v): ?string
{
    $v = s($v);
    if ($v === null) {
        return null;
    }
    $n = (float) $v;
    return ($n > 0 ? '+' : '') . number_format($n, 2, '.', '');
}

/** axis / pd เป็นจำนวนเต็ม — '180' ไม่ใช่ '180.00' */
function whole(?string $v): ?string
{
    $v = s($v);
    return $v === null ? null : (string) (int) round((float) $v);
}

/** ตัวเลขที่ไม่ต้องจัดรูป (VA) — ตัดศูนย์ท้ายทิ้งให้อ่านง่าย */
function plain(?string $v): ?string
{
    $v = s($v);
    if ($v === null) {
        return null;
    }
    $n = (float) $v;
    return $n == 0.0 ? null : rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.');
}

/**
 * คีย์สำหรับกันค่าซ้ำ — ตัวพิมพ์ใหญ่เล็กนับเป็นตัวเดียวกัน
 *
 * คอลัมน์ UNIQUE ของ MySQL ใช้ collation แบบ `_ci` (ไม่สนตัวพิมพ์) แต่ PHP เทียบ
 * สตริงแบบตรงตัว · กันซ้ำฝั่ง PHP ด้วยการเทียบตรงตัวจึงปล่อย 'Old Frame' กับ
 * 'Old frame' ผ่านไปทั้งคู่ แล้วไปตายที่ INSERT ซึ่งเป็นจุดที่ debug ยากที่สุด
 */
function ukey(?string $v): string
{
    return mb_strtolower(trim((string) $v));
}

$report = [];
$skipped = [];
$note = static function (string $line) use (&$report): void {
    $report[] = $line;
    fwrite(STDOUT, $line . "\n");
};
$skip = static function (string $why) use (&$skipped): void {
    $skipped[$why] = ($skipped[$why] ?? 0) + 1;
};

/** INSERT ทีละก้อน — 112,000 แถวถ้ายิงทีละคำสั่งใช้เวลาเป็นสิบนาที */
function insertBatch(PDO $pdo, string $table, array $cols, array $rows, int $chunk = 500): int
{
    if (!$rows) {
        return 0;
    }
    $colSql = '`' . implode('`,`', $cols) . '`';
    $one = '(' . implode(',', array_fill(0, count($cols), '?')) . ')';
    $done = 0;
    foreach (array_chunk($rows, $chunk) as $part) {
        $sql = "INSERT INTO `$table` ($colSql) VALUES " . implode(',', array_fill(0, count($part), $one));
        $args = [];
        foreach ($part as $r) {
            foreach ($r as $v) {
                $args[] = $v;
            }
        }
        $pdo->prepare($sql)->execute($args);
        $done += count($part);
    }
    return $done;
}

// ---------------------------------------------------------------- อ่าน CSV

$src = [];
foreach ([
    'tblCustomer', 'tblEmployee', 'tblEyeTest', 'tblCustomOrder', 'tblSale',
    'tblStock', 'tblExpense', 'tblIncome', 'tblLocationProd',
    'listSex', 'listMarketing', 'listPayType', 'listProductType',
] as $t) {
    $p = "$csvDir/$t.csv";
    if (!is_file($p)) {
        fwrite(STDERR, "ไม่พบไฟล์ $p\n");
        exit(1);
    }
    $src[$t] = readCsv($p);
    $note(sprintf('  อ่าน %-18s %7d แถว', $t, count($src[$t])));
}

$note('');

// ---------------------------------------------------- ตารางที่ห้ามล้าง
/**
 * สี่ตารางนี้ไม่ใช่ข้อมูลของร้าน แต่เป็นของระบบ — ล้างแล้วเข้าระบบไม่ได้อีก
 *
 *   admins            บัญชีผู้ใช้ทั้งหมด รวมบัญชีที่กำลังรันสคริปต์นี้อยู่
 *   app_settings      โทเคน Telegram และค่าตั้งต้น
 *   case_statuses     ตารางอ้างอิงของสถานะเคส ไม่ใช่ข้อมูลที่ผู้ใช้สร้าง
 *   schema_migrations บัญชีว่า migration ไหนรันไปแล้ว
 *
 * `list_len_type` ก็ไม่ล้าง — Access มีตารางนี้แต่ว่างเปล่า ส่วนของเรามีหกประเภท
 * ที่ระบบใหม่ใช้จริง การล้างทิ้งแล้วไม่มีอะไรมาแทนคือการทำให้ลุกอัปหายไปเฉย ๆ
 */
const KEEP = ['admins', 'app_settings', 'case_statuses', 'schema_migrations', 'list_len_type', 'branches'];

/** ล้างตามลำดับนี้ (ลูกก่อนพ่อ) — FOREIGN_KEY_CHECKS ปิดอยู่แล้วแต่เรียงไว้ให้อ่านรู้เรื่อง */
const WIPE = [
    'case_events', 'case_photos', 'case_processes', 'case_stock_issues',
    'case_item_fulfillment', 'case_deliveries', 'centerings', 'frame_fittings',
    'qc_checks', 'production_withdrawals', 'production_jobs', 'lens_followups',
    'lens_jobs', 'stock_reservations', 'customer_notifications', 'notification_log',
    'booking_notes', 'bookings',
    'pos_payments', 'pos_sale_items', 'pos_sales',
    'payments', 'sales', 'custom_orders', 'prescriptions', 'cases',
    'branch_issues', 'stock_requests', 'rx_orders', 'inventory_logs',
    'stock_lots', 'products', 'categories', 'suppliers', 'product_locations',
    'expenses', 'incomes', 'customers', 'employees',
    'list_sex', 'list_marketing', 'list_pay_type', 'list_product_type',
];

// ------------------------------------------------------------------ เริ่ม

$t0 = microtime(true);
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
$pdo->beginTransaction();

try {
    /* บัญชีผู้ใช้ที่ผูกกับพนักงานเดิมต้องปลดก่อน — พนักงานชุดใหม่จาก Access เป็น
       คนละคนคนละ id การปล่อยไว้คือลิงก์ที่ชี้ไปยังคนที่ไม่มีอยู่ */
    $pdo->exec('UPDATE admins SET employee_id = NULL');

    foreach (WIPE as $t) {
        if (in_array($t, KEEP, true)) {
            continue;
        }
        /* DELETE ไม่ใช่ TRUNCATE และไม่มี ALTER ตามหลัง — ทั้งคู่เป็น DDL ที่ทำให้
           MySQL สั่ง COMMIT อัตโนมัติ transaction จะขาดกลางคันโดยไม่มีอะไรเตือน
           และ rollback ทีหลังจะล้มเหลวทั้งที่ข้อมูลถูกลบไปแล้ว
           AUTO_INCREMENT ไม่ต้องรีเซ็ต เพราะทุกแถวใส่ id มาเอง InnoDB ดันตัวนับ
           ให้เกินค่าสูงสุดที่เพิ่งใส่ไปอยู่แล้ว */
        $pdo->exec("DELETE FROM `$t`");
    }
    $note('ล้างข้อมูลเดิมแล้ว (' . count(WIPE) . ' ตาราง · ไม่แตะ ' . implode(', ', KEEP) . ')');

    // ------------------------------------------------------------ ลุกอัป
    $SEX_TH = ['Male' => 'ชาย', 'Female' => 'หญิง'];
    $rows = [];
    $n = 0;
    $dedup = [];
    foreach ($src['listSex'] as $r) {
        $code = s($r['Sex'] ?? null);
        if ($code === null || isset($dedup[ukey($code)])) {
            continue;
        }
        $dedup[ukey($code)] = true;
        $rows[] = [$code, $SEX_TH[$code] ?? $code, $n += 10];
    }
    insertBatch($pdo, 'list_sex', ['code', 'label_th', 'sort_order'], $rows);

    $rows = [];
    $n = 0;
    $dedup = [];
    foreach ($src['listMarketing'] as $r) {
        $code = s($r['MarketingCode'] ?? null);
        if ($code === null || isset($dedup[ukey($code)])) {
            continue;
        }
        $dedup[ukey($code)] = true;
        $rows[] = [fit($code, 50), fit($code, 80), $n += 10];
    }
    insertBatch($pdo, 'list_marketing', ['code', 'label_th', 'sort_order'], $rows);

    $rows = [];
    $n = 0;
    $dedup = [];
    foreach ($src['listPayType'] as $r) {
        $code = s($r['PayType'] ?? null);
        if ($code === null || isset($dedup[ukey($code)])) {
            continue;
        }
        $dedup[ukey($code)] = true;
        $rows[] = [fit($code, 30), fit($code, 50), $n += 10, 1];
    }
    insertBatch($pdo, 'list_pay_type', ['code', 'label_th', 'sort_order', 'is_active'], $rows);

    $TYPE_TH = ['Lens' => 'เลนส์', 'Frame' => 'กรอบแว่น', 'ContactLen' => 'คอนแทคเลนส์',
        'Solution' => 'น้ำยา', 'Accessory' => 'อุปกรณ์เสริม', 'Sunglass' => 'แว่นกันแดด'];
    $rows = [];
    $n = 0;
    $dedup = [];
    foreach ($src['listProductType'] as $r) {
        $code = s($r['ProductType'] ?? null);
        if ($code === null || isset($dedup[ukey($code)])) {
            continue;
        }
        $dedup[ukey($code)] = true;
        $rows[] = [fit($code, 30), $TYPE_TH[$code] ?? $code, $n += 10];
    }
    insertBatch($pdo, 'list_product_type', ['code', 'label_th', 'sort_order'], $rows);
    $note('  ลุกอัป: เพศ · ช่องทางรู้จัก · ช่องทางชำระ · ประเภทสินค้า');

    // -------------------------------------------------------- หมวดสินค้า
    /* products.category_id เป็น NOT NULL — สคีมานี้บังคับให้ทุกสินค้ามีหมวด
       ส่วน Access ไม่มีคอนเซ็ปต์หมวด มีแต่ ProductType · หมวดจึงถูกสร้างจาก
       ProductType หนึ่งต่อหนึ่ง ซึ่งตรงกับที่หน้าคลังใช้กรองอยู่แล้ว */
    $catId = [];
    $rows = [];
    foreach ($TYPE_TH as $code => $th) {
        $rows[] = [$th, $code];
    }
    insertBatch($pdo, 'categories', ['name', 'code'], $rows);
    foreach ($pdo->query('SELECT id, code FROM categories') as $r) {
        $catId[$r['code']] = (int) $r['id'];
    }

    // ------------------------------------------------------------ ผู้ขาย
    $seen = [];
    foreach ($src['tblStock'] as $r) {
        $v = fit($r['VendorName'] ?? null, 120);
        if ($v !== null && !isset($seen[ukey($v)])) {
            $seen[ukey($v)] = $v;
        }
    }
    $rows = [];
    foreach ($seen as $v) {
        $rows[] = [$v];
    }
    insertBatch($pdo, 'suppliers', ['name'], $rows);
    /* คีย์ของแมปเป็น ukey ไม่ใช่ชื่อจริง — ตอนหาตอนใส่ล็อตก็ต้องหาด้วย ukey
       เหมือนกัน ไม่งั้นล็อตของ 'Old frame' จะหาผู้ขายไม่เจอเพราะที่เก็บไว้คือ
       'Old Frame' */
    $vendorId = [];
    foreach ($pdo->query('SELECT id, name FROM suppliers') as $r) {
        $vendorId[ukey($r['name'])] = (int) $r['id'];
    }
    $note(sprintf('  ผู้ขาย %d ราย', count($vendorId)));

    // ----------------------------------------------------------- สินค้า
    /* หนึ่งสินค้า = หนึ่งคู่ (ProductType, ProductName) ที่ไม่ซ้ำ · ราคาขายตั้งต้น
       ใช้ราคาของชิ้นที่รับเข้าล่าสุด เพราะราคาที่ขายจริงถูกบันทึกไว้บนใบออเดอร์
       อยู่แล้ว ค่านี้เป็นแค่ค่าตั้งต้นตอนเปิดบิลใหม่ */
    $prod = [];
    foreach ($src['tblStock'] as $r) {
        $type = s($r['ProductType'] ?? null) ?? 'Accessory';
        $name = s($r['ProductName'] ?? null) ?? '(ไม่มีชื่อ)';
        /* คีย์ไม่สนตัวพิมพ์ — 'Hoya Nulux 1.60' กับ 'hoya nulux 1.60' คือสินค้า
           ตัวเดียวกันที่พนักงานพิมพ์ต่างกัน · แยกเป็นสองรายการแล้วแคตตาล็อกจะมี
           ฝาแฝดเต็มไปหมด และรายงานยอดขายตามสินค้าจะซอยยอดของตัวเดียวกันเป็นสองก้อน
           ชื่อกับราคาที่เก็บเอาของชิ้นที่รับเข้าล่าสุด = การสะกดที่ใช้อยู่ปัจจุบัน */
        $key = ukey($type) . "\x00" . ukey($name);
        $date = dt($r['StockDate'] ?? null) ?? '';
        if (!isset($prod[$key]) || $date > $prod[$key]['date']) {
            $prod[$key] = ['type' => $type, 'name' => $name, 'price' => f($r['ProductPrice'] ?? null), 'date' => $date];
        }
    }
    $rows = [];
    $sku = 0;
    $skuOf = [];
    foreach ($prod as $key => $p) {
        $sku++;
        $code = sprintf('OLD-%06d', $sku);
        $skuOf[$key] = $code;
        $rows[] = [
            $code,
            $catId[$p['type']] ?? $catId['Accessory'],
            fit($p['type'], 30),
            fit($p['name'], 255),
            $p['price'],
        ];
    }
    insertBatch($pdo, 'products', ['sku', 'category_id', 'product_type', 'name', 'base_selling_price'], $rows);
    $prodId = [];
    foreach ($pdo->query('SELECT id, sku FROM products') as $r) {
        $prodId[$r['sku']] = (int) $r['id'];
    }
    $note(sprintf('  สินค้า %d รายการ', count($prodId)));

    // ------------------------------------------------------------- ล็อต
    /* หนึ่งแถวของ tblStock = ของหนึ่งชิ้น จึงเป็นล็อตจำนวน 1 · `Sold` บอกว่าชิ้นนั้น
       ออกไปแล้วหรือยัง ซึ่งกลายเป็น remaining_qty 0 หรือ 1 · **id ต้องเท่าของเดิม**
       เพราะออเดอร์และการขายชี้มาที่เลขนี้ */
    $rows = [];
    $lotIds = [];
    foreach ($src['tblStock'] as $r) {
        $id = i($r['ID'] ?? null);
        if ($id === null) {
            continue;
        }
        $type = s($r['ProductType'] ?? null) ?? 'Accessory';
        $name = s($r['ProductName'] ?? null) ?? '(ไม่มีชื่อ)';
        $pid = $prodId[$skuOf[ukey($type) . "\x00" . ukey($name)] ?? ''] ?? null;
        if ($pid === null) {
            $skip('ล็อตที่หาสินค้าไม่เจอ');
            continue;
        }
        $vendor = s($r['VendorName'] ?? null);
        $sold = (int) f($r['Sold'] ?? null) !== 0;
        $rows[] = [
            $id,
            (string) $id,
            $pid,
            $vendor === null ? null : ($vendorId[ukey(mb_substr($vendor, 0, 120))] ?? null),
            f($r['ProductExpense'] ?? null),
            1,
            $sold ? 0 : 1,
            d($r['StockDate'] ?? null) ?? '2023-01-01',
            s($r['Notes'] ?? null),
        ];
        $lotIds[$id] = true;
    }
    $n = insertBatch($pdo, 'stock_lots', ['id', 'lot_number', 'product_id', 'supplier_id',
        'cost_per_unit', 'initial_qty', 'remaining_qty', 'received_date', 'notes'], $rows);
    $note(sprintf('  ล็อตสต็อก %d แถว', $n));

    // ----------------------------------------------------------- ลูกค้า
    $rows = [];
    $custIds = [];
    foreach ($src['tblCustomer'] as $r) {
        $id = i($r['ID'] ?? null);
        if ($id === null) {
            continue;
        }
        /* first_name เป็น NOT NULL · ลูกค้าหกรายในฐานเดิมไม่มีชื่อ — ใส่ป้ายแทน
           ไม่ใช่ทิ้งแถว เพราะยอดขายของเขายังอยู่ */
        $first = fit($r['FirstName'] ?? null, 100) ?? '(ไม่ระบุชื่อ)';
        $extra = [];
        $nat = fit($r['Nationality'] ?? null, 60, $o);
        if ($o !== null) {
            $extra[] = "สัญชาติเต็ม: $o";
        }
        $phone = fit($r['Phone'] ?? null, 40, $o2);
        if ($o2 !== null) {
            $extra[] = "เบอร์เต็ม: $o2";
        }
        $notes = s($r['Notes'] ?? null);
        if ($extra) {
            $notes = trim(($notes ?? '') . "\n" . implode("\n", $extra));
        }
        $rows[] = [$id, $first, fit($r['LastName'] ?? null, 100), fit($r['Sex'] ?? null, 20),
            $nat, fit($r['Email'] ?? null, 120), $phone, $notes];
        $custIds[$id] = true;
    }
    $n = insertBatch($pdo, 'customers', ['id', 'first_name', 'last_name', 'sex',
        'nationality', 'email', 'phone', 'notes'], $rows);
    $note(sprintf('  ลูกค้า %d คน', $n));

    // --------------------------------------------------------- พนักงาน
    $rows = [];
    $empIds = [];
    foreach ($src['tblEmployee'] as $r) {
        $id = i($r['EmployeeID'] ?? null);
        if ($id === null) {
            continue;
        }
        $rows[] = [$id, fit($r['EmployeeName'] ?? null, 120) ?? "พนักงาน #$id",
            fit($r['FirstName'] ?? null, 100), fit($r['LastName'] ?? null, 100),
            fit($r['Sex'] ?? null, 20), d($r['BirthDate'] ?? null)];
        $empIds[$id] = true;
    }
    $n = insertBatch($pdo, 'employees', ['id', 'employee_name', 'first_name', 'last_name',
        'sex', 'birth_date'], $rows);
    $note(sprintf('  พนักงาน %d คน', $n));

    $emp = static fn(?int $id): ?int => ($id !== null && isset($empIds[$id])) ? $id : null;
    /* ล็อตที่ออเดอร์ชี้ไปแล้วไม่มีอยู่จริง (ถูกลบในฐานเดิม) — คอลัมน์พวกนี้ NULL ได้
       จึงปล่อยว่างแทนที่จะทิ้งทั้งออเดอร์ */
    $lot = static fn(?int $x): ?int => ($x !== null && $x > 0 && isset($lotIds[$x])) ? $x : null;

    // ---------------------------------------------------- ค่าสายตา
    $rows = [];
    $rxIds = [];
    foreach ($src['tblEyeTest'] as $r) {
        $id = i($r['ID'] ?? null);
        $cid = i($r['CustomerID'] ?? null);
        if ($id === null) {
            continue;
        }
        if ($cid === null || !isset($custIds[$cid])) {
            $skip('ใบวัดสายตาที่ลูกค้าถูกลบไปแล้ว');
            continue;
        }
        $rows[] = [
            $id, $cid, 'measured', dt($r['TestDate'] ?? null) ?? '2023-01-01 00:00:00',
            fit($r['TestFor'] ?? null, 80),
            power($r['RSphere'] ?? null), power($r['RCylinder'] ?? null), whole($r['RAxis'] ?? null),
            power($r['RAdd'] ?? null), plain($r['RPD'] ?? null), plain($r['RVA'] ?? null),
            power($r['LSphere'] ?? null), power($r['LCylinder'] ?? null), whole($r['LAxis'] ?? null),
            power($r['LAdd'] ?? null), plain($r['LPD'] ?? null), plain($r['LVA'] ?? null),
            $emp(i($r['EmployeeID'] ?? null)),
            s($r['Notes'] ?? null),
        ];
        $rxIds[$id] = true;
    }
    $n = insertBatch($pdo, 'prescriptions', ['id', 'customer_id', 'kind', 'test_date', 'test_for',
        'r_sphere', 'r_cylinder', 'r_axis', 'r_add', 'r_pd', 'r_va',
        'l_sphere', 'l_cylinder', 'l_axis', 'l_add', 'l_pd', 'l_va',
        'performed_by', 'notes'], $rows);
    $note(sprintf('  ใบวัดสายตา %d ใบ', $n));

    // ------------------------------------------------- เคส + ออเดอร์
    /**
     * หนึ่งออเดอร์ = หนึ่งเคส และใช้ id เดียวกัน
     *
     * สถานะมาจาก `OrderClosed` เท่านั้น: ปิดแล้ว = ปิดเคสแล้ว · ยังไม่ปิด = อยู่
     * ขั้นส่งมอบ (นัดหมายรับของ ถ้ามีวันนัด ไม่งั้นรอลูกค้ามารับ) · ไม่เดาว่าเคส
     * ไหนเคยผ่านขั้นวัดสายตาหรือวัดเซ็นเตอร์มาก่อน เพราะฐานเดิมไม่ได้บันทึกไว้
     * และการแต่งประวัติที่ไม่เคยเกิดขึ้นแย่กว่าการไม่มีประวัติ
     */
    $caseRows = [];
    $orderRows = [];
    $payRows = [];
    $invSeen = [];
    foreach ($src['tblCustomOrder'] as $r) {
        $id = i($r['ID'] ?? null);
        $cid = i($r['CustomerID'] ?? null);
        if ($id === null) {
            continue;
        }
        if ($cid === null || !isset($custIds[$cid])) {
            $skip('ออเดอร์ที่ลูกค้าถูกลบไปแล้ว');
            continue;
        }

        $closed = (int) f($r['OrderClosed'] ?? null) !== 0;
        $openedAt = dt($r['OrderDate'] ?? null) ?? '2023-01-01 00:00:00';
        $closeAt = dt($r['OrderCloseDate'] ?? null);
        $appt = d($r['AppointmentDate'] ?? null);
        $empOrder = $emp(i($r['EmployeeID'] ?? null));
        $empClose = $emp(i($r['OrderCloseEmployeeID'] ?? null));

        $caseRows[] = [
            $id,
            sprintf('OLD-%06d', $id),
            $cid,
            $closed ? 'completed' : ($appt !== null ? 'appointment' : 'waiting_pickup'),
            $openedAt,
            $closed ? ($closeAt ?? $openedAt) : null,
            $empOrder,
            'ตัดแว่นใหม่',
            fit($r['Marketing'] ?? null, 20),
            s($r['Notes'] ?? null),
        ];

        /* invoice_code เป็น UNIQUE — ฐานเดิมมีซ้ำอยู่สี่ใบ · เติมท้ายให้ต่างกัน
           แทนที่จะทิ้งใบใดใบหนึ่ง เพราะทั้งคู่เป็นการขายจริง */
        $inv = fit($r['InvoiceCode'] ?? null, 46);
        if ($inv !== null) {
            $k = ukey($inv);
            if (isset($invSeen[$k])) {
                $inv = $inv . '-' . (++$invSeen[$k]);
            } else {
                $invSeen[$k] = 1;
            }
        }

        $rxId = i($r['EyeTestID'] ?? null);

        $orderRows[] = [
            $id, $id, $inv, $cid, $empOrder,
            ($rxId !== null && isset($rxIds[$rxId])) ? $rxId : null,
            $openedAt, $appt,
            fit($r['FrameName'] ?? null, 200), fit($r['LenName'] ?? null, 200),
            $lot(i($r['FrameProductID'] ?? null)),
            $lot(i($r['LenProductID'] ?? null)),
            $lot(i($r['RightLenProductID'] ?? null)),
            f($r['TotalPrice'] ?? null), f($r['Discount'] ?? null), f($r['Deposit'] ?? null),
            fit($r['DepositPayType'] ?? null, 30),
            $closed ? 1 : 0, $closeAt, $empClose,
            $closed ? f($r['OrderCloseIncome'] ?? null) : null,
            fit($r['OrderClosePayType'] ?? null, 30),
            fit($r['Marketing'] ?? null, 50),
            s($r['Notes'] ?? null),
        ];

        /* เงินสองก้อนที่ Access เก็บไว้บนใบออเดอร์ กลายเป็นสองรายการใน ledger
           วันที่ใช้ของจริง: มัดจำลงวันที่เปิดออเดอร์ ปิดยอดลงวันที่ปิด */
        $dep = f($r['Deposit'] ?? null);
        if ($dep > 0) {
            $payRows[] = [$id, $id, 'deposit', fit($r['DepositPayType'] ?? null, 30) ?? 'Cash',
                $dep, $openedAt, $empOrder, 'นำเข้าจากระบบเดิม', null];
        }
        $fin = f($r['OrderCloseIncome'] ?? null);
        if ($closed && $fin > 0) {
            $payRows[] = [$id, $id, 'final', fit($r['OrderClosePayType'] ?? null, 30) ?? 'Cash',
                $fin, $closeAt ?? $openedAt, $empClose, 'นำเข้าจากระบบเดิม', null];
        }
    }

    $n = insertBatch($pdo, 'cases', ['id', 'case_code', 'customer_id', 'status', 'opened_at',
        'closed_at', 'received_by', 'case_type', 'referral_source', 'notes'], $caseRows);
    $note(sprintf('  เคส %d เคส', $n));

    $n = insertBatch($pdo, 'custom_orders', ['id', 'case_id', 'invoice_code', 'customer_id',
        'employee_id', 'final_prescription_id', 'order_date', 'appointment_date',
        'frame_name', 'lens_name', 'frame_product_id', 'lens_product_id', 'right_lens_product_id',
        'total_price', 'discount', 'deposit', 'deposit_pay_type',
        'order_closed', 'order_close_date', 'order_close_employee_id', 'order_close_income',
        'order_close_pay_type', 'marketing', 'notes'], $orderRows);
    $note(sprintf('  ออเดอร์ %d ใบ', $n));

    // ------------------------------------------------------------- ขาย
    $saleRows = [];
    foreach ($src['tblSale'] as $r) {
        $id = i($r['ID'] ?? null);
        if ($id === null) {
            continue;
        }
        $lotId = i($r['ProductStockID'] ?? null);
        $price = f($r['Price'] ?? null);
        $disc = f($r['Discount'] ?? null);
        $when = dt($r['SaleDate'] ?? null) ?? '2023-01-01 00:00:00';
        $e = $emp(i($r['EmployeeID'] ?? null));
        $saleRows[] = [$id, fit($r['InvoiceCode'] ?? null, 50), $when,
            ($lotId !== null && isset($lotIds[$lotId])) ? $lotId : null,
            $e, $price, $disc, fit($r['PayType'] ?? null, 30),
            fit($r['Marketing'] ?? null, 50), s($r['Notes'] ?? null)];

        /* การขายสินค้าหนึ่งครั้งจ่ายครบในครั้งเดียวเสมอในระบบเดิม — ไม่มีที่เก็บ
           การผ่อน จึงเป็นรายการ 'full' หนึ่งแถวต่อหนึ่งการขาย */
        $amt = round($price - $disc, 2);
        if ($amt > 0) {
            $payRows[] = [null, null, 'full', fit($r['PayType'] ?? null, 30) ?? 'Cash',
                $amt, $when, $e, 'นำเข้าจากระบบเดิม', $id];
        }
    }
    $n = insertBatch($pdo, 'sales', ['id', 'invoice_code', 'sale_date', 'product_stock_id',
        'employee_id', 'price', 'discount', 'pay_type', 'marketing', 'notes'], $saleRows);
    $note(sprintf('  การขายสินค้า %d รายการ', $n));

    // -------------------------------------------------------- การรับเงิน
    $n = insertBatch($pdo, 'payments', ['case_id', 'order_id', 'kind', 'method', 'amount',
        'paid_at', 'received_by', 'notes', 'sale_id'], $payRows);
    $note(sprintf('  รายการรับเงิน %d แถว (สร้างจากยอดมัดจำ/ปิดยอด/การขาย)', $n));

    // ------------------------------------------------- รายรับ / รายจ่าย
    $rows = [];
    foreach ($src['tblExpense'] as $r) {
        $rows[] = [i($r['ID'] ?? null), d($r['CFDate'] ?? null) ?? '2023-01-01',
            fit($r['ExpenseType'] ?? null, 80), fit($r['Branch'] ?? null, 80),
            f($r['Amount'] ?? null), fit($r['PayType'] ?? null, 30), s($r['Notes'] ?? null)];
    }
    $n = insertBatch($pdo, 'expenses', ['id', 'cf_date', 'expense_type', 'branch', 'amount',
        'pay_type', 'notes'], $rows);
    $note(sprintf('  รายจ่าย %d รายการ', $n));

    $rows = [];
    foreach ($src['tblIncome'] as $r) {
        $rows[] = [i($r['ID'] ?? null), d($r['CFDate'] ?? null) ?? '2023-01-01',
            fit($r['IncomeType'] ?? null, 80), fit($r['Branch'] ?? null, 80),
            f($r['Amount'] ?? null), s($r['Notes'] ?? null)];
    }
    $n = insertBatch($pdo, 'incomes', ['id', 'cf_date', 'income_type', 'branch', 'amount', 'notes'], $rows);
    $note(sprintf('  รายรับ %d รายการ', $n));

    // ---------------------------------------------------- ตำแหน่งสินค้า
    /* product_name เป็น UNIQUE ในสคีมานี้ (สินค้าหนึ่งชื่ออยู่ที่เดียว) แต่ฐานเดิม
       ไม่ได้บังคับ · ชื่อที่ซ้ำเก็บแถวแรกไว้ แล้วนับจำนวนที่ข้ามให้เห็น */
    $rows = [];
    $locSeen = [];
    foreach ($src['tblLocationProd'] as $r) {
        $name = fit($r['ProductName'] ?? null, 200);
        $loc = fit($r['Location'] ?? null, 100);
        if ($name === null || $loc === null) {
            $skip('ตำแหน่งสินค้าที่ข้อมูลไม่ครบ');
            continue;
        }
        if (isset($locSeen[ukey($name)])) {
            $skip('ตำแหน่งสินค้าที่ชื่อซ้ำกับแถวก่อนหน้า');
            continue;
        }
        $locSeen[ukey($name)] = true;
        $rows[] = [i($r['ID'] ?? null), $name, $loc];
    }
    $n = insertBatch($pdo, 'product_locations', ['id', 'product_name', 'location'], $rows);
    $note(sprintf('  ตำแหน่งสินค้า %d แถว', $n));

    // ------------------------------------------ ผูกบัญชีผู้ใช้กับพนักงาน
    /* บัญชีที่ชื่อตรงกับพนักงานในฐานใหม่ ผูกให้อัตโนมัติ · ที่เหลือปล่อยว่าง
       ให้เจ้าของร้านผูกเองที่หน้าจัดการผู้ใช้ — เดาผิดแล้วยอดขายไปโผล่ชื่อคนอื่น */
    $linked = $pdo->exec(
        'UPDATE admins a JOIN employees e ON e.employee_name = a.display_name
            SET a.employee_id = e.id WHERE a.employee_id IS NULL'
    );
    $note(sprintf('  ผูกบัญชีผู้ใช้กับพนักงานอัตโนมัติ %d บัญชี', (int) $linked));

    if ($dryRun) {
        if (!$pdo->inTransaction()) {
            throw new RuntimeException(
                'transaction ขาดกลางคัน — มีคำสั่ง DDL แทรกอยู่ ย้อนกลับไม่ได้แล้ว'
            );
        }
        $pdo->rollBack();
        $note("\n*** DRY RUN — ย้อนกลับทั้งหมดแล้ว ฐานข้อมูลไม่ถูกแก้ ***");
    } else {
        $pdo->commit();
        $note("\nบันทึกลงฐานข้อมูลเรียบร้อย");
    }
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
    fwrite(STDERR, "\nล้มเหลว ย้อนกลับทั้งหมดแล้ว: " . $e->getMessage() . "\n");
    fwrite(STDERR, $e->getTraceAsString() . "\n");
    exit(1);
}

$pdo->exec('SET FOREIGN_KEY_CHECKS = 1');

if ($skipped) {
    $note("\nแถวที่ข้ามไป:");
    foreach ($skipped as $why => $cnt) {
        $note(sprintf('  %-45s %d แถว', $why, $cnt));
    }
}
$note(sprintf("\nใช้เวลา %.1f วินาที", microtime(true) - $t0));
