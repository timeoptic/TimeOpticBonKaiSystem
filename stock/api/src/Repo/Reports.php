<?php

declare(strict_types=1);

namespace Optic\Repo;

use Optic\ApiError;
use Optic\Db;

/**
 * The ledger added up over a stretch of time.
 *
 * Every figure here is derived from `inventory_logs` and `branch_issues` at read
 * time. Nothing is precomputed and stored, because a stored total is a second
 * copy of the truth that can drift from the first — and the invariant this
 * project is built on is that the ledger *is* the truth.
 *
 * Two dates rule everything below, and they are not the same date:
 *
 *   `created_at` on a movement — the day stock moved. Cost of goods sold is
 *                                dated by this, because that is when the goods
 *                                left.
 *   `settled_at` on a branch issue — the day money arrived. Profit from a branch
 *                                withdrawal is dated by this, because until then
 *                                there was no profit to date.
 *
 * A withdrawal in one month settled in the next therefore appears in the cost of
 * one and the profit of the other. That is not an inconsistency; it is the whole
 * reason the two dates are kept apart.
 */
final class Reports
{
    /**
     * @return array<string,mixed>
     */
    public static function overview(
        string $from,
        string $to,
        bool $money = false,
        array $filter = [],
    ): array {
        [$from, $to] = self::range($from, $to);
        [$lens, $lensArgs] = self::lens($filter);
        $joins = self::LENS_JOINS;

        // DATETIME columns carry no zone and the connection is pinned to +07:00,
        // so a plain BETWEEN on the dates covers exactly the local days asked
        // for. `< to + 1 day` rather than `<= to 23:59:59`: the latter silently
        // drops anything stamped in the last second of the day.
        $window = 'g.created_at >= ? AND g.created_at < DATE_ADD(?, INTERVAL 1 DAY)' . $lens;
        $args = [$from, $to, ...$lensArgs];

        $totals = Db::all(
            "SELECT g.action_type,
                    COUNT(*)                                   AS rows_n,
                    COALESCE(SUM(ABS(g.quantity)), 0)          AS qty,
                    COALESCE(SUM(ABS(g.quantity) * g.unit_cost), 0) AS value,
                    SUM(CASE WHEN g.unit_cost IS NULL THEN ABS(g.quantity) ELSE 0 END) AS qty_no_cost
             FROM inventory_logs g{$joins}
             WHERE {$window}
             GROUP BY g.action_type",
            $args,
        );

        $by = [];
        foreach ($totals as $r) {
            $by[$r['action_type']] = [
                'rows'      => (int) $r['rows_n'],
                'qty'       => (int) $r['qty'],
                'value'     => (float) $r['value'],
                'qtyNoCost' => (int) $r['qty_no_cost'],
            ];
        }
        // Quantities are stock facts and go to everyone; values are buying
        // prices and do not. Same rule as the stock screens.
        $slot = static function (string $t) use ($by, $money): array {
            $s = $by[$t] ?? ['rows' => 0, 'qty' => 0, 'value' => 0.0, 'qtyNoCost' => 0];
            $s['value'] = $money ? $s['value'] : null;
            return $s;
        };

        $daily = Db::all(
            "SELECT DATE(g.created_at) AS day,
                    COALESCE(SUM(CASE WHEN g.action_type IN ('IN','RETURN') THEN g.quantity ELSE 0 END), 0) AS in_qty,
                    COALESCE(SUM(CASE WHEN g.action_type = 'OUT' THEN ABS(g.quantity) ELSE 0 END), 0)       AS out_qty,
                    COALESCE(SUM(CASE WHEN g.action_type = 'SCRAP' THEN ABS(g.quantity) ELSE 0 END), 0)     AS scrap_qty,
                    COALESCE(SUM(CASE WHEN g.action_type = 'OUT'
                                      THEN ABS(g.quantity) * g.unit_cost ELSE 0 END), 0)                    AS cogs
             FROM inventory_logs g{$joins}
             WHERE {$window}
             GROUP BY DATE(g.created_at)
             ORDER BY day ASC",
            $args,
        );

        $top = Db::all(
            "SELECT p.id, p.sku, p.name,
                    COALESCE(SUM(ABS(g.quantity)), 0) AS qty,
                    COALESCE(SUM(ABS(g.quantity) * g.unit_cost), 0) AS cost
             FROM inventory_logs g{$joins}
             WHERE {$window} AND g.action_type = 'OUT' AND p.id IS NOT NULL
             GROUP BY p.id, p.sku, p.name
             ORDER BY qty DESC, cost DESC
             LIMIT 10",
            $args,
        );

        $people = Db::all(
            "SELECT COALESCE(NULLIF(g.scrap_by, ''), who.display_name, a.display_name) AS name,
                    COALESCE(SUM(ABS(g.quantity)), 0) AS qty,
                    COUNT(*) AS rows_n
             FROM inventory_logs g{$joins}
             LEFT JOIN admins who ON who.id = g.issued_to_admin_id
             LEFT JOIN admins a ON a.id = g.created_by
             WHERE {$window} AND g.action_type IN ('OUT','SCRAP')
               AND COALESCE(NULLIF(g.scrap_by, ''), who.display_name, a.display_name) IS NOT NULL
             /* จัดกลุ่มด้วยนิพจน์เต็ม ไม่ใช่ชื่อ alias — ตาราง products ที่ join
                เข้ามาให้ตัวกรองก็มีคอลัมน์ชื่อ name เหมือนกัน และ GROUP BY name
                จะไปเกาะคอลัมน์นั้นแทน แล้วคนคนเดียวจะแตกเป็นหลายแถวตามชื่อสินค้า */
             GROUP BY COALESCE(NULLIF(g.scrap_by, ''), who.display_name, a.display_name)
             ORDER BY qty DESC
             LIMIT 10",
            $args,
        );

        /**
         * ของเสีย แยกตามคนที่ทำเสีย
         *
         * แยกจาก `topPeople` ข้างบนซึ่งรวมของที่เบิกออกไปด้วย — ของที่เบิกคือ
         * งานที่ทำ ยิ่งเยอะยิ่งดี ส่วนของเสียคือของที่หายไปจากร้าน สองอย่างนี้
         * อ่านคนละความหมาย รวมเป็นตัวเลขเดียวแล้วคนขายเก่งจะขึ้นหัวตารางเดียว
         * กับคนทำแตกบ่อย
         *
         * ชื่อมาจาก `scrap_by` ที่พิมพ์ตอนตัด (034) ก่อน แล้วค่อยตกไปที่บัญชีใน
         * `issued_to_admin_id` ของแถวเก่าที่ระบุคนทำไว้แบบเดิม · ไม่ถอยไปใช้
         * `created_by` เหมือนตารางข้างบน — คนคีย์ไม่ใช่คนทำเสีย และการเดาแทนตรงนี้
         * คือการกล่าวหาคนผิด · แถวที่ไม่มีทั้งสองอย่างจะไม่ขึ้นในตารางนี้
         */
        $scrapPeople = Db::all(
            "SELECT COALESCE(NULLIF(g.scrap_by, ''), who.display_name) AS name,
                    COALESCE(SUM(ABS(g.quantity)), 0) AS qty,
                    COALESCE(SUM(ABS(g.quantity) * g.unit_cost), 0) AS cost,
                    COUNT(*) AS rows_n
             FROM inventory_logs g{$joins}
             LEFT JOIN admins who ON who.id = g.issued_to_admin_id
             WHERE {$window} AND g.action_type = 'SCRAP'
               AND COALESCE(NULLIF(g.scrap_by, ''), who.display_name) IS NOT NULL
             GROUP BY COALESCE(NULLIF(g.scrap_by, ''), who.display_name)
             ORDER BY qty DESC, rows_n DESC
             LIMIT 10",
            $args,
        );

        return [
            'from'    => $from,
            'to'      => $to,
            'in'      => $slot('IN'),
            'out'     => $slot('OUT'),
            'scrap'   => $slot('SCRAP'),
            'return'  => $slot('RETURN'),
            'adjust'  => $slot('ADJUST'),
            'rxOrder' => $slot('RX_ORDER'),
            'byDay'   => array_map(static fn(array $r): array => [
                'day'      => $r['day'],
                'inQty'    => (int) $r['in_qty'],
                'outQty'   => (int) $r['out_qty'],
                'scrapQty' => (int) $r['scrap_qty'],
                'cogs'     => $money ? (float) $r['cogs'] : null,
            ], $daily),
            'topProducts' => array_map(static fn(array $r): array => [
                'id'   => (int) $r['id'],
                'sku'  => $r['sku'],
                'name' => $r['name'],
                'qty'  => (int) $r['qty'],
                'cost' => $money ? (float) $r['cost'] : null,
            ], $top),
            'topPeople' => array_map(static fn(array $r): array => [
                'name' => $r['name'],
                'qty'  => (int) $r['qty'],
                'rows' => (int) $r['rows_n'],
            ], $people),
            'scrapPeople' => array_map(static fn(array $r): array => [
                'name' => $r['name'],
                'qty'  => (int) $r['qty'],
                'rows' => (int) $r['rows_n'],
                // Same rule as everywhere else here: quantities are stock facts
                // and go to everyone, buying prices do not.
                'cost' => $money ? (float) $r['cost'] : null,
            ], $scrapPeople),
            'branch' => self::branch($from, $to, $money, $filter),
            'branchDraws' => self::branchDraws($from, $to, $money, $filter),
            'rxBranches' => self::rxBranches($from, $to, $money, $filter),
            'sales'  => self::sales($window, $args, $money),
        ];
    }

