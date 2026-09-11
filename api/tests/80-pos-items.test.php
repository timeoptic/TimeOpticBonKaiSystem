<?php

declare(strict_types=1);

/**
 * รายการสินค้าหน้าร้าน (POS) — ของที่ขายหน้าเคาน์เตอร์ ไม่ใช่ของในคลัง
 *
 * สเปก: docs/superpowers/specs/2026-09-10-pos-items-own-catalog-design.md
 *
 * เดิม POS อ่านรายการจาก `products` หมวด `Pos*` ซึ่งเป็นตารางกลางที่คลังใช้ด้วย
 * การล้างข้อมูลคลังวันที่ 9 ก.ย. จึงลบรายการ 41 ตัวของหน้าร้านทิ้งไปด้วย แล้วหน้า
 * /pos ก็ค้นอะไรไม่เจออีกเลย · ตั้งแต่ migration 033 รายการอยู่ที่ `pos_items`
 * ตารางเดียว ซึ่งโมดูลคลังไม่อ่าน ไม่นับ และไม่เตือน
 *
 * สามเรื่องที่ไฟล์นี้เฝ้าไว้:
 *
 *   1. **รายการครบและเรียงตามใบที่ร้านให้มา** — 41 ตัว 8 กลุ่ม ลำดับเดียวกับ
 *      `<select>` ของระบบเดิม คนหน้าร้านกวาดตาหาตามลำดับที่จำได้
 *   2. **คลังไม่เห็นของหน้าร้าน** — ไม่มีสินค้าหรือหมวด `Pos*` เหลือในตารางของคลัง
 *   3. **การขายตรวจกับ `pos_items`** — ช่องที่สินค้าบังคับต้องมีค่า และ id ที่ไม่อยู่
 *      ในรายการของหน้าร้านต้องไม่ผ่าน
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('รายการสินค้าหน้าร้าน (POS)');

/** เจ้าของร้านตัวจริงจากฐาน — POS ต้องมีคนล็อกอินที่ใช้หน้าร้านได้ */
function posOwner(): array
{
    $r = Db::get(
        "SELECT a.id, a.username, a.display_name, a.job_title, a.employee_id
           FROM admins a JOIN admin_roles r ON r.admin_id = a.id
          WHERE r.role = 'owner' AND a.is_active = 1 LIMIT 1"
    );
    if (!$r) {
        failTest('ไม่มีบัญชี owner ในฐาน — เทสต์ POS ต้องใช้คนที่ขายหน้าร้านได้');
    }
    $roles = \Optic\Auth::rolesOf((int) $r['id']);
    return [
        'id'          => (int) $r['id'],
        'username'    => $r['username'],
        'displayName' => $r['display_name'],
        'roles'       => $roles,
        'perms'       => \Optic\Roles::permsOf($roles),
        'employeeId'  => $r['employee_id'] === null ? null : (int) $r['employee_id'],
    ];
}

/** ยิงเส้นทางจริงของ POS ในฐานะเจ้าของร้าน */
function posCall(string $method, string $path, array $body = [], array $query = []): mixed
{
    StockModule::boot();
    return \Optic\Auth::as(posOwner(), fn() => Router::dispatch($method, $path, $query, $body));
}

/** @return array{status:?int,msg:string} */
function posCallError(string $method, string $path, array $body = []): array
{
    try {
        posCall($method, $path, $body);
    } catch (HttpError $e) {
        return ['status' => $e->status, 'msg' => $e->getMessage()];
    }
    return ['status' => null, 'msg' => ''];
}

/** id ของรายการหน้าร้านจาก SKU */
function posItemId(Tx $q, string $sku): int
{
    $r = $q->get('SELECT id FROM pos_items WHERE sku = ?', $sku);
    if (!$r) {
        failTest("ไม่มี $sku ใน pos_items");
    }
    return (int) $r['id'];
}

/** ใบขายที่จ่ายครบและรับของแล้ว — ไม่ต้องมีชื่อลูกค้า */
function posPaidSale(array $items, float $total): array
{
    return [
        'items'     => $items,
        'delivered' => true,
        'payment'   => ['amount' => $total, 'method' => 'cash'],
    ];
}

