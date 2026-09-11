<?php

declare(strict_types=1);

/**
 * ข้อมูลทดลอง 30 วัน สำหรับกดดู Export โดยไม่แตะของจริง
 *
 * ต่างจาก `seed.php` ตรงที่ไม่ลบอะไรเลย — มันเพิ่มสินค้าชุดใหม่ที่ชื่อขึ้นต้นด้วย
 * MOCK แล้วเดินความเคลื่อนไหวหนึ่งเดือนบนสินค้าชุดนั้นอย่างเดียว · ล็อตของจริง
 * ไม่ถูกตัด ยอดคงเหลือของจริงไม่ขยับ และลบทิ้งทีหลังได้ทั้งก้อน
 *
 * ที่ลบได้สะอาดเพราะมันจับกันเป็นก้อนเดียว: ทุกแถวที่สร้างผูกกับ product_id ของ
 * สินค้าที่สคริปต์นี้สร้าง · `--undo` จึงลบด้วยชุด product_id นั้น ไม่ต้องเดา
 * ไม่ต้องคำนวณ remaining_qty ของล็อตอื่นย้อนกลับ ซึ่งเป็นจุดที่พังได้จริง
 *
 * เขียนผ่าน service ทั้งหมด ไม่มี INSERT ตรงเข้า stock_lots หรือ inventory_logs
 * ด้วยเหตุผลเดียวกับ seed.php — ข้อมูลที่เทลงตารางตรง ๆ คือข้อมูลที่ทำให้
 * remaining_qty กับสมุดไม่ตรงกัน
 *
 *   php api/bin/mock-month.php --yes     สร้าง
 *   php api/bin/mock-month.php --undo    ลบทิ้งทั้งก้อน
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Roles;
use Optic\Service\Catalog;
use Optic\Service\Receiving;
use Optic\Service\Rx;
use Optic\Service\Stock;

/** เจ้าของร้าน — ทุกความเคลื่อนไหวที่สร้างเซ็นด้วยคนนี้ */
const OWNER = 1;

/** คำนำหน้าที่ทำให้ของชุดนี้หาเจอและลบได้ */
const TAG = 'MOCK';

$say = static fn(string $s): int => print("  {$s}\n");

/* -------------------------------------------------------------- undo */

if (in_array('--undo', $argv, true)) {
    $ids = array_map(
        static fn(array $r): int => (int) $r['id'],
        Db::all("SELECT id FROM products WHERE sku LIKE '" . TAG . "-%'"),
    );

    if ($ids === []) {
        $say('ไม่มีข้อมูลทดลองให้ลบ');
        exit(0);
    }

    $in = implode(',', $ids);
    Db::conn()->beginTransaction();
    try {
        /* ลำดับสำคัญ: ลูกก่อนพ่อ · rx_orders กับ branch_issues ชี้ไปที่
           inventory_logs ส่วน inventory_logs ชี้ไปที่ stock_lots */
        Db::run("DELETE r FROM rx_orders r JOIN inventory_logs g ON g.id = r.log_id WHERE g.product_id IN ({$in})");
        Db::run("DELETE FROM branch_issues WHERE product_id IN ({$in})");
        Db::run("DELETE FROM inventory_logs WHERE product_id IN ({$in})");
        Db::run("DELETE FROM stock_lots WHERE product_id IN ({$in})");
        Db::run("DELETE FROM products WHERE id IN ({$in})");
        Db::conn()->commit();
    } catch (Throwable $e) {
        Db::conn()->rollBack();
        throw $e;
    }

    $say('ลบข้อมูลทดลองแล้ว — สินค้า ' . count($ids) . ' รายการ พร้อมล็อตและความเคลื่อนไหวทั้งหมด');
    exit(0);
}

if (!in_array('--yes', $argv, true)) {
    fwrite(STDERR, <<<TXT

    สคริปต์นี้เพิ่มข้อมูลทดลอง 30 วันลงฐานข้อมูลจริง ไม่ลบของเดิม

      เพิ่ม   สินค้าชื่อขึ้นต้นด้วย MOCK พร้อมล็อต ความเคลื่อนไหว สาขาเบิก
              และใบสั่งตัด RX ย้อนหลัง 30 วัน
      ไม่แตะ  สินค้า ล็อต และความเคลื่อนไหวของจริงทั้งหมด

      php api/bin/mock-month.php --yes     สร้าง
      php api/bin/mock-month.php --undo    ลบทิ้งทั้งก้อน


    TXT);
    exit(1);
}

