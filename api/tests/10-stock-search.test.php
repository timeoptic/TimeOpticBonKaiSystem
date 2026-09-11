<?php

declare(strict_types=1);

/**
 * ช่องค้นหาสินค้าในหน้าขาย — `GET /api/stock?q=`
 *
 * โจทย์ที่ทำให้ต้องมีไฟล์นี้: คนขายพิมพ์ "MC 1.6" ซึ่งเป็นวิธีที่คนในร้านเรียก
 * เลนส์จริง ๆ แต่ชื่อสินค้าในฐานคือ "Hitop Autograph MC Single Vision (1.60)"
 * — "MC" กับ "1.60" อยู่คนละที่ในสตริง การค้นทั้งก้อนด้วย LIKE จึงได้ศูนย์แถว
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน
 * harness.php) เพราะชุดนี้รันบนฐานเดียวกับที่ร้านใช้อยู่จริง
 */

group('ค้นหาสินค้าในหน้าขาย');

const T_LENS  = 31; // categories.code = 'Lens'
const T_FRAME = 32; // categories.code = 'Frame'

/** สินค้าหนึ่งชิ้นพร้อมล็อตที่ยังมีของ — เท่าที่ v_stock_lot ต้องใช้ */
function fixture(Tx $q, string $sku, int $cat, string $type, string $name, ?string $brand, array $attrs): void
{
    $id = $q->run(
        'INSERT INTO products (sku, category_id, product_type, name, brand, base_selling_price, attributes)
         VALUES (?,?,?,?,?,?,?)',
        $sku,
        $cat,
        $type,
        $name,
        $brand,
        '1000.00',
        json_encode($attrs, JSON_UNESCAPED_UNICODE)
    )['insertId'];

    $q->run(
        'INSERT INTO stock_lots (lot_number, product_id, initial_qty, remaining_qty, received_date)
         VALUES (?,?,?,?,CURDATE())',
        'LOT-' . $sku,
        $id,
        5,
        5
    );
}

/** แคตตาล็อกจำลอง — ตั้งใจให้มีทั้ง MC และ MultiCoat และมี 1.67 ไว้ดักคำค้น "1.6" */
function catalogue(Tx $q): void
{
    fixture($q, 'TST-MC160', T_LENS, 'Lens', 'Hitop Autograph MC Single Vision (1.60) -0.25/-0.25', 'Hitop',
        ['coating' => 'MC', 'lens_index' => '1.60', 'lens_design' => 'Single Vision']);
    fixture($q, 'TST-MUL156', T_LENS, 'Lens', 'Lens G hohoho MultiCoat (1.56) -0.50/-2.75', 'Lens G',
        ['coating' => 'MultiCoat', 'lens_index' => '1.56', 'lens_design' => 'Single Vision']);
    fixture($q, 'TST-BLU160', T_LENS, 'Lens', 'Lens G testing Blue (1.60) +7.00/-6.00', 'Lens G',
        ['coating' => 'Blue', 'lens_index' => '1.60', 'lens_design' => 'Bifocal']);
    fixture($q, 'TST-MUL150', T_LENS, 'Lens', 'Tokai Lutina', 'Tokai',
        ['coating' => 'MultiCoat', 'lens_index' => '1.50', 'lens_design' => 'Sport']);
    fixture($q, 'TST-TRA167', T_LENS, 'Lens', 'Essilor Varilux X', 'Essilor',
        ['coating' => 'Transition', 'lens_index' => '1.67', 'lens_design' => 'Progressive']);
    fixture($q, 'TST-FRAME', T_FRAME, 'Frame', 'Aviator Classic', 'Ray-Ban',
        ['model' => 'RB3025', 'color' => 'Black', 'size' => '58']);
}

/** SKU ที่คำค้นนี้หาเจอ เรียงแล้ว — จำกัดเฉพาะของทดสอบ ไม่ปนของจริงในร้าน */
function found(Tx $q, string $term): array
{
    [$sql, $args] = stockSearch($term);
    $where = $sql === '' ? '' : " AND ($sql)";
    $rows = $q->all(
        "SELECT s.sku FROM v_stock_lot s WHERE s.sku LIKE 'TST-%'$where ORDER BY s.sku",
        ...$args
    );
    return array_values(array_unique(array_column($rows, 'sku')));
}

