<?php

declare(strict_types=1);

/**
 * Empties the shop's test data and writes a fresh, coherent set in its place.
 *
 * This exists because a demo is only useful if it is believable. The data that
 * had accumulated was the residue of a dozen features being built — products
 * named three ways, half of them called TEST-something, lots with no cost that
 * nobody meant to leave — and the first thing a shop owner asked to try it out
 * does is stop to ask what any of it means.
 *
 * Everything below is written **through the services**, never with raw INSERTs
 * into `stock_lots` and `inventory_logs`. That is the whole point: the invariant
 * this project rests on is that a lot's `remaining_qty` equals the sum of its
 * ledger rows, and data poured straight into the tables is exactly how that
 * stops being true. Seeding through `Receiving` and `Stock` means the demo is
 * built by the same code the shop uses, so it cannot be inconsistent in a way
 * the real thing could not also be.
 *
 * `admins` is never touched — signing in has to keep working — and neither is
 * anything that is configuration rather than data: `employees`, `app_settings`,
 * the `list_*` lookups, the case statuses and processes. Those are the rules
 * the shop-floor system runs on, not test rows.
 *
 *   php api/bin/backup.php     ← ทำก่อนเสมอ
 *   php api/bin/seed.php --yes
 */

require __DIR__ . '/../src/bootstrap.php';

use Optic\Db;
use Optic\Roles;
use Optic\Service\Branches;
use Optic\Service\Catalog;
use Optic\Service\Receiving;
use Optic\Service\Rx;
use Optic\Service\Settlement;
use Optic\Service\Stock;

if (!in_array('--yes', $argv, true)) {
    fwrite(STDERR, <<<TXT
    สคริปต์นี้ลบข้อมูลทดสอบทั้งหมดแล้วสร้างใหม่ ย้อนกลับไม่ได้

      ลบ    ทุกตารางที่เป็นข้อมูล แล้ว mock ใหม่ทั้งหมด — สินค้า ล็อต ความเคลื่อนไหว
            สาขา รายการค้างรับ ลูกค้า ประวัติค่าสายตา เคส นัดหมาย
            ใบสั่งตัด การรับเงิน รายรับรายจ่าย
      ไม่แตะ admins · employees · app_settings · list_* · case_statuses
            case_processes · schema_migrations

    สำรองข้อมูลก่อน:  php api/bin/backup.php
    แล้วสั่ง:          php api/bin/seed.php --yes

    TXT);
    exit(1);
}

/** Whoever is on the shop's own account. Every seeded movement is signed by one. */
const OWNER = 1;
const STAFF = [3 => 'ไทม์', 4 => 'แนน', 5 => 'โอ๊ต', 6 => 'ช่างเอก', 7 => 'พี่หนู'];

/** Deterministic, so two runs of this script produce the same shop. */
mt_srand(20260831);

$today = new DateTimeImmutable('today');
$day = static fn(int $ago): string => $today->modify("-{$ago} days")->format('Y-m-d');

function say(string $line): void
{
    echo $line . "\n";
}

/* ---------------------------------------------------------------- wipe */

/**
 * Configuration stays; data goes.
 *
 * Named as a keep-list rather than a clear-list on purpose: a table added to
 * this database next month should default to being cleared by a script whose
 * whole job is to clear data, not to being silently preserved because nobody
 * remembered to add it here.
 */
$keep = [
    'admins', 'employees', 'schema_migrations', 'app_settings',
    'case_statuses', 'case_processes',
    'list_len_type', 'list_marketing', 'list_pay_type', 'list_product_type', 'list_sex',
];

$tables = [];
foreach (Db::all('SHOW FULL TABLES') as $row) {
    $v = array_values($row);
    if (($v[1] ?? '') === 'BASE TABLE' && !in_array($v[0], $keep, true)) {
        $tables[] = (string) $v[0];
    }
}

$pdo = Db::conn();
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
foreach ($tables as $t) {
    // TRUNCATE rather than DELETE: it resets AUTO_INCREMENT, and a demo whose
    // first product is id 1383 invites the question of what happened to 1382.
    $pdo->exec("TRUNCATE TABLE `{$t}`");
}
$pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
say('ล้างแล้ว ' . count($tables) . ' ตาราง · เก็บไว้ ' . implode(' · ', $keep));

/* ---------------------------------------------------------- categories */

$categories = [
    'Lens'       => 'เลนส์',
    'Frame'      => 'กรอบแว่น',
    'Sunglass'   => 'แว่นกันแดด',
    'ContactLen' => 'คอนแทคเลนส์',
    'Accessory'  => 'อุปกรณ์เสริม',
];
foreach ($categories as $code => $name) {
    Db::run('INSERT INTO categories (name, code) VALUES (?, ?)', [$name, $code]);
}
$catId = [];
foreach (Db::all('SELECT id, code FROM categories') as $c) {
    $catId[$c['code']] = (int) $c['id'];
}

/* ----------------------------------------------------------- suppliers */

$suppliers = [
    'Lens G Supply'      => ['สุนีย์', '02-111-2233'],
    'Hitop Optical'      => ['ก้อง', '02-222-3344'],
    'Hoya Lens Thailand' => ['ฝ่ายขาย', '02-333-4455'],
    'Zeiss Thailand'     => ['ฝ่ายขาย', '02-444-5566'],
    'Essilor Thailand'   => ['ฝ่ายขาย', '02-555-6677'],
    'Bangkok Frame Co.'  => ['พี่แดง', '02-666-7788'],
    'อุปกรณ์แว่นไทย'      => ['เจ๊หมวย', '02-777-8899'],
];
foreach ($suppliers as $name => [$person, $phone]) {
    Db::run(
        'INSERT INTO suppliers (name, contact_person, phone) VALUES (?, ?, ?)',
        [$name, $person, $phone],
    );
}
$supId = [];
foreach (Db::all('SELECT id, name FROM suppliers') as $s) {
    $supId[$s['name']] = (int) $s['id'];
}
say('หมวดหมู่ ' . count($categories) . ' · ผู้ขาย ' . count($suppliers));

