<?php

declare(strict_types=1);

/**
 * ตัวกรองเลนส์ในหน้าขาย — `GET /api/stock?coating=&sph=&cyl=`
 *
 * โจทย์ของร้าน (2026-09-15): พนักงานกรอกค่าสายตาที่วัดได้แล้วต้องเห็นเฉพาะเลนส์ในคลัง
 * ที่ตรงค่าจริง ไม่ใช่ตัวที่ "ใกล้เคียง" · ทุกเงื่อนไขเป็น AND · Coating ตรงตัว
 * (Auto-Blue ไม่ใช่ Auto หรือ Blue) · SPH/CYL เทียบเป็นตัวเลข -2 = -2.00 · 0.25 = +0.25
 *
 * ค่าสายตาในแคตตาล็อกจริงบนโฮสต์เขียนปนกันหลายแบบ ("-2.00" "-2" 1.5 เป็นตัวเลข JSON)
 * ชุดทดสอบจึงตั้งใจเก็บทั้งสามแบบ · ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ
 */

require_once __DIR__ . '/../routes/stock.php';

group('ตัวกรองเลนส์ Coating / SPH / CYL');

/** เลนส์หนึ่งรุ่น · $qty = null คือยังไม่เคยรับของเข้า (ไม่มีล็อต) */
function lensFilterLens(Tx $q, string $sku, string $name, string $coating, mixed $sph, mixed $cyl, ?int $qty = 4): void
{
    $id = $q->run(
        'INSERT INTO products (sku, category_id, product_type, name, brand, base_selling_price, attributes)
         VALUES (?,?,?,?,?,?,?)',
        $sku,
        31,
        'Lens',
        $name,
        'G',
        '1000.00',
        json_encode([
            'coating' => $coating, 'lens_design' => 'Single Vision', 'lens_index' => '1.50',
            'sph' => $sph, 'cyl' => $cyl,
        ])
    )['insertId'];

    if ($qty !== null) {
        $q->run(
            'INSERT INTO stock_lots (lot_number, product_id, initial_qty, remaining_qty, received_date)
             VALUES (?,?,?,?,CURDATE())',
            'LOT-' . $sku,
            $id,
            $qty,
            $qty
        );
    }
}

function lensFilterCatalogue(Tx $q): void
{
    lensFilterLens($q, 'TLF-A-P25-M75', 'G Auto Single Vision (1.50) +0.25/-0.75', 'Auto', '+0.25', '-0.75');
    lensFilterLens($q, 'TLF-A-P25-M50', 'G Auto Single Vision (1.50) +0.25/-0.50', 'Auto', '+0.25', '-0.50');
    lensFilterLens($q, 'TLF-A-P25-M100', 'G Auto Single Vision (1.50) +0.25/-1.00', 'Auto', '+0.25', '-1.00');
    lensFilterLens($q, 'TLF-A-M25-M75', 'G Auto Single Vision (1.50) -0.25/-0.75', 'Auto', '-0.25', '-0.75');
    lensFilterLens($q, 'TLF-B-P25-M75', 'G Blue Single Vision (1.50) +0.25/-0.75', 'Blue', '+0.25', '-0.75');
    lensFilterLens($q, 'TLF-AB-P25-M75', 'G Auto-Blue Single Vision (1.50) +0.25/-0.75', 'Auto-Blue', '+0.25', '-0.75');
    /* sph เก็บเป็นตัวเลขเต็ม -2 แบบที่มีจริงบนโฮสต์ */
    lensFilterLens($q, 'TLF-AB-M200-M75', 'G Auto-Blue Single Vision (1.50) -2.00/-0.75', 'Auto-Blue', -2, '-0.75');
    /* 1.5 กับ 0 เป็นตัวเลข JSON ไม่ใช่ข้อความ */
    lensFilterLens($q, 'TLF-MC-P150-0', 'G MC Single Vision (1.50) +1.50/0.00', 'MC', 1.5, 0);
    /* ยังไม่เคยรับของเข้า — ต้องถูกกรองด้วยกติกาเดียวกัน */
    lensFilterLens($q, 'TLF-H-P25-M75', 'G Hard Single Vision (1.50) +0.25/-0.75', 'Hard', '+0.25', '-0.75', null);
}

/** SKU ที่หน้าขายได้กลับมา เรียงตามตัวอักษร — เฉพาะของทดสอบ */
function lensFiltered(array $query): array
{
    $rows = Router::dispatch('GET', '/api/stock', $query + [
        'type' => 'Lens', 'sold' => '0', 'group' => 'product', 'limit' => '2000',
    ]);
    $skus = array_values(array_filter(
        array_map(fn($r) => (string) $r['sku'], $rows),
        fn($s) => str_starts_with($s, 'TLF-')
    ));
    sort($skus);
    return $skus;
}