test('ช่องเลือกสินค้าได้ 41 รายการ ตัวแรกคือค่าประกอบแว่น', function () {
    $rows = posCall('GET', '/api/pos/products');

    eq(count($rows), 41, 'จำนวนรายการ');
    eq($rows[0]['sku'], 'SRV-0001', 'SKU ตัวแรก');
    eq($rows[0]['name'], 'ค่าประกอบแว่น', 'ชื่อตัวแรก');
    eq($rows[40]['name'], 'อื่นๆ (พิมพ์เอง)', 'ตัวสุดท้ายคือช่องพิมพ์เอง');
});

test('จัดกลุ่ม 8 กลุ่ม ชื่อและลำดับตรงกับช่องเลือกของระบบเดิม', function () {
    $rows = posCall('GET', '/api/pos/products');

    $groups = [];
    foreach ($rows as $r) {
        if (end($groups) !== $r['category_name']) {
            $groups[] = $r['category_name'];
        }
    }
    eq($groups, [
        'บริการ/อะไหล่แว่น',
        'อุปกรณ์ทำความสะอาด/ดูแล',
        'คอนแทคเลนส์ Bausch & Lomb',
        'คอนแทคเลนส์ Maxim',
        'คอนแทคเลนส์ Acuvue',
        'คอนแทคเลนส์ Alcon',
        'แว่นตา/กล่อง',
        'อื่นๆ',
    ], 'กลุ่มตามลำดับ (กลุ่มเดียวกันต้องติดกัน ไม่งั้นหัวกลุ่มโผล่ซ้ำ)');
});

/* หน้าเว็บ (ProductPicker / cart.js / CartItemRow) ไม่ถูกแก้ — API ต้องคืนคีย์เดิมครบ */
test('แต่ละแถวมีคีย์ครบตามที่หน้าเว็บใช้', function () {
    $rows = posCall('GET', '/api/pos/products');
    $bySku = array_column($rows, null, 'sku');

    foreach (['id', 'sku', 'name', 'brand', 'product_type', 'base_selling_price',
              'category_code', 'category_name', 'pos_fields', 'pos_custom'] as $k) {
        ok(array_key_exists($k, $rows[0]), "ต้องมีคีย์ $k");
    }
    eq($bySku['CTM-0004']['pos_fields'], [
        ['key' => 'power', 'label' => 'ค่าสายตา', 'required' => true],
        ['key' => 'color', 'label' => 'สี', 'required' => true],
    ], 'Maxim color ถามค่าสายตากับสี');
    eq($bySku['SRV-0001']['pos_fields'], [], 'ค่าประกอบแว่นไม่มีช่องกรอกเพิ่ม');
    eq($bySku['CST-0001']['pos_custom'], true, 'ช่องพิมพ์เองติดธง custom');
    eq($bySku['SRV-0001']['pos_custom'], false, 'สินค้าธรรมดาไม่ติดธง');
    eq($bySku['CLN-0003']['name'], 'น้ำยา Anti fog', 'สะกด Anti ไม่ใช่ Anit');
});

test('ค้นด้วยคำ ได้เฉพาะที่ตรง', function () {
    $rows = posCall('GET', '/api/pos/products', [], ['q' => 'Hitop']);

    eq(array_column($rows, 'sku'), ['CLN-0004', 'CLN-0005', 'CLN-0006'], 'สเปรย์ Hitop สามขนาด');
});

test('คลังไม่เห็นของหน้าร้าน — ไม่มีหมวด Pos* เหลือในตารางของคลัง', function () {
    $n = Db::get("SELECT COUNT(*) AS n FROM categories WHERE code LIKE 'Pos%'");
    eq((int) $n['n'], 0, 'หมวด Pos* ใน categories');
});

group('ขายหน้าร้านด้วยรายการของ pos_items');

test('ขายสินค้าธรรมดา บันทึก pos_item_id และไม่ผูกกับสินค้าในคลัง', function () {
    rollback(function (Tx $q) {
        $id = posItemId($q, 'SRV-0001');

        $sale = posCall('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => $id, 'quantity' => 1, 'unit_price' => 350],
        ], 350));

        $it = $q->get('SELECT * FROM pos_sale_items WHERE sale_id = ?', (int) $sale['id']);
        eq((int) $it['pos_item_id'], $id, 'pos_item_id');
        eq($it['product_id'], null, 'product_id ต้องว่าง');
        eq($it['sku_snapshot'], 'SRV-0001', 'SKU ที่จดไว้');
        eq($it['product_name_snapshot'], 'ค่าประกอบแว่น', 'ชื่อที่จดไว้');
        eq($sale['payment_status'], 'paid', 'จ่ายครบ');
    });
});