test('"MC 1.6" หาเลนส์ MC index 1.60 เจอ — คำค้นสองคำที่อยู่คนละที่ในชื่อ', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(found($q, 'MC 1.6'), ['TST-MC160'], 'MC 1.6');
    });
});

test('"1.6" ไม่ลาก 1.67 มาด้วย — 1.6 กับ 1.67 คนละเลนส์', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(found($q, '1.6'), ['TST-BLU160', 'TST-MC160'], '1.6');
    });
});

test('"1.5" คือ 1.50 เท่านั้น อยากได้ 1.56 ต้องพิมพ์ 1.56', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(found($q, '1.5'), ['TST-MUL150'], '1.5');
        eq(found($q, '1.56'), ['TST-MUL156'], '1.56');
    });
});

test('"MC" หา MultiCoat เจอด้วย — ร้านเขียนสองแบบ คนพิมพ์ตัวย่อ', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(found($q, 'MC'), ['TST-MC160', 'TST-MUL150', 'TST-MUL156'], 'MC');
        eq(found($q, 'multicoat'), ['TST-MC160', 'TST-MUL150', 'TST-MUL156'], 'multicoat');
    });
});

test('"blue 1.6" หาเลนส์ Blue index 1.60 เจอ', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(found($q, 'blue 1.6'), ['TST-BLU160'], 'blue 1.6');
    });
});

test('ทุกคำต้องเจอ ไม่ใช่คำใดคำหนึ่ง', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(found($q, 'blue 1.67'), [], 'blue 1.67 — ไม่มีเลนส์ที่เป็นทั้งสองอย่าง');
        eq(found($q, 'hitop zzzz'), [], 'hitop zzzz — คำที่สองไม่มีในระบบ');
    });
});

test('กรอบก็ค้นด้วยรุ่นกับสีได้ ไม่ใช่แค่เลนส์', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(found($q, 'ray-ban black'), ['TST-FRAME'], 'ray-ban black');
        eq(found($q, 'rb3025'), ['TST-FRAME'], 'rb3025');
    });
});

test('ยังค้นด้วย SKU กับ ยี่ห้อ ได้เหมือนเดิม', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(found($q, 'TST-BLU160'), ['TST-BLU160'], 'SKU เต็ม');
        eq(found($q, 'essilor'), ['TST-TRA167'], 'ยี่ห้อ');
    });
});

test('ยังค้นด้วยเลข id ได้เหมือนเดิม — เลขที่โชว์ท้ายบรรทัดในหน้าขาย', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        $row = $q->get("SELECT id, sku FROM v_stock_lot WHERE sku = 'TST-FRAME'");
        /* เทียบแบบ "ต้องมีอยู่ในผล" ไม่ใช่ "ต้องเป็นผลทั้งหมด" — id เป็นเลขวิ่ง
           ที่จะไปพ้องกับตัวเลขในชื่อสินค้าตัวอื่นเมื่อไหร่ก็ได้ ผูกให้แน่นกว่านี้
           คือเทสต์ที่ตกเองวันหนึ่งโดยที่โค้ดไม่ได้เปลี่ยน */
        ok(in_array($row['sku'], found($q, (string) $row['id']), true), 'ค้นด้วย id แล้วเจอแถวนั้น');
    });
});

test('ค่าสายตาในชื่อสินค้ายังค้นเจอ — ตัวเลขไม่ได้มีแต่ index', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(found($q, '0.25'), ['TST-MC160'], '0.25 — อยู่ในชื่อว่า -0.25/-0.25');
        eq(found($q, '2.75'), ['TST-MUL156'], '2.75');
    });
});

test('คำค้นว่างคือไม่กรอง — รายการยังขึ้นครบตอนยังไม่ได้พิมพ์อะไร', function () {
    rollback(function (Tx $q) {
        catalogue($q);
        eq(count(found($q, '')), 6, 'คำค้นว่าง');
        eq(count(found($q, '   ')), 6, 'คำค้นที่มีแต่ช่องว่าง');
    });
});