    /**
     * join ที่ตัวกรองของหน้าแดชบอร์ดต้องใช้ ติดไปกับทุกคำถามที่อ่านจากสมุด
     *
     * ติดไปเสมอ ไม่ได้ต่อเมื่อมีตัวกรอง — SQL ที่ประกอบต่างกันตามว่ามีตัวกรองไหม
     * คือ SQL สองชุดที่ต้องถูกทั้งคู่ และชุดที่ไม่มีใครกรองคือชุดที่ไม่มีใครทดสอบ
     *
     * LEFT ทั้งสามใบ: แถวในสมุดที่ไม่ผูกสินค้า ไม่ผูกใบเบิกสาขา หรือไม่ใช่ใบสั่ง
     * RX ต้องยังถูกนับเมื่อไม่ได้กรองอะไร · การกรองเป็นคนตัดแถวพวกนั้นออกเอง
     */
    private const LENS_JOINS = "
             LEFT JOIN products p       ON p.id  = g.product_id
             LEFT JOIN branch_issues bi ON bi.id = g.branch_issue_id
             LEFT JOIN rx_orders rxo    ON rxo.log_id = g.id";

    /**
     * ตัวกรองของทั้งหน้าแดชบอร์ด — ชนิดสินค้า และสาขา
     *
     * ตัวเดียวกับที่หน้าจอใช้และที่ไฟล์ Excel ใช้ · แยกกันอยู่คนละชุดคือหน้าจอกับ
     * ไฟล์ที่ตอบคนละคำถามทั้งที่คนกดคิดว่าถามอันเดียวกัน ซึ่งรู้ตัวตอนเอาไฟล์ไป
     * เทียบกับจอแล้วเลขไม่ตรง
     *
     * **สาขาไม่ได้มีอยู่ในทุกแถวของสมุด** — ของเข้าคลังกลาง ปรับยอด คืนของ และ
     * ตัดของเสีย ไม่ผูกกับสาขาใด เพราะมันไม่ได้เกิดที่สาขา · เลือกสาขาแล้วแถว
     * พวกนั้นจึงหลุดออกจากผลลัพธ์และตัวเลขกลายเป็นศูนย์ ซึ่งเป็นความจริง ไม่ใช่
     * ข้อมูลหาย · หน้าจอเป็นคนบอกเรื่องนี้ ด้วยการหรี่การ์ดพวกนั้นลง
     *
     * `self` คือใบที่ร้านนี้ทำเอง ไม่ใช่สาขา — มันไม่มี id ให้เทียบ จึงถามด้วย
     * IS NULL ไม่ใช่ด้วยเลขศูนย์
     *
     * @param array{branch?:?string,type?:?string} $filter
     * @return array{0:string,1:list<mixed>}
     */
    private static function lens(array $filter): array
    {
        $sql = '';
        $args = [];

        $type = trim((string) ($filter['type'] ?? ''));
        if ($type !== '') {
            $sql .= ' AND p.product_type = ?';
            $args[] = $type;
        }

        $branch = trim((string) ($filter['branch'] ?? ''));
        if ($branch === 'self') {
            $sql .= ' AND COALESCE(bi.branch_id, rxo.branch_id) IS NULL';
        } elseif ($branch !== '') {
            $sql .= ' AND COALESCE(bi.branch_id, rxo.branch_id) = ?';
            $args[] = (int) $branch;
        }

        return [$sql, $args];
    }