/* ------------------------------------------------------------ branches */

foreach ([
    ['สาขาบางแค', 'พี่นก 089-111-2222'],
    ['สาขารังสิต', 'คุณเอ๋ 089-333-4444'],
    ['สาขาลาดพร้าว', 'คุณบอย 089-555-6666'],
] as [$name, $contact]) {
    Branches::create(['name' => $name, 'contact' => $contact], Roles::OWNER);
}
$branchIds = array_map(
    static fn(array $b): int => (int) $b['id'],
    Db::all('SELECT id FROM branches ORDER BY id'),
);

/* ------------------------------------------------------------ products */

/**
 * Nothing here carries a name.
 *
 * That is the demonstration: every product below is described by its spec and
 * named by `Catalog::composeName`, so the catalogue that comes out is one where
 * two rows can only read alike if they really are the same thing.
 *
 * @var list<array{0:string,1:string,2:?string,3:array<string,mixed>,4:string,5:int,6:bool}>
 */
$plan = [];

/** Stocked lenses — the drawers, one row per power. */
foreach ([
    ['Lens G', 'Clear', '1.56', 'Hard', 'Single Vision', ['-1.00', '-2.00', '-3.00'], '1200.00', 6],
    ['Lens G', 'Clear', '1.60', 'MC', 'Single Vision', ['-2.25', '-4.00'], '1800.00', 4],
    ['Hitop', 'Aspheric', '1.56', 'Blue', 'Single Vision', ['-1.50', '-2.50'], '1500.00', 4],
    ['Hitop', 'Aspheric', '1.60', 'Auto', 'Single Vision', ['-3.00'], '2600.00', 3],
    ['Hoya', 'HiVision', '1.60', 'MC', 'Single Vision', ['-2.25', '-4.00'], '3200.00', 4],
    ['Hoya', 'HiVision', '1.67', 'Auto-Blue', 'Single Vision', ['-5.00'], '5400.00', 2],
] as [$brand, $model, $index, $coating, $design, $powers, $price, $min]) {
    foreach ($powers as $sph) {
        $plan[] = [
            'Lens', $brand, $coating,
            [
                'model' => $model, 'lens_index' => $index, 'coating' => $coating,
                'lens_design' => $design, 'sph' => (float) $sph, 'cyl' => -0.50,
            ],
            $price, $min, false,
        ];
    }
}

/** Stocked bifocals — same model, told apart only by the ADD. */
foreach (['+2.00', '+2.50'] as $add) {
    $plan[] = [
        'Lens', 'Lens G', 'Hard',
        [
            'model' => 'FT28', 'lens_index' => '1.56', 'coating' => 'Hard',
            'lens_design' => 'Bifocal', 'sph' => -1.50, 'add' => $add,
        ],
        '2200.00', 3, false,
    ];
}

/** Made to order — a model, never a power. The power belongs to the job. */
foreach ([
    ['Hoya', 'Lifestyle 4', '1.60', 'MC', 'Progressive', '8900.00'],
    ['Zeiss', 'SmartLife', '1.67', 'Auto-Blue', 'Progressive', '12500.00'],
    ['Essilor', 'Varilux X', '1.67', 'MC', 'Progressive', '13800.00'],
    ['TOG', 'Office', '1.60', 'Blue', 'Progressive', '6900.00'],
    ['Rodenstock', 'Impression', '1.60', 'MC', 'Progressive', '11500.00'],
    ['Shamir', 'Autograph', '1.67', 'Auto', 'Progressive', '10900.00'],
    ['Tokai', 'Lutina', '1.60', 'Blue', 'Single Vision', '7200.00'],
] as [$brand, $model, $index, $coating, $design, $price]) {
    $plan[] = [
        'Lens', $brand, $coating,
        ['model' => $model, 'lens_index' => $index, 'coating' => $coating, 'lens_design' => $design],
        $price, 0, true,
    ];
}

/** Frames — told apart by colour and size. */
foreach ([
    ['Hitop', 'TS2088', 'ดำเงา', '50-22-150', 'TR90', '2900.00', 3],
    ['Hitop', 'TS2088', 'น้ำตาลใส', '50-22-150', 'TR90', '2900.00', 3],
    ['Hitop', 'TS1042', 'เงินด้าน', '52-18-145', 'Metal', '3400.00', 2],
    ['Hitop', 'AC5028', 'ดำด้าน', '54-16-145', 'Acetate', '3900.00', 2],
    ['Lens G', 'LG-Titan', 'ไทเทเนียม', '53-17-140', 'Titanium', '5200.00', 2],
] as [$brand, $model, $color, $size, $material, $price, $min]) {
    $plan[] = [
        'Frame', $brand, null,
        ['model' => $model, 'color' => $color, 'size' => $size, 'material' => $material],
        $price, $min, false,
    ];
}

