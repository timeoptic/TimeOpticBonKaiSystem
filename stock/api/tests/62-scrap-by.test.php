<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Repo\Reports;
use Optic\Service\Stock;

/**
 * ตัดของเสีย — คนที่ทำเสียเป็นชื่อที่พิมพ์ ไม่ใช่บัญชีผู้ใช้
 *
 * ร้านขอไว้ 12 ก.ย. 2026: ผู้ดูแลคลังเป็นคนคีย์ แต่คนทำเสียมักเป็นเด็กฝึกงานที่มาไม่นาน
 * ไม่ควรสร้างบัญชีให้ · ช่องเดิมผูกกับตาราง admins และตั้งเป็นคนที่ล็อกอินอยู่เอง ของเสีย
 * ของน้องฝึกงานจึงไปขึ้นชื่อผู้ดูแลคลังในแดชบอร์ด · ตอนนี้ชื่อคนทำเป็นข้อความที่ต้องกรอก
 * ทุกครั้งที่ตัดของเสีย ส่วนคนคีย์ยังถูกจดไว้เองเหมือนเดิม
 *
 * ของทดสอบ (สินค้า + ล็อต) สร้างเองในทรานแซกชันที่ roll back — ไม่พึ่งสินค้าที่มีในฐาน
 */

group('ตัดของเสีย: ชื่อคนที่ทำเสีย');

/** สินค้าหนึ่งตัวกับล็อตที่มีของ 10 ชิ้น ทุนชิ้นละ 50 · คืน SKU */
function scrapFixture(): string
{
    $tag  = strtoupper(bin2hex(random_bytes(3)));
    $sku  = "TST-SCRAP-$tag";
    $lens = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
    Db::run(
        'INSERT INTO products (sku, category_id, product_type, name) VALUES (?, ?, ?, ?)',
        [$sku, $lens, 'Lens', "เลนส์ทดสอบของเสีย $tag"],
    );
    $product = (int) Db::conn()->lastInsertId();
    Db::run(
        'INSERT INTO stock_lots (lot_number, product_id, cost_per_unit, initial_qty, remaining_qty, received_date)
         VALUES (?, ?, 50, 10, 10, CURDATE())',
        ["L-$tag", $product],
    );
    return $sku;
}

/** ยอดคงเหลือรวมทุกล็อตของ SKU */
function scrapOnHand(string $sku): int
{
    return (int) Db::value(
        'SELECT COALESCE(SUM(l.remaining_qty), 0) FROM stock_lots l JOIN products p ON p.id = l.product_id WHERE p.sku = ?',
        [$sku],
    );
}

/** คำขอตัดทั้งตะกร้า */
function scrapBasket(string $sku, int $qty, string $key, array $extra = []): array
{
    return ['source' => 'test', 'idem_key' => $key, 'actor_id' => 1, 'items' => [['sku' => $sku, 'quantity' => $qty]]] + $extra;
}

test('ตัดของเสียต้องกรอกชื่อคนที่ทำเสีย — ไม่ส่งมา หรือมีแต่ช่องว่าง ถูกปฏิเสธและไม่ตัดของ', function () {
    withRollback(function () {
        $sku = scrapFixture();
        throwsReason('missing_scrap_by', fn() => Stock::scrap(issueReq($sku, 1, idem('noname'))), 'ตัดทีละรายการ ไม่มีชื่อ');
        throwsReason('missing_scrap_by', fn() => Stock::scrap(issueReq($sku, 1, idem('blank'), ['scrap_by' => '   '])), 'ชื่อเป็นช่องว่าง');
        throwsReason('missing_scrap_by', fn() => Stock::scrapMany(scrapBasket($sku, 1, idem('basket'))), 'ตะกร้า ไม่มีชื่อ');
        eq(scrapOnHand($sku), 10, 'ของยังอยู่ครบ');
    });
});