    /**
     * สาขาไหนเบิกอะไรไปบ้าง แยกเป็นสินค้าทีละรายการ
     *
     * ตัวเลขรวมของฝั่งสาขา (`branch`) ตอบว่า "ค้างอยู่เท่าไร" ซึ่งเป็นคำถามของ
     * คนเก็บเงิน · ตารางนี้ตอบคำถามของคนคุมของ: เดือนนี้สาขานี้ขอเลนส์อะไรไป
     * กี่ชิ้น — คำถามที่ก่อนหน้านี้ต้องเปิดหน้าค้างรับแล้วไล่อ่านทีละใบ
     *
     * อ่านจาก `branch_issues` ไม่ใช่ `inventory_logs` เพราะหนึ่งใบเบิกคือหนึ่ง
     * ครั้งที่สาขามารับของ ส่วนสมุดแตกเป็นบรรทัดละล็อต — ใบเดียวที่ FIFO ตัดจาก
     * สามล็อตจะกลายเป็นสามแถวและอ่านเหมือนมารับสามรอบ
     *
     * ทุกสถานะ ไม่ใช่เฉพาะที่ยังค้าง: คำถามคือของออกไปเท่าไร ไม่ใช่หนี้เหลือ
     * เท่าไร · ใบที่ยกเลิกไปแล้วเท่านั้นที่ตัดออก เพราะของนั้นกลับเข้าคลังแล้ว
     *
     * @return list<array<string,mixed>>
     */
    private static function branchDraws(
        string $from,
        string $to,
        bool $money,
        array $filter = [],
    ): array {
        /* ตารางนี้ต่อสองท่อนด้วย UNION — ท่อนสาขา กับ ท่อนที่ร้านเบิกเอง · เลือก
           สาขาแล้วอีกท่อนต้องเงียบ และเลือก "ร้านนี้เอง" ก็กลับกัน · ปิดด้วย
           1 = 0 แทนที่จะประกอบ SQL คนละแบบ เพราะรูปของคำถามยังเป็นอันเดียวกัน
           เปลี่ยนแค่ว่าท่อนไหนมีสิทธิ์ตอบ */
        $type = trim((string) ($filter['type'] ?? ''));
        $branch = trim((string) ($filter['branch'] ?? ''));

        $issueWhere = '';
        $issueArgs = [];
        $selfWhere = '';
        $selfArgs = [];

        if ($type !== '') {
            $issueWhere .= ' AND p.product_type = ?';
            $issueArgs[] = $type;
            $selfWhere .= ' AND p.product_type = ?';
            $selfArgs[] = $type;
        }
        if ($branch === 'self') {
            $issueWhere .= ' AND 1 = 0';
        } elseif ($branch !== '') {
            $issueWhere .= ' AND i.branch_id = ?';
            $issueArgs[] = (int) $branch;
            $selfWhere .= ' AND 1 = 0';
        }

        $rows = Db::all(
            "SELECT b.id   AS branch_id,
                    b.name AS branch_name,
                    i.sku,
                    COALESCE(p.name, i.sku)  AS product_name,
                    p.product_type,
                    " . self::attr('lens_design') . " AS lens_design,
                    " . self::attr('lens_index')  . " AS lens_index,
                    " . self::attr('coating')     . " AS coating,
                    COUNT(*)                          AS draws,
                    COALESCE(SUM(i.quantity), 0)      AS qty,
                    COALESCE(SUM(i.cost_total), 0)    AS cost,
                    COALESCE(SUM(i.cost_unknown_qty), 0) AS qty_no_cost
             FROM branch_issues i
             JOIN branches b ON b.id = i.branch_id
             LEFT JOIN products p ON p.id = i.product_id
             WHERE i.issued_at >= ? AND i.issued_at < DATE_ADD(?, INTERVAL 1 DAY)
               AND i.status <> 'cancelled' {$issueWhere}
             GROUP BY b.id, b.name, i.sku, p.name, p.product_type,
                      lens_design, lens_index, coating

             UNION ALL

             /* ของที่ร้านเองเบิกไป — ไม่มีสาขาผูกอยู่ จึงไม่เคยอยู่ในตารางนี้มาก่อน
                ตารางที่มีแต่สาขาตอบไม่ได้ว่าของทั้งหมดที่ออกจากชั้นไปแบ่งกันอย่างไร
                ซึ่งเป็นคำถามที่คนเปิดไฟล์ถามจริง ๆ

                นับจากสมุดโดยตรง ไม่ใช่จาก branch_issues เพราะการเบิกของร้านเองไม่ได้
                สร้างแถวหนี้ · จำนวนในสมุดเป็นลบสำหรับของออก จึงกลับเครื่องหมายด้วย
                ABS ให้อ่านเป็นจำนวนชิ้นเหมือนฝั่งสาขา */
             SELECT NULL AS branch_id,
                    NULL AS branch_name,
                    p.sku,
                    COALESCE(p.name, p.sku)  AS product_name,
                    p.product_type,
                    " . self::attr('lens_design') . " AS lens_design,
                    " . self::attr('lens_index')  . " AS lens_index,
                    " . self::attr('coating')     . " AS coating,
                    COUNT(*)                                AS draws,
                    COALESCE(SUM(ABS(g.quantity)), 0)       AS qty,
                    COALESCE(SUM(ABS(g.quantity) * g.unit_cost), 0) AS cost,
                    SUM(CASE WHEN g.unit_cost IS NULL THEN ABS(g.quantity) ELSE 0 END) AS qty_no_cost
             FROM inventory_logs g
             JOIN products p ON p.id = g.product_id
             WHERE g.created_at >= ? AND g.created_at < DATE_ADD(?, INTERVAL 1 DAY)
               AND g.action_type = 'OUT' AND g.branch_issue_id IS NULL {$selfWhere}
             GROUP BY p.id, p.sku, p.name, p.product_type,
                      lens_design, lens_index, coating

             ORDER BY branch_name IS NULL DESC, branch_name ASC, qty DESC, sku ASC",
            [$from, $to, ...$issueArgs, $from, $to, ...$selfArgs],
        );

        /* ทำให้เป็นสาขาละก้อน ไม่ใช่แถวเรียงยาว — หน้าจอวาดทีละสาขาอยู่แล้ว
           และการรวมยอดของสาขาตรงนี้แปลว่าหน้าจอไม่ต้องบวกเอง แล้วบวกไม่ตรงกับ
           ที่ API บอกในวันที่กฎเปลี่ยน */
        $out = [];
        foreach ($rows as $r) {
            /* ร้านเองไม่มี id ของสาขา — ใช้ 0 เป็นกุญแจในอาเรย์ แต่ส่งออกเป็น null
               เพราะ 0 ไม่ใช่ id ของอะไรเลย · กฎเดียวกับฝั่ง `rxBranches` */
            $id = $r['branch_id'] === null ? 0 : (int) $r['branch_id'];
            if (!isset($out[$id])) {
                $out[$id] = [
                    'branchId' => $id === 0 ? null : $id,
                    'branch'   => $r['branch_name'] ?? 'TIMEOPTIC @ Be Well MEDICAL CENTER',
                    'draws'    => 0,
                    'qty'      => 0,
                    'cost'     => 0.0,
                    'qtyNoCost' => 0,
                    'items'    => [],
                ];
            }

            $out[$id]['draws'] += (int) $r['draws'];
            $out[$id]['qty']   += (int) $r['qty'];
            $out[$id]['cost']  += (float) $r['cost'];
            $out[$id]['qtyNoCost'] += (int) $r['qty_no_cost'];

            $out[$id]['items'][] = [
                'sku'        => $r['sku'],
                'name'       => $r['product_name'],
                'type'       => $r['product_type'],
                'lensDesign' => $r['lens_design'],
                'lensIndex'  => $r['lens_index'],
                'coating'    => $r['coating'],
                'draws'      => (int) $r['draws'],
                'qty'        => (int) $r['qty'],
                'qtyNoCost'  => (int) $r['qty_no_cost'],
                // กฎเดียวกับทั้งไฟล์: จำนวนเป็นข้อเท็จจริงของสต็อก ราคาทุนไม่ใช่
                'cost'       => $money ? (float) $r['cost'] : null,
            ];
        }

        foreach ($out as &$branch) {
            $branch['cost'] = $money ? $branch['cost'] : null;
        }
        unset($branch);

        return array_values($out);
    }

