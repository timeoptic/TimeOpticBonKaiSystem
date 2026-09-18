<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;

/**
 * ช่องค้นหาสินค้าของระบบคลัง — ค้นแบบเดียวกับช่องค้นหาสินค้าของหน้าขายหน้าบ้าน
 *
 * เดิมคำที่พิมพ์ทั้งช่องถูกส่งไป `LIKE '%…%'` ก้อนเดียว "MC 1.6" จึงไม่เจออะไรเลย
 * เพราะชื่อจริงคือ "Autograph MC Single Vision (1.60)" · ตอนนี้ตัดเป็นคำ ต้องเจอครบ
 * ทุกคำ แต่ละคำเจอที่คอลัมน์ไหนก็ได้ แล้วเรียงตัวที่ตรงที่สุดขึ้นก่อน — กติกาเดียวกับ
 * `api/core/StockSearch.php` ของหน้าบ้าน
 *
 * ทุกเคสสร้างสินค้าของตัวเองใต้แบรนด์สุ่ม และค้นด้วยแบรนด์นั้นนำหน้าเสมอ แคตตาล็อก
 * จริงจึงไม่ปนเข้ามาในผล · ทุกอย่างอยู่ใน transaction ที่ roll back
 */

group('ค้นหาสินค้าแบบหน้าบ้าน');

/** แบรนด์สุ่มที่ไม่ชนกับของจริง — ขึ้นต้นด้วยตัวอักษร จะได้ไม่ถูกอ่านเป็นตัวเลข */
function psBrand(): string
{
    return 'ZQ' . strtoupper(bin2hex(random_bytes(3)));
}

