<?php

declare(strict_types=1);

/**
 * นำยอดนับคอนแทคเลนส์จากชีต Time2026_Stockcontactlens เข้าคลัง — ร้านขอ 18 ก.ย. 2026
 *
 *   php bin/import-contactlens.php <โฟลเดอร์ CSV>                 ดูอย่างเดียว (ค่าตั้งต้น)
 *   php bin/import-contactlens.php <โฟลเดอร์ CSV> --offline       ดูอย่างเดียว ไม่แตะฐานข้อมูล
 *   php bin/import-contactlens.php <โฟลเดอร์ CSV> --apply [--actor=ID]
 *
 * อ่านไฟล์ "... - รายวัน & ราย 2 สัปดาห์.csv", "... - รายเดือน - ใส.csv", "... - รายเดือน - สี.csv"
 * (ชีต "สรุปภาพรวม & น้ำยา" ไม่อ่าน — ร้านเลือกเอาเฉพาะคอนแทคเลนส์)
 *
 * กติกาที่ร้านเลือก:
 *   · แถวที่ติ๊กขายออกแล้ว (มีของ = FALSE หรือ ขายออกแล้ว = TRUE) ไม่นำเข้า
 *   · ล็อตที่หมดอายุแล้วนำเข้าพร้อมวันหมดอายุจริง — ขึ้นเตือนแล้วค่อยตัดเป็นของเสีย
 *
 * หนึ่งสินค้า = รุ่น + สี + ค่าสายตา (แบบเลนส์สต็อก) · หนึ่งล็อต = วันหมดอายุหนึ่งวัน · วันรับเข้า
 * คือวันนับ 4 ก.ย. 2569 · ไม่มีต้นทุนและราคา (ล็อตขึ้น "รอต้นทุน" ให้บัญชีลง)
 *
 * รันซ้ำได้: สินค้าหาจากชื่อก่อนสร้าง และเลขล็อตคำนวณจากสินค้า + วันหมดอายุ ล็อตที่มีแล้วข้าม
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Roles;
use Optic\Service\Catalog;
use Optic\Service\Receiving;

const COUNTED_ON = '2026-09-04';
const NOTE = 'ยอดนับ 4 ก.ย. 2569 — นำเข้าจากชีต Time2026_Stockcontactlens';
const BRANDS = ['B&L', 'Acuvue', 'Alcon', 'Maxim'];

$dir = $argv[1] ?? null;
$apply = in_array('--apply', $argv, true);
$offline = in_array('--offline', $argv, true);
$actorArg = null;
foreach ($argv as $a) {
    if (str_starts_with($a, '--actor=')) {
        $actorArg = (int) substr($a, 8);
    }
}
if ($dir === null || !is_dir($dir)) {
    fwrite(STDERR, "ใช้: php bin/import-contactlens.php <โฟลเดอร์ CSV> [--apply] [--offline] [--actor=ID]\n");
    exit(1);
}
if ($apply && $offline) {
    fwrite(STDERR, "--apply กับ --offline ใช้พร้อมกันไม่ได้\n");
    exit(1);
}

/* ---------------------------------------------------------------- parse */

$warnings = [];
$skipped = [];
$rows = [];

$files = [
    'รายวัน & ราย 2 สัปดาห์' => null, // ไฟล์นี้มีสองตอน อ่านจากหัวตอน
    'รายเดือน - ใส'          => 'Monthly',
    'รายเดือน - สี'          => 'Monthly',
];

foreach ($files as $needle => $wear) {
    $path = null;
    foreach (glob(rtrim($dir, '/\\') . '/*.csv') ?: [] as $f) {
        if (str_contains(basename($f), $needle)) {
            $path = $f;
        }
    }
    if ($path === null) {
        fwrite(STDERR, "ไม่พบไฟล์ของชีต \"{$needle}\" ใน {$dir}\n");
        exit(1);
    }

    $fh = fopen($path, 'r');
    $head = null;
    $line = 0;
    while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
        $line++;
        $r = array_map(static fn($v) => trim(preg_replace('/^\xEF\xBB\xBF/', '', (string) $v)), $r);
        $first = $r[0] ?? '';
        if (str_contains($first, 'ราย 2 สัปดาห์')) {
            $wear = 'Bi-weekly';
        } elseif (str_contains($first, 'รายวัน')) {
            $wear = 'Daily';
        }
        if ($first === 'ลำดับ') {
            $head = array_flip($r);
            continue;
        }
        if ($head === null || ($r[1] ?? '') === '' || str_starts_with($first, 'รวม')) {
            continue;
        }
        $col = static function (string $prefix) use ($head, $r): string {
            foreach ($head as $name => $i) {
                if (str_starts_with((string) $name, $prefix)) {
                    return $r[$i] ?? '';
                }
            }
            return '';
        };
        $where = basename($path) . " บรรทัด {$line}";

        $has = strtoupper($col('มีของ'));
        $sold = strtoupper($col('ขายออกแล้ว'));
        if ($has === 'FALSE' || $sold === 'TRUE') {
            $skipped[] = "{$where}: ติ๊กขายออกแล้ว — " . $col('รุ่นสินค้า') . ' ' . $col('ค่าสายตา');
            continue;
        }

        $rows[] = [
            'where'  => $where,
            'wear'   => $wear,
            'brand'  => $col('แบรนด์'),
            'model'  => $col('รุ่นสินค้า'),
            'color'  => $col('เฉดสี'),
            'kind'   => $col('ประเภท'),
            'power'  => $col('ค่าสายตา'),
            'expiry' => $col('วันหมดอายุ'),
            'qty'    => $col('จำนวน') !== '' ? $col('จำนวน') : $col('นับจริง'),
        ];
    }
    fclose($fh);
}