    /**
     * ใบสั่งตัด RX แยกตามคนสั่ง — ร้านเองและสาขา อยู่ในตารางเดียวกัน
     *
     * คนละคำถามกับ `branchDraws` ข้างบน: นั่นคือของที่ออกจากชั้นไป นี่คือของที่
     * ต้องไปสั่งจากผู้ขายมาให้ · สาขาหนึ่งอาจเบิกน้อยแต่สั่งตัดเยอะ ซึ่งเป็นคนละ
     * เรื่องกันทั้งเรื่องเงินและเรื่องงาน
     *
     * ใบที่ไม่ได้ระบุสาขาคือร้านสั่งเอง และมีแถวของตัวเองในชื่อ TimeOptic —
     * เคยตัดทิ้งเพราะคิดว่าเป็นค่าปกติที่ไม่ต้องบอก แต่ตารางที่มีแต่สาขาตอบไม่ได้
     * ว่างานสั่งตัดทั้งหมดแบ่งกันอย่างไร ซึ่งเป็นคำถามที่คนเปิดหน้านี้ถามจริง ๆ
     *
     * รูปร่างเหมือน `branchDraws` ทุกอย่าง เพราะหน้าจอวาดสองก้อนนี้ด้วยโค้ดชุด
     * เดียวกัน — สาขาละก้อน ข้างในเป็นรายการสินค้าที่สั่ง
     *
     * ใบที่ยกเลิกแล้วไม่นับ ด้วยเหตุผลเดียวกับฝั่งเบิก
     *
     * @return list<array<string,mixed>>
     */
    private static function rxBranches(
        string $from,
        string $to,
        bool $money,
        array $filter = [],
    ): array {
        /* ใบสั่ง RX พกสาขาของตัวเองมาในตาราง (rx_orders.branch_id) จึงกรองตรง
           คอลัมน์นั้นได้เลย ไม่ต้องผ่าน lens ที่ทำไว้ให้คำถามฝั่งสมุด */
        $where = '';
        $extra = [];

        $type = trim((string) ($filter['type'] ?? ''));
        if ($type !== '') {
            $where .= ' AND p.product_type = ?';
            $extra[] = $type;
        }

        $branch = trim((string) ($filter['branch'] ?? ''));
        if ($branch === 'self') {
            $where .= ' AND r.branch_id IS NULL';
        } elseif ($branch !== '') {
            $where .= ' AND r.branch_id = ?';
            $extra[] = (int) $branch;
        }

        $rows = Db::all(
            "SELECT r.branch_id,
                    b.name AS branch_name,
                    p.sku,
                    p.name AS product_name,
                    p.product_type,
                    " . self::attr('lens_design') . " AS lens_design,
                    " . self::attr('lens_index')  . " AS lens_index,
                    " . self::attr('coating')     . " AS coating,
                    COUNT(*)                              AS orders_n,
                    COALESCE(SUM(ABS(g.quantity)), 0)     AS qty,
                    COALESCE(SUM(ABS(g.quantity) * g.unit_cost), 0) AS cost,
                    COALESCE(SUM(r.sale_price), 0)        AS revenue,
                    SUM(CASE WHEN g.unit_cost IS NULL THEN 1 ELSE 0 END) AS awaiting_cost
             FROM inventory_logs g
             JOIN rx_orders r ON r.log_id = g.id
             JOIN products p ON p.id = g.product_id
             LEFT JOIN branches b ON b.id = r.branch_id
             WHERE g.created_at >= ? AND g.created_at < DATE_ADD(?, INTERVAL 1 DAY)
               AND g.action_type = 'RX_ORDER' AND r.cancelled_at IS NULL {$where}
             GROUP BY r.branch_id, b.name, p.id, p.sku, p.name, p.product_type,
                      lens_design, lens_index, coating
             ORDER BY b.name IS NULL DESC, b.name ASC, qty DESC, p.sku ASC",
            [$from, $to, ...$extra],
        );

        $out = [];
        foreach ($rows as $r) {
            /* ร้านเองไม่มี id ของสาขา — ใช้ 0 เป็นกุญแจของก้อนนี้ในอาเรย์ แต่ส่ง
               `branchId` ออกไปเป็น null เพราะ 0 ไม่ใช่ id ของอะไรเลย และหน้าจอ
               ที่เอาไปทำลิงก์ต่อจะได้ไม่ยิงไปหาสาขาหมายเลขศูนย์ */
            $id = $r['branch_id'] === null ? 0 : (int) $r['branch_id'];
            if (!isset($out[$id])) {
                $out[$id] = [
                    'branchId'     => $id === 0 ? null : $id,
                    'branch'       => $r['branch_name'] ?? 'TIMEOPTIC @ Be Well MEDICAL CENTER',
                    'orders'       => 0,
                    'qty'          => 0,
                    'awaitingCost' => 0,
                    'cost'         => 0.0,
                    'revenue'      => 0.0,
                    'items'        => [],
                ];
            }

            $out[$id]['orders']       += (int) $r['orders_n'];
            $out[$id]['qty']          += (int) $r['qty'];
            $out[$id]['awaitingCost'] += (int) $r['awaiting_cost'];
            $out[$id]['cost']         += (float) $r['cost'];
            $out[$id]['revenue']      += (float) $r['revenue'];

            $out[$id]['items'][] = [
                'sku'          => $r['sku'],
                'name'         => $r['product_name'],
                'type'         => $r['product_type'],
                'lensDesign'   => $r['lens_design'],
                'lensIndex'    => $r['lens_index'],
                'coating'      => $r['coating'],
                'orders'       => (int) $r['orders_n'],
                'qty'          => (int) $r['qty'],
                'awaitingCost' => (int) $r['awaiting_cost'],
                // กฎเดียวกับทั้งไฟล์: จำนวนเป็นข้อเท็จจริงของสต็อก ราคาทุนไม่ใช่
                'cost'         => $money ? (float) $r['cost'] : null,
                // ราคาขายไม่ใช่ราคาทุน แต่ก็เป็นตัวเลขเงินเหมือนกัน กฎเดียวกัน
                'revenue'      => $money ? (float) $r['revenue'] : null,
            ];
        }

        foreach ($out as &$branch) {
            $branch['cost']    = $money ? $branch['cost'] : null;
            $branch['revenue'] = $money ? $branch['revenue'] : null;
        }
        unset($branch);

        return array_values($out);
    }

