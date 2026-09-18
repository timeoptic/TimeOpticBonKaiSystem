<?php

declare(strict_types=1);

/**
 * ค้นเลนส์แบบตัดคำแล้วจัดอันดับ — `stockSearchTokens()` · `stockSearch()` · `stockSearchRank()`
 *
 * เรื่องจริงวันที่ 2026-09-11: คนขายพิมพ์ "G Blue 1.5" แล้วทั้งหน้าจอเป็น G Auto-Blue
 * ทั้งที่ G Blue มีอยู่ 540 รุ่น — ผลที่ตรงทุกคำถูกเรียงตามชื่อ ("Auto" มาก่อน "Blue")
 * แล้วตัดเหลือ 30 แถว ตัวที่ใกล้คำค้นที่สุดจึงตกขอบไปทั้งหมด
 *
 * ชื่อสินค้าในชุดทดสอบลอกรูปแบบจากแคตตาล็อกจริงบนโฮสต์ ไม่ได้แต่งขึ้น
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('ค้นเลนส์แบบตัดคำและจัดอันดับ');

/** เลนส์หนึ่งรุ่นพร้อมล็อตที่มีของ */
function rankLens(Tx $q, string $sku, string $name, string $coating, string $index, string $brand = 'G'): void
{
    $id = $q->run(
        'INSERT INTO products (sku, category_id, product_type, name, brand, base_selling_price, attributes)
         VALUES (?,?,?,?,?,?,?)',
        $sku,
        31,
        'Lens',
        $name,
        $brand,
        '1000.00',
        json_encode(['coating' => $coating, 'lens_design' => 'Single Vision', 'lens_index' => $index])
    )['insertId'];

    $q->run(
        'INSERT INTO stock_lots (lot_number, product_id, initial_qty, remaining_qty, received_date)
         VALUES (?,?,?,?,CURDATE())',
        'LOT-' . $sku,
        $id,
        3,
        3
    );
}

function rankCatalogue(Tx $q): void
{
    rankLens($q, 'TRK-GB-1', 'G Blue Single Vision (1.50) -0.25/-0.25', 'Blue', '1.50');
    rankLens($q, 'TRK-GB-2', 'G Blue Single Vision (1.50) -0.25/-0.50', 'Blue', '1.50');
    rankLens($q, 'TRK-GB-156', 'G Blue Single Vision (1.56) +2.50/0.00', 'Blue', '1.56');
    rankLens($q, 'TRK-GB-160', 'G Blue Single Vision (1.60) -0.25/-0.25', 'Blue', '1.60');
    rankLens($q, 'TRK-GAB-1', 'G Auto-Blue Single Vision (1.50) -0.25/-0.25', 'Auto-Blue', '1.50');
    rankLens($q, 'TRK-GA-1', 'G Auto Single Vision (1.50) -0.25/-0.25', 'Auto', '1.50');
    rankLens($q, 'TRK-HOYA', 'HOYA SL Blue Single Vision (1.50) -0.25/-0.25', 'Blue', '1.50', 'HOYA');
}

/** SKU ตามลำดับที่หน้าขายจะเห็น — จำกัดเฉพาะของทดสอบ */
function ranked(Tx $q, string $term, bool $any = false): array
{
    [$sql, $args] = stockSearch($term, $any);
    $where = $sql === '' ? '' : " AND ($sql)";
    $rows = $q->all("SELECT s.* FROM v_stock_lot s WHERE s.sku LIKE 'TRK-%'$where", ...$args);
    return array_column(stockSearchRank($rows, $term), 'sku');
}

/** เซตของ SKU ที่เจอ ไม่สนลำดับ */
function rankedSet(Tx $q, string $term): array
{
    $skus = ranked($q, $term);
    sort($skus);
    return $skus;
}

test('ตัดคำด้วยช่องว่างและ / — ค่าสายตา -0.25/-0.50 คือสองคำ', function () {
    eq(stockSearchTokens('  G  Blue 1.5 '), ['G', 'Blue', '1.5'], 'ช่องว่างซ้อน');
    eq(stockSearchTokens('-0.25/-0.50'), ['-0.25', '-0.50'], 'ค่าสายตาคู่');
    eq(stockSearchTokens('(1.50)'), ['1.50'], 'วงเล็บที่ลอกมาจากชื่อ');
    eq(stockSearchTokens('LNS-0748'), ['LNS-0748'], 'SKU มีขีดไม่ถูกตัด');
    eq(stockSearchTokens('   '), [], 'ว่าง');
});

test('"G Blue 1.5" — G Blue ขึ้นก่อน G Auto-Blue และไม่บังคับคำที่ไม่ได้พิมพ์', function () {
    rollback(function (Tx $q) {
        rankCatalogue($q);
        eq(
            ranked($q, 'G Blue 1.5'),
            ['TRK-GB-1', 'TRK-GB-2', 'TRK-GAB-1', 'TRK-HOYA'],
            'G Blue 1.5'
        );
    });
});

