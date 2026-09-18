<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Repo\Inventory;
use Optic\Roles;
use Optic\Service\Branches;
use Optic\Service\ShopIssue;
use Optic\Service\Stock;

/**
 * แก้ไข / ยกเลิกการเบิกของร้านเอง (TimeOptic) — ของที่ออกไปโดยไม่ได้ผูกสาขา
 *
 * ร้านถามไว้ 12 ก.ย. 2026: "ถ้า TimeOptic เบิกผิดแก้อย่างไร ไม่มีที่แก้ให้เลย" · ฝั่งสาขามี
 * หน้าการเบิกจากสาขาให้แก้และยกเลิก ฝั่งร้านเองไม่มีอะไรเลย · ตอนนี้แถว "จ่ายออก" ที่ไม่ผูก
 * สาขาแก้ เลขเอกสาร หมายเหตุ ผู้เบิก ได้ และยกเลิกได้ด้วยเหตุผล ของกลับเข้าล็อตเดิม
 *
 * สองกรณีที่ไม่ให้ทำทางนี้: ใบของสาขา (มีหน้าของตัวเอง) กับของที่ตัดตามเคสหน้าร้าน (ต้อง
 * แก้ที่หน้าเคส ไม่งั้นเคสยังเชื่อว่าของอยู่กับลูกค้าทั้งที่กลับเข้าคลังแล้ว)
 *
 * ของทดสอบสร้างเองทั้งหมดในทรานแซกชันที่ roll back
 */

group('แก้ไข / ยกเลิกการเบิกของร้านเอง (TimeOptic)');

/** สินค้าหนึ่งตัวกับล็อตที่มีของ 10 ชิ้น · คืน [SKU, id ล็อต] */
function shopFixture(): array
{
    $tag  = strtoupper(bin2hex(random_bytes(3)));
    $sku  = "TST-SHOP-$tag";
    $lens = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
    Db::run(
        'INSERT INTO products (sku, category_id, product_type, name) VALUES (?, ?, ?, ?)',
        [$sku, $lens, 'Lens', "เลนส์ทดสอบเบิกของร้าน $tag"],
    );
    $product = (int) Db::conn()->lastInsertId();
    Db::run(
        'INSERT INTO stock_lots (lot_number, product_id, cost_per_unit, initial_qty, remaining_qty, received_date)
         VALUES (?, ?, 40, 10, 10, CURDATE())',
        ["L-$tag", $product],
    );
    return [$sku, (int) Db::conn()->lastInsertId()];
}

/** แถว OUT ล่าสุดของ SKU */
function shopOutLog(string $sku): int
{
    return (int) Db::value(
        "SELECT g.id FROM inventory_logs g JOIN products p ON p.id = g.product_id
          WHERE p.sku = ? AND g.action_type = 'OUT' ORDER BY g.id DESC LIMIT 1",
        [$sku],
    );
}

test('ยกเลิกการเบิกของร้าน: ของกลับเข้าล็อตเดิมครบ มีแถวรับคืนพร้อมเหตุผลที่ชี้กลับไปแถวเดิม', function () {
    withRollback(function () {
        [$sku, $lot] = shopFixture();
        Stock::issue(issueReq($sku, 2, idem('shop-out'), ['reference_doc' => 'SO-TEST', 'note' => 'เบิกให้ช่าง']));
        $out = shopOutLog($sku);
        eq(lotRemaining($lot), 8, 'เบิกแล้วเหลือ 8');

        $res = ShopIssue::cancel($out, ['note' => 'คีย์จำนวนผิด'], [Roles::OWNER], 1);
        eq(lotRemaining($lot), 10, 'ของกลับเข้าล็อตเดิมครบ');
        eq(array_sum(array_column($res['returned'], 'quantity')), 2, 'คืน 2 ชิ้น');

        $back = Db::one("SELECT * FROM inventory_logs WHERE reverses_log_id = ?", [$out]);
        ok($back !== null, 'ต้องมีแถวรับคืนที่ชี้กลับไปแถวเดิม');
        eq([$back['action_type'], (int) $back['quantity'], (int) $back['lot_id']], ['RETURN', 2, $lot], 'แถวรับคืน');
        ok(str_contains((string) $back['notes'], 'คีย์จำนวนผิด'), 'เหตุผลอยู่ในหมายเหตุ — ได้ ' . render($back['notes']));
        eq($back['reference_doc'], 'SO-TEST', 'เลขเอกสารเดิม');
    });
});