/** Sunglasses — colour, tint and size. */
foreach ([
    ['Hitop', 'SG-Wave', 'ดำ', 'Grey Gradient', '54-16-145', '3600.00'],
    ['Hitop', 'SG-Wave', 'น้ำตาล', 'Brown', '54-16-145', '3600.00'],
    ['Lens G', 'LG-Sport', 'ดำด้าน', 'Polarized Grey', '58-14-135', '4500.00'],
] as [$brand, $model, $color, $tint, $size, $price]) {
    $plan[] = [
        'Sunglass', $brand, null,
        ['model' => $model, 'color' => $color, 'tint' => $tint, 'size' => $size, 'polarized' => true],
        $price, 2, false,
    ];
}

/** Contact lenses — curve, diameter and how many in the box. */
foreach ([
    ['Hoya', 'Daily Soft', '8.6', '14.2', '30', 'Daily', '850.00', 10],
    ['Hoya', 'Daily Soft', '8.6', '14.2', '90', 'Daily', '2200.00', 4],
    ['Lens G', 'Monthly Clear', '8.7', '14.0', '6', 'Monthly', '1250.00', 6],
] as [$brand, $model, $bc, $dia, $pack, $wear, $price, $min]) {
    $plan[] = [
        'ContactLen', $brand, null,
        ['model' => $model, 'bc' => $bc, 'dia' => $dia, 'pack' => $pack, 'wear' => $wear],
        $price, $min, false,
    ];
}

/** Accessories. */
foreach ([
    ['Lens G', 'น้ำยาล้างแว่น', ['kind' => 'Cleaning', 'volume' => '60ml'], '120.00', 12],
    ['Lens G', 'ผ้าเช็ดเลนส์', ['kind' => 'Cloth', 'color' => 'เทา', 'size' => '15x18cm'], '60.00', 20],
    ['Hitop', 'กล่องแว่นแข็ง', ['kind' => 'Case', 'color' => 'ดำ', 'size' => 'M'], '250.00', 8],
    ['Hitop', 'สายคล้องแว่นหนัง', ['kind' => 'Chain', 'color' => 'น้ำตาล'], '190.00', 6],
] as [$brand, $model, $extra, $price, $min]) {
    $plan[] = ['Accessory', $brand, null, ['model' => $model] + $extra, $price, $min, false];
}

$made = [];
foreach ($plan as [$type, $brand, , $attrs, $price, $min, $custom]) {
    $out = Catalog::createProduct([
        'product_type'       => $type,
        'category_id'        => $catId[$type],
        'brand'              => $brand,
        'base_selling_price' => $price,
        'min_stock'          => $custom ? 0 : $min,
        'is_custom_made'     => $custom,
        'attributes'         => $attrs,
        // No name: composed from everything above, which is the point.
    ], Roles::OWNER);
    $made[] = $out + ['type' => $type, 'custom' => $custom];
}
say('สินค้า ' . count($made) . ' รายการ · ชื่อทั้งหมดตั้งอัตโนมัติจากสเปก');

/* ---------------------------------------------------------------- lots */

$stocked = array_values(array_filter($made, static fn(array $p): bool => !$p['custom']));
$supplierFor = [
    'Lens G'     => 'Lens G Supply',
    'Hitop'      => 'Hitop Optical',
    'Hoya'       => 'Hoya Lens Thailand',
    'Zeiss'      => 'Zeiss Thailand',
    'Essilor'    => 'Essilor Thailand',
];

$lots = 0;
foreach ($stocked as $i => $p) {
    $brand = (string) Db::value('SELECT brand FROM products WHERE id = ?', [$p['id']]);
    $supplier = $supId[$supplierFor[$brand] ?? 'Bangkok Frame Co.'] ?? null;

    // Two deliveries for most things, so FIFO has an order to respect and the
    // lot list has something to show. The first is old enough that one product
    // per handful ends up on the "sitting still" report.
    $deliveries = $i % 4 === 0 ? [[110, 14], [24, 12]] : [[52, 12], [12, 16]];
    if ($i % 7 === 0) {
        $deliveries = [[95, 10]];
    }

    foreach ($deliveries as $n => [$ago, $qty]) {
        // One lot in nine arrives before its invoice does — that is the state
        // the "รอต้นทุน" chip and the cost column exist to make visible.
        $awaiting = ($i + $n) % 9 === 0;
        Receiving::receive([
            'sku'           => $p['sku'],
            'quantity'      => $qty,
            'supplier_id'   => $supplier,
            'cost_per_unit' => $awaiting ? null : number_format(
                (float) Db::value('SELECT base_selling_price FROM products WHERE id = ?', [$p['id']]) * 0.45,
                2,
                '.',
                '',
            ),
            'received_date' => $day($ago),
            // Contact lenses are the only thing here that actually expires.
            'expiry_date'   => $p['type'] === 'ContactLen'
                ? $today->modify('+' . (60 + $n * 200) . ' days')->format('Y-m-d')
                : null,
            'note'          => $awaiting ? 'ของมาก่อน ใบกำกับตามมาทีหลัง' : null,
        ], Roles::OWNER, OWNER);
        $lots++;
    }
}
say("ล็อตที่รับเข้า {$lots} ล็อต");

/* ----------------------------------------------------------- movements */

/**
 * A quarter of trading, written by the same code the shop uses.
 *
 * Backdated afterwards rather than faked: the services stamp `NOW()`, and a
 * demo where every movement happened this second has nothing for the charts,
 * the date range or the "sitting still" report to say. The quantities and the
 * lots they came out of are whatever FIFO really chose.
 */
$moves = 0;
$backdate = [];
$staffIds = array_keys(STAFF);