test('Coating + SPH + CYL ต้องตรงครบทุกค่า — ตัวที่ต่างแค่ค่าเดียวไม่ขึ้น', function () {
    rollback(function (Tx $q) {
        lensFilterCatalogue($q);
        eq(lensFiltered(['coating' => 'Auto', 'sph' => '+0.25', 'cyl' => '-0.75']), ['TLF-A-P25-M75'], 'Auto +0.25/-0.75');
    });
});

test('Auto-Blue คือ Auto-Blue เท่านั้น — ไม่ใช่ Auto หรือ Blue', function () {
    rollback(function (Tx $q) {
        lensFilterCatalogue($q);
        eq(lensFiltered(['coating' => 'Auto-Blue']), ['TLF-AB-M200-M75', 'TLF-AB-P25-M75'], 'Auto-Blue');
        eq(lensFiltered(['coating' => 'Blue']), ['TLF-B-P25-M75'], 'Blue ไม่ได้ Auto-Blue');
        eq(
            lensFiltered(['coating' => 'Auto']),
            ['TLF-A-M25-M75', 'TLF-A-P25-M100', 'TLF-A-P25-M50', 'TLF-A-P25-M75'],
            'Auto ไม่ได้ Auto-Blue'
        );
    });
});

test('SPH เทียบเป็นตัวเลข: -2 = -2.00 · 0.25 = +0.25 · แต่ +0.25 ไม่ใช่ -0.25', function () {
    rollback(function (Tx $q) {
        lensFilterCatalogue($q);
        eq(lensFiltered(['sph' => '-2']), ['TLF-AB-M200-M75'], 'sph -2');
        eq(lensFiltered(['sph' => '-2.00']), ['TLF-AB-M200-M75'], 'sph -2.00');
        eq(
            lensFiltered(['coating' => 'Auto', 'sph' => '0.25']),
            ['TLF-A-P25-M100', 'TLF-A-P25-M50', 'TLF-A-P25-M75'],
            'sph 0.25 = +0.25 และไม่ได้ -0.25'
        );
        eq(lensFiltered(['sph' => '1.5', 'cyl' => '0']), ['TLF-MC-P150-0'], 'ค่าที่เก็บเป็นตัวเลข JSON');
    });
});

test('CYL -0.50 ไม่ match -0.75', function () {
    rollback(function (Tx $q) {
        lensFilterCatalogue($q);
        eq(lensFiltered(['coating' => 'Auto', 'sph' => '+0.25', 'cyl' => '-0.50']), ['TLF-A-P25-M50'], 'cyl -0.50');
    });
});

test('ช่องที่ว่างไม่เป็นเงื่อนไข · Coating ว่างหรือ "ทั้งหมด" ไม่กรอง Coating', function () {
    rollback(function (Tx $q) {
        lensFilterCatalogue($q);
        eq(
            lensFiltered(['coating' => 'Auto', 'sph' => '+0.25', 'cyl' => '']),
            ['TLF-A-P25-M100', 'TLF-A-P25-M50', 'TLF-A-P25-M75'],
            'CYL ว่าง'
        );
        $all = ['TLF-A-P25-M75', 'TLF-AB-P25-M75', 'TLF-B-P25-M75', 'TLF-H-P25-M75'];
        eq(lensFiltered(['coating' => '', 'sph' => '+0.25', 'cyl' => '-0.75']), $all, 'Coating ว่าง');
        eq(lensFiltered(['coating' => 'all', 'sph' => '+0.25', 'cyl' => '-0.75']), $all, 'Coating ทั้งหมด');
    });
});

test('คำค้นใช้ร่วมกับตัวกรองแบบ AND — และไม่ถอยไปโชว์ตัวที่ตรงบางคำ', function () {
    rollback(function (Tx $q) {
        lensFilterCatalogue($q);
        $f = ['coating' => 'Auto', 'sph' => '+0.25', 'cyl' => '-0.75'];
        eq(lensFiltered($f + ['q' => 'G']), ['TLF-A-P25-M75'], 'Search = G');
        eq(lensFiltered($f + ['q' => 'TLF-B-P25-M75']), [], 'SKU ของตัวที่ Coating ไม่ตรง');
        eq(lensFiltered($f + ['q' => 'G Zeiss']), [], 'ไม่มีตัวไหนตรงครบ ต้องว่าง ไม่ใช่ตรงบางคำ');
    });
});

test('SPH ที่ไม่ใช่ตัวเลขถูกปฏิเสธ ไม่ถูกมองข้ามเงียบ ๆ', function () {
    rollback(function (Tx $q) {
        lensFilterCatalogue($q);
        $status = null;
        try {
            lensFiltered(['sph' => 'abc']);
        } catch (HttpError $e) {
            $status = $e->status;
        }
        eq($status, 400, 'sph=abc');
    });
});