if (Db::value("SELECT COUNT(*) FROM products WHERE sku LIKE '" . TAG . "-%'") > 0) {
    fwrite(STDERR, "  มีข้อมูลทดลองอยู่แล้ว — ลบก่อนด้วย --undo\n");
    exit(1);
}

$today = new DateTimeImmutable('today');
$day = static fn(int $ago): string => $today->modify("-{$ago} days")->format('Y-m-d');

/* ---------------------------------------------------------- สินค้า */

/**
 * สิบสองตัว: เลนส์สำเร็จรูป กรอบ แว่นกันแดด คอนแทค อุปกรณ์ และเลนส์สั่งตัด
 *
 * หลายชนิดเพราะรายงานแยกตามชนิดสินค้า — ชุดที่มีแต่เลนส์จะทำให้คอลัมน์ "ชนิด"
 * ในไฟล์ Excel มีค่าเดียวทั้งคอลัมน์ ซึ่งตรวจไม่ได้ว่ามันทำงานถูกไหม
 */
$catalogue = [
    ['Lens',       'Hoya',        1290, ['model' => 'HiVision', 'coating' => 'MC', 'lens_index' => '1.56', 'lens_design' => 'Single']],
    ['Lens',       'Hoya',        3450, ['model' => 'HiVision', 'coating' => 'Blue',      'lens_index' => '1.60', 'lens_design' => 'Progressive']],
    ['Lens',       'Zeiss',       2890, ['model' => 'SmartLife', 'coating' => 'Hard',     'lens_index' => '1.60', 'lens_design' => 'Bifocal']],
    ['Lens',       'Essilor',     5600, ['model' => 'Varilux X', 'coating' => 'Auto', 'lens_index' => '1.67', 'lens_design' => 'Progressive']],
    ['Lens',       'Tokai',       1990, ['model' => 'Lutina',   'coating' => 'MC', 'lens_index' => '1.50', 'lens_design' => 'Sport']],
    ['Frame',      'Ray-Ban',     4200, ['model' => 'RB5154',   'color' => 'Black',  'size' => '51-21-145', 'material' => 'Acetate']],
    ['Frame',      'Owndays',     1890, ['model' => 'OR1052',   'color' => 'Gold',   'size' => '49-20-140', 'material' => 'Titanium']],
    ['Sunglass',   'Ray-Ban',     6900, ['model' => 'RB3025',   'color' => 'Green',  'size' => '58-14-135', 'tint' => 'G-15']],
    ['ContactLen', 'Acuvue',       850, ['model' => 'Oasys',    'bc' => '8.5', 'dia' => '14.0', 'pack' => '6', 'wear' => 'รายสองสัปดาห์']],
    ['Accessory',  'TimeOptic',    150, ['kind' => 'น้ำยาล้างเลนส์', 'volume' => '60ml']],
    ['Accessory',  'TimeOptic',    290, ['kind' => 'กล่องแว่นหนัง']],
];

$custom = [
    ['Lens', 'Hoya',    ['model' => 'Nulux',    'coating' => 'Blue',       'lens_index' => '1.67', 'lens_design' => 'Progressive']],
    ['Lens', 'Zeiss',   ['model' => 'DriveSafe','coating' => 'Hard',       'lens_index' => '1.60', 'lens_design' => 'Degressive/Digital/Office']],
    ['Lens', 'Shamir',  ['model' => 'Autograph','coating' => 'Auto', 'lens_index' => '1.74', 'lens_design' => 'Myopia']],
];

$catId = [];
foreach (Db::all('SELECT id, code FROM categories') as $c) {
    $catId[$c['code']] = (int) $c['id'];
}

$made = [];
$seq = 0;
foreach ([...array_map(static fn($r) => [...$r, false], $catalogue),
          ...array_map(static fn($r) => [$r[0], $r[1], 0, $r[2], true], $custom)] as $row) {
    [$type, $brand, $price, $attrs, $isCustom] = $row;
    $seq++;

    $out = Catalog::createProduct([
        // SKU ตั้งเองเพื่อให้ `--undo` หาเจอด้วย LIKE ตัวเดียว · ปล่อยให้ระบบ
        // ออกเลขให้จะได้ LNS-0008 ซึ่งแยกจากของจริงไม่ออก
        'sku'                => sprintf('%s-%03d', TAG, $seq),
        'name'               => TAG . ' ' . $brand . ' ' . ($attrs['model'] ?? $attrs['kind'] ?? $type),
        'product_type'       => $type,
        'category_id'        => $catId[$type] ?? null,
        'brand'              => $brand,
        'base_selling_price' => (string) $price,
        'min_stock'          => $isCustom ? 0 : ($type === 'ContactLen' ? 12 : 4),
        'is_custom_made'     => $isCustom,
        'attributes'         => $attrs,
    ], Roles::OWNER);

    $made[] = $out + ['type' => $type, 'custom' => $isCustom, 'price' => $price];
}
$say('สินค้าทดลอง ' . count($made) . ' รายการ');