for ($ago = 88; $ago >= 0; $ago--) {
    // Sundays are quiet, and a shop that sold the same amount every day reads
    // as a spreadsheet rather than as a shop.
    $weekday = (int) $today->modify("-{$ago} days")->format('N');
    $sales = $weekday === 7 ? 0 : mt_rand(1, 3);

    for ($n = 0; $n < $sales; $n++) {
        $pick = mt_rand(0, count($stocked) - 1);
        // Every sixth product is bought and then simply sits. Not an oversight:
        // the whole point of the "sitting still" report is that some drawers do
        // exactly this, and a demo where everything moves has nothing to show
        // on the screen built to find what does not.
        if ($pick % 6 === 0) {
            continue;
        }
        $p = $stocked[$pick];
        $have = (int) Db::value(
            'SELECT COALESCE(SUM(remaining_qty), 0) FROM stock_lots WHERE product_id = ?',
            [$p['id']],
        );
        if ($have < 1) {
            continue;
        }

        $qty = min($have, mt_rand(1, 2));
        $roll = mt_rand(1, 100);
        $key = "seed:{$ago}:{$n}:" . $p['id'];

        try {
            if ($roll <= 88) {
                $r = Stock::issue([
                    'source' => 'seed', 'idem_key' => $key, 'sku' => $p['sku'],
                    'quantity' => $qty, 'actor_id' => OWNER,
                    'issued_to_admin_id' => $staffIds[array_rand($staffIds)],
                    'note' => 'ขายหน้าร้าน',
                ]);
            } elseif ($roll <= 95) {
                $r = Stock::scrap([
                    'source' => 'seed', 'idem_key' => $key, 'sku' => $p['sku'],
                    'quantity' => 1, 'actor_id' => OWNER, 'note' => 'ตัดเสียตอนฝนเลนส์',
                ]);
            } else {
                $r = Stock::returnStock([
                    'source' => 'seed', 'idem_key' => $key, 'sku' => $p['sku'],
                    'quantity' => 1, 'actor_id' => OWNER, 'note' => 'ลูกค้าคืนของ',
                ]);
            }
        } catch (Throwable) {
            // "Out of stock" is a real answer, not a failure of the seed.
            continue;
        }

        $backdate[] = $day($ago);
        $moves++;
    }
}

// The ledger rows the loop above created, in the order it created them.
$fresh = Db::all(
    "SELECT id FROM inventory_logs
     WHERE action_type IN ('OUT','SCRAP','RETURN') ORDER BY id ASC",
);
foreach ($fresh as $i => $row) {
    if (!isset($backdate[$i])) {
        break;
    }
    Db::run(
        'UPDATE inventory_logs SET created_at = ? WHERE id = ?',
        [$backdate[$i] . ' ' . sprintf('%02d:%02d:00', mt_rand(9, 18), mt_rand(0, 59)), $row['id']],
    );
}

// Receiving stamps the day it ran too; a lot received in May with a ledger row
// dated today would make the two disagree on screen.
Db::run(
    "UPDATE inventory_logs g
     JOIN stock_lots l ON l.id = g.lot_id
     SET g.created_at = CONCAT(l.received_date, ' 10:00:00')
     WHERE g.action_type = 'IN'",
);
say("ความเคลื่อนไหว {$moves} รายการ ตลอด 88 วันที่ผ่านมา");

/* ------------------------------------------------------- branch issues */

$issues = 0;
foreach ($stocked as $i => $p) {
    if ($i % 5 !== 0) {
        continue;
    }
    $have = (int) Db::value(
        'SELECT COALESCE(SUM(remaining_qty), 0) FROM stock_lots WHERE product_id = ?',
        [$p['id']],
    );
    if ($have < 1) {
        continue;
    }

    $ago = 40 - $issues * 4;
    try {
        Stock::issue([
            'source' => 'seed', 'idem_key' => "seed:branch:{$p['id']}", 'sku' => $p['sku'],
            'quantity' => 1, 'actor_id' => OWNER,
            'branch_id' => $branchIds[$issues % count($branchIds)],
            'taken_by' => ['พี่นก', 'คุณเอ๋', 'คุณบอย'][$issues % 3],
            'note' => 'สาขามาเบิก',
        ]);
    } catch (Throwable) {
        continue;
    }
    $issues++;

    $issue = Db::one('SELECT id FROM branch_issues ORDER BY id DESC LIMIT 1');
    Db::run(
        'UPDATE branch_issues SET issued_at = ? WHERE id = ?',
        [$day(max(1, $ago)) . ' 11:00:00', $issue['id']],
    );

    // Two of every three have paid; the rest are what the settlements screen is
    // for. A demo where nothing is owed cannot show the screen that matters.
    if ($issues % 3 !== 0) {
        $cost = (float) Db::value('SELECT cost_total FROM branch_issues WHERE id = ?', [$issue['id']]);
        Settlement::settle(
            (int) $issue['id'],
            ['amount' => number_format($cost * 1.35, 2, '.', ''), 'note' => 'โอนเข้าบัญชีร้าน'],
            Roles::OWNER,
            OWNER,
        );
        Db::run(
            'UPDATE branch_issues SET settled_at = ? WHERE id = ?',
            [$day(max(0, $ago - 5)) . ' 15:00:00', $issue['id']],
        );
    }
}
say("สาขาเบิกไป {$issues} รายการ");

/* -------------------------------------------------------- RX order book */

/**
 * Lenses ordered against a job rather than taken from a drawer.
 *
 * One per made-to-order model, so the RX screen opens on something. Two are
 * left without a cost on purpose: an order keyed before the invoice arrives is
 * the normal case, and it is what the "รอต้นทุน" list on that screen is for.
 */