/** "-+2.00/-1.25*110" · "-0.50/-0.75*110" · "-+1.00 Add Mid" · "Plano" */
$power = static function (string $raw, string $where) use (&$warnings): ?array {
    $s = trim(str_replace(['−', '×'], ['-', '*'], $raw));
    $add = null;
    if (preg_match('/\s*Add\s+(\w+)\s*$/i', $s, $m)) {
        $add = ucfirst(strtolower($m[1]));
        $s = trim(substr($s, 0, -strlen($m[0])));
    }
    if (strcasecmp($s, 'Plano') === 0) {
        $s = '0';
    }
    $s = preg_replace('/^-\+/', '+', $s); // "-+1.25" ในชีต = บวก
    if (!preg_match('/^([+-]?\d+(?:\.\d+)?)(?:\/([+-]?\d+(?:\.\d+)?)\*(\d{1,3}))?$/', $s, $m)) {
        $warnings[] = "{$where}: อ่านค่าสายตา \"{$raw}\" ไม่ออก — ข้ามแถว";
        return null;
    }
    return [
        'sph'  => round((float) $m[1], 2),
        'cyl'  => isset($m[2]) && $m[2] !== '' ? round((float) $m[2], 2) : null,
        'axis' => isset($m[3]) && $m[3] !== '' ? (int) $m[3] : null,
        'add'  => $add,
    ];
};

/**
 * วันหมดอายุหลายรูปแบบในชีตเดียวกัน:
 *   29-04-01 (ปป-ดด-วว) · 01-08-28 (วว-ดด-ปป ของ Acuvue Moist) · 29-07 (ปป-ดด)
 *   10/2026 · 02-2031 (ดด/ปปปป) · ไม่มีวันที่ = วันที่ 1 ของเดือน (ถือแบบระวังไว้ก่อน)
 */
$expiry = static function (string $raw, string $where) use (&$warnings): ?string {
    $s = trim($raw);
    if ($s === '') {
        return null;
    }
    $ymd = null;
    if (preg_match('#^(\d{1,2})[/-](\d{4})$#', $s, $m)) {
        $ymd = [(int) $m[2], (int) $m[1], 1];
    } elseif (preg_match('/^(\d{2})-(\d{2})-(\d{2})$/', $s, $m)) {
        [$a, $b, $c] = [(int) $m[1], (int) $m[2], (int) $m[3]];
        $ymd = $a < 20 && $c >= 20 ? [2000 + $c, $b, $a] : [2000 + $a, $b, $c];
    } elseif (preg_match('/^(\d{2})-(\d{2})$/', $s, $m)) {
        $ymd = [2000 + (int) $m[1], (int) $m[2], 1];
    }
    if ($ymd === null || !checkdate($ymd[1], $ymd[2], $ymd[0])) {
        $warnings[] = "{$where}: อ่านวันหมดอายุ \"{$raw}\" ไม่ออก — นำเข้าโดยไม่มีวันหมดอายุ";
        return null;
    }
    return sprintf('%04d-%02d-%02d', ...$ymd);
};

/* ---------------------------------------------------------------- plan */