    /**
     * ค่าในคอลัมน์ `attributes` ของสินค้า อ่านออกมาเป็นคอลัมน์ธรรมดา
     *
     * สำเนาของ `Inventory::attr` ตัวเดียวกัน — NULLIF เพราะ JSON_UNQUOTE เปลี่ยน
     * null ของ JSON เป็นสตริงสี่ตัวอักษร "null" ไม่ใช่ NULL ของ SQL
     */
    private static function attr(string $key): string
    {
        return "NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.{$key}')), 'null')";
    }

    /**
     * ยอดขายและกำไรเท่าที่สมุดคลังรู้
     *
     * สมุดนี้ไม่ใช่สมุดขาย มันบันทึก "ของเคลื่อนที่" — บรรทัดส่วนใหญ่จึงมีต้นทุน
     * แต่ไม่มีราคาขาย เพราะตอนตัดของออกไม่มีใครบอกระบบว่าขายได้เท่าไร · ที่มีทั้ง
     * สองค่าคือใบสั่งตัด RX ซึ่งตกลงราคากันต่อใบและบันทึกไว้ทั้งคู่
     *
     * เงื่อนไขจึงเป็นกฎเดียว ไม่ใช่รายชื่อกรณี: **บรรทัดที่ของออกจากคลัง และมี
     * ราคาขายติดอยู่** · วันนี้เข้าเงื่อนไขแต่ RX_ORDER แต่ถ้าวันหน้าการตัดขาย
     * เริ่มบันทึกราคาขายลง OUT ด้วย ตัวเลขนี้จะนับให้เองโดยไม่ต้องมีใครมาแก้ตรงนี้
     *
     * สามชนิดที่ *ไม่* นับ และเหตุผล:
     *   IN     มี sale_price ก็จริง แต่นั่นคือราคาที่ตั้งจะขายตอนรับเข้า ไม่ใช่
     *          ราคาที่ขายได้ · นับเข้าไปคือนับของที่ยังอยู่บนชั้นเป็นยอดขาย
     *   PRICE  เป็นบรรทัดบันทึกการแก้ราคา `quantity` เป็นศูนย์ ไม่มีของเคลื่อน
     *   SETTLE เงินจากสาขา มีที่ทางของมันที่หน้าค้างรับ และคิดคนละวันกัน
     *          (ดูหมายเหตุหัวไฟล์เรื่องนาฬิกาสองเรือน) รวมเข้ามาจะได้ยอดที่
     *          อธิบายไม่ได้ว่านับวันไหน
     *
     * ใบสั่งตัดที่ถูกยกเลิกไม่นับ — แถวยังอยู่ในสมุดตามกฎ (ประวัติลบไม่ได้) แต่
     * มันไม่ใช่ของที่ขายได้ · `cancelled_at` เป็นตัวบอก ดู migration 024
     *
     * `costedRevenue` แยกจาก `revenue` เพราะอัตรากำไรต้องหารด้วยตัวหลัง — หาร
     * ด้วยยอดรวมทั้งก้อนคือเอากำไรของใบที่รู้ต้นทุน ไปหารด้วยยอดขายของใบที่
     * มากกว่านั้น แล้วได้เปอร์เซ็นต์ที่ต่ำกว่าจริงโดยไม่มีอะไรบอกว่าทำไม
     *
     * @param list<mixed> $args
     * @return array<string,mixed>
     */
    private static function sales(string $window, array $args, bool $money): array
    {
        $r = Db::one(
            "SELECT COUNT(*) AS bills,
                    COALESCE(SUM(ABS(g.quantity) * g.sale_price), 0) AS revenue,
                    COALESCE(SUM(CASE WHEN g.unit_cost IS NOT NULL
                                      THEN ABS(g.quantity) * g.sale_price ELSE 0 END), 0) AS costed_revenue,
                    COALESCE(SUM(CASE WHEN g.unit_cost IS NOT NULL
                                      THEN ABS(g.quantity) * (g.sale_price - g.unit_cost) ELSE 0 END), 0) AS profit,
                    COALESCE(SUM(g.unit_cost IS NOT NULL), 0) AS costed,
                    COALESCE(SUM(g.unit_cost IS NULL), 0)     AS uncosted
             FROM inventory_logs g" . self::LENS_JOINS . "
             WHERE {$window}
               AND g.action_type IN ('RX_ORDER','OUT')
               AND g.sale_price IS NOT NULL
               AND rxo.cancelled_at IS NULL",
            $args,
        ) ?? ['bills' => 0, 'revenue' => 0, 'costed_revenue' => 0, 'profit' => 0, 'costed' => 0, 'uncosted' => 0];

        $costedRevenue = (float) $r['costed_revenue'];

        return [
            'bills'    => (int) $r['bills'],
            'costed'   => (int) $r['costed'],
            'uncosted' => (int) $r['uncosted'],
            // ตัวเลขเงินไปเฉพาะบทบาทที่เห็นราคาทุนได้ กฎเดียวกับทั้งไฟล์
            'revenue'  => $money ? (float) $r['revenue'] : null,
            'profit'   => $money ? (float) $r['profit'] : null,
            'margin'   => $money && $costedRevenue > 0
                ? round((float) $r['profit'] / $costedRevenue * 100, 1)
                : null,
        ];
    }

