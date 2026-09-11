<?php

declare(strict_types=1);

/**
 *   php api/cli/sweep-get-routes.php [--base=http://localhost:8095]
 *
 * ยิงทุกเส้น GET ของทั้งสองฝั่งผ่าน HTTP จริง ด้วย session จริง แล้วรายงานว่า
 * เส้นไหนไม่ตอบ 200
 *
 * ทำไมต้องยิงจริงแทนที่จะเรียกฟังก์ชันตรง ๆ: เส้นทางของสองฝั่งอยู่คนละตาราง
 * และมารวมกันที่ `api/index.php` ตัวเดียว — ลำดับของการเติม `/api`, ประตูตรวจ
 * session, การตัดต้นทุนออกจากคำตอบ ล้วนอยู่ในเส้นทางนั้น ไม่ใช่ในตัว handler
 * เรียก handler ตรง ๆ จึงพิสูจน์ไม่ได้ว่าเปิดหน้าเว็บแล้วจะได้อะไร
 *
 * รายชื่อเส้นทางอ่านจากไฟล์ route จริง ไม่ใช่ลิสต์ที่พิมพ์ไว้ — ลิสต์ที่พิมพ์ไว้
 * จะถูกต้องวันที่เขียน แล้วเงียบ ๆ ตกหล่นทุกเส้นที่เพิ่มหลังจากนั้น
 *
 * เขียนอย่างเดียว: ไม่มี POST ในสคริปต์นี้เลย เส้นที่เขียนข้อมูลถูกทดสอบด้วย
 * `stock/api/tests/run.php` (239 เทสต์) และ `api/cli/check-stock-bridge.php`
 * (18 เช็ก) ซึ่งทั้งคู่ครอบด้วยทรานแซกชันแล้ว roll back
 */

$root = dirname(__DIR__, 2);
$config = require "$root/api/config.php";
require "$root/api/core/Db.php";

$base = 'http://localhost:8095';
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--base=')) {
        $base = substr($arg, 7);
    }
}

Db::configure($config["db"]);

/** ค่าจริงจากฐานข้อมูล สำหรับเติมลงพารามิเตอร์ของเส้นทาง */
function firstId(string $sql): ?string
{
    try {
        $v = Db::get($sql);
        return $v === null ? null : (string) reset($v);
    } catch (Throwable) {
        return null;
    }
}

$ids = [
    'case'       => firstId('SELECT id FROM cases ORDER BY id DESC LIMIT 1'),
    'customer'   => firstId('SELECT id FROM customers ORDER BY id DESC LIMIT 1'),
    'order'      => firstId('SELECT id FROM orders ORDER BY id DESC LIMIT 1'),
    'booking'    => firstId('SELECT id FROM bookings ORDER BY id DESC LIMIT 1'),
    'prescript'  => firstId('SELECT id FROM prescriptions ORDER BY id DESC LIMIT 1'),
    'stock'      => firstId('SELECT id FROM stock_lots ORDER BY id DESC LIMIT 1'),
    /* ตารางชื่อ case_photos ไม่ใช่ uploads — เดิมถามหาตารางที่ไม่มีอยู่จริง
       `firstId()` กลืน exception แล้วคืน null เส้น /api/uploads/:id จึงขึ้นว่า
       "ข้าม เพราะไม่มีข้อมูลจริงให้ใส่" ทุกรอบ ทั้งที่ในฐานมีรูปอยู่ */
    'upload'     => firstId('SELECT id FROM case_photos ORDER BY id DESC LIMIT 1'),
    'product'    => firstId('SELECT id FROM products ORDER BY id DESC LIMIT 1'),
    'sku'        => firstId('SELECT sku FROM products WHERE sku IS NOT NULL ORDER BY id DESC LIMIT 1'),
];

