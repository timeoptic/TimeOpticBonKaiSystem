<?php
/**
 * รายงานยอดขาย — ที่เดียวที่ตัดสินว่า "ยอดขาย" ของร้านนี้แปลว่าอะไร
 *
 * ทั้งเจ็ดหน้าใน `/api/routes/analytics.php` อ่านบิลจากที่นี่ที่เดียว แล้วค่อยเอาไป
 * นับต่อคนละแบบ · ตัวเลขในหน้าภาพรวมกับหน้าย่อยจึงตรงกันเสมอโดยไม่ต้องมีใครคอย
 * ไล่แก้ SQL ให้เหมือนกันหกที่
 *
 * ─────────────────────────────────────────────────────────────────────────
 * สองคำที่ห้ามยุบเป็นคำเดียว
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   ยอดขาย    = ราคาที่ตกลงกันในบิล  → นับด้วย "วันที่เปิดบิล"
 *   ยอดรับเงิน = เงินที่เข้ามาจริง     → นับด้วย "วันที่กดรับเงิน" (paid_at)
 *
 * สองตัวนี้ไม่เท่ากันโดยตั้งใจ ร้านนี้รับมัดจำเดือนนี้แล้วปิดยอดเดือนหน้าได้ และ
 * ปล่อยของทั้งที่ค้างเงินก็ได้ · การยุบสองเรื่องนี้เป็นตัวเลขเดียวคือสิ่งที่ทำให้
 * รายงานตอบคำถาม "ทำไมเงินในลิ้นชักไม่เท่ายอดขาย" ไม่ได้
 *
 * หน้า Payment Report อ่านจากราง "ยอดรับเงิน" · หน้าอื่นอ่านจากราง "ยอดขาย"
 *
 * ─────────────────────────────────────────────────────────────────────────
 * สองช่องทาง สามตาราง
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   main = custom_orders                  งานตัดแว่น 6 ขั้น
 *   pos  = pos_sales  +  sales (ของเดิม)  ขายหน้าร้าน
 *
 * ตาราง `sales` คือการขายสินค้าทั่วไปยุคก่อนมี POS · ยังมีแถวจริงและมีเงินจริงอยู่
 * ในนั้น ถ้าไม่นับรวมยอดรวมของรายงานจะน้อยกว่าเงินที่รับมาจริง โดยไม่มีอะไรบอก
 * ว่าหายไปไหน · แถวจากตารางนั้นติดธง src='legacy' ให้หน้าเว็บขึ้นป้ายกำกับ
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ต้นทุน
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ฝั่ง main ได้ต้นทุนจริง — `custom_orders.frame_product_id` และ
 * `lens_product_id` / `right_lens_product_id` เก็บ id ของ *ล็อต* ไม่ใช่ id ของ
 * สินค้า จึงต่อไปที่ `v_stock_lot.product_expense` (= `stock_lots.cost_per_unit`)
 * ได้ตรง ๆ
 *
 * ฝั่ง pos ไม่มีต้นทุน — `pos_sale_items` เก็บแต่ราคาขาย ไม่มีคอลัมน์ต้นทุน และ
 * ครึ่งหนึ่งของรายการเป็นสินค้า Custom ที่ไม่มีแถวในคลังอยู่แล้ว · รายงานกำไรจึง
 * บอกตรง ๆ ว่าฝั่งนี้ไม่มีข้อมูล แทนที่จะเดาแล้วส่งตัวเลขที่เจ้าของร้านเอาไปตัดสินใจ
 *
 * ต้นทุนออกจาก API ได้เฉพาะแอดมินขึ้นไป — `/api/reports` ถูกกันด้วยประตูที่สอง
 * ใน `api/index.php` ซึ่งใช้ระดับเดียวกับ `Roles::seeCost()` พอดี
 */
declare(strict_types=1);

final class SalesReport
{
    /** ช่องทางที่รับ — ค่าอื่นตกกลับเป็น 'all' ไม่ใช่ตอบ 400 ให้ลิงก์ที่พิมพ์ผิด */
    public const CHANNELS = ['all', 'main', 'pos'];

    /**
     * ช่วงวันที่ + ช่องทาง จาก query string
     *
     * ไม่มีอะไรส่งมา = วันนี้วันเดียว · ส่ง from มาอย่างเดียว = วันนั้นวันเดียว
     * ส่งกลับหัวกลับหาง (to < from) ก็สลับให้ ไม่ใช่คืนช่วงว่างที่อ่านว่าไม่มียอดขาย
     */
    public static function range(array $query): array
    {
        $from = str_or($query['from'] ?? null) ?: today();
        $to   = str_or($query['to'] ?? null) ?: $from;
        if ($to < $from) {
            [$from, $to] = [$to, $from];
        }
        $channel = str_or($query['channel'] ?? null, 'all');
        if (!in_array($channel, self::CHANNELS, true)) {
            $channel = 'all';
        }
        return ['from' => $from, 'to' => $to, 'channel' => $channel];
    }

