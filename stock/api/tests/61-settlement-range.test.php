<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Roles;
use Optic\Service\Branches;
use Optic\Service\Settlement;

/**
 * หน้าการเบิกจากสาขา — ช่วงวันที่ และดึงทุกใบในครั้งเดียวสำหรับไฟล์ Excel
 *
 * ร้านขอไว้ 12 ก.ย. 2026: ส่งออก Excel ตามสาขา มีชื่อเลนส์ หมายเหตุ และสาขาที่เบิก ·
 * ไฟล์ต้องมีทุกใบที่ตรงกับตัวกรอง ไม่ใช่แค่ 25 แถวของหน้าที่เปิดอยู่ และช่วงวันที่ต้อง
 * ตัดการ์ดสรุปด้วย ไม่งั้นการ์ดกับตารางนับของคนละก้อน
 *
 * ของทดสอบสร้างเองทั้งหมด (สาขา สินค้า ใบเบิก) ลงปี 2031 ในทรานแซกชันที่ roll back —
 * ไม่พึ่งสินค้าหรือล็อตที่มีอยู่ในฐาน
 */

group('การเบิกจากสาขา: ช่วงวันที่และส่งออก');

/** สาขาสองแห่งกับสินค้าหนึ่งตัว · คืน [สาขา A, สาขา B, id สินค้า, SKU, ชื่อสินค้า] */
function settleRangeFixtures(): array
{
    $tag  = strtoupper(bin2hex(random_bytes(3)));
    $a    = Branches::create(['name' => "สาขาช่วงวัน-A-$tag"], [Roles::OWNER])['id'];
    $b    = Branches::create(['name' => "สาขาช่วงวัน-B-$tag"], [Roles::OWNER])['id'];
    $lens = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
    $sku  = "TST-SR-$tag";
    $name = "เลนส์ทดสอบช่วงวัน $tag";
    Db::run(
        'INSERT INTO products (sku, category_id, product_type, name) VALUES (?, ?, ?, ?)',
        [$sku, $lens, 'lens', $name],
    );
    return [$a, $b, (int) Db::conn()->lastInsertId(), $sku, $name];
}

/** ใบเบิกหนึ่งใบ ลงตรงในตาราง — เทสต์นี้ถามเรื่องการอ่าน ไม่ใช่เรื่องการตัดสต็อก */
function settleIssue(int $branch, int $product, string $sku, string $at, ?string $note = null, string $status = 'pending'): void
{
    Db::run(
        'INSERT INTO branch_issues (branch_id, product_id, sku, quantity, cost_total, issued_at, note, status)
         VALUES (?, ?, ?, 1, 100, ?, ?, ?)',
        [$branch, $product, $sku, $at, $note, $status],
    );
}

test('ช่วงวันที่ตัดทั้งตารางและการ์ดสรุป — นับตามวันที่เบิก รวมใบที่เบิกวินาทีสุดท้ายของวัน', function () {
    withRollback(function () {
        [$a, , $product, $sku] = settleRangeFixtures();
        settleIssue($a, $product, $sku, '2031-01-31 23:59:59');
        settleIssue($a, $product, $sku, '2031-02-01 00:00:00');
        settleIssue($a, $product, $sku, '2031-02-28 23:59:59');
        settleIssue($a, $product, $sku, '2031-03-01 00:00:00');

        $filter = ['status' => 'pending', 'branch_id' => $a, 'from' => '2031-02-01', 'to' => '2031-02-28'];
        eq(Settlement::list($filter, [Roles::OWNER])['total'], 2, 'ใบในเดือน ก.พ.');

        $sum = Settlement::summary([Roles::OWNER], $filter);
        eq($sum['pendingCount'], 2, 'การ์ดนับใบเดียวกับตาราง');
        eq($sum['pendingCost'], 200.0, 'การ์ดรวมต้นทุนเดียวกับตาราง');
    });
});

test('ไม่ส่งช่วงวันที่คือทุกใบเหมือนเดิม · วันที่ผิดรูปแบบไม่ถูกใช้กรอง', function () {
    withRollback(function () {
        [$a, , $product, $sku] = settleRangeFixtures();
        foreach (['2031-01-31 10:00:00', '2031-02-10 10:00:00', '2031-03-05 10:00:00'] as $at) {
            settleIssue($a, $product, $sku, $at);
        }
        eq(Settlement::list(['status' => 'pending', 'branch_id' => $a], [Roles::OWNER])['total'], 3, 'ไม่มีช่วงวันที่');
        eq(
            Settlement::list(['status' => 'pending', 'branch_id' => $a, 'from' => '01/02/2031', 'to' => 'เมื่อวาน'], [Roles::OWNER])['total'],
            3,
            'วันที่ผิดรูปแบบ'
        );
    });
});

test('all ได้ทุกใบในครั้งเดียว ไม่แบ่งหน้า — ไฟล์ Excel ต้องมีครบ', function () {
    withRollback(function () {
        [, $b, $product, $sku] = settleRangeFixtures();
        for ($i = 1; $i <= Settlement::PER_PAGE + 5; $i++) {
            settleIssue($b, $product, $sku, sprintf('2031-02-%02d 09:00:00', 1 + $i % 27));
        }
        $n = Settlement::PER_PAGE + 5;

        $paged = Settlement::list(['status' => 'pending', 'branch_id' => $b], [Roles::OWNER]);
        eq(count($paged['rows']), Settlement::PER_PAGE, 'หน้าจอยังแบ่งหน้าเหมือนเดิม');

        $all = Settlement::list(['status' => 'pending', 'branch_id' => $b, 'all' => true], [Roles::OWNER]);
        eq(count($all['rows']), $n, 'ทุกใบ');
        eq($all['total'], $n, 'ยอดรวม');
        eq($all['page'], 1, 'หน้าเดียว');
        eq($all['perPage'], $n, 'ขนาดหน้าเท่ากับทั้งหมด');
    });
});

test('แถวมีหมายเหตุ ชื่อสินค้า และชื่อสาขา — ครบสำหรับคอลัมน์ในไฟล์', function () {
    withRollback(function () {
        [$a, , $product, $sku, $name] = settleRangeFixtures();
        settleIssue($a, $product, $sku, '2031-02-15 13:25:51', '42591');

        $row = Settlement::list(['status' => 'pending', 'branch_id' => $a, 'all' => true], [Roles::OWNER])['rows'][0];
        eq($row['note'], '42591', 'หมายเหตุ');
        eq($row['productName'], $name, 'ชื่อสินค้า');
        eq($row['issuedAt'], '2031-02-15 13:25:51', 'วันเวลาที่เบิก');
        ok(str_starts_with((string) $row['branchName'], 'สาขาช่วงวัน-A-'), 'ชื่อสาขา — ได้ ' . render($row['branchName']));
    });
});

test('ดึงทุกใบไม่ข้ามสิทธิ์ — พนักงานขายยังเปิดรายการนี้ไม่ได้', function () {
    withRollback(function () {
        try {
            Settlement::list(['status' => 'pending', 'all' => true], [Roles::SALES]);
        } catch (\Optic\ApiError) {
            ok(true, 'ถูกปฏิเสธ');
            return;
        }
        fail('พนักงานขายต้องถูกปฏิเสธ');
    });
});