$rxMade = Db::all("SELECT id, sku, base_selling_price FROM products WHERE is_custom_made = 1 ORDER BY id");
$rxCount = 0;
foreach ($rxMade as $n => $p) {
    $ago = 30 - $n * 4;
    $order = Rx::order([
        'sku'        => $p['sku'],
        'eye_side'   => $n % 2 === 0 ? 'right' : 'left',
        'sph'        => number_format(-1.0 - $n * 0.75, 2, '.', ''),
        'cyl'        => '-0.50',
        'axis'       => (string) (90 + $n * 5),
        'add_power'  => $n % 3 === 0 ? '+2.00' : null,
        'sale_price' => $p['base_selling_price'],
        // Two of the seven arrive before their invoice does.
        'unit_cost'  => $n % 3 === 1 ? null : number_format((float) $p['base_selling_price'] * 0.45, 2, '.', ''),
        'note'       => 'สั่งตามใบงานลูกค้า',
    ], Roles::OWNER, OWNER);

    Db::run(
        'UPDATE inventory_logs SET created_at = ? WHERE id = ?',
        [$day(max(0, $ago)) . ' 13:30:00', $order['id']],
    );
    $rxCount++;
}
say("ใบสั่งตัด RX {$rxCount} ใบ");

/* --------------------------------------------------------- RX customers */

/**
 * Ten customers and the prescriptions behind them.
 *
 * Kept small and plainly Thai, because the point of them is to be recognisable
 * at a glance: a tester should be able to see that สมชาย's reading has drifted
 * a quarter dioptre since last year without reading a single id.
 */
$people = [
    ['สมชาย', 'ใจกว้าง', 'Male', '081-234-5678', -2.00, -2.25, null],
    ['สุดารัตน์', 'พรหมมา', 'Female', '082-345-6789', -4.25, -4.00, '+2.00'],
    ['อนุชา', 'ทองดี', 'Male', '083-456-7890', -1.25, -1.50, null],
    ['ปิยะดา', 'ศรีสุข', 'Female', '084-567-8901', -3.50, -3.25, null],
    ['ธนกร', 'วงศ์ไทย', 'Male', '085-678-9012', -0.75, -1.00, null],
    ['กมลชนก', 'แสงเดือน', 'Female', '086-789-0123', -5.00, -5.25, '+2.50'],
    ['ณัฐพล', 'บุญมี', 'Male', '087-890-1234', -2.75, -2.50, null],
    ['วราภรณ์', 'จันทร์เพ็ญ', 'Female', '088-901-2345', -1.75, -2.00, '+1.75'],
    ['ภาณุวัฒน์', 'รักษ์ดี', 'Male', '089-012-3456', -6.00, -5.75, null],
    ['ชนิดา', 'อยู่ดี', 'Female', '090-123-4567', -0.50, -0.50, null],
];

$rx = 0;
foreach ($people as $i => [$first, $last, $sex, $phone, $rSph, $lSph, $add]) {
    Db::run(
        'INSERT INTO customers (first_name, last_name, sex, nationality, phone, line_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$first, $last, $sex, 'Thai', $phone, strtolower(str_replace(' ', '', $first)) . $i,
         $i % 3 === 0 ? 'ลูกค้าประจำ' : null],
    );
    $customerId = (int) Db::conn()->lastInsertId();

    /**
     * Two visits for most people: last year's reading and this year's.
     *
     * The older one is a quarter dioptre weaker, which is what a real record
     * looks like and what makes the history worth keeping at all. The first
     * visit is filed as `old` — the reading they arrived with — and the second
     * as `final`, the one a lens was cut from.
     */
    $visits = $i % 4 === 0
        ? [[400, 'old', $rSph + 0.25, $lSph + 0.25]]
        : [[400, 'old', $rSph + 0.25, $lSph + 0.25], [mt_rand(10, 120), 'final', $rSph, $lSph]];

    foreach ($visits as [$ago, $kind, $r, $l]) {
        $signed = static fn(float $n): string => ($n > 0 ? '+' : ($n < 0 ? '-' : ''))
            . number_format(abs($n), 2, '.', '');

        Db::run(
            'INSERT INTO prescriptions
               (customer_id, kind, test_date, r_sphere, r_cylinder, r_axis, r_add, r_pd,
                l_sphere, l_cylinder, l_axis, l_add, l_pd, pd_total, performed_by, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $customerId, $kind, $day($ago) . ' 14:00:00',
                $signed($r), '-0.50', '180', $add, '32',
                $signed($l), '-0.50', '175', $add, '32', '64',
                3, // โอ๊ต — employees.id, not admins.id
                $kind === 'old' ? 'ค่าจากแว่นเดิมที่ใส่มา' : 'วัดใหม่ ตัดเลนส์ตามค่านี้',
            ],
        );
        $rx++;
    }
}
say('ลูกค้า ' . count($people) . " คน · ประวัติค่าสายตา {$rx} ครั้ง");

/* ------------------------------------------------------- the shop floor */

/**
 * The other system's tables, filled in so the demo is one shop rather than two.
 *
 * These belong to the front-desk system, not to this module — no foreign key
 * crosses between them, and nothing here is written by any service in `src/`.
 * They are seeded anyway because a tester who opens the front desk and finds
 * ten customers with no visits, no orders and no money against their names
 * learns the wrong thing about what the shop looks like.
 *
 * Written as plain inserts, and only for the tables that had rows before. A
 * table that was empty stays empty: that is what it looked like, and inventing
 * work for it would be inventing a shop that does not exist. `case_photos` is
 * the one exception on purpose — its rows name image files, and thirty-six rows
 * pointing at pictures that were never uploaded is worse than none.
 */