    /**
     * The branch side of the period, deliberately counted on two different
     * clocks — see the note at the top of this file.
     *
     * @return array<string,mixed>
     */
    private static function branch(
        string $from,
        string $to,
        bool $money,
        array $filter = [],
    ): array {
        /* ใบเบิกสาขาผูกกับสาขาอยู่แล้วโดยนิยาม — เลือก "ร้านนี้เอง" จึงไม่ใช่การ
           กรองให้แคบลง แต่คือการถามหาสิ่งที่ตารางนี้ไม่มี · ตอบศูนย์ ซึ่งเป็น
           ความจริง: ร้านไม่ได้ติดหนี้ตัวเอง */
        $where = '';
        $extra = [];

        $type = trim((string) ($filter['type'] ?? ''));
        if ($type !== '') {
            $where .= ' AND p.product_type = ?';
            $extra[] = $type;
        }

        $branch = trim((string) ($filter['branch'] ?? ''));
        if ($branch === 'self') {
            $where .= ' AND 1 = 0';
        } elseif ($branch !== '') {
            $where .= ' AND i.branch_id = ?';
            $extra[] = (int) $branch;
        }

        $from_ = 'FROM branch_issues i LEFT JOIN products p ON p.id = i.product_id';

        $issued = Db::one(
            "SELECT COUNT(*) AS n, COALESCE(SUM(i.cost_total), 0) AS cost
             {$from_}
             WHERE i.issued_at >= ? AND i.issued_at < DATE_ADD(?, INTERVAL 1 DAY) {$where}",
            [$from, $to, ...$extra],
        ) ?? ['n' => 0, 'cost' => 0];

        $settled = Db::one(
            "SELECT COUNT(*) AS n,
                    COALESCE(SUM(i.settled_amount), 0) AS amount,
                    COALESCE(SUM(i.settled_amount - i.cost_total), 0) AS profit
             {$from_}
             WHERE i.status = 'settled'
               AND i.settled_at >= ? AND i.settled_at < DATE_ADD(?, INTERVAL 1 DAY) {$where}",
            [$from, $to, ...$extra],
        ) ?? ['n' => 0, 'amount' => 0, 'profit' => 0];

        // Not windowed: what is owed right now is owed regardless of which dates
        // are being looked at, and hiding it behind a date filter would let a
        // debt go unnoticed simply because someone was reading last month.
        $owing = Db::one(
            "SELECT COUNT(*) AS n, COALESCE(SUM(i.cost_total), 0) AS cost
             {$from_} WHERE i.status = 'pending' {$where}",
            $extra,
        ) ?? ['n' => 0, 'cost' => 0];

        return [
            'issuedCount'   => (int) $issued['n'],
            'issuedCost'    => $money ? (float) $issued['cost'] : null,
            'settledCount'  => (int) $settled['n'],
            'settledAmount' => $money ? (float) $settled['amount'] : null,
            'settledProfit' => $money ? (float) $settled['profit'] : null,
            'owingCount'    => (int) $owing['n'],
            'owingCost'     => $money ? (float) $owing['cost'] : null,
        ];
    }