/* ------------------------------------------------------------- ล็อต */

$stocked = array_values(array_filter($made, static fn(array $p): bool => !$p['custom']));
$lots = 0;
foreach ($stocked as $i => $p) {
    // สองล็อตต่อสินค้า รับคนละวัน — FIFO จะได้มีอะไรให้เลือกจริง ๆ และคอลัมน์
    // "ต้นทุนรวม" จะได้ไม่ใช่ราคาเดียวคูณจำนวน
    foreach ([[34, 0.55], [17, 0.62]] as $n => [$ago, $margin]) {
        Receiving::receive([
            'sku'           => $p['sku'],
            'quantity'      => (string) (10 + ($i % 4) * 5 + $n * 3),
            'cost_per_unit' => number_format($p['price'] * $margin, 2, '.', ''),
            'received_date' => $day($ago),
            'note'          => TAG,
        ], Roles::OWNER, OWNER);
        $lots++;
    }
}
$say("ล็อต {$lots} ล็อต");

/* --------------------------------------------------- ความเคลื่อนไหว */

$branchIds = array_map(
    static fn(array $b): int => (int) $b['id'],
    Db::all('SELECT id FROM branches WHERE is_active = 1 ORDER BY id'),
);
$staffIds = array_map(
    static fn(array $a): int => (int) $a['id'],
    Db::all('SELECT id FROM admins WHERE is_active = 1 ORDER BY id LIMIT 4'),
);

$backdate = [];
$moves = 0;
$rxSeq = 0;

for ($ago = 30; $ago >= 0; $ago--) {
    // วันอาทิตย์เงียบ · ร้านที่ขายเท่ากันทุกวันอ่านเป็นสเปรดชีต ไม่ใช่ร้าน
    $weekday = (int) $today->modify("-{$ago} days")->format('N');
    $lines = $weekday === 7 ? 0 : mt_rand(2, 5);

    for ($n = 0; $n < $lines; $n++) {
        $p = $stocked[mt_rand(0, count($stocked) - 1)];
        $have = (int) Db::value(
            'SELECT COALESCE(SUM(remaining_qty), 0) FROM stock_lots WHERE product_id = ?',
            [$p['id']],
        );
        if ($have < 1) {
            continue;
        }

        $qty = min($have, mt_rand(1, 2));
        $key = TAG . ":{$ago}:{$n}:" . $p['id'];
        $roll = mt_rand(1, 100);

        try {
            if ($roll <= 22 && $branchIds !== []) {
                // สาขามาเบิก — ก้อนที่หน้า "ของที่สาขาเบิกไป" กับชีตสาขาในไฟล์
                // Excel กินอยู่ · หนึ่งในห้าของรายการ เพราะสาขาไม่ได้มาทุกวัน
                Stock::issue([
                    'source' => TAG, 'idem_key' => $key, 'sku' => $p['sku'],
                    'quantity' => $qty, 'actor_id' => OWNER,
                    'branch_id' => $branchIds[array_rand($branchIds)],
                    'taken_by' => ['พี่หนึ่ง', 'พี่เมย์', 'ช่างเอก'][mt_rand(0, 2)],
                    'note' => TAG,
                ]);
            } elseif ($roll <= 92) {
                Stock::issue([
                    'source' => TAG, 'idem_key' => $key, 'sku' => $p['sku'],
                    'quantity' => $qty, 'actor_id' => OWNER,
                    'issued_to_admin_id' => $staffIds[array_rand($staffIds)],
                    'note' => TAG . ' ขายหน้าร้าน',
                ]);
            } else {
                Stock::scrap([
                    'source' => TAG, 'idem_key' => $key, 'sku' => $p['sku'],
                    'quantity' => 1, 'actor_id' => OWNER,
                    'taken_by' => ['ช่างเอก', 'พี่เมย์'][mt_rand(0, 1)],
                    'note' => TAG . ' ฝนเลนส์เสีย',
                ]);
            }
        } catch (Throwable) {
            // ของหมดพอดีระหว่างทาง ข้ามไป — ไม่ใช่เรื่องที่ต้องหยุดทั้งสคริปต์
            continue;
        }

        $backdate[] = $day($ago);
        $moves++;
    }

    /* ใบสั่งตัด RX ราวสองวันครั้ง · ครึ่งหนึ่งเป็นสาขาสั่ง เพื่อให้แผง
       "ใครสั่งตัด RX" มีทั้งก้อน TimeOptic และก้อนสาขาให้ดู */
    if ($ago % 2 === 0 && $weekday !== 7) {
        $lens = $custom[array_rand($custom)];
        $rxSeq++;
        $costed = mt_rand(1, 100) <= 70;

        try {
            Rx::order([
                'brand'         => $lens[1],
                'lens_model'    => $lens[2]['model'],
                'lens_coating'  => $lens[2]['coating'],
                'lens_index'    => $lens[2]['lens_index'],
                'lens_design'   => $lens[2]['lens_design'],
                'reference_doc' => sprintf('%s-RX-%04d', TAG, $rxSeq),
                'branch_id'     => ($branchIds !== [] && $rxSeq % 2 === 0)
                    ? $branchIds[array_rand($branchIds)]
                    : null,
                'sale_price'    => (string) (2500 + mt_rand(0, 24) * 250),
                'unit_cost'     => $costed ? (string) (900 + mt_rand(0, 30) * 50) : null,
                'eye_side'      => ['left', 'right'][mt_rand(0, 1)],
                // ค่าสายตาเดินทีละ 0.25 เสมอ — เลขนอกบันไดถูกปฏิเสธที่ Optics::power
                'sph'           => number_format(mt_rand(-32, 16) * 0.25, 2, '.', ''),
                'cyl'           => number_format(mt_rand(-12, 0) * 0.25, 2, '.', ''),
                'axis'          => (string) (mt_rand(1, 36) * 5),
            ], Roles::OWNER, OWNER);
            $backdate[] = $day($ago);
            $moves++;
        } catch (Throwable) {
            continue;
        }
    }
}

