<?php

declare(strict_types=1);

use Optic\Auth;
use Optic\Db;
use Optic\Roles;
use Optic\Service\IssueRequests;

/**
 * คำขอตัดเลนส์จากบัญชีสาขา — ร้านขอไว้ 27 ต.ค. 2026
 *
 * สาขากรอก ของยังไม่ขยับ · แอดมินแก้ค่าได้แล้วยืนยัน ระบบจึงตัดผ่าน `issueMany` / `Rx::order`
 * ทั้งหมดในทรานแซกชันที่ roll back · บัญชีสาขาคือแถว admins ที่มีอยู่แล้ว ยืมมาถือบทบาท branch
 * บัญชีไม่ผูกสาขา — สาขาเลือกต่อคำขอ และคนตรวจเปลี่ยนได้
 */

group('คำขอตัดเลนส์จากสาขา');

/** สาขาทดสอบ + บัญชีสาขา + สินค้าที่มีของ 10 ชิ้น · คืน [requester actor, approver actor, sku, lot, branch] */
function requestFixture(): array
{
    $tag = strtoupper(bin2hex(random_bytes(3)));
    Db::run('INSERT INTO branches (name) VALUES (?)', ["สาขาทดสอบ $tag"]);
    $branch = (int) Db::conn()->lastInsertId();

    $ids = array_map('intval', array_column(Db::all('SELECT id FROM admins ORDER BY id LIMIT 2'), 'id'));
    [$who, $boss] = $ids;
    Db::run("INSERT IGNORE INTO admin_roles (admin_id, role) VALUES (?, 'branch')", [$who]);

    $lens = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
    $sku = "TST-REQ-$tag";
    Db::run(
        'INSERT INTO products (sku, category_id, product_type, name) VALUES (?, ?, ?, ?)',
        [$sku, $lens, 'Lens', "เลนส์ทดสอบคำขอ $tag"],
    );
    $product = (int) Db::conn()->lastInsertId();
    Db::run(
        'INSERT INTO stock_lots (lot_number, product_id, cost_per_unit, initial_qty, remaining_qty, received_date)
         VALUES (?, ?, 40, 10, 10, CURDATE())',
        ["L-$tag", $product],
    );
    $lot = (int) Db::conn()->lastInsertId();

    return [
        ['id' => $who, 'roles' => [Roles::BRANCH]],
        ['id' => $boss, 'roles' => [Roles::ADMIN]],
        $sku,
        $lot,
        $branch,
    ];
}

test('ส่งคำขอเบิก: ของยังไม่ขยับ · ยืนยันพร้อมค่าที่แก้ แล้วตัดตามค่าที่แก้ ผูกสาขาของคำขอ', function () {
    withRollback(function () {
        [$who, $boss, $sku, $lot, $branch] = requestFixture();

        throwsReason('missing_branch', static fn() => IssueRequests::create(['kind' => 'issue', 'body' => [
            'items' => [['sku' => $sku, 'quantity' => 1]],
        ]], $who), 'ไม่เลือกสาขา');
        throwsReason('branch_excluded', static fn() => IssueRequests::create(['kind' => 'issue', 'branch_id' => 5335, 'body' => [
            'items' => [['sku' => $sku, 'quantity' => 1]],
        ]], $who), 'Bewell');

        $req = IssueRequests::create(['kind' => 'issue', 'branch_id' => $branch, 'body' => [
            'items' => [['sku' => $sku, 'quantity' => 3]], 'note' => 'ลูกค้า A',
        ]], $who);
        eq($req['status'], 'pending', 'สถานะเริ่มต้น');
        eq($req['branchId'], $branch, 'สาขาที่เลือก');
        eq(lotRemaining($lot), 10, 'ยังไม่ตัด');
        eq(IssueRequests::pendingCount([Roles::OWNER])['pending'] >= 1, true, 'นับรอตรวจ');

        $done = Auth::as($boss, static fn() => IssueRequests::approve((int) $req['id'], ['body' => [
            'items' => [['sku' => $sku, 'quantity' => 2]], 'note' => 'ลูกค้า A',
        ]], $boss));
        eq($done['status'], 'approved', 'ยืนยันแล้ว');
        eq($done['edited'], true, 'จำได้ว่าแอดมินแก้');
        eq(lotRemaining($lot), 8, 'ตัดตามจำนวนที่แก้ (2)');
        eq(
            (int) Db::value('SELECT COUNT(*) FROM branch_issues WHERE branch_id = ? AND sku = ?', [$branch, $sku]),
            1,
            'เปิดใบค้างรับของสาขา',
        );

        throwsReason('not_pending', static fn() => Auth::as($boss, static fn() => IssueRequests::approve((int) $req['id'], [], $boss)), 'ยืนยันซ้ำ');
    });
});