test('พิมพ์ Auto มาเอง ถึงจะกรองให้ต้องมี Auto', function () {
    rollback(function (Tx $q) {
        rankCatalogue($q);
        eq(ranked($q, 'G Auto Blue 1.5'), ['TRK-GAB-1'], 'G Auto Blue 1.5');
        eq(ranked($q, 'G Auto-Blue 1.5'), ['TRK-GAB-1'], 'G Auto-Blue 1.5');
    });
});

test('1.5 = 1.50 แต่ไม่ใช่ 1.56 · 1.6 = 1.60', function () {
    rollback(function (Tx $q) {
        rankCatalogue($q);
        $i150 = ['TRK-GA-1', 'TRK-GAB-1', 'TRK-GB-1', 'TRK-GB-2', 'TRK-HOYA'];
        eq(rankedSet($q, '1.5'), $i150, '1.5');
        eq(rankedSet($q, '1.50'), $i150, '1.50');
        eq(rankedSet($q, '1.56'), ['TRK-GB-156'], '1.56');
        eq(rankedSet($q, '1.6'), ['TRK-GB-160'], '1.6');
    });
});

test('ค่าสายตา — เลขทศนิยมเติมศูนย์ได้ เครื่องหมายที่พิมพ์มาต้องตรง', function () {
    rollback(function (Tx $q) {
        rankCatalogue($q);
        eq(ranked($q, '-0.25/-0.50'), ['TRK-GB-2'], '-0.25/-0.50');
        eq(ranked($q, 'blue 2.5'), ['TRK-GB-156'], '2.5 ไม่มีเครื่องหมาย = +2.50 ก็ได้');
        eq(ranked($q, '+2.50'), ['TRK-GB-156'], '+2.50');
        eq(ranked($q, '-2.5'), [], '-2.5 ไม่ใช่ +2.50');
    });
});

test('คำบางส่วนยังค้นเจอ แต่อยู่หลังคำที่ตรงเต็มคำ', function () {
    rollback(function (Tx $q) {
        rankCatalogue($q);
        eq(rankedSet($q, 'blu 1.5'), ['TRK-GAB-1', 'TRK-GB-1', 'TRK-GB-2', 'TRK-HOYA'], 'blu 1.5');
        eq(count(ranked($q, 'singl')), 7, 'singl');
        /* "G" ใน HOYA เจอแค่เป็นส่วนหนึ่งของ "Single" — ยังอยู่ในผล แต่ท้ายสุด */
        $r = ranked($q, 'G Blue 1.5');
        eq(end($r), 'TRK-HOYA', 'G ที่เจอแค่ใน Single อยู่ท้าย');
    });
});

test('SKU ตรงทั้งตัวขึ้นแถวแรก SKU บางส่วนก็ค้นได้', function () {
    rollback(function (Tx $q) {
        rankCatalogue($q);
        $r = ranked($q, 'TRK-GB-1');
        eq($r[0], 'TRK-GB-1', 'SKU เต็ม');
        ok(count($r) === 3, 'TRK-GB-1 เป็นส่วนหนึ่งของ TRK-GB-156 / TRK-GB-160 ด้วย');
        eq(rankedSet($q, 'gab'), ['TRK-GAB-1'], 'SKU บางส่วน');
    });
});

test('ชื่อที่พิมพ์มาเต็ม ๆ ขึ้นแถวแรก', function () {
    rollback(function (Tx $q) {
        rankCatalogue($q);
        eq(ranked($q, 'G Blue Single Vision (1.50) -0.25/-0.50')[0], 'TRK-GB-2', 'ชื่อเต็ม');
    });
});

test('ไม่มีตัวไหนตรงครบทุกคำ — ถอยไปเอาตัวที่ตรงบางคำ เรียงตามจำนวนคำที่ตรง', function () {
    rollback(function (Tx $q) {
        rankCatalogue($q);
        eq(ranked($q, 'G Blue zzzz'), [], 'โหมดปกติต้องครบทุกคำ');
        $r = ranked($q, 'G Blue zzzz', true);
        eq($r[0], 'TRK-GB-1', 'ตรงสองคำและติดกันในชื่อขึ้นก่อน');
        ok(array_search('TRK-GA-1', $r, true) > array_search('TRK-GAB-1', $r, true), 'G Auto ตรงคำเดียว อยู่หลัง G Auto-Blue');
    });
});

test('ไม่มีคำค้น — ไม่เรียงใหม่ ปล่อยลำดับเดิม', function () {
    $rows = [['product_name' => 'B', 'sku' => '2'], ['product_name' => 'A', 'sku' => '1']];
    eq(array_column(stockSearchRank($rows, ''), 'sku'), ['2', '1'], 'คำค้นว่าง');
});