    public static function wantsMain(string $channel): bool
    {
        return $channel === 'all' || $channel === 'main';
    }

    public static function wantsPos(string $channel): bool
    {
        return $channel === 'all' || $channel === 'pos';
    }

    /**
     * บิลของงานตัดแว่นในช่วงวันที่ — หนึ่งแถวคือหนึ่งออเดอร์
     *
     * `paid` มาจาก `payments` ไม่ใช่จาก `custom_orders.deposit` — คอลัมน์นั้นเป็น
     * แค่เงาของมัดจำก้อนแรก (ดู README หัวข้อ "เรื่องเงิน") ยอดที่รับจริงอยู่ที่
     * ledger เสมอ
     *
     * สถานะมาจาก `v_case_board` ซึ่งเป็น view เดียวกับที่กระดานงานใช้ — รายงาน
     * กับกระดานจึงพูดสถานะชุดเดียวกัน · ออเดอร์ที่ไม่มีเคส (เปิดจากหน้าออเดอร์
     * ตรง ๆ) จะได้ค่าว่างและตกไปเป็น "ไม่ผูกเคส" ที่หน้าเว็บ
     */
    public static function mainBills(string $from, string $to): array
    {
        return Db::all(
            "SELECT o.id, o.invoice_code, o.order_date, o.lens_type,
                    o.order_closed, o.case_id,
                    ROUND(o.total_price - o.discount, 2)                       AS revenue,
                    ROUND(COALESCE(pay.paid, 0), 2)                            AS paid,
                    ROUND(o.total_price - o.discount - COALESCE(pay.paid,0),2) AS balance,
                    o.frame_name, o.lens_name,
                    c.id AS customer_id, c.first_name, c.mid_name, c.last_name,
                    e.id AS employee_id, e.employee_name,
                    cs.case_code,
                    b.stage_group, b.status_label_th, b.is_terminal,
                    /* สำเนาต้นทุนบนใบสั่งมาก่อน แล้วค่อยตกไปที่ล็อต — ใบเก่ายังอ่าน
                       จากล็อตได้เหมือนเดิม ส่วนใบที่มีสำเนาแล้วอ่านได้ต่อไปแม้ล็อต
                       จะถูกลบทิ้ง กำไรย้อนหลังจึงไม่หายไปพร้อมกับการล้างคลัง */
                    COALESCE(o.frame_cost_snapshot,  fl.product_expense) AS frame_unit_cost,
                    COALESCE(o.lens_cost_snapshot,   ll.product_expense) AS lens_l_unit_cost,
                    COALESCE(o.lens_r_cost_snapshot, lr.product_expense) AS lens_r_unit_cost
               FROM custom_orders o
               JOIN customers c        ON c.id  = o.customer_id
               LEFT JOIN employees e   ON e.id  = o.employee_id
               LEFT JOIN cases cs      ON cs.id = o.case_id
               LEFT JOIN v_case_board b ON b.id = o.case_id
               LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
                           WHERE order_id IS NOT NULL AND cancelled_at IS NULL
                           GROUP BY order_id) pay ON pay.order_id = o.id
               LEFT JOIN v_stock_lot fl ON fl.id = o.frame_product_id
               LEFT JOIN v_stock_lot ll ON ll.id = o.lens_product_id
               LEFT JOIN v_stock_lot lr ON lr.id = o.right_lens_product_id
              WHERE DATE(o.order_date) BETWEEN ? AND ?
              ORDER BY o.order_date DESC, o.id DESC",
            $from,
            $to
        );
    }

    /**
     * บิลขายหน้าร้าน — POS ใหม่ต่อท้ายด้วยการขายสินค้าทั่วไปของระบบเดิม
     *
     * ใบที่ถูกยกเลิก (status='void') ไม่นับเป็นยอดขาย แต่ไม่ได้หายไปจากฐาน —
     * ถ้าวันหนึ่งอยากได้รายงาน "ใบที่ถูกยกเลิก" ข้อมูลยังอยู่ครบ
     */
    public static function posBills(string $from, string $to): array
    {
        $pos = Db::all(
            "SELECT s.id, s.pos_no AS bill_no, s.sale_date,
                    ROUND(s.total_amount, 2)   AS revenue,
                    ROUND(s.paid_amount, 2)    AS paid,
                    ROUND(s.balance_amount, 2) AS balance,
                    s.payment_status, s.fulfillment_status,
                    s.customer_id, s.customer_name_snapshot,
                    c.first_name, c.mid_name, c.last_name,
                    a.employee_id, e.employee_name,
                    COALESCE(it.qty, 0)        AS item_qty,
                    COALESCE(it.line_count, 0) AS item_lines,
                    it.names                   AS item_names
               FROM pos_sales s
               LEFT JOIN customers c ON c.id = s.customer_id
               LEFT JOIN admins a    ON a.id = s.created_by
               LEFT JOIN employees e ON e.id = a.employee_id
               /* `lines` เป็นคำสงวนของ MariaDB — ตั้งชื่อ line_count แทน */
               LEFT JOIN (SELECT sale_id, SUM(quantity) qty, COUNT(*) line_count,
                                 GROUP_CONCAT(product_name_snapshot
                                              ORDER BY sort_order SEPARATOR ', ') names
                            FROM pos_sale_items GROUP BY sale_id) it ON it.sale_id = s.id
              WHERE s.status = 'active' AND DATE(s.sale_date) BETWEEN ? AND ?",
            $from,
            $to
        );

        /* ระบบเดิม: หนึ่งแถว = หนึ่งชิ้นจากคลัง จึงเป็นทั้งใบและทั้งรายการในตัวเอง
           เงินของมันอยู่ใน `payments` (kind='full', ผูกด้วย sale_id) ไม่ใช่
           `pos_payments` — สองรางแยกกัน ไม่มีทางนับซ้ำ */
        $legacy = Db::all(
            "SELECT sa.id, sa.invoice_code AS bill_no, sa.sale_date,
                    ROUND(sa.price - sa.discount, 2)                        AS revenue,
                    ROUND(COALESCE(pay.paid, 0), 2)                         AS paid,
                    ROUND(sa.price - sa.discount - COALESCE(pay.paid,0), 2) AS balance,
                    sa.customer_id,
                    c.first_name, c.mid_name, c.last_name,
                    sa.employee_id, e.employee_name,
                    COALESCE(sa.product_name_snapshot, st.product_name) AS item_names,
                    COALESCE(sa.unit_cost_snapshot, st.product_expense)  AS unit_cost
               FROM sales sa
               LEFT JOIN customers c     ON c.id = sa.customer_id
               LEFT JOIN employees e     ON e.id = sa.employee_id
               LEFT JOIN v_stock_lot st  ON st.id = sa.product_stock_id
               LEFT JOIN (SELECT sale_id, SUM(amount) paid FROM payments
                           WHERE sale_id IS NOT NULL AND cancelled_at IS NULL
                           GROUP BY sale_id) pay ON pay.sale_id = sa.id
              WHERE DATE(sa.sale_date) BETWEEN ? AND ?",
            $from,
            $to
        );

        $rows = [];
        foreach ($pos as $r) {
            $r['src'] = 'pos';
            $rows[]   = $r;
        }
        foreach ($legacy as $r) {
            $r['src']                = 'legacy';
            $r['item_qty']           = 1;
            $r['item_lines']         = 1;
            $r['payment_status']     = ((float) $r['balance'] <= 0.001) ? 'paid'
                : (((float) $r['paid'] > 0.001) ? 'partial' : 'unpaid');
            $r['fulfillment_status'] = 'delivered';
            $rows[]                  = $r;
        }

        usort($rows, fn($a, $b) => strcmp((string) $b['sale_date'], (string) $a['sale_date']));
        return $rows;
    }

    /**
     * ใบขายหน้าร้านที่ถูกยกเลิกในช่วงวันที่
     *
     * ไม่นับเป็นยอดขาย แต่ต้องนับให้เห็น — ใบที่หายไปจากรายงานโดยไม่มีอะไรบอก
     * ทำให้คนอ่านสรุปว่า "ระบบไม่บันทึกการขาย" ทั้งที่มันบันทึกครบและถูกยกเลิก
     * ทีหลัง · เป็นคำเตือนเดียวกับที่หัวไฟล์ migration 018 เขียนไว้ว่าใบขายที่
     * หายไปเฉย ๆ คือเงินที่อธิบายไม่ได้ตอนปิดยอด
     *
     * นับเฉพาะฝั่ง POS เพราะตาราง `sales` ของระบบเดิมไม่มีสถานะยกเลิก (ลบทิ้ง
     * อย่างเดียว) จึงไม่มีอะไรให้นับ
     */
    public static function voidedPos(string $from, string $to): array
    {
        $r = Db::get(
            "SELECT COUNT(*) n, COALESCE(SUM(total_amount), 0) amount
               FROM pos_sales
              WHERE status = 'void' AND DATE(sale_date) BETWEEN ? AND ?",
            $from,
            $to
        );
        return ['bills' => (int) ($r['n'] ?? 0), 'amount' => round2($r['amount'] ?? 0)];
    }

    /**
     * เงินที่รับจริงในช่วงวันที่ — คนละรางกับยอดขาย นับด้วย paid_at
     *
     * คืนแถวหน้าตาเดียวกันจากสองตารางที่หน้าตาไม่เหมือนกัน ให้ผู้เรียกไม่ต้องรู้ว่า
     * เงินก้อนไหนมาจากตารางไหน
     */
    public static function receipts(string $from, string $to, string $channel): array
    {
        $rows = [];

        if (self::wantsMain($channel) || self::wantsPos($channel)) {
            /* `payments` มีทั้งเงินของออเดอร์ (order_id) และเงินของการขายสินค้า
               ระบบเดิม (sale_id) ปนกันอยู่ตารางเดียว — แยกช่องทางด้วยว่าแถวนั้น
               ผูกกับอะไร ไม่ใช่ด้วยชื่อตาราง */
            foreach (Db::all(
                "SELECT p.id, p.method, p.kind, p.amount, p.paid_at,
                        p.order_id, p.sale_id, e.employee_name
                   FROM payments p
                   LEFT JOIN employees e ON e.id = p.received_by
                  WHERE p.cancelled_at IS NULL AND DATE(p.paid_at) BETWEEN ? AND ?",
                $from,
                $to
            ) as $p) {
                $ch = $p['sale_id'] !== null ? 'pos' : 'main';
                if ($ch === 'main' && !self::wantsMain($channel)) {
                    continue;
                }
                if ($ch === 'pos' && !self::wantsPos($channel)) {
                    continue;
                }
                $rows[] = [
                    'method'        => self::payMethodKey((string) $p['method']),
                    'kind'          => (string) $p['kind'],
                    'amount'        => round2($p['amount']),
                    'paid_at'       => $p['paid_at'],
                    'channel'       => $ch,
                    'employee_name' => $p['employee_name'],
                ];
            }
        }

        if (self::wantsPos($channel)) {
            foreach (Db::all(
                "SELECT pp.id, pp.payment_method, pp.amount, pp.paid_at,
                        e.employee_name
                   FROM pos_payments pp
                   JOIN pos_sales s      ON s.id = pp.sale_id AND s.status = 'active'
                   LEFT JOIN admins a    ON a.id = pp.created_by
                   LEFT JOIN employees e ON e.id = a.employee_id
                  WHERE pp.cancelled_at IS NULL AND DATE(pp.paid_at) BETWEEN ? AND ?",
                $from,
                $to
            ) as $p) {
                $rows[] = [
                    'method'        => self::payMethodKey((string) $p['payment_method']),
                    'kind'          => 'pos',
                    'amount'        => round2($p['amount']),
                    'paid_at'       => $p['paid_at'],
                    'channel'       => 'pos',
                    'employee_name' => $p['employee_name'],
                ];
            }
        }

        usort($rows, fn($a, $b) => strcmp((string) $b['paid_at'], (string) $a['paid_at']));
        return $rows;
    }

    /**
     * ช่องทางชำระของสองระบบเขียนคนละแบบ — Main เก็บ 'Cash' POS เก็บ 'cash'
     *
     * ยุบเป็นคีย์เดียวที่นี่ ไม่ใช่ที่หน้าเว็บ ไม่งั้น Pie จะมีสองชิ้นชื่อเดียวกัน
     * ค่าที่ไม่รู้จักไม่ถูกทิ้ง แต่ถูกส่งต่อเป็นคีย์ของมันเอง — เงินที่หายไปจากกราฟ
     * แย่กว่าชิ้นที่ชื่อแปลก
     */
    public static function payMethodKey(string $raw): string
    {
        $k = strtolower(trim($raw));
        return match ($k) {
            'cash', 'เงินสด'                => 'cash',
            'transfer', 'โอน', 'โอนเงิน'     => 'transfer',
            'qr', 'qrcode', 'qr payment'    => 'qr',
            'credit', 'creditcard', 'card'  => 'credit',
            'thungngern', 'ถุงเงิน'          => 'thungngern',
            ''                              => 'unknown',
            default                         => $k,
        };
    }

    /**
     * หมวดสินค้าที่ขายได้ในช่วงวันที่ — เฉพาะฝั่ง POS
     *
     * รายการ Custom (`product_id IS NULL`) ไม่มีหมวด เพราะพนักงานพิมพ์ชื่อเอง —
     * นั่นคือครึ่งหนึ่งของเหตุผลที่ POS มีอยู่ จึงมีหมวดของตัวเองชื่อ 'Custom'
     * ไม่ใช่ถูกโยนรวมกับ "อื่น ๆ" จนหาไม่เจอว่าขายอะไรไปบ้าง
     */
    public static function posCategories(string $from, string $to): array
    {
        return Db::all(
            "SELECT COALESCE(cat.name, 'Custom')      AS category,
                    SUM(i.quantity)                   AS qty,
                    ROUND(SUM(i.line_total), 2)       AS revenue,
                    COUNT(DISTINCT i.sale_id)         AS bills
               FROM pos_sale_items i
               JOIN pos_sales s        ON s.id = i.sale_id AND s.status = 'active'
               LEFT JOIN products p    ON p.id = i.product_id
               LEFT JOIN categories cat ON cat.id = p.category_id
              WHERE DATE(s.sale_date) BETWEEN ? AND ?
              GROUP BY category
              ORDER BY revenue DESC",
            $from,
            $to
        );
    }

    /**
     * เคสในช่วงวันที่ พร้อมช่องทางที่ลูกค้ารู้จักร้าน และยอดขายของเคสนั้น
     *
     * นับด้วย `cases.opened_at` (วันที่เปิดเคส) ไม่ใช่วันที่เปิดออเดอร์ — คำถามคือ
     * "ลูกค้าที่เดินเข้ามาช่วงนี้มาจากช่องทางไหน" ซึ่งเกิดตอนเปิดเคส · เคสที่เปิด
     * แล้วยังไม่ได้ขายอะไรก็ยังเป็นคนที่ช่องทางนั้นพามา จึงต้องนับด้วย
     * (ยอดขายของเคสนั้นเป็น 0 ซึ่งเป็นข้อมูลจริงที่บอกว่าช่องทางนั้นปิดการขายไม่ได้)
     */
    public static function referralCases(string $from, string $to): array
    {
        return Db::all(
            'SELECT c.id, c.opened_at, c.referral_source, c.customer_category,
                    c.is_new_customer, c.customer_id, c.case_type,
                    ROUND(COALESCE(o.revenue, 0), 2) AS revenue,
                    COALESCE(o.n, 0)                 AS orders
               FROM cases c
               LEFT JOIN (SELECT case_id, SUM(total_price - discount) revenue, COUNT(*) n
                            FROM custom_orders WHERE case_id IS NOT NULL
                            GROUP BY case_id) o ON o.case_id = c.id
              WHERE DATE(c.opened_at) BETWEEN ? AND ?',
            $from,
            $to
        );
    }

    /**
     * ป้ายของช่องทางที่ลูกค้ารู้จักร้าน
     *
     * รายการที่ให้เลือกตอนนี้อยู่ใน `Lookups::lists()['referral_source']` แต่ในฐาน
     * มีค่าที่เลิกใช้แล้วปนอยู่ด้วย เพราะเคยเก็บด้วยชุดตัวเลือกเก่า — `facebook`
     * (สมัยที่ยังไม่มี IG/TikTok ในตัวเลือกเดียวกัน) และ `friend`
     *
     * **ค่าเก่าถูกยุบเข้ากลุ่มปัจจุบัน ไม่ใช่แยกเป็นแท่งของตัวเอง** — สองแท่งที่
     * แปลว่าช่องทางเดียวกันทำให้เจ้าของร้านอ่านสัดส่วนผิด ซึ่งเป็นสิ่งเดียวที่
     * รายงานนี้มีไว้ตอบ · หน้าเว็บบอกไว้ด้วยว่ามีการยุบเกิดขึ้น
     *
     * ค่าที่ไม่รู้จักคืนชื่อของตัวเองกลับไป ไม่ใช่ถูกยุบเป็น "อื่นๆ" — เคสที่หายเข้าไป
     * ในถังรวมคือเคสที่ตามกลับไม่ได้
     */
    public const REFERRAL_LABELS = [
        'fb_ig_tt' => 'FB / IG / TikTok',
        'facebook' => 'FB / IG / TikTok',
        'line'     => 'LINE',
        'ai'       => 'AI',
        'google'   => 'Google',
        'walk_in'  => 'Walk In',
        'friend'   => 'ลูกค้าแนะนำ',
        'referral' => 'ลูกค้าแนะนำ',
        'other'    => 'อื่นๆ',
    ];

    /** โค้ดเก่าที่ถูกยุบเข้ากลุ่มอื่น — หน้าเว็บใช้บอกผู้อ่านว่ามีการยุบ */
    public const REFERRAL_MERGED = ['facebook' => 'fb_ig_tt', 'referral' => 'friend'];

    public static function referralLabel(?string $code): string
    {
        if ($code === null || $code === '') {
            return 'ไม่ได้ถาม';
        }
        return self::REFERRAL_LABELS[$code] ?? $code;
    }

    /** ป้ายภาษาไทยของโค้ดประเภทเลนส์ — จาก `list_len_type` ไม่ใช่ hardcode */
    public static function lensTypeLabels(): array
    {
        $out = [];
        foreach (Db::all('SELECT code, label_th FROM list_len_type ORDER BY sort_order, code') as $r) {
            $out[(string) $r['code']] = (string) ($r['label_th'] ?: $r['code']);
        }
        return $out;
    }

    /**
     * บิลใบแรกและใบล่าสุดที่ร้านนี้มี — ไม่ขึ้นกับช่วงวันที่ที่กรองอยู่
     *
     * มีไว้ให้หน้าจอที่ไม่มีข้อมูลพูดได้ว่า *ทำไม* ถึงว่าง · หน้าที่ขึ้น ฿0 เฉย ๆ
     * แยกไม่ออกระหว่าง "วันนี้ยังไม่มีใครมา" กับ "ระบบพัง" และคนที่เห็นจะเดา
     * อย่างหลังเสมอ · รู้ขอบเขตแล้วหน้าจอเสนอช่วงที่มีข้อมูลให้กดได้เลย
     *
     * คืน null ทั้งคู่เมื่อร้านยังไม่มีบิลสักใบ ซึ่งเป็นคนละเรื่องกับ "ช่วงนี้ว่าง"
     */
    public static function bounds(string $channel): array
    {
        $dates = [];
        if (self::wantsMain($channel)) {
            $r = Db::get('SELECT MIN(DATE(order_date)) a, MAX(DATE(order_date)) b FROM custom_orders');
            $dates[] = [$r['a'] ?? null, $r['b'] ?? null];
        }
        if (self::wantsPos($channel)) {
            $r = Db::get(
                "SELECT MIN(DATE(sale_date)) a, MAX(DATE(sale_date)) b
                   FROM pos_sales WHERE status = 'active'"
            );
            $dates[] = [$r['a'] ?? null, $r['b'] ?? null];
            $r = Db::get('SELECT MIN(DATE(sale_date)) a, MAX(DATE(sale_date)) b FROM sales');
            $dates[] = [$r['a'] ?? null, $r['b'] ?? null];
        }

        $first = null;
        $last  = null;
        foreach ($dates as [$a, $b]) {
            if ($a !== null && ($first === null || $a < $first)) {
                $first = $a;
            }
            if ($b !== null && ($last === null || $b > $last)) {
                $last = $b;
            }
        }
        return ['first' => $first, 'last' => $last];
    }

    /** ยอดค้างชำระสะสมทั้งร้าน — ไม่ขึ้นกับช่วงวันที่ที่กรองอยู่ */
    public static function outstandingAllTime(string $channel): float
    {
        $sum = 0.0;
        if (self::wantsMain($channel)) {
            $r = Db::get(
                'SELECT COALESCE(SUM(GREATEST(o.total_price - o.discount
                          - COALESCE(pay.paid, 0), 0)), 0) v
                   FROM custom_orders o
                   LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
                               WHERE order_id IS NOT NULL AND cancelled_at IS NULL
                               GROUP BY order_id) pay ON pay.order_id = o.id'
            );
            $sum += (float) ($r['v'] ?? 0);
        }
        if (self::wantsPos($channel)) {
            $r = Db::get(
                "SELECT COALESCE(SUM(balance_amount), 0) v FROM pos_sales WHERE status = 'active'"
            );
            $sum += (float) ($r['v'] ?? 0);
        }
        return round2($sum);
    }

    // ---------------------------------------------------------------------
    // การนับ — ทำในภาษา PHP ไม่ใช่ SQL
    //
    // ทุกหน้าเริ่มจากบิลชุดเดียวกันแล้วนับคนละแบบ · เขียนเป็น GROUP BY หกชุดใน
    // SQL แปลว่ามีหกที่ที่นิยาม "ยอดขาย" ได้เอง และวันหนึ่งจะมีที่ที่นิยามไม่ตรง
    // ข้อมูลระดับหลักพันแถวต่อเดือน การวนใน PHP จึงถูกกว่าความเสี่ยงนั้นมาก
    // ---------------------------------------------------------------------

    /** ยอดรวมของบิลชุดหนึ่ง — รูปเดียวกันทุกที่ที่สรุปยอด */
    public static function totals(array $bills): array
    {
        $revenue = 0.0;
        $paid    = 0.0;
        $balance = 0.0;
        foreach ($bills as $b) {
            $revenue += (float) $b['revenue'];
            $paid    += (float) $b['paid'];
            $balance += max(0.0, (float) $b['balance']);
        }
        $n = count($bills);
        return [
            'bills'   => $n,
            'revenue' => round2($revenue),
            'paid'    => round2($paid),
            'balance' => round2($balance),
            'avg'     => $n ? round2($revenue / $n) : 0.0,
        ];
    }

    /**
     * ลูกค้าในบิลชุดหนึ่ง — คนที่มีแถวในระบบ กับลูกค้าขาจรที่ไม่มี
     *
     * แยกกันเพราะขาจรนับหัวไม่ได้ (ซื้อสามใบวันเดียวก็ยังเป็นสามใบ ไม่รู้ว่าคนเดียว
     * หรือสามคน) การเอาไปบวกกับจำนวนลูกค้าที่นับหัวได้จึงเป็นตัวเลขที่อ่านผิด
     */
    public static function customers(array $bills): array
    {
        $known = [];
        $walk  = 0;
        foreach ($bills as $b) {
            if (!empty($b['customer_id'])) {
                $known[(int) $b['customer_id']] = true;
            } else {
                $walk++;
            }
        }
        return ['known' => count($known), 'walk_in' => $walk];
    }

    /**
     * ความละเอียดของแกนเวลา — เลือกจากความยาวของช่วง
     *
     * ดูทั้งปีแล้ววาดวันละแท่งคือ 365 แท่งในกราฟกว้างพันกว่าพิกเซล = แท่งละไม่ถึง
     * 3px ซึ่งมองไม่เห็นและอ่านไม่ได้ · ยิ่งร้านที่ขายไม่ทุกวัน กราฟจะกลายเป็น
     * เส้นเดี่ยว ๆ ไม่กี่เส้นบนพื้นว่าง
     *
     * ขอบเขตที่เลือก ให้จำนวนแท่งอยู่ราว 9–45 แท่งเสมอ ซึ่งเป็นช่วงที่ยังนับด้วยตา
     * ได้และแท่งยังหนาพอจะชี้โดน:
     *
     *   ≤ 45 วัน   → รายวัน    (เดือนนี้ = 30 แท่ง)
     *   ≤ 210 วัน  → รายสัปดาห์ (ครึ่งปี = 26 แท่ง)
     *   มากกว่านั้น → รายเดือน   (ปีนี้ = 9–12 แท่ง)
     */
    public static function bucketFor(string $from, string $to): string
    {
        $days = (new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days + 1;
        if ($days <= 45) {
            return 'day';
        }
        return $days <= 210 ? 'week' : 'month';
    }

    /**
     * ยอดตามช่วงเวลา — เติมช่วงที่ไม่มีบิลด้วยศูนย์
     *
     * ช่องว่างในกราฟอ่านว่า "ไม่มีข้อมูล" ส่วนศูนย์อ่านว่า "ช่วงนั้นขายไม่ได้"
     * ซึ่งเป็นคนละเรื่องกัน และเรื่องหลังคือเรื่องที่เจ้าของร้านอยากเห็น
     *
     * แต่ละแถวมี `date` (วันเริ่มของช่วง) กับ `date_end` (วันจบ) — หน้าเว็บใช้
     * เขียนป้ายให้ถูกว่านี่คือวัน สัปดาห์ หรือเดือน โดยไม่ต้องเดาเอง
     *
     * สัปดาห์เริ่มวันจันทร์ ให้ตรงกับปุ่ม "สัปดาห์นี้" ในตัวกรอง — สองที่ที่นับ
     * ต้นสัปดาห์ไม่ตรงกันคือรายงานที่ตัวเลขไม่ตรงกับตัวเอง
     */
    public static function daily(string $from, string $to, array $series): array
    {
        $bucket = self::bucketFor($from, $to);
        $start  = new DateTimeImmutable($from);
        $end    = new DateTimeImmutable($to);

        /* หัวช่วงของวันหนึ่ง ๆ — คีย์ที่บิลถูกโยนเข้าไปรวม */
        $head = function (DateTimeImmutable $d) use ($bucket): DateTimeImmutable {
            if ($bucket === 'week') {
                /* 'N' = 1 (จันทร์) ถึง 7 (อาทิตย์) */
                return $d->modify('-' . ((int) $d->format('N') - 1) . ' day');
            }
            if ($bucket === 'month') {
                return $d->modify('first day of this month');
            }
            return $d;
        };

        $step = ['day' => '+1 day', 'week' => '+7 day', 'month' => '+1 month'][$bucket];
        $tail = function (DateTimeImmutable $h) use ($bucket, $end): DateTimeImmutable {
            $last = match ($bucket) {
                'week'  => $h->modify('+6 day'),
                'month' => $h->modify('last day of this month'),
                default => $h,
            };
            /* ช่วงสุดท้ายไม่ลากเลยวันที่ผู้ใช้เลือก — "ก.ย." ที่จบวันที่ 30 ทั้งที่
               ผู้ใช้ดูถึงวันที่ 2 อ่านว่ารายงานเอาข้อมูลอนาคตมาด้วย */
            return $last > $end ? $end : $last;
        };

        $slots = [];
        $cur   = $head($start);
        /* กันช่วงที่กว้างจนวาดไม่ไหว — 400 ช่องคือเกินหนึ่งปีในทุกความละเอียด */
        $guard = 0;
        while ($cur <= $end && $guard++ < 400) {
            $slots[$cur->format('Y-m-d')] = array_fill_keys(array_keys($series), 0.0);
            $cur = $cur->modify($step);
        }

        foreach ($series as $key => $spec) {
            [$bills, $dateField] = $spec;
            foreach ($bills as $b) {
                $d = substr((string) $b[$dateField], 0, 10);
                if ($d === '') {
                    continue;
                }
                $k = $head(new DateTimeImmutable($d))->format('Y-m-d');
                if (isset($slots[$k])) {
                    $slots[$k][$key] += (float) $b['revenue'];
                }
            }
        }

        $out = [];
        foreach ($slots as $d => $vals) {
            $h   = new DateTimeImmutable($d);
            /* ช่องแรกเริ่มที่วันที่ผู้ใช้เลือก ไม่ใช่ต้นสัปดาห์/ต้นเดือนที่อยู่ก่อนหน้า */
            $row = [
                'date'     => max($d, $from),
                'date_end' => $tail($h)->format('Y-m-d'),
                'bucket'   => $bucket,
            ];
            foreach ($vals as $k => $v) {
                $row[$k] = round2($v);
            }
            $out[] = $row;
        }
        return $out;
    }

    /**
     * จัดกลุ่มบิลตามคีย์แล้วสรุปยอด เรียงจากมากไปน้อย
     *
     * `$key` คืนค่า null ได้ = บิลนี้ไม่มีค่าของมิตินี้ (ออเดอร์ที่ยังไม่เลือกเลนส์
     * ยังไม่มี lens_type) จะถูกรวมไว้ที่กลุ่มชื่อ `$blank` ไม่ใช่ถูกทิ้ง
     */
    public static function groupBy(array $bills, callable $key, string $blank = '(ไม่ระบุ)'): array
    {
        $g = [];
        foreach ($bills as $b) {
            $k = $key($b);
            $k = ($k === null || $k === '') ? $blank : (string) $k;
            if (!isset($g[$k])) {
                $g[$k] = ['label' => $k, 'bills' => 0, 'revenue' => 0.0];
            }
            $g[$k]['bills']++;
            $g[$k]['revenue'] += (float) $b['revenue'];
        }
        foreach ($g as &$row) {
            $row['revenue'] = round2($row['revenue']);
        }
        unset($row);

        $out = array_values($g);
        usort($out, fn($a, $b) => $b['revenue'] <=> $a['revenue']);
        return $out;
    }

    /**
     * ต้นทุนและกำไรของออเดอร์หนึ่งใบ
     *
     * ต้นทุนอื่น ๆ เป็น 0 เสมอเพราะระบบยังไม่มีที่เก็บ (ค่าประกอบ ค่าส่ง ค่าแรง
     * ไม่ได้ถูกบันทึกต่อออเดอร์) — คืนเป็น 0 พร้อมให้หน้าเว็บบอกว่ายังไม่บันทึก
     * ไม่ใช่เงียบ ๆ ปล่อยให้อ่านว่าร้านไม่มีต้นทุนส่วนนั้น
     *
     * ─────────────────────────────────────────────────────────────────────
     * **ต้นทุน 0 นับว่า "ยังไม่ได้บันทึก" ไม่ใช่ "ของฟรี"**
     * ─────────────────────────────────────────────────────────────────────
     *
     * ในข้อมูลที่ยกมาจากระบบ Access เดิม ล็อต 86.5% มี `cost_per_unit = 0`
     * เพราะร้านไม่ได้กรอกราคาทุนตอนรับของ · ถ้านับศูนย์เป็นต้นทุนจริง กำไรของ
     * ใบนั้นจะเท่ากับยอดขายทั้งก้อน และอัตรากำไรรวมพุ่งไปที่ 96.7% ทั้งที่ของจริง
     * คิดได้จากออเดอร์เพียง 15.7% เท่านั้น
     *
     * ตัวเลขที่ผิดหกเท่าแต่ดูน่าเชื่อ อันตรายกว่าช่องที่ว่างเปล่า — เจ้าของร้าน
     * เอาไปตั้งราคาต่อได้ทันที · ใบที่ต้นทุนเป็นศูนย์จึงตกไปอยู่กลุ่ม `uncosted`
     * และไม่ถูกนับในกำไรเลย
     *
     * ผลข้างเคียงที่ยอมรับแล้ว: ของแถมที่ต้นทุนศูนย์จริง ๆ ก็ถูกกันออกไปด้วย
     * ซึ่งเป็นส่วนน้อยมาก และการนับมันเข้ามาก็ไม่ได้ทำให้ภาพรวมถูกขึ้น
     */
    public static function margin(array $bill): array
    {
        $frame = (float) ($bill['frame_unit_cost'] ?? 0);
        $lensL = (float) ($bill['lens_l_unit_cost'] ?? 0);
        $lensR = (float) ($bill['lens_r_unit_cost'] ?? 0);

        $known = $frame > 0 || $lensL > 0 || $lensR > 0;
        $frameCost = $frame;
        $lensCost  = $lensL + $lensR;
        $revenue   = (float) $bill['revenue'];

        return [
            'revenue'    => round2($revenue),
            'frame_cost' => $known ? round2($frameCost) : null,
            'lens_cost'  => $known ? round2($lensCost) : null,
            'other_cost' => 0.0,
            'profit'     => $known ? round2($revenue - $frameCost - $lensCost) : null,
            'has_cost'   => $known,
        ];
    }
}