/* ------------------------------------------------------ ย้อนวันที่ */

/* service ประทับวันที่เป็นวันนี้เสมอ ซึ่งถูกสำหรับของจริงและผิดสำหรับของทดลอง —
   หนึ่งเดือนที่ทุกแถวลงวันเดียวกันคือกราฟที่มีแท่งเดียว · แก้ทีหลังตามลำดับที่
   สร้าง เพราะ id เรียงตามเวลาที่สร้างอยู่แล้ว */
$fresh = Db::all(
    "SELECT g.id FROM inventory_logs g
     JOIN products p ON p.id = g.product_id
     WHERE p.sku LIKE '" . TAG . "-%' AND g.action_type <> 'IN'
     ORDER BY g.id ASC",
);
foreach ($fresh as $i => $row) {
    if (!isset($backdate[$i])) {
        break;
    }
    Db::run(
        'UPDATE inventory_logs SET created_at = ? WHERE id = ?',
        [$backdate[$i] . ' ' . sprintf('%02d:%02d:00', mt_rand(9, 18), mt_rand(0, 59)), (int) $row['id']],
    );
}

// ของเข้าลงวันตามวันที่รับจริงของล็อต ไม่ใช่วันที่รันสคริปต์
Db::run(
    "UPDATE inventory_logs g
     JOIN stock_lots l ON l.id = g.lot_id
     JOIN products p ON p.id = g.product_id
     SET g.created_at = CONCAT(l.received_date, ' 10:00:00')
     WHERE g.action_type = 'IN' AND p.sku LIKE '" . TAG . "-%'",
);

// ใบเบิกของสาขาถือวันของตัวเอง และรายงานฝั่งสาขานับตามวันนั้น
Db::run(
    "UPDATE branch_issues i
     JOIN inventory_logs g ON g.branch_issue_id = i.id
     JOIN products p ON p.id = i.product_id
     SET i.issued_at = g.created_at
     WHERE p.sku LIKE '" . TAG . "-%'",
);

$say("ความเคลื่อนไหว {$moves} รายการ ตลอด 30 วันที่ผ่านมา · ใบสั่งตัด RX {$rxSeq} ใบ");
$say('ลบทิ้งเมื่อดูเสร็จ:  php api/bin/mock-month.php --undo');