test('คอนแทคเลนส์ใส่ค่าสายตาแล้ว ขายได้', function () {
    rollback(function (Tx $q) {
        $sale = posCall('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => posItemId($q, 'CTA-0003'), 'quantity' => 2, 'unit_price' => 900,
             'item_meta' => ['power' => '-2.50']],
        ], 1800));

        eq((float) $sale['total_amount'], 1800.0, 'ยอดรวม');
    });
});

test('คอนแทคเลนส์ไม่ใส่ค่าสายตา ขายไม่ได้', function () {
    rollback(function (Tx $q) {
        $e = posCallError('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => posItemId($q, 'CTA-0003'), 'quantity' => 1, 'unit_price' => 900],
        ], 900));

        eq($e['status'], 400, 'ต้องเป็น 400');
        ok(str_contains($e['msg'], 'ต้องระบุค่าสายตา'), 'ข้อความต้องบอกว่าขาดค่าสายตา — ได้ ' . $e['msg']);
    });
});

test('สินค้าพิมพ์เอง ใช้ชื่อที่พิมพ์', function () {
    rollback(function (Tx $q) {
        $sale = posCall('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => posItemId($q, 'CST-0001'), 'custom_name' => 'ไขควงซ่อมแว่น',
             'quantity' => 1, 'unit_price' => 60],
        ], 60));

        eq($sale['items'][0]['product_name_snapshot'], 'ไขควงซ่อมแว่น', 'ชื่อบนใบ');
    });
});

test('สินค้าพิมพ์เองไม่มีชื่อ ขายไม่ได้', function () {
    rollback(function (Tx $q) {
        $e = posCallError('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => posItemId($q, 'CST-0001'), 'quantity' => 1, 'unit_price' => 60],
        ], 60));

        eq($e['status'], 400, 'ต้องเป็น 400');
        eq($e['msg'], 'รายการที่ 1: สินค้าพิมพ์เองต้องระบุชื่อสินค้า', 'ข้อความ');
    });
});

/* id ของสินค้าในคลังที่หน้าเว็บเก่ายังจำไว้ต้องไม่ผ่าน — POS ไม่หักสต็อก */
test('id ที่ไม่อยู่ในรายการหน้าร้าน ขายไม่ได้', function () {
    rollback(function (Tx $q) {
        $e = posCallError('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => 999999999, 'quantity' => 1, 'unit_price' => 10],
        ], 10));

        eq($e['status'], 400, 'ต้องเป็น 400');
        eq($e['msg'], 'รายการที่ 1: ไม่พบสินค้ารหัส 999999999 ในรายการของหน้าร้าน', 'ข้อความ');
    });
});

test('รายการที่เลิกขายแล้ว ไม่ขึ้นในช่องเลือกและขายไม่ได้', function () {
    rollback(function (Tx $q) {
        $id = posItemId($q, 'SRV-0002');
        $q->run('UPDATE pos_items SET is_active = 0 WHERE id = ?', $id);

        $skus = array_column(posCall('GET', '/api/pos/products'), 'sku');
        ok(!in_array('SRV-0002', $skus, true), 'ต้องไม่ขึ้นในช่องเลือก');

        $e = posCallError('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => $id, 'quantity' => 1, 'unit_price' => 100],
        ], 100));
        eq($e['status'], 400, 'ขายต้องเป็น 400');
    });
});

test('รายงานยอดขาย POS แยกตามชื่อกลุ่มของหน้าร้าน', function () {
    rollback(function (Tx $q) {
        posCall('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => posItemId($q, 'CLN-0005'), 'quantity' => 3, 'unit_price' => 120],
        ], 360));

        $today = date('Y-m-d');
        $cats = array_column(SalesReport::posCategories($today, $today), null, 'category');
        ok(isset($cats['อุปกรณ์ทำความสะอาด/ดูแล']), 'ต้องมีกลุ่มของสินค้าที่ขาย — ได้ ' . render(array_keys($cats)));
        ok((float) $cats['อุปกรณ์ทำความสะอาด/ดูแล']['revenue'] >= 360.0, 'ยอดของกลุ่มต้องรวมใบนี้');
    });
});