test('ชื่อที่พิมพ์ถูกเก็บตามจริง ขึ้นในหน้าความเคลื่อนไหว และค้นหาได้ — คนคีย์ยังถูกจดแยก', function () {
    withRollback(function () {
        $sku = scrapFixture();
        Stock::scrapMany(scrapBasket($sku, 2, idem('named'), ['note' => 'เจียร์เสีย', 'scrap_by' => '  น้องมิว (ฝึกงาน) ']));

        $rows = Inventory::movements(['type' => 'SCRAP', 'q' => 'น้องมิว'])['rows'];
        eq(count($rows), 1, 'ค้นด้วยชื่อคนทำเสียเจอ');
        eq($rows[0]['scrapBy'], 'น้องมิว (ฝึกงาน)', 'ชื่อคนทำเสีย ตัดช่องว่างหัวท้าย');
        eq($rows[0]['issuedToName'], null, 'ไม่ผูกกับบัญชีใคร');
        eq($rows[0]['actorName'], Db::value('SELECT display_name FROM admins WHERE id = 1'), 'คนคีย์ถูกจดเอง');
        eq($rows[0]['notes'], 'เจียร์เสีย', 'สาเหตุยังอยู่ในหมายเหตุ');
        eq(scrapOnHand($sku), 8, 'ตัดของออกจริง');
    });
});

test('ตัดทีละรายการก็เก็บชื่อเหมือนตะกร้า', function () {
    withRollback(function () {
        $sku = scrapFixture();
        Stock::scrap(issueReq($sku, 1, idem('single'), ['scrap_by' => 'พี่วัฒน์']));
        eq(
            Db::value(
                "SELECT g.scrap_by FROM inventory_logs g JOIN products p ON p.id = g.product_id
                  WHERE p.sku = ? AND g.action_type = 'SCRAP'",
                [$sku],
            ),
            'พี่วัฒน์',
            'ชื่อในสมุด'
        );
    });
});

test('เบิก/ขายไม่ต้องมีชื่อคนทำเสีย และไม่เก็บชื่อนั้นแม้จะส่งมา', function () {
    withRollback(function () {
        $sku = scrapFixture();
        Stock::issue(issueReq($sku, 1, idem('issue'), ['scrap_by' => 'ใครก็ได้']));
        eq(
            Db::value(
                "SELECT g.scrap_by FROM inventory_logs g JOIN products p ON p.id = g.product_id
                  WHERE p.sku = ? AND g.action_type = 'OUT'",
                [$sku],
            ),
            null,
            'แถวเบิกไม่มีชื่อคนทำเสีย'
        );
    });
});

test('แดชบอร์ด: ของเสียแยกตามคนนับตามชื่อที่พิมพ์ ไม่นับเข้าบัญชีคนคีย์ · ใครเบิกมากสุดก็ใช้ชื่อนี้', function () {
    withRollback(function () {
        $sku   = scrapFixture();
        $today = (string) Db::value('SELECT CURDATE()');
        Stock::scrap(issueReq($sku, 2, idem('d1'), ['scrap_by' => 'น้องมิว']));
        Stock::scrap(issueReq($sku, 1, idem('d2'), ['scrap_by' => 'น้องมิว']));
        Stock::scrap(issueReq($sku, 1, idem('d3'), ['scrap_by' => 'พี่วัฒน์']));

        $r     = Reports::overview($today, $today, true);
        $scrap = array_column($r['scrapPeople'], null, 'name');
        eq([$scrap['น้องมิว']['qty'] ?? null, $scrap['น้องมิว']['rows'] ?? null], [3, 2], 'น้องมิว: ชิ้น และรายการ');
        eq($scrap['น้องมิว']['cost'] ?? null, 150.0, 'น้องมิว: มูลค่า');
        eq($scrap['พี่วัฒน์']['qty'] ?? null, 1, 'พี่วัฒน์');
        ok(!isset($scrap[(string) Db::value('SELECT display_name FROM admins WHERE id = 1')]), 'คนคีย์ต้องไม่ถูกนับเป็นคนทำเสีย');

        $top = array_column($r['topPeople'], null, 'name');
        ok(isset($top['น้องมิว']), 'ใครเบิกมากสุดต้องมีชื่อน้องมิว — ได้ ' . render(array_keys($top)));
    });
});
