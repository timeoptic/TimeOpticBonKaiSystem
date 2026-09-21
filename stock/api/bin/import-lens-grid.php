<?php

declare(strict_types=1);

/**
 * นำยอดเลนส์จากตาราง SPH × CYL (ชีต add_more_lens) เข้าคลังเป็นบิลเดียว — ร้านขอ 18 ก.ย. 2026
 *
 *   php bin/import-lens-grid.php <csv> --brand=G --coating=Auto-Blue --index=1.50 [--design="Single Vision"]
 *        [--mult=2] [--doc=เลขบิล] [--date=YYYY-MM-DD] [--apply] [--actor=ID]
 *
 * ชีตมีหลายตาราง แต่ละตารางขึ้นด้วยแถว "pairs,,Cyl,..." ตามด้วยแถวค่า CYL แล้วแถว "SPH,<ค่า>,<จำนวน>..." ·
 * ตัวเลขในชีตนับเป็นคู่ `--mult=2` แปลงเป็นชิ้น · ช่องว่าง/0 ข้าม
 *
 * จับคู่สินค้าที่มีอยู่แล้วด้วยสเปก (ยี่ห้อ coating index ชนิดเลนส์ SPH CYL แบบตัวเลข ไม่ใช่สินค้าสั่งตัด) ·
 * ช่องไหนไม่เจอหรือเจอเกินหนึ่งตัว สคริปต์หยุด ไม่นำเข้าอะไรเลย · ต้นทุนเติมจากล็อตก่อนของสินค้านั้น
 * (แบบเดียวกับหน้าบิลรับเข้า) ไม่มีก็รอต้นทุน · ทั้งไฟล์เข้าด้วย Receiving::receiveMany ทรานแซกชันเดียว
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Roles;
use Optic\Service\Receiving;

$opt = ['mult' => '1', 'design' => 'Single Vision', 'date' => date('Y-m-d')];
$file = null;
$apply = false;
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--apply') {
        $apply = true;
    } elseif (preg_match('/^--([a-z]+)=(.*)$/', $a, $m)) {
        $opt[$m[1]] = $m[2];
    } else {
        $file = $a;
    }
}
foreach (['brand', 'coating', 'index'] as $k) {
    if (empty($opt[$k])) {
        fwrite(STDERR, "ต้องระบุ --{$k}\n");
        exit(1);
    }
}
if ($file === null || !is_file($file)) {
    fwrite(STDERR, "ไม่พบไฟล์ CSV\n");
    exit(1);
}
$mult = max(1, (int) $opt['mult']);

$attr = static fn(string $k): string => "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.{$k}')), 'null')";
$num = static fn(string $k): string => 'CAST(' . $attr($k) . ' AS DECIMAL(6,2))';

$cells = [];
$cyls = null;
$fh = fopen($file, 'r');
while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) {
    $r = array_map('trim', $r);
    if (($r[0] ?? '') === 'pairs') {
        $cyls = null;
        continue;
    }
    if (($r[0] ?? '') === '' && ($r[1] ?? '') === '' && isset($r[2]) && is_numeric($r[2])) {
        $cyls = array_slice($r, 2);
        continue;
    }
    if (($r[0] ?? '') !== 'SPH' || $cyls === null || !is_numeric($r[1] ?? '')) {
        continue;
    }
    $sph = round((float) $r[1], 2);
    foreach ($cyls as $i => $c) {
        $q = $r[$i + 2] ?? '';
        if ($c === '' || !is_numeric($c) || $q === '' || !ctype_digit($q) || (int) $q === 0) {
            continue;
        }
        $cells[] = ['sph' => $sph, 'cyl' => round((float) $c, 2), 'pairs' => (int) $q];
    }
}
fclose($fh);

$lines = [];
$problems = [];
$noCost = 0;
foreach ($cells as $c) {
    $found = Db::all(
        "SELECT id, sku, name FROM products
          WHERE product_type = 'Lens' AND is_custom_made = 0 AND brand = ?
            AND " . $attr('coating') . ' = ? AND ' . $attr('lens_design') . ' = ?
            AND ' . $num('lens_index') . ' = ? AND ' . $num('sph') . ' = ? AND ' . $num('cyl') . ' = ?',
        [$opt['brand'], $opt['coating'], $opt['design'], $opt['index'], $c['sph'], $c['cyl']],
    );
    $label = sprintf('%+.2f/%.2f', $c['sph'], $c['cyl']);
    if (count($found) !== 1) {
        $problems[] = "{$label}: เจอ " . count($found) . ' ตัว ' . implode(' | ', array_map(fn($f) => $f['sku'] . ' ' . $f['name'], $found));
        continue;
    }
    $p = $found[0];
    $cost = Db::value(
        'SELECT cost_per_unit FROM stock_lots WHERE product_id = ? AND cost_per_unit IS NOT NULL ORDER BY id DESC LIMIT 1',
        [$p['id']],
    );
    if ($cost === null) {
        $noCost++;
    }
    $lines[] = ['sku' => $p['sku'], 'quantity' => $c['pairs'] * $mult, 'cost_per_unit' => $cost, '_name' => $p['name']];
}

$pieces = array_sum(array_column($lines, 'quantity'));
echo "{$opt['brand']} {$opt['coating']} ({$opt['index']}) · ช่องที่มีจำนวน " . count($cells) . ' · จับคู่ได้ ' . count($lines)
    . " · รวม {$pieces} ชิ้น (x{$mult}) · ไม่มีต้นทุนเดิม {$noCost}\n";
foreach ($problems as $p) {
    echo "  ! {$p}\n";
}
if ($problems !== []) {
    echo "มีช่องที่จับคู่ไม่ได้ — ไม่นำเข้าอะไรเลย\n";
    exit(2);
}
if (!$apply) {
    foreach (array_slice($lines, 0, 5) as $l) {
        echo "  {$l['_name']} × {$l['quantity']}" . ($l['cost_per_unit'] !== null ? " @{$l['cost_per_unit']}" : ' (รอต้นทุน)') . "\n";
    }
    echo "ดูอย่างเดียว — เติม --apply เพื่อนำเข้า\n";
    exit(0);
}

$actorId = isset($opt['actor']) ? (int) $opt['actor'] : (int) Db::value(
    "SELECT a.id FROM admins a JOIN admin_roles r ON r.admin_id = a.id
      WHERE r.role IN ('superuser', 'owner') ORDER BY a.id LIMIT 1"
);
$lots = Receiving::receiveMany([
    'received_date' => $opt['date'],
    'reference_doc' => $opt['doc'] ?? null,
    'note'          => 'นำเข้าจากชีต ' . basename($file) . " (ในชีตนับเป็นคู่ x{$mult})",
    'lines'         => array_map(static fn($l) => array_diff_key($l, ['_name' => 1]), $lines),
], [Roles::SUPERUSER], $actorId);
echo 'นำเข้าแล้ว ' . count($lots) . " ล็อต · {$pieces} ชิ้น\n";