$employees = array_map(
    static fn(array $e): int => (int) $e['id'],
    Db::all('SELECT id FROM employees ORDER BY id'),
);
$optometrist = $employees[2] ?? $employees[0];   // โอ๊ต
$technician = $employees[3] ?? $employees[0];    // ช่างเอก
$reception = $employees[1] ?? $employees[0];     // แนน

$customers = Db::all('SELECT id, first_name, last_name, phone FROM customers ORDER BY id');
$frames = Db::all(
    "SELECT id, sku, name, brand, attributes, base_selling_price
     FROM products WHERE product_type = 'Frame' ORDER BY id",
);
$rxLenses = Db::all(
    "SELECT id, sku, name, brand, attributes, base_selling_price
     FROM products WHERE product_type = 'Lens' AND is_custom_made = 1 ORDER BY id",
);

/**
 * Where each case has got to.
 *
 * Spread across the pipeline rather than all finished, because the board that
 * front desk works from is a board of things in progress — one that shows
 * eleven completed cases shows nothing about how the shop actually runs.
 */
$flow = [
    ['completed', 118, true],
    ['completed', 96, true],
    ['completed', 74, true],
    ['waiting_pickup', 21, false],
    ['ready_notify', 16, false],
    ['centering', 11, false],
    ['order_confirm', 8, false],
    ['exam', 5, false],
    ['waiting_exam', 2, false],
    ['reception', 0, false],
];

