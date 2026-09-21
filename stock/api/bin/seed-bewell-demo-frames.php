<?php

declare(strict_types=1);

/**
 * กรอบแว่นตัวอย่างของ Bewell — ไว้ทดสอบขายจากคลังจนกว่าจะนำเข้าฐานกรอบจริง
 *
 *   php bin/seed-bewell-demo-frames.php            ดูว่าจะเพิ่มอะไร (ไม่เขียน)
 *   php bin/seed-bewell-demo-frames.php --apply    เพิ่มจริง
 *
 * สร้างสินค้าด้วย Catalog::createProduct แล้วรับเข้าด้วย Receiving::receive — ทางเดียวกับ
 * หน้าคลัง สมุดสต็อกจึงตรงยอดเหมือนรับของจริง · SKU / ล็อตขึ้นต้น DEMO- ทั้งหมด หาและลบทีหลังง่าย
 * รันซ้ำได้: SKU ที่มีอยู่แล้วข้าม
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Roles;
use Optic\Service\Catalog;
use Optic\Service\Receiving;

const NOTE = 'กรอบตัวอย่างสำหรับทดสอบขาย (Bewell demo)';

/** SKU, ยี่ห้อ, รุ่น, สี, ขนาด, วัสดุ, ราคาขาย, ต้นทุน, จำนวน (0 = มีแต่ชื่อ ยังไม่รับเข้า) */
const FRAMES = [
    ['DEMO-FRM-001', 'Ray-Ban', 'RB5154 Clubmaster', 'Black/Gold', '51-21-145', 'Acetate/Metal', 5900, 3200, 3],
    ['DEMO-FRM-002', 'Ray-Ban', 'RB7047', 'Matte Black', '54-17-145', 'Acetate', 4900, 2600, 4],
    ['DEMO-FRM-003', 'Ray-Ban', 'RB3447V Round', 'Gold', '50-21-145', 'Metal', 5500, 3000, 2],
    ['DEMO-FRM-004', 'Oakley', 'OX8046 Airdrop', 'Satin Black', '55-18-143', 'O Matter', 6200, 3500, 2],
    ['DEMO-FRM-005', 'Oakley', 'OX3217 Crosslink', 'Pewter', '53-17-139', 'Metal', 6800, 3900, 1],
    ['DEMO-FRM-006', 'Gucci', 'GG0026O', 'Havana', '50-22-145', 'Acetate', 14500, 8200, 1],
    ['DEMO-FRM-007', 'Prada', 'VPR 16M', 'Black', '52-19-140', 'Acetate', 12900, 7400, 1],
    ['DEMO-FRM-008', 'Silhouette', 'Momentum 5529', 'Silver', '52-18-140', 'Titanium', 13500, 7800, 2],
    ['DEMO-FRM-009', 'Lindberg', 'Strip 9704', 'Titanium', '51-19-140', 'Titanium', 22000, 13000, 1],
    ['DEMO-FRM-010', 'Charmant', 'CH12115', 'Gunmetal', '53-17-140', 'Titanium', 7900, 4300, 3],
    ['DEMO-FRM-011', 'Tom Ford', 'FT5401', 'Dark Havana', '51-20-145', 'Acetate', 15900, 9000, 1],
    ['DEMO-FRM-012', 'Bewell', 'BW-101 Classic', 'Clear', '52-18-140', 'TR90', 1990, 650, 8],
    ['DEMO-FRM-013', 'Bewell', 'BW-102 Square', 'Black', '54-17-142', 'TR90', 1990, 650, 6],
    ['DEMO-FRM-014', 'Bewell', 'BW-201 Round Metal', 'Rose Gold', '49-20-140', 'Metal', 2490, 900, 5],
    ['DEMO-FRM-015', 'Bewell', 'BW-301 Kids', 'Blue', '45-16-125', 'Silicone', 1590, 500, 4],
    /* ยังไม่เคยรับเข้า — ทดสอบว่าหน้าขายเลือกได้ และเปิดล็อตค้างส่งให้เอง */
    ['DEMO-FRM-016', 'Bewell', 'BW-401 Cat Eye', 'Tortoise', '53-16-140', 'Acetate', 2290, 800, 0],
];

$apply = in_array('--apply', $argv, true);

$db = Db::value('SELECT DATABASE()');
if ($db !== 'bewell') {
    fwrite(STDERR, "สคริปต์นี้ใช้กับฐาน bewell เท่านั้น (ตอนนี้ต่ออยู่ที่ {$db})\n");
    exit(1);
}

$categoryId = (int) Db::value("SELECT id FROM categories WHERE code = 'Frame'");
if (!$categoryId) {
    fwrite(STDERR, "ไม่พบหมวดหมู่ Frame\n");
    exit(1);
}
$actorId = (int) Db::value(
    "SELECT a.id FROM admins a JOIN admin_roles r ON r.admin_id = a.id
      WHERE r.role IN ('superuser', 'owner') ORDER BY a.id LIMIT 1"
);
$roles = [Roles::SUPERUSER];

$made = $had = $units = 0;
foreach (FRAMES as [$sku, $brand, $model, $color, $size, $material, $price, $cost, $qty]) {
    if (Db::value('SELECT id FROM products WHERE sku = ?', [$sku]) !== null) {
        $had++;
        continue;
    }
    echo ($apply ? '+ ' : '  จะเพิ่ม ') . "{$sku}  {$brand} {$model} {$color} {$size}  ราคา {$price}  จำนวน {$qty}\n";
    $made++;
    $units += $qty;
    if (!$apply) {
        continue;
    }
    Catalog::createProduct([
        'sku'                => $sku,
        'name'               => "{$brand} {$model}",
        'brand'              => $brand,
        'product_type'       => 'Frame',
        'category_id'        => $categoryId,
        'base_selling_price' => (string) $price,
        'min_stock'          => '1',
        'is_custom_made'     => false,
        'attributes'         => ['model' => $model, 'color' => $color, 'size' => $size, 'material' => $material],
    ], $roles);
    if ($qty > 0) {
        Receiving::receive([
            'sku'           => $sku,
            'quantity'      => $qty,
            'cost_per_unit' => (string) $cost,
            'received_date' => date('Y-m-d'),
            'lot_number'    => 'DEMO-' . substr($sku, 5),
            'note'          => NOTE,
        ], $roles, $actorId);
    }
}

echo "\n" . ($apply ? 'เพิ่มแล้ว' : 'ถ้ารัน --apply จะเพิ่ม') . ": กรอบ {$made} รุ่น · รวม {$units} ชิ้น · มีอยู่แล้ว (ข้าม) {$had}\n";