/** เส้นทางไหนต้องเติมอะไร — เดาจากชื่อเส้นทาง ไม่ใช่จากชื่อพารามิเตอร์อย่างเดียว */
function fill(string $path, array $ids): ?string
{
    $map = [
        '/api/cases'         => 'case',
        '/api/case-'         => 'case',
        '/api/centerings'    => 'case',
        '/api/frame-fittings' => 'case',
        '/api/customers'     => 'customer',
        '/api/orders'        => 'order',
        '/api/bookings'      => 'booking',
        '/api/prescriptions' => 'prescript',
        '/api/stock'         => 'stock',
        '/api/uploads'       => 'upload',
        '/api/reports/order' => 'order',
        '/api/reports/prescription' => 'prescript',
        '/stock-api/products' => 'product',
    ];

    $out = $path;
    foreach (['/:id', '/:case_id', '/{id}'] as $token) {
        if (!str_contains($out, $token)) {
            continue;
        }
        $key = null;
        foreach ($map as $prefix => $which) {
            if (str_starts_with($path, $prefix)) {
                $key = $which;
                break;
            }
        }
        $value = $key === null ? null : ($ids[$key] ?? null);
        if ($value === null) {
            return null; // ไม่มีข้อมูลจริงให้ยิง — รายงานว่าข้าม ดีกว่ายิงมั่ว
        }
        $out = str_replace($token, '/' . rawurlencode($value), $out);
    }
    if (str_contains($out, '{sku}')) {
        if ($ids['sku'] === null) {
            return null;
        }
        $out = str_replace('{sku}', rawurlencode($ids['sku']), $out);
    }
    return str_contains($out, ':') || str_contains($out, '{') ? null : $out;
}

/** @return list<string> */
function routesFrom(string $glob, string $pattern, string $prefix = ''): array
{
    $found = [];
    foreach (glob($glob) ?: [] as $file) {
        preg_match_all($pattern, (string) file_get_contents($file), $m);
        foreach ($m[1] as $path) {
            $found[] = $prefix . $path;
        }
    }
    sort($found);
    return array_values(array_unique($found));
}

$storefront = routesFrom("$root/api/routes/*.php", "/^GET\('([^']+)'/m");
$stock = array_map(
    static fn(string $p): string => '/stock-api' . substr($p, 4),
    routesFrom("$root/stock/api/public/index.php", "/Http::get\('([^']+)'/"),
);

/* /stock-api/auth/me ซ้ำกับของหน้าร้านโดยตั้งใจ ทั้งคู่ต้องตอบได้ */
$all = array_merge($storefront, $stock);

/**
 * เส้นที่ต้องมี query ถึงจะตอบได้ — ไม่ใช่บั๊ก แต่เป็นเส้นที่ไม่มีค่าปริยาย
 *
 * ยิงเปล่า ๆ แล้วได้ 400 คือคำตอบที่ถูกต้องของมัน แต่ไม่ได้พิสูจน์ว่ามันทำงาน
 * จึงต้องเติม query ที่หน้าเว็บใช้จริงเข้าไป ไม่งั้นเท่ากับไม่ได้ทดสอบ
 */
$query = [
    '/api/uploads'                  => 'case_id=%case%',
    '/stock-api/products/hints'     => 'type=Lens',
    '/stock-api/products/next-sku'  => 'type=Frame',
];

echo "\nยิงทุกเส้น GET ที่ $base\n";
echo str_repeat('─', 72) . "\n";

$session = getenv('SWEEP_COOKIE') ?: '';
if ($session === '') {
    fwrite(STDERR, "ต้องมี session ก่อน: ตั้ง SWEEP_COOKIE=optic_session=<ค่า>\n");
    exit(1);
}

$fail = [];
$skip = [];
$ok = 0;

foreach ($all as $path) {
    $url = fill($path, $ids);
    if ($url === null) {
        $skip[] = $path;
        continue;
    }
    if (isset($query[$path])) {
        $q = str_replace('%case%', (string) ($ids['case'] ?? ''), $query[$path]);
        $url .= '?' . $q;
    }

    $ch = curl_init($base . $url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['Cookie: ' . $session, 'Origin: http://localhost:3010'],
    ]);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code === 200) {
        $ok++;
        printf("  ✓ %-46s %d  %s\n", $url, $code, mb_substr(trim($body), 0, 18));
        continue;
    }
    $fail[] = [$url, $code, mb_substr(trim($body), 0, 120)];
    printf("  ✗ %-46s %d  %s\n", $url, $code, mb_substr(trim($body), 0, 60));
}

echo str_repeat('─', 72) . "\n";
printf("ผ่าน %d / %d เส้น", $ok, $ok + count($fail));
if ($skip !== []) {
    printf(" · ข้าม %d เส้น (ไม่มีข้อมูลจริงให้ใส่ในพารามิเตอร์)", count($skip));
}
echo "\n";

foreach ($skip as $s) {
    echo "  – ข้าม $s\n";
}
if ($fail !== []) {
    echo "\nที่ไม่ผ่าน:\n";
    foreach ($fail as [$u, $c, $b]) {
        echo "  • $u → $c\n    $b\n";
    }
    exit(1);
}
