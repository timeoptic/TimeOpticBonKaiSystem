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
    public static function overview(string $from, string $to, bool $money = false): array
    {
        [$from, $to] = self::range($from, $to);

        // DATETIME columns carry no zone and the connection is pinned to +07:00,
        // so a plain BETWEEN on the dates covers exactly the local days asked
        // for. `< to + 1 day` rather than `<= to 23:59:59`: the latter silently
        // drops anything stamped in the last second of the day.
        $window = 'g.created_at >= ? AND g.created_at < DATE_ADD(?, INTERVAL 1 DAY)';
        $args = [$from, $to];

        $totals = Db::all(
            "SELECT g.action_type,
                    COUNT(*)                                   AS rows_n,
                    COALESCE(SUM(ABS(g.quantity)), 0)          AS qty,
                    COALESCE(SUM(ABS(g.quantity) * g.unit_cost), 0) AS value,
                    SUM(CASE WHEN g.unit_cost IS NULL THEN ABS(g.quantity) ELSE 0 END) AS qty_no_cost
             FROM inventory_logs g
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
             FROM inventory_logs g
             WHERE {$window}
             GROUP BY DATE(g.created_at)
             ORDER BY day ASC",
            $args,
        );

        $top = Db::all(
            "SELECT p.id, p.sku, p.name,
                    COALESCE(SUM(ABS(g.quantity)), 0) AS qty,
                    COALESCE(SUM(ABS(g.quantity) * g.unit_cost), 0) AS cost
             FROM inventory_logs g
             JOIN products p ON p.id = g.product_id
             WHERE {$window} AND g.action_type = 'OUT'
             GROUP BY p.id, p.sku, p.name
             ORDER BY qty DESC, cost DESC
             LIMIT 10",
            $args,
        );

        $people = Db::all(
            "SELECT COALESCE(who.display_name, a.display_name) AS name,
                    COALESCE(SUM(ABS(g.quantity)), 0) AS qty,
                    COUNT(*) AS rows_n
             FROM inventory_logs g
             LEFT JOIN admins who ON who.id = g.issued_to_admin_id
             LEFT JOIN admins a ON a.id = g.created_by
             WHERE {$window} AND g.action_type IN ('OUT','SCRAP')
               AND COALESCE(who.display_name, a.display_name) IS NOT NULL
             GROUP BY name
             ORDER BY qty DESC
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
            'branch' => self::branch($from, $to, $money),
            'sales'  => self::sales($window, $args, $money),
        ];
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
             FROM inventory_logs g
             LEFT JOIN rx_orders r ON r.log_id = g.id
             WHERE {$window}
               AND g.action_type IN ('RX_ORDER','OUT')
               AND g.sale_price IS NOT NULL
               AND r.cancelled_at IS NULL",
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
    private static function branch(string $from, string $to, bool $money): array
    {
        $issued = Db::one(
            'SELECT COUNT(*) AS n, COALESCE(SUM(cost_total), 0) AS cost
             FROM branch_issues
             WHERE issued_at >= ? AND issued_at < DATE_ADD(?, INTERVAL 1 DAY)',
            [$from, $to],
        ) ?? ['n' => 0, 'cost' => 0];

        $settled = Db::one(
            "SELECT COUNT(*) AS n,
                    COALESCE(SUM(settled_amount), 0) AS amount,
                    COALESCE(SUM(settled_amount - cost_total), 0) AS profit
             FROM branch_issues
             WHERE status = 'settled'
               AND settled_at >= ? AND settled_at < DATE_ADD(?, INTERVAL 1 DAY)",
            [$from, $to],
        ) ?? ['n' => 0, 'amount' => 0, 'profit' => 0];

        // Not windowed: what is owed right now is owed regardless of which dates
        // are being looked at, and hiding it behind a date filter would let a
        // debt go unnoticed simply because someone was reading last month.
        $owing = Db::one(
            "SELECT COUNT(*) AS n, COALESCE(SUM(cost_total), 0) AS cost
             FROM branch_issues WHERE status = 'pending'"
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
    public static function movers(string $from, string $to, int $idleDays, bool $money): array
    {
        [$from, $to] = self::range($from, $to);
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
             FROM inventory_logs g
             JOIN products p ON p.id = g.product_id
             LEFT JOIN (SELECT product_id, SUM(remaining_qty) AS on_hand
                        FROM stock_lots GROUP BY product_id) s ON s.product_id = p.id
             WHERE g.created_at >= ? AND g.created_at < DATE_ADD(?, INTERVAL 1 DAY)
               AND g.action_type = 'OUT'
             GROUP BY p.id, p.sku, p.name, p.brand, p.product_type, s.on_hand, p.min_stock
             ORDER BY qty DESC, cost DESC, p.id ASC
             LIMIT 25",
            [$from, $to],
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
             WHERE p.is_custom_made = 0
               AND COALESCE(DATE(m.last_out), s.oldest) <= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             ORDER BY idle_days DESC, s.on_hand DESC, p.id ASC
             LIMIT 50",
            [$idle],
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