test('ยกเลิกต้องบอกเหตุผล และยกเลิกซ้ำไม่ได้', function () {
    withRollback(function () {
        [$sku, $lot] = shopFixture();
        Stock::issue(issueReq($sku, 1, idem('shop-twice')));
        $out = shopOutLog($sku);

        throwsReason('missing_field', fn() => ShopIssue::cancel($out, ['note' => '  '], [Roles::OWNER], 1), 'ไม่มีเหตุผล');
        eq(lotRemaining($lot), 9, 'ยังไม่คืน');

        ShopIssue::cancel($out, ['note' => 'เบิกผิด'], [Roles::OWNER], 1);
        throwsReason('already_returned', fn() => ShopIssue::cancel($out, ['note' => 'อีกรอบ'], [Roles::OWNER], 1), 'ยกเลิกซ้ำ');
        eq(lotRemaining($lot), 10, 'คืนรอบเดียว');
    });
});

test('ใบของสาขาไม่ให้ยกเลิกทางนี้ — ใช้หน้าการเบิกจากสาขา', function () {
    withRollback(function () {
        [$sku] = shopFixture();
        $branch = Branches::create(['name' => 'สาขาทดสอบร้าน-' . strtoupper(bin2hex(random_bytes(3)))], [Roles::OWNER])['id'];
        Stock::issue(issueReq($sku, 1, idem('shop-branch'), ['branch_id' => $branch]));
        $out = shopOutLog($sku);
        throwsReason('branch_issue', fn() => ShopIssue::cancel($out, ['note' => 'ผิด'], [Roles::OWNER], 1), 'ยกเลิก');
        throwsReason('branch_issue', fn() => ShopIssue::edit($out, ['note' => 'ผิด'], [Roles::OWNER], 1), 'แก้ไข');
    });
});

test('ของที่ตัดตามเคสหน้าร้านไม่ให้แก้หรือยกเลิกทางนี้ — ต้องแก้ที่หน้าเคส และแถวบอก id ของเคสไว้ให้ลิงก์', function () {
    withRollback(function () {
        [$sku, $lot] = shopFixture();
        $tag  = strtoupper(bin2hex(random_bytes(3)));
        $code = "CASE-TEST-$tag";
        Db::run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', ['ทดสอบ', 'เคสคลัง']);
        $customer = (int) Db::conn()->lastInsertId();
        Db::run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', [$code, $customer]);
        $case = (int) Db::conn()->lastInsertId();
        Db::run('INSERT INTO custom_orders (customer_id, case_id) VALUES (?, ?)', [$customer, $case]);
        $order = (int) Db::conn()->lastInsertId();

        Stock::issue(saleReq($sku, 1, idem('shop-case'), ['reference_doc' => $code, 'note' => "ขายหน้าร้าน กรอบ — เคส $code"]));
        Db::run(
            'INSERT INTO case_stock_issues (case_id, order_id, slot, kind, sku, lot_id, quantity, idem_key, reference_doc)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
            [$case, $order, 'frame', 'issue', $sku, $lot, 'case-idem-' . $tag, $code],
        );
        $out = shopOutLog($sku);

        throwsReason('case_linked', fn() => ShopIssue::cancel($out, ['note' => 'ผิด'], [Roles::OWNER], 1), 'ยกเลิก');
        throwsReason('case_linked', fn() => ShopIssue::edit($out, ['note' => 'ผิด'], [Roles::OWNER], 1), 'แก้ไข');
        eq(lotRemaining($lot), 9, 'ของยังไม่ถูกคืน');

        $row = Inventory::movements(['type' => 'OUT', 'q' => $sku])['rows'][0];
        eq($row['caseId'], $case, 'แถวบอก id ของเคส');
    });
});