    /** How long a thing may sit unsold before the shop is told about it. */
    public const IDLE_DAYS = 90;

    /**
     * รายการรับเข้า / จ่ายออก / ของเสีย ทีละบรรทัด สำหรับไฟล์ Excel ของแดชบอร์ด (ร้านขอ 18 ก.ย. 2026)
     *
     * ชีตสรุปตอบว่า "เท่าไร" · ร้านอยากรู้ว่า "ของที่ออกไปไปกับออเดอร์ไหน" และ "วันนี้รับอะไรเข้ามา"
     * ซึ่งต้องเห็นทีละบรรทัด · ช่วงวันและตัวกรองสาขา/ชนิดชุดเดียวกับ overview ตัวเลขในไฟล์จึงรวม
     * กลับมาเท่ากับชีตสรุปเสมอ · ต้นทุนเฉพาะคนที่เห็นทุน
     *
     * ออเดอร์ของแถวที่ออก = เลขเอกสารในสมุด (หน้าร้านใส่เลขเคส ใบเบิกสาขาใส่เลขใบ) · ใบเบิกสาขา
     * ที่ไม่มีเลขเอกสารใช้ชื่อสาขาแทน · ไม่มีทั้งคู่คือ "ไม่ระบุเอกสาร"
     *
     * @param array{branch?:?string,type?:?string} $filter
     * @return array{rows:list<array<string,mixed>>,truncated:bool}
     */
    public static function lines(string $from, string $to, bool $money = false, array $filter = []): array
    {
        [$from, $to] = self::range($from, $to);
        [$lens, $lensArgs] = self::lens($filter);
        $cap = 20000;

        $rows = Db::all(
            "SELECT g.id, g.action_type, g.created_at, g.quantity, g.unit_cost, g.reference_doc, g.notes, g.scrap_by,
                    p.sku, p.name AS product_name, p.product_type,
                    l.lot_number, l.expiry_date, s.name AS supplier_name,
                    a.display_name AS actor_name, who.display_name AS issued_to_name,
                    br.name AS branch_name, bi.taken_by
             FROM inventory_logs g" . self::LENS_JOINS . "
             LEFT JOIN stock_lots l ON l.id = g.lot_id
             LEFT JOIN suppliers s  ON s.id = l.supplier_id
             LEFT JOIN admins a     ON a.id = g.created_by
             LEFT JOIN admins who   ON who.id = g.issued_to_admin_id
             LEFT JOIN branches br  ON br.id = bi.branch_id
             WHERE g.action_type IN ('IN', 'OUT', 'SCRAP')
               AND g.created_at >= ? AND g.created_at < DATE_ADD(?, INTERVAL 1 DAY){$lens}
             ORDER BY g.created_at ASC, g.id ASC
             LIMIT " . ($cap + 1),
            [$from, $to, ...$lensArgs],
        );

        $truncated = count($rows) > $cap;
        $rows = array_slice($rows, 0, $cap);

        return [
            'truncated' => $truncated,
            'rows' => array_map(static function (array $r) use ($money): array {
                $qty = abs((int) $r['quantity']);
                $cost = $money && $r['unit_cost'] !== null ? (float) $r['unit_cost'] : null;
                $doc = trim((string) ($r['reference_doc'] ?? ''));
                return [
                    'kind'      => $r['action_type'],
                    'at'        => $r['created_at'],
                    'doc'       => $doc !== '' ? $doc : null,
                    'branch'    => $r['branch_name'] ?? null,
                    'sku'       => $r['sku'],
                    'name'      => $r['product_name'],
                    'type'      => $r['product_type'],
                    'lot'       => $r['lot_number'],
                    'expiry'    => $r['expiry_date'],
                    'supplier'  => $r['supplier_name'],
                    'qty'       => $qty,
                    'unitCost'  => $cost,
                    'total'     => $cost === null ? null : round($cost * $qty, 2),
                    // คนที่เอาของไป — ใบเบิกสาขาคือคนมารับ · ของเสียคือชื่อคนทำเสีย · นอกนั้นคือคนเบิก
                    'who'       => $r['taken_by'] ?? $r['scrap_by'] ?? $r['issued_to_name'] ?? $r['actor_name'],
                    'keyedBy'   => $r['actor_name'],
                    'note'      => $r['notes'],
                ];
            }, $rows),
        ];
    }