$products = [];
foreach ($rows as $r) {
    $model = preg_replace('/\s+/', ' ', $r['model']);
    $model = preg_replace('/\bAsitg\b/i', 'Astig', $model);
    $brand = $r['brand'];
    // ชื่อรุ่นขึ้นต้นด้วยแบรนด์อื่น (ชีตเขียน "Maxim" หน้า "B&L Monthly 6P") — เชื่อชื่อรุ่น
    foreach (BRANDS as $b) {
        if (stripos($model, $b) === 0 && strcasecmp($b, $brand) !== 0) {
            $warnings[] = "{$r['where']}: แบรนด์ \"{$brand}\" ไม่ตรงกับรุ่น \"{$model}\" — ใช้ {$b}";
            $brand = $b;
        }
    }

    $p = $power($r['power'], $r['where']);
    if ($p === null) {
        $skipped[] = "{$r['where']}: ค่าสายตาอ่านไม่ออก";
        continue;
    }
    $qty = (int) $r['qty'];
    if ($qty <= 0) {
        $skipped[] = "{$r['where']}: จำนวน \"{$r['qty']}\" ไม่ใช่ตัวเลขบวก";
        continue;
    }

    $type = $r['kind'] === 'สี' ? 'สี' : ($p['cyl'] !== null ? 'Toric' : ($p['add'] !== null ? 'Multifocal' : 'ใส'));
    $attrs = array_filter([
        'model'     => $model,
        'wear'      => $r['wear'],
        'cl_type'   => $type,
        'color'     => $r['color'] !== '' ? $r['color'] : null,
        'pack'      => preg_match('/\b(\d+)P\b/', $model, $m) ? (int) $m[1] : null,
        'sph'       => $p['sph'],
        'cyl'       => $p['cyl'],
        'axis'      => $p['axis'],
        'add_level' => $p['add'],
    ], static fn($v) => $v !== null);

    $name = Catalog::composeName('ContactLen', $brand, $attrs);
    $exp = $expiry($r['expiry'], $r['where']);

    $products[$name] ??= ['brand' => $brand, 'attrs' => $attrs, 'lots' => []];
    $key = $exp ?? 'none';
    $products[$name]['lots'][$key] = ($products[$name]['lots'][$key] ?? 0) + $qty;
}
ksort($products, SORT_NATURAL);

$lotCount = 0;
$boxes = 0;
$expired = [];
foreach ($products as $name => $p) {
    foreach ($p['lots'] as $exp => $q) {
        $lotCount++;
        $boxes += $q;
        if ($exp !== 'none' && $exp < COUNTED_ON) {
            $expired[] = "{$name} หมดอายุ {$exp} × {$q}";
        }
    }
}

echo "สินค้า " . count($products) . " รายการ · ล็อต {$lotCount} · รวม {$boxes} กล่อง\n";
echo "ข้าม " . count($skipped) . " แถว\n";
foreach ($skipped as $s) {
    echo "  - {$s}\n";
}
echo "คำเตือน " . count($warnings) . "\n";
foreach ($warnings as $w) {
    echo "  - {$w}\n";
}
echo "ล็อตที่หมดอายุแล้ว (นำเข้าพร้อมวันจริง) " . count($expired) . "\n";
foreach ($expired as $e) {
    echo "  - {$e}\n";
}

if ($offline) {
    echo "\nรายการสินค้า:\n";
    foreach ($products as $name => $p) {
        $lots = [];
        foreach ($p['lots'] as $exp => $q) {
            $lots[] = "{$exp}×{$q}";
        }
        echo "  {$name}  [" . implode(', ', $lots) . "]\n";
    }
    exit(0);
}

/* ---------------------------------------------------------------- apply */

$categoryId = Db::value("SELECT id FROM categories WHERE code = 'ContactLen'");
if ($categoryId === null) {
    fwrite(STDERR, "ไม่พบหมวดหมู่ ContactLen\n");
    exit(1);
}
$actorId = $actorArg ?? (int) Db::value(
    "SELECT a.id FROM admins a JOIN admin_roles r ON r.admin_id = a.id
      WHERE r.role IN ('superuser', 'owner') ORDER BY a.id LIMIT 1"
);
$roles = [Roles::SUPERUSER];

$made = $reused = $lotsIn = $lotsHad = 0;
foreach ($products as $name => $p) {
    $sku = Db::value(
        "SELECT sku FROM products WHERE product_type = 'ContactLen' AND is_custom_made = 0 AND name = ? ORDER BY id LIMIT 1",
        [$name],
    );
    if ($sku === null) {
        if (!$apply) {
            $made++;
            $lotsIn += count($p['lots']);
            continue;
        }
        $sku = Catalog::createProduct([
            'name'               => $name,
            'brand'              => $p['brand'],
            'product_type'       => 'ContactLen',
            'category_id'        => (int) $categoryId,
            'base_selling_price' => '0',
            'min_stock'          => '0',
            'is_custom_made'     => false,
            'attributes'         => $p['attrs'],
        ], $roles)['sku'];
        $made++;
    } else {
        $reused++;
    }

    foreach ($p['lots'] as $exp => $q) {
        $lot = 'CL0904-' . substr(md5($name . '|' . $exp), 0, 8);
        if (Db::value('SELECT id FROM stock_lots WHERE lot_number = ?', [$lot]) !== null) {
            $lotsHad++;
            continue;
        }
        if ($apply) {
            Receiving::receive([
                'sku'           => (string) $sku,
                'quantity'      => $q,
                'received_date' => COUNTED_ON,
                'expiry_date'   => $exp === 'none' ? null : $exp,
                'lot_number'    => $lot,
                'note'          => NOTE,
            ], $roles, $actorId, allowExpired: true);
        }
        $lotsIn++;
    }
}

echo "\n" . ($apply ? 'นำเข้าแล้ว' : 'ถ้ารัน --apply จะ') . ": สร้างสินค้าใหม่ {$made} · ใช้สินค้าเดิม {$reused} · "
    . "ล็อตใหม่ {$lotsIn} · ล็อตที่มีอยู่แล้ว (ข้าม) {$lotsHad}\n";
