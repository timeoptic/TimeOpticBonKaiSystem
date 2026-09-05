<?php

declare(strict_types=1);

namespace Optic\Service;

use PDO;

/**
 * ต้นทุนที่เพิ่งรู้ ไล่ไปเติมทุกที่ที่รอมันอยู่
 *
 * ของออกจากคลังก่อนใบกำกับมาถึงเป็นเรื่องปกติของร้านนี้ — ล็อตถูกรับเข้าโดยยัง
 * ไม่มีต้นทุน ของถูกเบิกหรือขายไป และทุกแถวที่เกิดจากมันถูกประทับว่า "ไม่รู้
 * ต้นทุน" · ก่อนหน้านี้พอใบกำกับมาถึงแล้วกรอกต้นทุน มีแค่ `stock_lots` ที่
 * เปลี่ยน ส่วนที่เหลือค้างอยู่อย่างนั้นตลอดไป ไม่ว่าจะกรอกจากหน้าไหน
 *
 * ที่รอมันอยู่มีสี่ที่ และไม่มีที่ไหนคิดเองใหม่ได้:
 *
 *   1. `inventory_logs.unit_cost` — สมุดคลัง · แดชบอร์ด ต้นทุนขาย กำไร และคำว่า
 *      "อีกกี่ชิ้นยังไม่รู้ต้นทุน" ทั้งหมดคิดสดจากคอลัมน์นี้ พอเติมแล้วตัวเลข
 *      ทุกตัวที่อ่านจากมันถูกต้องทันทีโดยไม่ต้องแตะอะไรอีก
 *   2. `branch_issues` — ยอดของใบเบิกสาขาถูกแช่ไว้ตอนเบิก (ตั้งใจ ดูข้างล่าง)
 *   3. `sales.unit_cost_snapshot` — สำเนาต้นทุนของฝั่งขาย เก็บไว้ให้กำไรย้อนหลัง
 *      อยู่รอดหลังล้างคลัง (migration 023)
 *   4. `custom_orders.*_cost_snapshot` — อย่างเดียวกันของงานตัดแว่น สามช่อง
 *      เพราะหนึ่งงานมีกรอบหนึ่งและเลนส์สองข้าง
 *
 * **เติมเฉพาะช่องที่ว่าง ไม่เขียนทับของเดิม** ทุกคำสั่งข้างล่างมี `IS NULL`
 * กำกับ · การ "แก้" ต้นทุนที่เคยกรอกไว้ผิดจึงไม่ย้อนไปรื้อกำไรของรายการที่ปิด
 * ไปแล้ว ซึ่งเป็นเหตุผลที่ตัวเลขพวกนี้ถูกแช่ไว้ตั้งแต่แรก · ที่ทำตรงนี้เป็นคนละ
 * เรื่อง: เติมค่าที่ยังไม่เคยมี ไม่ใช่แก้ค่าที่มีอยู่
 *
 * และใบเบิกสาขาเติมเฉพาะที่ยัง `pending` · ใบที่รับเงินหรือตัดหนี้สูญไปแล้วปิดจบ
 * ด้วยตัวเลขที่ใช้ตัดสินใจตอนนั้น ขยับทีหลังคือการแก้บัญชีที่ปิดแล้ว
 */
final class Costing
{
    /**
     * เติมต้นทุนของล็อตหนึ่งให้ทุกที่ที่อ้างถึงมันและยังว่างอยู่
     *
     * @param string $cost ต้นทุนต่อหน่วย เป็นสตริงเพราะคอลัมน์เป็น DECIMAL —
     *                     แปลงเป็น float ระหว่างทางคือเปิดช่องให้ปัดเศษ
     * @return int จำนวนแถวในสมุดที่ได้ต้นทุนไป · ศูนย์แปลว่าไม่มีอะไรรออยู่
     */
    public static function fill(PDO $pdo, int $lotId, string $cost): int
    {
        $logs = $pdo->prepare(
            'UPDATE inventory_logs SET unit_cost = ? WHERE lot_id = ? AND unit_cost IS NULL'
        );
        $logs->execute([$cost, $lotId]);
        $filled = $logs->rowCount();

        self::fillBranchIssues($pdo, $lotId);
        self::fillSalesSnapshots($pdo, $lotId, $cost);

        return $filled;
    }

    /**
     * ยอดของใบเบิกสาขา คิดใหม่จากสมุด ไม่ใช่บวกส่วนต่างเข้าไป
     *
     * ใบเดียวกินได้หลายล็อต และการบวกทีละครั้งจะเพี้ยนทันทีที่ล็อตที่สองถูกกรอก
     * ต้นทุนตามมา · อ่านจากสมุดใหม่ทั้งใบจึงถูกเสมอ ไม่ว่าจะเรียกกี่รอบ
     */
    private static function fillBranchIssues(PDO $pdo, int $lotId): void
    {
        $pdo->prepare(
            "UPDATE branch_issues i
                SET i.cost_total = (
                        SELECT COALESCE(SUM(ABS(g.quantity) * g.unit_cost), 0)
                        FROM inventory_logs g
                        WHERE g.branch_issue_id = i.id
                          AND g.action_type = 'OUT'
                          AND g.unit_cost IS NOT NULL
                    ),
                    i.cost_unknown_qty = (
                        SELECT COALESCE(SUM(CASE WHEN g.unit_cost IS NULL THEN ABS(g.quantity) ELSE 0 END), 0)
                        FROM inventory_logs g
                        WHERE g.branch_issue_id = i.id
                          AND g.action_type = 'OUT'
                    )
              WHERE i.status = 'pending'
                AND i.id IN (
                        SELECT g2.branch_issue_id FROM inventory_logs g2
                        WHERE g2.lot_id = ? AND g2.branch_issue_id IS NOT NULL
                    )"
        )->execute([$lotId]);
    }

    /**
     * สำเนาต้นทุนของฝั่งขาย — บิลขายทั่วไป และงานตัดแว่น
     *
     * สองตารางนี้เป็นของหน้าร้าน แต่คอลัมน์สำเนาต้นทุนเป็นของโมดูลนี้ (สร้างที่
     * migration 023) และโมดูลนี้เป็นที่เดียวที่รู้ว่าต้นทุนเพิ่งถูกกรอก · ถ้าไม่
     * เติมที่นี่ รายงานกำไรฝั่งขายจะบอกว่างานนั้นไม่มีต้นทุนไปตลอด ทั้งที่คลัง
     * รู้แล้วตั้งแต่วันที่ใบกำกับมาถึง
     *
     * งานตัดแว่นมีสามช่องเพราะหนึ่งงานมีกรอบหนึ่งกับเลนส์สองข้าง และแต่ละชิ้นมา
     * จากคนละล็อตได้ · เขียนทีละช่องจึงถูกกว่าเขียนรวดเดียว
     */
    private static function fillSalesSnapshots(PDO $pdo, int $lotId, string $cost): void
    {
        $pdo->prepare(
            'UPDATE sales SET unit_cost_snapshot = ?
              WHERE product_stock_id = ? AND unit_cost_snapshot IS NULL'
        )->execute([$cost, $lotId]);

        foreach ([
            'frame_cost_snapshot'  => 'frame_product_id',
            'lens_cost_snapshot'   => 'lens_product_id',
            'lens_r_cost_snapshot' => 'right_lens_product_id',
        ] as $snapshot => $ref) {
            $pdo->prepare(
                "UPDATE custom_orders SET {$snapshot} = ?
                  WHERE {$ref} = ? AND {$snapshot} IS NULL"
            )->execute([$cost, $lotId]);
        }
    }
}
