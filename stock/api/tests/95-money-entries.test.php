<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Roles;
use Optic\Service\Rx;
use Optic\Service\Settlement;
use Optic\Service\Stock;

/**
 * ตัวเลขเงินที่กรอกทีหลัง ต้องมีแถวของตัวเองในสมุด ลงวันที่วันที่กรอก
 *
 * ต้นทุน RX กับเงินที่สาขาจ่าย ถูกกรอกหลังเหตุการณ์จริงเสมอ — ใบกำกับมาทีหลัง
 * เงินกลับมาทีหลัง · เดิมทั้งสองอย่างเขียนทับของเก่าเงียบ ๆ ตัวเลขจึงไปโผล่ใน
 * เดือนที่ปิดไปแล้ว โดยไม่มีบรรทัดไหนบอกว่าใครกรอกเมื่อไร
 *
 * แถวใหม่ต้องมีจำนวนเป็นศูนย์ ไม่งั้นมันจะกลายเป็นของที่เคลื่อนจริง แล้วกฎที่ว่า
 * ยอดคงเหลือของล็อตเท่ากับผลรวมในสมุดจะพัง
 */

/** แถวในสมุดของชนิดหนึ่ง ที่อ้างถึงเอกสารใบหนึ่ง */
function ledgerRows(string $action, string $doc): array
{
    return Db::all(
        'SELECT * FROM inventory_logs WHERE action_type = ? AND reference_doc = ? ORDER BY id',
        [$action, $doc],
    );
}

group('ตัวเลขเงินที่กรอกทีหลัง');

test('ลงต้นทุน RX แล้วได้แถวใหม่ในสมุด ลงวันที่วันนี้', function () {
    withRollback(function () {
        $ref = doc('RX-COSTLOG');
        Rx::order(['sku' => customSku(), 'reference_doc' => $ref], [Roles::SALES], 1);
        $id = (int) Db::value('SELECT id FROM inventory_logs WHERE reference_doc = ?', [$ref]);

        eq(count(ledgerRows('COST', $ref)), 0, 'ก่อนกรอกยังไม่มีแถวเรื่องเงิน');

        Rx::setCost($id, '9800.00', [Roles::OWNER], 7);

        $rows = ledgerRows('COST', $ref);
        eq(count($rows), 1, 'กรอกครั้งเดียว ได้แถวเดียว');
        eq((int) $rows[0]['quantity'], 0, 'ไม่มีของเคลื่อนตอนกรอกราคา');
        eq((string) $rows[0]['unit_cost'], '9800.00', 'ต้นทุนที่กรอก');
        eq(substr((string) $rows[0]['created_at'], 0, 10), date('Y-m-d'), 'ลงวันที่วันที่กรอก');
        eq((int) $rows[0]['created_by'], 7, 'บอกว่าใครกรอก');

        /* ใบสั่งเดิมยังถือต้นทุนไว้เหมือนเดิม — กำไรของงานนั้นอ่านจากแถวนั้น */
        eq((string) Db::value('SELECT unit_cost FROM inventory_logs WHERE id = ?', [$id]), '9800.00', 'ใบสั่งเดิม');
    });
});

test('แถวเรื่องเงินไม่ทำให้ยอดคงเหลือกับสมุดหลุดจากกัน', function () {
    withRollback(function () {
        $ref = doc('RX-LEDGER');
        Rx::order(['sku' => customSku(), 'reference_doc' => $ref], [Roles::SALES], 1);
        $id = (int) Db::value('SELECT id FROM inventory_logs WHERE reference_doc = ?', [$ref]);
        Rx::setCost($id, '1200', [Roles::OWNER], 1);

        $drift = Db::all(
            'SELECT l.id FROM stock_lots l
               LEFT JOIN inventory_logs g ON g.lot_id = l.id
              GROUP BY l.id, l.remaining_qty
             HAVING l.remaining_qty <> COALESCE(SUM(g.quantity), 0)'
        );
        eq($drift, [], 'ทุกล็อตยังตรงกับสมุด');
    });
});

test('รับเงินจากสาขาแล้วได้แถวใหม่ ผูกกับใบเบิกใบนั้น', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $out = Stock::issue(issueReq($sku, 1, idem('settlelog'), [
            'branch_id' => aBranch(),
            'taken_by'  => 'สมชาย',
        ]));
        $issueId = (int) $out['branch_issue_id'];

        Settlement::settle($issueId, ['amount' => 750, 'received_date' => date('Y-m-d')], [Roles::OWNER], 3);

        $rows = Db::all(
            "SELECT * FROM inventory_logs WHERE action_type = 'SETTLE' AND branch_issue_id = ?",
            [$issueId],
        );
        eq(count($rows), 1, 'ได้แถวเดียว');
        eq((int) $rows[0]['quantity'], 0, 'เงินไม่ใช่ของ');
        eq((string) $rows[0]['unit_cost'], '750.00', 'จำนวนเงินที่รับทั้งใบ');
        eq(substr((string) $rows[0]['created_at'], 0, 10), date('Y-m-d'), 'ลงวันที่วันที่กรอก');
        eq((int) $rows[0]['created_by'], 3, 'บอกว่าใครกรอก');
    });
});

test('ตัดหนี้สูญก็ต้องเห็นในสมุด ที่ศูนย์บาท', function () {
    withRollback(function () {
        $sku = skuWithLots(1);
        $out = Stock::issue(issueReq($sku, 1, idem('writeofflog'), [
            'branch_id' => aBranch(),
            'taken_by'  => 'สมชาย',
        ]));
        $issueId = (int) $out['branch_issue_id'];

        Settlement::writeOff($issueId, ['note' => 'สาขาปิดไปแล้ว'], [Roles::OWNER], 4);

        $rows = Db::all(
            "SELECT * FROM inventory_logs WHERE action_type = 'SETTLE' AND branch_issue_id = ?",
            [$issueId],
        );
        eq(count($rows), 1, 'ตัดหนี้สูญก็มีบรรทัด');
        eq((string) $rows[0]['unit_cost'], '0.00', 'ได้เงินศูนย์บาท');
        ok(str_contains((string) $rows[0]['notes'], 'สาขาปิดไปแล้ว'), 'เหตุผลติดไปด้วย');
    });
});