test('แก้เลขเอกสาร หมายเหตุ และผู้เบิกได้ — ของไม่ขยับ', function () {
    withRollback(function () {
        [$sku, $lot] = shopFixture();
        Stock::issue(issueReq($sku, 2, idem('shop-edit'), ['reference_doc' => 'SO-OLD', 'note' => 'เดิม']));
        $out = shopOutLog($sku);

        ShopIssue::edit($out, ['reference_doc' => ' SO-NEW ', 'note' => 'แก้แล้ว', 'issued_to_admin_id' => 1], [Roles::OWNER], 1);
        $row = Db::one('SELECT reference_doc, notes, issued_to_admin_id, quantity FROM inventory_logs WHERE id = ?', [$out]);
        eq([$row['reference_doc'], $row['notes'], (int) $row['issued_to_admin_id'], (int) $row['quantity']], ['SO-NEW', 'แก้แล้ว', 1, -2], 'แถวหลังแก้');
        eq(lotRemaining($lot), 8, 'ยอดล็อตไม่ขยับ');

        ShopIssue::edit($out, ['reference_doc' => '', 'note' => '', 'issued_to_admin_id' => null], [Roles::OWNER], 1);
        $row = Db::one('SELECT reference_doc, notes, issued_to_admin_id FROM inventory_logs WHERE id = ?', [$out]);
        eq([$row['reference_doc'], $row['notes'], $row['issued_to_admin_id']], [null, null, null], 'ล้างค่าได้');
    });
});

test('แถวที่คืนแล้วแก้ไม่ได้ และหน้าความเคลื่อนไหวบอกว่าคืนแล้ว', function () {
    withRollback(function () {
        [$sku] = shopFixture();
        Stock::issue(issueReq($sku, 1, idem('shop-flag')));
        $out = shopOutLog($sku);

        eq(Inventory::movements(['type' => 'OUT', 'q' => $sku])['rows'][0]['returned'], false, 'ก่อนยกเลิก');
        ShopIssue::cancel($out, ['note' => 'เบิกผิด'], [Roles::OWNER], 1);
        eq(Inventory::movements(['type' => 'OUT', 'q' => $sku])['rows'][0]['returned'], true, 'หลังยกเลิก');
        throwsReason('already_returned', fn() => ShopIssue::edit($out, ['note' => 'แก้'], [Roles::OWNER], 1), 'แก้แถวที่คืนแล้ว');
    });
});

/* ร้านขอไว้ 14 ก.ย. 2026: ตัดของเสียผิดก็ต้องยกเลิกได้ — เดิมปุ่มมีแค่แถวจ่ายออก */

/** แถว SCRAP ล่าสุดของ SKU */
function shopScrapLog(string $sku): int
{
    return (int) Db::value(
        "SELECT g.id FROM inventory_logs g JOIN products p ON p.id = g.product_id
          WHERE p.sku = ? AND g.action_type = 'SCRAP' ORDER BY g.id DESC LIMIT 1",
        [$sku],
    );
}

