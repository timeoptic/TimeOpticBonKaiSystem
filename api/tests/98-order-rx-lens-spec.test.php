<?php

declare(strict_types=1);

/**
 * ออเดอร์ที่ใช้เลนส์สั่งตัด RX — ยี่ห้อ/ดีไซน์/index/โค้ตติ้ง ของออเดอร์เติมจากสินค้าในคลัง
 *
 * เหตุการณ์จริง 14 ก.ย. 2026: ใบสั่งซื้อของออเดอร์ 10467 (RX-2026-0003/0004) ช่อง Type
 * กับ Lens ว่าง · ฟอร์มเก็บเลนส์ RX ไว้แค่ชื่อกับ SKU แยกข้าง ส่วน lens_brand /
 * lens_design / lens_index / lens_coating ที่ใบพิมพ์อ่าน ไม่มีใครเติม (เลนส์สต็อกเติม
 * จากชิ้นที่เลือกในฟอร์ม แต่การ์ด RX ได้กลับมาแค่ชื่อกับ SKU)
 *
 * เทสต์ rxLensSpec() ตรง ๆ ไม่ยิงผ่าน POST /api/orders — ฐานในเครื่องบางชุดยังไม่มี
 * คอลัมน์ lens_*_rx_id · ของทดสอบในฐานอยู่ในทรานแซกชันที่ roll back เสมอ
 */

group('ออเดอร์เลนส์สั่งตัด RX — สเปกเลนส์จากสินค้า');

/** สินค้าสั่งตัดหนึ่งรุ่น · คืน SKU */
function rxSpecProduct(Tx $q, string $sku, string $brand, array $attrs): string
{
    $q->run(
        'INSERT INTO products (sku, category_id, product_type, name, brand, base_selling_price, is_custom_made, attributes)
         VALUES (?,?,?,?,?,?,?,?)',
        $sku, 31, 'Lens', "$brand RX test", $brand, '0.00', 1, json_encode($attrs)
    );
    return $sku;
}

/** สี่ช่องที่ใบสั่งซื้ออ่าน */
function rxSpecOf(array $b): array
{
    return [
        'lens_brand'   => $b['lens_brand'] ?? null,
        'lens_design'  => $b['lens_design'] ?? null,
        'lens_index'   => $b['lens_index'] ?? null,
        'lens_coating' => $b['lens_coating'] ?? null,
    ];
}

test('RX สองข้าง ไม่มีล็อต — เติมยี่ห้อ ดีไซน์ index โค้ตติ้ง จากสินค้า', function () {
    rollback(function (Tx $q) {
        $sku = rxSpecProduct($q, 'TRXS-A', 'Zeiss', [
            'model' => 'Digital', 'lens_design' => 'Degressive', 'lens_index' => '1.60', 'coating' => 'BlueGuard',
        ]);
        $b = rxLensSpec([
            'lens_r_rx_id' => 901, 'lens_r_sku' => $sku,
            'lens_l_rx_id' => 902, 'lens_l_sku' => $sku,
        ]);
        eq(rxSpecOf($b), [
            'lens_brand' => 'Zeiss', 'lens_design' => 'Degressive', 'lens_index' => '1.60', 'lens_coating' => 'BlueGuard',
        ], 'สเปกเลนส์ของออเดอร์');
    });
});

test('RX ข้างซ้ายข้างเดียวก็เติมจากข้างซ้าย', function () {
    rollback(function (Tx $q) {
        $sku = rxSpecProduct($q, 'TRXS-L', 'Hoya', ['lens_design' => 'Single']);
        $b = rxLensSpec(['lens_l_rx_id' => 903, 'lens_l_sku' => $sku]);
        eq($b['lens_brand'] ?? null, 'Hoya', 'ยี่ห้อ');
        eq($b['lens_design'] ?? null, 'Single', 'ดีไซน์');
    });
});

test('สองข้างคนละรุ่น ยึดข้างขวาเป็นตัวแทน เหมือนเลนส์สต็อก', function () {
    rollback(function (Tx $q) {
        $r = rxSpecProduct($q, 'TRXS-R', 'Zeiss', ['lens_design' => 'Progressive']);
        $l = rxSpecProduct($q, 'TRXS-L2', 'Hoya', ['lens_design' => 'Single']);
        $b = rxLensSpec([
            'lens_r_rx_id' => 904, 'lens_r_sku' => $r,
            'lens_l_rx_id' => 905, 'lens_l_sku' => $l,
        ]);
        eq($b['lens_brand'] ?? null, 'Zeiss', 'ยี่ห้อ');
        eq($b['lens_design'] ?? null, 'Progressive', 'ดีไซน์');
    });
});