$cases = 0;
$orders = 0;
$paid = 0;
foreach ($customers as $i => $cust) {
    [$status, $ago, $closed] = $flow[$i % count($flow)];
    $opened = $day($ago);

    Db::run(
        'INSERT INTO cases
           (case_code, customer_id, status, is_new_customer, is_rush, received_by,
            recorded_by, opened_at, closed_at, closed_by, case_type, referral_source,
            reception_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            sprintf('CS-2569-%04d', $i + 1), $cust['id'], $status,
            $i % 4 === 0 ? 1 : 0, $i % 7 === 0 ? 1 : 0,
            $reception, $reception,
            $opened . ' 10:30:00',
            $closed ? $day(max(0, $ago - 9)) . ' 16:00:00' : null,
            $closed ? $reception : null,
            $i % 5 === 0 ? 'contact_lens' : 'glasses',
            ['walk_in', 'facebook', 'friend', 'line'][$i % 4],
            $i % 3 === 0 ? 'ลูกค้าเก่ามาวัดสายตาใหม่' : null,
        ],
    );
    $caseId = (int) Db::conn()->lastInsertId();
    $cases++;

    // The prescriptions written earlier belong to a visit; hanging them off the
    // case is what lets the front desk read one from the other.
    Db::run(
        'UPDATE prescriptions SET case_id = ? WHERE customer_id = ? AND kind = ?',
        [$caseId, $cust['id'], 'final'],
    );

    /** The trail the board is drawn from — one row per step actually taken. */
    $trail = [
        [null, 'reception', 'open_case', $ago, 'รับเคสหน้าร้าน'],
        ['reception', 'waiting_exam', 'queue_exam', $ago, 'ส่งต่อห้องวัดสายตา'],
        ['waiting_exam', 'exam', 'start_exam', $ago, 'เริ่มวัดสายตา'],
        ['exam', 'order_confirm', 'save_rx', max(0, $ago - 1), 'บันทึกค่าสายตา'],
        ['order_confirm', 'centering', 'confirm_order', max(0, $ago - 1), 'ยืนยันใบสั่ง'],
        ['centering', 'ready_notify', 'finish_centering', max(0, $ago - 4), 'วัดจุดศูนย์กลางเสร็จ'],
        ['ready_notify', 'waiting_pickup', 'notify_customer', max(0, $ago - 7), 'โทรแจ้งลูกค้ามารับ'],
        ['waiting_pickup', 'completed', 'hand_over', max(0, $ago - 9), 'ส่งมอบแว่น'],
    ];
    $reached = array_search($status, array_column($trail, 1), true);
    $steps = $reached === false ? 1 : $reached + 1;

    foreach (array_slice($trail, 0, $steps) as $n => [$from, $to, $action, $when, $note]) {
        Db::run(
            'INSERT INTO case_events (case_id, from_status, to_status, action, employee_id, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$caseId, $from, $to, $action, $employees[$n % count($employees)], $note,
             $day($when) . ' ' . sprintf('%02d:%02d:00', 10 + $n, ($n * 7) % 60)],
        );
    }

    // Only cases that got as far as confirming an order have one.
    if ($steps < 5) {
        continue;
    }

    $frame = $frames[$i % count($frames)];
    $lens = $rxLenses[$i % count($rxLenses)];
    $frameAttrs = json_decode((string) $frame['attributes'], true) ?: [];
    $lensAttrs = json_decode((string) $lens['attributes'], true) ?: [];

    $framePrice = (float) $frame['base_selling_price'];
    $lensPrice = (float) $lens['base_selling_price'];
    $total = $framePrice + $lensPrice * 2;
    $discount = $i % 3 === 0 ? 500.0 : 0.0;
    $deposit = round(($total - $discount) * 0.5, 2);

    $finalRx = Db::value(
        "SELECT id FROM prescriptions WHERE customer_id = ? AND kind = 'final' ORDER BY id DESC LIMIT 1",
        [$cust['id']],
    );

    Db::run(
        'INSERT INTO custom_orders
           (case_id, invoice_code, customer_id, employee_id, recorded_by, final_prescription_id,
            order_date, appointment_date, lens_type,
            frame_product_id, frame_name, frame_brand, frame_model, frame_color, frame_size, frame_sku,
            lens_product_id, lens_name, lens_brand, lens_design, lens_index, lens_coating,
            total_price, discount, deposit, deposit_pay_type, marketing,
            confirmed_by, confirmed_at, order_closed, order_close_date, order_close_income,
            order_close_pay_type, frame_price, lens_od_price, lens_os_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $caseId, sprintf('INV-2569-%04d', $i + 1), $cust['id'], $reception, $reception,
            $finalRx !== null ? (int) $finalRx : null,
            $day(max(0, $ago - 1)) . ' 15:00:00', $day(max(0, $ago - 8)),
            $lensAttrs['lens_design'] ?? 'Single Vision',
            $frame['id'], $frame['name'], $frame['brand'], $frameAttrs['model'] ?? null,
            $frameAttrs['color'] ?? null, $frameAttrs['size'] ?? null, $frame['sku'],
            $lens['id'], $lens['name'], $lens['brand'],
            $lensAttrs['lens_design'] ?? null, $lensAttrs['lens_index'] ?? null,
            $lensAttrs['coating'] ?? null,
            number_format($total, 2, '.', ''), number_format($discount, 2, '.', ''),
            number_format($deposit, 2, '.', ''), 'Cash',
            ['walk_in', 'facebook', 'friend', 'line'][$i % 4],
            $reception, $day(max(0, $ago - 1)) . ' 15:10:00',
            $closed ? 1 : 0,
            $closed ? $day(max(0, $ago - 9)) . ' 16:00:00' : null,
            $closed ? number_format($total - $discount, 2, '.', '') : null,
            $closed ? 'Transfer' : null,
            number_format($framePrice, 2, '.', ''),
            number_format($lensPrice, 2, '.', ''),
            number_format($lensPrice, 2, '.', ''),
        ],
    );
    $orderId = (int) Db::conn()->lastInsertId();
    $orders++;

    // Half up front, the rest on pickup — the way the shop actually takes money.
    Db::run(
        'INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, paid_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$caseId, $orderId, 'deposit', 'Cash', number_format($deposit, 2, '.', ''),
         $reception, $day(max(0, $ago - 1)) . ' 15:12:00', 'payment'],
    );
    $paid++;

    if ($closed) {
        Db::run(
            'INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, paid_at, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$caseId, $orderId, 'final', 'Transfer',
             number_format($total - $discount - $deposit, 2, '.', ''),
             $reception, $day(max(0, $ago - 9)) . ' 15:55:00', 'delivery'],
        );
        $paid++;

        Db::run(
            'INSERT INTO case_deliveries
               (case_id, order_id, delivered_at, handed_over_by, received_by_customer_name, note)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$caseId, $orderId, $day(max(0, $ago - 9)) . ' 16:00:00', $reception,
             $cust['first_name'] . ' ' . $cust['last_name'], 'ลูกค้ามารับเอง ลองใส่แล้วพอดี'],
        );
    }

    // Centering and fitting happen once the frame is chosen, so they exist for
    // every case that got past the order.
    if ($steps >= 6) {
        Db::run(
            'INSERT INTO centerings
               (case_id, order_id, frame_product_id, r_pd, l_pd, pd_total, r_height, l_height,
                vertex_distance, pantoscopic_tilt, performed_by, recorded_by, measured_at, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$caseId, $orderId, $frame['id'], '32', '32', '64', '22', '22', '12', '8',
             $optometrist, $reception, $day(max(0, $ago - 4)) . ' 11:00:00', 'วัดจากกรอบจริง'],
        );

        Db::run(
            'INSERT INTO frame_fittings
               (case_id, order_id, frame_size, lens_width, bridge_width, temple_length,
                r_pd, l_pd, r_height, l_height, performed_by, recorded_by, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$caseId, $orderId, $frameAttrs['size'] ?? null, '50', '22', '150',
             '32', '32', '22', '22', $technician, $reception, 'ดัดขาแว่นให้แนบขมับ'],
        );
    }
}
say("เคสหน้าร้าน {$cases} เคส · ใบสั่งตัด {$orders} ใบ · รับเงิน {$paid} ครั้ง");

/* ------------------------------------------------------------- bookings */

$bookings = 0;
foreach ($customers as $i => $cust) {
    // Some in the past and kept, some still ahead — an appointment book with
    // nothing in the future is a book nobody would open.
    $ago = [30, 18, 9, 3, -2, -5, -9, -14][$i % 8];
    $status = $ago > 0 ? ($i % 5 === 0 ? 'cancelled' : 'arrived') : 'booked';

    Db::run(
        'INSERT INTO bookings
           (booking_code, customer_id, first_name, last_name, phone, booking_date, booking_time,
            duration_min, service_type, channel, status, assigned_to, confirmed_at, arrived_at,
            cancelled_reason, created_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            sprintf('BK-2569-%04d', $i + 1), $cust['id'],
            $cust['first_name'], $cust['last_name'], $cust['phone'],
            $day($ago), sprintf('%02d:%02d:00', 10 + ($i % 7), ($i % 2) * 30),
            $i % 3 === 0 ? 45 : 30,
            ['eye_exam', 'pickup', 'contact_lens_fit', 'frame_adjust'][$i % 4],
            ['phone', 'line', 'walk_in', 'facebook'][$i % 4],
            $status, $optometrist,
            $day(max(0, $ago) + 1) . ' 09:00:00',
            $status === 'arrived' ? $day($ago) . ' 10:05:00' : null,
            $status === 'cancelled' ? 'ลูกค้าติดธุระ ขอเลื่อน' : null,
            $reception,
            $ago < 0 ? 'นัดวัดสายตาประจำปี' : null,
        ],
    );
    $bookingId = (int) Db::conn()->lastInsertId();
    $bookings++;

    // The reminder that went out for it, and whether it landed.
    foreach ([['line', true], ['telegram', $i % 6 !== 0]] as [$channel, $ok]) {
        Db::run(
            'INSERT INTO notification_log (channel, kind, booking_id, target, message, ok, error, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $channel, 'booking_reminder', $bookingId, $cust['phone'],
                "แจ้งเตือนนัด {$cust['first_name']} วันที่ " . $day($ago),
                $ok ? 1 : 0,
                $ok ? null : 'ส่งไม่สำเร็จ — ปลายทางปิดรับข้อความ',
                $day(max(0, $ago) + 1) . ' 09:00:00',
            ],
        );
    }
}
say("นัดหมาย {$bookings} รายการ · แจ้งเตือน " . ($bookings * 2) . ' ครั้ง');