test('ของไม่พอตอนยืนยัน: ไม่ตัดอะไรเลย คำขอยังรอตรวจ', function () {
    withRollback(function () {
        [$who, $boss, $sku, $lot, $branch] = requestFixture();
        $req = IssueRequests::create(['kind' => 'issue', 'branch_id' => $branch, 'body' => ['items' => [['sku' => $sku, 'quantity' => 50]]]], $who);

        try {
            Auth::as($boss, static fn() => IssueRequests::approve((int) $req['id'], [], $boss));
            fail('ควรปฏิเสธเพราะของไม่พอ');
        } catch (\Optic\ApiError) {
        }
        eq(lotRemaining($lot), 10, 'ไม่ตัด');
        eq(Db::value('SELECT status FROM issue_requests WHERE id = ?', [$req['id']]), 'pending', 'ยังรอตรวจ');
    });
});

test('สิทธิ์: สาขายืนยันเองไม่ได้ · แอดมินส่งคำขอแทนไม่ได้ · ตีกลับต้องมีเหตุผล · สาขายกเลิกได้เฉพาะของตัวเอง', function () {
    withRollback(function () {
        [$who, $boss, $sku, , $branch] = requestFixture();
        $req = IssueRequests::create(['kind' => 'issue', 'branch_id' => $branch, 'body' => ['items' => [['sku' => $sku, 'quantity' => 1]]]], $who);

        try {
            IssueRequests::approve((int) $req['id'], [], $who);
            fail('สาขายืนยันเองไม่ควรได้');
        } catch (\Optic\ApiError) {
        }
        try {
            IssueRequests::create(['kind' => 'issue', 'branch_id' => $branch, 'body' => ['items' => [['sku' => $sku, 'quantity' => 1]]]], $boss);
            fail('แอดมินไม่มี issue.request');
        } catch (\Optic\ApiError) {
        }
        throwsReason('missing_reason', static fn() => IssueRequests::reject((int) $req['id'], ['reason' => ' '], $boss), 'ตีกลับไม่มีเหตุผล');

        throwsReason('not_pending', static fn() => IssueRequests::cancel((int) $req['id'], ['id' => $boss['id'], 'roles' => [Roles::BRANCH]]), 'ยกเลิกของคนอื่น');
        eq(IssueRequests::cancel((int) $req['id'], $who)['status'], 'cancelled', 'ยกเลิกของตัวเอง');
    });
});

test('คำขอ RX: คนตรวจเปลี่ยนสาขาได้ · ยืนยันแล้วเปิดใบสั่งตัดผูกสาขาที่เปลี่ยน ไม่มีต้นทุน', function () {
    withRollback(function () {
        [$who, $boss, , , $first] = requestFixture();
        Db::run('INSERT INTO branches (name) VALUES (?)', ['สาขาทดสอบอีกสาขา ' . bin2hex(random_bytes(3))]);
        $branch = (int) Db::conn()->lastInsertId();
        $req = IssueRequests::create(['kind' => 'rx', 'branch_id' => $first, 'body' => [
            'brand' => 'TestBrand', 'lens_model' => 'REQ-RX', 'lens_design' => 'Single Vision',
            'eye_side' => 'right', 'sph' => '-1.00', 'cyl' => '0.00', 'unit_cost' => '999',
        ]], $who);
        ok(!array_key_exists('unit_cost', $req['body']), 'ต้นทุนไม่ถูกเก็บจากคำขอ');

        $done = Auth::as($boss, static fn() => IssueRequests::approve((int) $req['id'], ['branch_id' => $branch], $boss));
        eq($done['status'], 'approved', 'ยืนยันแล้ว');
        eq($done['branchId'], $branch, 'คำขอย้ายไปสาขาที่คนตรวจเลือก');
        $doc = $done['result']['referenceDoc'] ?? null;
        ok(is_string($doc) && $doc !== '', 'ได้เลขใบสั่ง');
        $row = Db::one(
            "SELECT r.branch_id, g.unit_cost FROM inventory_logs g JOIN rx_orders r ON r.log_id = g.id
              WHERE g.action_type = 'RX_ORDER' AND g.reference_doc = ?",
            [$doc],
        );
        eq((int) $row['branch_id'], $branch, 'ใบสั่งผูกสาขาของคำขอ');
        eq($row['unit_cost'], null, 'ไม่มีต้นทุน');
    });
});