/* ฟอร์มตอนแก้ออเดอร์ส่งสเปกเดิมกลับมาทุกครั้ง — เปลี่ยนรุ่น RX แล้วของเดิมต้องไม่ค้าง */
test('เปลี่ยนรุ่น RX แล้ว สเปกเก่าที่ส่งกลับมาถูกแทนด้วยของรุ่นใหม่', function () {
    rollback(function (Tx $q) {
        $sku = rxSpecProduct($q, 'TRXS-N', 'Hitop', ['lens_design' => 'Bifocal']);
        $b = rxLensSpec([
            'lens_r_rx_id' => 906, 'lens_r_sku' => $sku,
            'lens_brand' => 'Zeiss', 'lens_design' => 'Degressive', 'lens_index' => '1.67', 'lens_coating' => 'Old',
        ]);
        eq(rxSpecOf($b), [
            'lens_brand' => 'Hitop', 'lens_design' => 'Bifocal', 'lens_index' => '', 'lens_coating' => '',
        ], 'สเปกหลังเปลี่ยนรุ่น');
    });
});

test('มีเลนส์สต็อก (ล็อต) อยู่ด้วย — ไม่แตะ ฟอร์มเติมจากชิ้นสต็อกแล้ว', function () {
    rollback(function (Tx $q) {
        $sku = rxSpecProduct($q, 'TRXS-S', 'Zeiss', ['lens_design' => 'Degressive']);
        $body = [
            'lens_product_id' => 55, 'lens_l_rx_id' => 907, 'lens_l_sku' => $sku,
            'lens_brand' => 'Hoya', 'lens_design' => 'Single Vision',
        ];
        eq(rxLensSpec($body), $body, 'ออเดอร์ที่มีล็อต');
    });
});

test('ไม่มีใบสั่งตัด RX — ไม่แตะ', function () {
    $body = ['lens_r_sku' => 'TRXS-NONE', 'lens_brand' => 'Hoya'];
    eq(rxLensSpec($body), $body, 'ออเดอร์ที่ไม่มี RX');
});

/* ใบสั่งซื้อพิมพ์ "ยี่ห้อ · รุ่น" — custom_orders ไม่มีคอลัมน์รุ่น orderDetail อ่านรุ่นจากตรงนี้ */
test('rxLensProduct คืนยี่ห้อกับรุ่นของเลนส์ RX', function () {
    rollback(function (Tx $q) {
        $sku = rxSpecProduct($q, 'TRXS-M', 'Zeiss', ['model' => 'Digital lenses 1.5photoxBlue', 'lens_design' => 'Degressive']);
        $p = rxLensProduct(['lens_product_id' => null, 'lens_r_rx_id' => '5709', 'lens_r_sku' => $sku]);
        eq($p['brand'] ?? null, 'Zeiss', 'ยี่ห้อ');
        eq($p['attrs']['model'] ?? null, 'Digital lenses 1.5photoxBlue', 'รุ่น');
    });
});

test('rxLensProduct คืน null เมื่อมีล็อตเลนส์สต็อก หรือไม่มีใบสั่งตัด', function () {
    rollback(function (Tx $q) {
        $sku = rxSpecProduct($q, 'TRXS-N2', 'Zeiss', ['model' => 'X']);
        eq(rxLensProduct(['right_lens_product_id' => '77', 'lens_l_rx_id' => 1, 'lens_l_sku' => $sku]), null, 'มีล็อต');
        eq(rxLensProduct(['lens_r_rx_id' => null, 'lens_r_sku' => $sku]), null, 'ไม่มีใบสั่งตัด');
    });
});

test('หา SKU ในคลังไม่เจอ — ไม่แตะ ไม่ล้ม', function () {
    $body = ['lens_r_rx_id' => 908, 'lens_r_sku' => 'TRXS-MISSING-' . bin2hex(random_bytes(3)), 'lens_brand' => 'Hoya'];
    eq(rxLensSpec($body), $body, 'SKU ที่ไม่มีในคลัง');
});