/* ------------------------------------------- over-the-counter and books */

/** Things sold off the shelf with no case behind them — a cloth, a solution. */
$counter = Db::all(
    "SELECT id, base_selling_price FROM products WHERE product_type = 'Accessory' ORDER BY id",
);
$sales = 0;
foreach ($counter as $n => $item) {
    Db::run(
        'INSERT INTO sales (invoice_code, sale_date, customer_id, employee_id, price, discount, pay_type, marketing, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            sprintf('SL-2569-%04d', $n + 1), $day(20 - $n * 5) . ' 14:20:00',
            $customers[$n % count($customers)]['id'], $reception,
            $item['base_selling_price'], '0.00',
            ['Cash', 'Transfer', 'Credit'][$n % 3], 'walk_in', 'ขายหน้าร้าน ไม่มีเคส',
        ],
    );
    $sales++;
}

foreach ([
    [26, 'ค่าเช่าร้าน', '35000.00', 'Transfer'],
    [12, 'ค่าน้ำค่าไฟ', '4200.00', 'Cash'],
    [4, 'ค่าส่งของให้สาขา', '850.00', 'Cash'],
] as [$ago, $type, $amount, $pay]) {
    Db::run(
        'INSERT INTO expenses (cf_date, expense_type, branch, amount, pay_type, notes)
         VALUES (?, ?, ?, ?, ?, ?)',
        [$day($ago), $type, 'สำนักงานใหญ่', $amount, $pay, null],
    );
}

foreach ([
    [18, 'รับเงินจากสาขา', '12800.00'],
    [6, 'ขายหน้าร้าน', '5400.00'],
] as [$ago, $type, $amount]) {
    Db::run(
        'INSERT INTO incomes (cf_date, income_type, branch, amount, notes) VALUES (?, ?, ?, ?, ?)',
        [$day($ago), $type, 'สำนักงานใหญ่', $amount, null],
    );
}
say("ขายหน้าร้าน {$sales} รายการ · รายรับ 2 · รายจ่าย 3");

/* -------------------------------------------------------- where it sits */

/**
 * Which drawer a thing is in, keyed by the product's name.
 *
 * The front desk keeps this by name rather than by id, which is exactly why the
 * composed names matter: a name that two products share is a drawer label that
 * points at two drawers.
 */
$shelves = ['ลิ้นชัก A1', 'ลิ้นชัก A2', 'ลิ้นชัก B1', 'ลิ้นชัก B2', 'ตู้โชว์หน้าร้าน', 'ชั้นวาง C', 'ตู้เก็บของหลังร้าน'];
$located = 0;
foreach (Db::all("SELECT name FROM products WHERE is_custom_made = 0 ORDER BY id LIMIT 8") as $n => $p) {
    Db::run(
        'INSERT INTO product_locations (product_name, location) VALUES (?, ?)',
        [$p['name'], $shelves[$n % count($shelves)]],
    );
    $located++;
}
say("ตำแหน่งเก็บของ {$located} รายการ");

/* ---------------------------------------------------------------- check */

// `remaining_qty` is selected as well as grouped by: HAVING can only read what
// the select list carries, and MariaDB refuses the column otherwise.
$broken = Db::all(
    'SELECT l.lot_number, l.remaining_qty, COALESCE(SUM(g.quantity), 0) AS ledger
     FROM stock_lots l
     LEFT JOIN inventory_logs g ON g.lot_id = l.id
     GROUP BY l.id, l.lot_number, l.remaining_qty
     HAVING l.remaining_qty <> ledger',
);

say('');
if ($broken !== []) {
    // The one thing that must never be true. Said loudly rather than returned
    // quietly, because a demo built on a broken ledger teaches the wrong shape.
    fwrite(STDERR, 'ผิดพลาด — ล็อตที่ยอดคงเหลือไม่ตรงกับบัญชี: '
        . implode(', ', array_column($broken, 'lot_number')) . "\n");
    exit(1);
}

printf(
    "เสร็จแล้ว · สินค้า %d · ล็อต %d · ความเคลื่อนไหว %d · สาขา %d · ลูกค้า %d\n",
    (int) Db::value('SELECT COUNT(*) FROM products'),
    (int) Db::value('SELECT COUNT(*) FROM stock_lots'),
    (int) Db::value('SELECT COUNT(*) FROM inventory_logs'),
    (int) Db::value('SELECT COUNT(*) FROM branches'),
    (int) Db::value('SELECT COUNT(*) FROM customers'),
);
say('ยอดคงเหลือทุกล็อตตรงกับบัญชี');
