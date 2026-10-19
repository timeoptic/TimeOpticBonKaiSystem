<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Roles;
use Optic\Service\Catalog;
use Optic\Service\ShopIssue;
use Optic\Service\Stock;

/**
 * คืนของเข้าล็อตที่ร้านเคยแก้ยอดคงเหลือขึ้นเกินจำนวนรับเข้า
 *
 * ร้านเจอ 19 ต.ค. 2026 (CASE-2026-00335): ล็อต L260910-01 รับเข้า 1 ชิ้น แล้วแก้ยอดขึ้น
 * เป็น 117 เพราะเอาของเข้าล็อตเดิมแทนการทำใบรับเข้า · เปลี่ยนกรอบในออเดอร์แล้วการคืน
 * กรอบเดิมติด "คืนแล้วยอดจะเกินจำนวนที่เคยรับเข้าล็อตนี้" ทั้งที่ของไม่ได้เกิน
 *
 * ของทดสอบสร้างเองทั้งหมดในทรานแซกชันที่ roll back
 */

group('คืนของเข้าล็อตที่แก้ยอดคงเหลือขึ้น');

/** สินค้ากับล็อตที่รับเข้า 1 ชิ้นแล้วแก้ยอดขึ้นเป็น $raised · คืน [SKU, id ล็อต] */
function raisedLot(int $raised): array
{
    $tag  = strtoupper(bin2hex(random_bytes(3)));
    $sku  = "TST-ADJ-$tag";
    $cat  = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
    Db::run(
        'INSERT INTO products (sku, category_id, product_type, name) VALUES (?, ?, ?, ?)',
        [$sku, $cat, 'Lens', "ของทดสอบล็อตแก้ยอด $tag"],
    );
    $product = (int) Db::conn()->lastInsertId();
    Db::run(
        'INSERT INTO stock_lots (lot_number, product_id, cost_per_unit, initial_qty, remaining_qty, received_date)
         VALUES (?, ?, 40, 1, 1, CURDATE())',
        ["L-$tag", $product],
    );
    $lot = (int) Db::conn()->lastInsertId();
    Db::run(
        "INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, reference_doc, created_by, created_by_kind, created_at)
         VALUES (?, ?, 'IN', 1, ?, 1, 'user', NOW())",
        [$product, $lot, "GRN-L-$tag"],
    );
    Catalog::updateLot($lot, ['remaining_qty' => $raised, 'note' => 'รับเข้าเพิ่มเข้าล็อตเดิม'], [Roles::OWNER], 1);
    return [$sku, $lot];
}

test('ล็อตรับเข้า 1 แก้ยอดเป็น 117 — ตัดแล้วคืนได้ ของกลับเข้าล็อตเดิม', function () {
    withRollback(function () {
        [$sku, $lot] = raisedLot(117);
        $k = idem('adj-cut');
        Stock::issue(issueReq($sku, 1, $k));
        eq(lotRemaining($lot), 116, 'ตัดแล้วเหลือ 116');

        Stock::returnStock(['source' => 'test', 'idem_key' => idem('adj-back'), 'reverses_key' => $k, 'actor_id' => 1]);
        eq(lotRemaining($lot), 117, 'คืนแล้วกลับเป็น 117');
    });
});

test('ยกเลิกการเบิกของร้านจากล็อตที่แก้ยอดขึ้น ก็คืนได้', function () {
    withRollback(function () {
        [$sku, $lot] = raisedLot(20);
        Stock::issue(issueReq($sku, 3, idem('adj-shop'), ['reference_doc' => 'SO-ADJ']));
        $out = (int) Db::value(
            "SELECT id FROM inventory_logs WHERE lot_id = ? AND action_type = 'OUT' ORDER BY id DESC LIMIT 1",
            [$lot],
        );
        ShopIssue::cancel($out, ['note' => 'เบิกผิด'], [Roles::OWNER], 1);
        eq(lotRemaining($lot), 20, 'ของกลับครบ');
    });
});

test('ยังคืนเกินยอดที่ล็อตควรมีไม่ได้ — แก้ยอดขึ้นแล้วลดลงทีหลัง เพดานลดตาม', function () {
    withRollback(function () {
        [$sku, $lot] = raisedLot(10);
        $k = idem('adj-cut2');
        Stock::issue(issueReq($sku, 2, $k));
        /* เหลือ 8 · ตรวจนับเจอ 10 (+2) แล้วของแตกไป 1 (−1) → เหลือ 9
           เพดาน = รับเข้า 1 + ปรับยอด (9 + 2 − 1) = 11 */
        Catalog::updateLot($lot, ['remaining_qty' => 10, 'note' => 'ตรวจนับ'], [Roles::OWNER], 1);
        Catalog::updateLot($lot, ['remaining_qty' => 9, 'note' => 'ของแตก'], [Roles::OWNER], 1);
        Stock::returnStock(['source' => 'test', 'idem_key' => idem('adj-back2'), 'reverses_key' => $k, 'actor_id' => 1]);
        eq(lotRemaining($lot), 11, 'คืน 2 ได้พอดีเพดาน 11');

        /* เติมยอดเงียบ ๆ อีก 1 โดยไม่ลงสมุด แล้วคืนรายการเดิมอีกรอบด้วยกุญแจใหม่ไม่ได้อยู่แล้ว ·
           ตรวจเพดานตรง ๆ แทน: ตัด 1 แล้วดันยอดกลับขึ้นเพดาน การคืนต้องถูกปฏิเสธ */
        $k2 = idem('adj-cut3');
        Stock::issue(issueReq($sku, 1, $k2));
        Db::run('UPDATE stock_lots SET remaining_qty = 11 WHERE id = ?', [$lot]);
        throwsReason('over_return', fn() => Stock::returnStock([
            'source' => 'test', 'idem_key' => idem('adj-back3'), 'reverses_key' => $k2, 'actor_id' => 1,
        ]), 'คืนเกินเพดาน');
    });
});

test('ล็อตที่ไม่เคยแก้ยอด ยังคืนเกินจำนวนรับเข้าไม่ได้เหมือนเดิม', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $k = idem('plain-cut');
        $cut = Stock::issue(issueReq($sku, 1, $k));
        $lot = (int) $cut['cuts'][0]['lot_id'];
        /* มีคนเติมยอดเงียบ ๆ โดยไม่ลงสมุด — ทางนี้ต้องยังถูกกันไว้ */
        Db::run('UPDATE stock_lots SET remaining_qty = initial_qty WHERE id = ?', [$lot]);
        throwsReason('over_return', fn() => Stock::returnStock([
            'source' => 'test', 'idem_key' => idem('plain-back'), 'reverses_key' => $k, 'actor_id' => 1,
        ]), 'คืนเกินรับเข้า');
    });
});