    /**
     * Which goods move and which do not — the same shelf read from both ends.
     *
     * Two questions that are only worth asking together. "What sells" alone
     * reorders the winners; "what sits" alone writes off the losers; side by
     * side they are a buying decision, which is the thing the owner actually
     * came for.
     *
     * The two are counted on different clocks on purpose. Best sellers belong
     * to a chosen stretch of days, because "sells well" is a claim about a
     * period and a lens that sold twenty last winter should not still be called
     * a winner in June. Slow movers ignore the window entirely: something that
     * has not moved since January is not made fresh by looking at March, and
     * the whole point of the list is the age.
     *
     * @return array<string,mixed>
     */
    public static function movers(
        string $from,
        string $to,
        int $idleDays,
        bool $money,
        array $filter = [],
    ): array {
        [$from, $to] = self::range($from, $to);
        [$lens, $lensArgs] = self::lens($filter);
        $joins = self::LENS_JOINS;

        /* ของที่ค้างไม่ขยับเป็นคำถามเกี่ยวกับชั้นวาง ไม่ใช่เกี่ยวกับการเคลื่อนไหว
           — มันอ่านจาก stock_lots ซึ่งไม่มีสาขา ของกองอยู่ที่คลังกลางกองเดียว ·
           ชนิดสินค้ากรองได้ตามปกติเพราะเป็นคุณสมบัติของตัวสินค้าเอง */
        $slowWhere = '';
        $slowArgs = [];
        $type = trim((string) ($filter['type'] ?? ''));
        if ($type !== '') {
            $slowWhere = ' AND p.product_type = ?';
            $slowArgs[] = $type;
        }
        // Below a week the list is noise — nothing a shop stocks moves daily —
        // and above ten years it is the whole catalogue with a longer query.
        $idle = max(7, min(3650, $idleDays));

        $best = Db::all(
            "SELECT p.id, p.sku, p.name, p.brand, p.product_type,
                    COALESCE(SUM(ABS(g.quantity)), 0)               AS qty,
                    COUNT(*)                                        AS rows_n,
                    COALESCE(SUM(ABS(g.quantity) * g.unit_cost), 0) AS cost,
                    COALESCE(s.on_hand, 0)                          AS on_hand,
                    p.min_stock
             FROM inventory_logs g{$joins}
             LEFT JOIN (SELECT product_id, SUM(remaining_qty) AS on_hand
                        FROM stock_lots GROUP BY product_id) s ON s.product_id = p.id
             WHERE g.created_at >= ? AND g.created_at < DATE_ADD(?, INTERVAL 1 DAY){$lens}
               AND g.action_type = 'OUT' AND p.id IS NOT NULL
             GROUP BY p.id, p.sku, p.name, p.brand, p.product_type, s.on_hand, p.min_stock
             ORDER BY qty DESC, cost DESC, p.id ASC
             LIMIT 25",
            [$from, $to, ...$lensArgs],
        );

        /**
         * Stock that is still here and has stopped leaving.
         *
         * Dated by the last time any of it was sold, and — for something that
         * has never sold at all — by the day the oldest lot still on the shelf
         * arrived. Without that second date a product that has never moved
         * would have no date, sort nowhere, and be missing from the one list
         * whose whole subject it is.
         *
         * Only OUT counts as movement. Scrapping a lens is the shop losing it,
         * not the shop selling it, and a drawer that has to be written off
         * twice a year is exactly the drawer this list exists to name.
         */
        $slow = Db::all(
            "SELECT p.id, p.sku, p.name, p.brand, p.product_type,
                    s.on_hand, s.stock_value, s.lots_missing_cost, s.oldest,
                    DATE(m.last_out) AS last_out,
                    DATEDIFF(CURDATE(), COALESCE(DATE(m.last_out), s.oldest)) AS idle_days
             FROM products p
             JOIN (SELECT product_id,
                          SUM(remaining_qty) AS on_hand,
                          SUM(CASE WHEN cost_per_unit IS NULL THEN 0
                                   ELSE remaining_qty * cost_per_unit END) AS stock_value,
                          SUM(CASE WHEN cost_per_unit IS NULL AND remaining_qty > 0
                                   THEN 1 ELSE 0 END) AS lots_missing_cost,
                          MIN(CASE WHEN remaining_qty > 0 THEN received_date END) AS oldest
                   FROM stock_lots
                   GROUP BY product_id
                   HAVING SUM(remaining_qty) > 0) s ON s.product_id = p.id
             LEFT JOIN (SELECT product_id, MAX(created_at) AS last_out
                        FROM inventory_logs
                        WHERE action_type = 'OUT'
                        GROUP BY product_id) m ON m.product_id = p.id
             WHERE p.is_custom_made = 0{$slowWhere}
               AND COALESCE(DATE(m.last_out), s.oldest) <= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             ORDER BY idle_days DESC, s.on_hand DESC, p.id ASC
             LIMIT 50",
            [...$slowArgs, $idle],
        );

        return [
            'from'      => $from,
            'to'        => $to,
            'idleDays'  => $idle,
            'best'      => array_map(static fn(array $r): array => [
                'id'          => (int) $r['id'],
                'sku'         => $r['sku'],
                'name'        => $r['name'],
                'brand'       => $r['brand'],
                'productType' => $r['product_type'],
                'qty'         => (int) $r['qty'],
                'rows'        => (int) $r['rows_n'],
                'cost'        => $money ? (float) $r['cost'] : null,
                'onHand'      => (int) $r['on_hand'],
                'minStock'    => (int) $r['min_stock'],
            ], $best),
            'slow'      => array_map(static fn(array $r): array => [
                'id'          => (int) $r['id'],
                'sku'         => $r['sku'],
                'name'        => $r['name'],
                'brand'       => $r['brand'],
                'productType' => $r['product_type'],
                'onHand'      => (int) $r['on_hand'],
                // Buying prices are a permission, the same as everywhere else.
                'stockValue'  => $money ? (float) $r['stock_value'] : null,
                // Some of the money in this row is unknown rather than zero.
                // Saying so is what keeps the total from reading as the answer.
                'lotsMissingCost' => (int) $r['lots_missing_cost'],
                'oldestLot'   => $r['oldest'],
                // Null means it has never been sold — not that it sold today.
                'lastOut'     => $r['last_out'],
                'idleDays'    => (int) $r['idle_days'],
            ], $slow),
        ];
    }

    /**
     * Both ends of the window, checked and put in order.
     *
     * A reversed range is corrected rather than refused: someone picking dates
     * in a calendar gets them the wrong way round often enough that an error
     * message would only be in the way.
     *
     * @return array{0:string,1:string}
     */
    private static function range(string $from, string $to): array
    {
        foreach ([$from, $to] as $d) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                throw ApiError::badRequest('ช่วงวันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD', 'bad_date');
            }
            [$y, $m, $dd] = array_map(intval(...), explode('-', $d));
            if (!checkdate($m, $dd, $y)) {
                throw ApiError::badRequest("วันที่ {$d} ไม่มีอยู่จริง", 'bad_date');
            }
        }

        return $from <= $to ? [$from, $to] : [$to, $from];
    }
}
