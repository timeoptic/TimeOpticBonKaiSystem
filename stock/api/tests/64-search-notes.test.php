<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Roles;
use Optic\Service\Branches;
use Optic\Service\Settlement;

/**
 * ช่องค้นหาทุกหน้าของคลังหาจากหมายเหตุได้
 *
 * ร้านขอ 3 ต.ค. 2026: พิมพ์สิ่งที่จดไว้ในหมายเหตุ (เลขใบส่งของ เลขบิล ชื่อคนรับ) แล้วบางหน้า
 * ไม่ขึ้น · ความเคลื่อนไหวกับใบสั่งตัดค้นหมายเหตุอยู่แล้ว ส่วนสินค้า ล็อต และการเบิกจากสาขา
 * ไม่ได้ค้น
 *
 * ของทดสอบสร้างเองทั้งหมดในทรานแซกชันที่ roll back
 */

group('ค้นหาจากหมายเหตุ ทุกหน้าของคลัง');

/** สินค้า + ล็อตหนึ่งล็อตที่มีหมายเหตุ · คืน [id สินค้า, SKU, คำในหมายเหตุ] */
function noteFixture(): array
{
    $tag  = strtoupper(bin2hex(random_bytes(3)));
    $lens = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
    $sku  = "TST-NOTE-$tag";
    Db::run(
        'INSERT INTO products (sku, category_id, product_type, name) VALUES (?, ?, ?, ?)',
        [$sku, $lens, 'lens', "เลนส์ทดสอบหมายเหตุ $tag"],
    );
    $pid  = (int) Db::conn()->lastInsertId();
    $word = "ใบส่งของNT$tag";
    Db::run(
        'INSERT INTO stock_lots (lot_number, product_id, remaining_qty, received_date, notes)
         VALUES (?, ?, 1, CURDATE(), ?)',
        ["LOT-$tag", $pid, "รับจากผู้ขาย $word"],
    );
    return [$pid, $sku, $word];
}

function foundSku(array $result, string $sku): bool
{
    return str_contains(json_encode($result, JSON_UNESCAPED_UNICODE), $sku);
}

test('หน้าสินค้า: ค้นคำในหมายเหตุของล็อต เจอสินค้านั้น', function () {
    withRollback(function () {
        [, $sku, $word] = noteFixture();
        ok(foundSku(Inventory::products(['q' => $word]), $sku), 'ไม่เจอสินค้าจากหมายเหตุล็อต');
    });
});

test('หน้าล็อต: ค้นคำในหมายเหตุของล็อต เจอล็อตนั้น', function () {
    withRollback(function () {
        [, $sku, $word] = noteFixture();
        ok(foundSku(Inventory::lots(['q' => $word]), $sku), 'ไม่เจอล็อตจากหมายเหตุ');
    });
});

test('หน้าเบิกจากสาขา: ค้นหมายเหตุตอนเบิก และหมายเหตุตอนรับเงิน', function () {
    withRollback(function () {
        [$pid, $sku] = noteFixture();
        $tag = strtoupper(bin2hex(random_bytes(3)));
        $br  = Branches::create(['name' => "สาขาหมายเหตุ-$tag"], [Roles::OWNER])['id'];
        Db::run(
            'INSERT INTO branch_issues (branch_id, product_id, sku, quantity, cost_total, issued_at, note, settled_note, status)
             VALUES (?, ?, ?, 1, 100, NOW(), ?, ?, ?)',
            [$br, $pid, $sku, "บิลเบิก BILL$tag", "โอนแล้ว PAY$tag", 'pending'],
        );
        ok(foundSku(Settlement::list(['status' => 'pending', 'q' => "BILL$tag"], [Roles::OWNER]), $sku), 'ไม่เจอจากหมายเหตุตอนเบิก');
        ok(foundSku(Settlement::list(['status' => 'pending', 'q' => "PAY$tag"], [Roles::OWNER]), $sku), 'ไม่เจอจากหมายเหตุตอนรับเงิน');
    });
});