/** เลนส์หนึ่งรุ่น ชื่อขึ้นต้นด้วยแบรนด์ · คืน id */
function psLens(string $brand, string $name, array $attrs = []): int
{
    Db::run(
        'INSERT INTO products (sku, category_id, product_type, name, brand, base_selling_price, attributes)
         VALUES (?,?,?,?,?,?,?)',
        [
            'PS-' . strtoupper(bin2hex(random_bytes(4))),
            (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'"),
            'Lens',
            "{$brand} {$name}",
            $brand,
            '1000.00',
            json_encode($attrs + ['lens_design' => 'Single Vision'], JSON_UNESCAPED_UNICODE),
        ],
    );
    return (int) Db::value('SELECT LAST_INSERT_ID()');
}

/** @return list<string> ชื่อสินค้าตามลำดับที่หน้าจอได้ */
function psNames(array $filter): array
{
    return array_map(static fn(array $r): string => (string) $r['name'], Inventory::products($filter)['rows']);
}

test('คำที่อยู่ห่างกันในชื่อก็ยังเจอ — ไม่ต้องพิมพ์ให้ติดกันเหมือนชื่อเต็ม', function () {
    withRollback(function () {
        $b = psBrand();
        psLens($b, 'Autograph MC Single Vision (1.60)', ['lens_index' => '1.60']);

        eq(psNames(['q' => "{$b} MC 1.6"]), ["{$b} Autograph MC Single Vision (1.60)"], 'MC กับ 1.6 ห่างกันสี่คำ');
    });
});

test('แต่ละคำเจอที่คอลัมน์ไหนก็ได้ — coating ที่ไม่ได้อยู่ในชื่อ', function () {
    withRollback(function () {
        $b = psBrand();
        psLens($b, 'Single Vision 1.60', ['coating' => 'Crizal Sapphire', 'lens_index' => '1.60']);

        eq(psNames(['q' => "{$b} sapphire"]), ["{$b} Single Vision 1.60"], 'คำที่อยู่แค่ใน coating');
    });
});

test('ต้องเจอครบทุกคำ — สินค้าที่ขาดคำใดคำหนึ่งไม่ขึ้น', function () {
    withRollback(function () {
        $b = psBrand();
        psLens($b, 'G Blue 1.50', ['lens_index' => '1.50']);
        psLens($b, 'Clear 1.50', ['lens_index' => '1.50']);

        eq(psNames(['q' => "{$b} blue"]), ["{$b} G Blue 1.50"], 'Clear ไม่มีคำว่า blue');
    });
});

test('ตัวเลขทศนิยมเทียบเป็นค่า — 1.6 เจอ 1.60 แต่ไม่เจอ 1.67', function () {
    withRollback(function () {
        $b = psBrand();
        psLens($b, 'Single Vision (1.60)', ['lens_index' => '1.60']);
        psLens($b, 'Single Vision (1.67)', ['lens_index' => '1.67']);

        eq(psNames(['q' => "{$b} 1.6"]), ["{$b} Single Vision (1.60)"], '1.67 เป็นเลนส์คนละตัว');
    });
});

test('ตัวที่ตรงคำค้นที่สุดขึ้นก่อน — G Blue ก่อน G Auto-Blue ทั้งที่เรียงตามชื่อแล้ว Auto มาก่อน', function () {
    withRollback(function () {
        $b = psBrand();
        psLens($b, 'G Blue 1.50', ['lens_index' => '1.50']);
        psLens($b, 'G Auto-Blue 1.50', ['lens_index' => '1.50']);
        $want = ["{$b} G Blue 1.50", "{$b} G Auto-Blue 1.50"];

        eq(psNames(['q' => "{$b} G Blue 1.5"]), $want, 'ไม่ได้ส่งการเรียงมา');
        eq(psNames(['q' => "{$b} G Blue 1.5", 'sort' => 'match']), $want, 'ขอเรียงตามความตรง');
    });
});

test('กดเรียงตามคอลัมน์เองแล้ว ได้ลำดับตามคอลัมน์นั้น', function () {
    withRollback(function () {
        $b = psBrand();
        psLens($b, 'G Blue 1.50', ['lens_index' => '1.50']);
        psLens($b, 'G Auto-Blue 1.50', ['lens_index' => '1.50']);

        eq(
            psNames(['q' => "{$b} G Blue", 'sort' => 'name', 'dir' => 'asc']),
            ["{$b} G Auto-Blue 1.50", "{$b} G Blue 1.50"],
            'เรียงตามชื่อ ก → ฮ',
        );
    });
});

test('ไม่มีตัวไหนตรงครบทุกคำ — ขึ้นตัวที่ตรงบางคำแทนรายการว่าง', function () {
    withRollback(function () {
        $b = psBrand();
        psLens($b, 'G Blue 1.50', ['lens_index' => '1.50']);

        $names = psNames(['q' => "{$b} Sapphire"]);
        ok(in_array("{$b} G Blue 1.50", $names, true), 'ตรงแค่แบรนด์ก็ยังขึ้น — ได้ ' . render($names));
    });
});

test('แบ่งหน้าหลังเรียงความตรง — หน้าสองต่อจากหน้าหนึ่ง ไม่ซ้ำไม่ข้าม', function () {
    withRollback(function () {
        $b = psBrand();
        for ($i = 1; $i <= 6; $i++) {
            psLens($b, "Blue Model {$i}");
        }

        $one = Inventory::products(['q' => "{$b} blue", 'per' => 5, 'page' => 1]);
        $two = Inventory::products(['q' => "{$b} blue", 'per' => 5, 'page' => 2]);

        eq($one['total'], 6, 'นับครบทุกตัวที่ตรง');
        eq(count($one['rows']), 5, 'หน้าหนึ่ง');
        eq(count($two['rows']), 1, 'หน้าสอง');
        $ids = array_merge(array_column($one['rows'], 'id'), array_column($two['rows'], 'id'));
        eq(count(array_unique($ids)), 6, 'สองหน้ารวมกันได้ครบหกตัวไม่ซ้ำ');
    });
});

test('ชิปสถานะนับจากชุดเดียวกับรายการ — ตอนถอยไปตรงบางคำด้วย', function () {
    withRollback(function () {
        $b = psBrand();
        psLens($b, 'G Blue 1.50', ['lens_index' => '1.50']);

        $filter = ['q' => "{$b} Sapphire"];
        $total = Inventory::products($filter)['total'];
        ok($total > 0, 'รายการถอยไปตรงบางคำ');
        eq(Inventory::stockStateCounts($filter)['all'] ?? null, $total, 'ชิป "ทั้งหมด" เท่ากับรายการ');
    });
});

test('ตัวกรองเลนส์นับจากชุดเดียวกับรายการ — ตอนถอยไปตรงบางคำด้วย', function () {
    withRollback(function () {
        $b = psBrand();
        psLens($b, 'G Blue 1.50', ['lens_index' => '1.50']);

        $indexes = array_column(Inventory::lensOptions(['q' => "{$b} Sapphire"])['indexes'], 'value');
        ok(in_array('1.50', $indexes, true), 'index ของเลนส์ที่ขึ้นในรายการมีให้เลือก — ได้ ' . render($indexes));
    });
});