test('ยกเลิกการตัดของเสีย: ของกลับเข้าล็อตเดิม มีแถวรับคืนพร้อมเหตุผล และหน้าความเคลื่อนไหวบอกว่ายกเลิกแล้ว', function () {
    withRollback(function () {
        [$sku, $lot] = shopFixture();
        Stock::scrap(issueReq($sku, 2, idem('scrap-undo'), ['scrap_by' => 'น้องมิว', 'note' => 'เจียร์เสีย']));
        $scrap = shopScrapLog($sku);
        ok($scrap > 0, 'มีแถวตัดของเสีย');
        eq(lotRemaining($lot), 8, 'ตัดเสียแล้วเหลือ 8');
        eq(Inventory::movements(['type' => 'SCRAP', 'q' => $sku])['rows'][0]['returned'], false, 'ก่อนยกเลิก');

        $res = ShopIssue::cancel($scrap, ['note' => 'ตัดผิดตัว'], [Roles::OWNER], 1);
        eq(lotRemaining($lot), 10, 'ของกลับเข้าล็อตเดิมครบ');
        eq(array_sum(array_column($res['returned'], 'quantity')), 2, 'คืน 2 ชิ้น');

        $back = Db::one('SELECT * FROM inventory_logs WHERE reverses_log_id = ?', [$scrap]);
        ok($back !== null, 'ต้องมีแถวรับคืนที่ชี้กลับไปแถวเดิม');
        eq([$back['action_type'], (int) $back['quantity'], (int) $back['lot_id']], ['RETURN', 2, $lot], 'แถวรับคืน');
        ok(str_contains((string) $back['notes'], 'ยกเลิกการตัดของเสีย'), 'บอกว่าเป็นการยกเลิกของเสีย — ได้ ' . render($back['notes']));
        ok(str_contains((string) $back['notes'], 'ตัดผิดตัว'), 'เหตุผลอยู่ในหมายเหตุ');

        eq(Inventory::movements(['type' => 'SCRAP', 'q' => $sku])['rows'][0]['returned'], true, 'หลังยกเลิก');
    });
});

test('ของเสียยกเลิกได้อย่างเดียว แก้รายละเอียดไม่ได้ · ยกเลิกซ้ำไม่ได้ · ต้องมีสิทธิ์', function () {
    withRollback(function () {
        [$sku, $lot] = shopFixture();
        Stock::scrap(issueReq($sku, 1, idem('scrap-twice'), ['scrap_by' => 'พี่วัฒน์']));
        $scrap = shopScrapLog($sku);

        throwsReason('not_shop_issue', fn() => ShopIssue::edit($scrap, ['note' => 'แก้'], [Roles::OWNER], 1), 'แก้แถวของเสีย');
        throwsReason('forbidden', fn() => ShopIssue::cancel($scrap, ['note' => 'ผิด'], [Roles::SALES], 1), 'พนักงานขายยกเลิก');
        throwsReason('missing_field', fn() => ShopIssue::cancel($scrap, ['note' => ''], [Roles::OWNER], 1), 'ไม่มีเหตุผล');

        ShopIssue::cancel($scrap, ['note' => 'ของไม่ได้เสีย'], [Roles::OWNER], 1);
        throwsReason('already_returned', fn() => ShopIssue::cancel($scrap, ['note' => 'อีกรอบ'], [Roles::OWNER], 1), 'ยกเลิกซ้ำ');
        eq(lotRemaining($lot), 10, 'คืนรอบเดียว');
    });
});

test('พนักงานขายและผู้ดูแลคลังแก้หรือยกเลิกไม่ได้ · แถวที่ไม่ใช่การเบิกก็ไม่ได้', function () {
    withRollback(function () {
        [$sku] = shopFixture();
        Stock::issue(issueReq($sku, 1, idem('shop-perm')));
        $out = shopOutLog($sku);
        throwsReason('forbidden', fn() => ShopIssue::cancel($out, ['note' => 'ผิด'], [Roles::SALES], 1), 'พนักงานขายยกเลิก');
        throwsReason('forbidden', fn() => ShopIssue::edit($out, ['note' => 'ผิด'], [Roles::STOCK], 1), 'ผู้ดูแลคลังแก้');

        $in = (int) Db::value(
            "SELECT g.id FROM inventory_logs g JOIN products p ON p.id = g.product_id WHERE p.sku = ? AND g.action_type <> 'OUT' LIMIT 1",
            [$sku],
        );
        if ($in > 0) {
            throwsReason('not_shop_issue', fn() => ShopIssue::cancel($in, ['note' => 'ผิด'], [Roles::OWNER], 1), 'แถวที่ไม่ใช่การเบิก');
        }
        throwsReason('not_found', fn() => ShopIssue::cancel(999999999, ['note' => 'ผิด'], [Roles::OWNER], 1), 'ไม่มีแถวนี้');
    });
});
