<?php
/**
 * ไฟล์ Excel ของหน้า รายงาน > การรับเงิน — ชีทสรุป กับชีทรายการรับเงินทีละครั้ง
 *
 * **หนึ่งแถว = เงินหนึ่งก้อนที่รับเข้ามา ไม่ใช่หนึ่งเคส** — เคสเดียวรับมัดจำวันหนึ่งแล้ว
 * รับส่วนที่เหลืออีกวัน ไฟล์ที่ยุบเป็นแถวเดียวต่อเคสตอบไม่ได้ว่าเงินในลิ้นชักวันไหนมา
 * จากบิลไหน ซึ่งเป็นคำถามที่คนเปิดไฟล์นี้ต้องการ (ร้านขอไว้ 12 ก.ย. 2026 — ไฟล์เดิมมี
 * แต่ตารางสรุปตามช่องทางชำระ)
 *
 * **เงินก้อนไหนอยู่ในไฟล์ ตัดสินที่ `SalesReport::receipts()` ที่เดียว** ตัวเดียวกับที่
 * หน้าจอใช้ · ที่นี่เอาเงินที่ได้ไปเติมรายละเอียดของบิล (ลูกค้า รายการ ยอดขาย ยอด
 * คงเหลือ) ด้วยการค้นตาม id อย่างเดียว ไม่มีเงื่อนไขกรองอีกชุดที่ต้องคอยแก้ให้ตรงกับ
 * หน้าจอ · ยอดในชีทสรุปจึงเท่ากับหน้าจอทุกบาท (`api/tests/91-payment-export.test.php`)
 *
 * **ยอดคงเหลือเป็นยอด ณ ตอนรับเงินก้อนนั้น** ไม่ใช่ ณ วันที่กดส่งออก — นับทุกงวดก่อนหน้า
 * ของบิลเดียวกัน รวมงวดที่รับก่อนช่วงวันที่ที่กรอง · ไล่ตรวจย้อนหลังแล้วเห็นว่าหลังรับ
 * ก้อนนี้บิลยังค้างเท่าไหร่ ซึ่งตรงกับใบเสร็จที่ลูกค้าได้ไปในวันนั้น
 */
declare(strict_types=1);

final class PaymentExport
{
    /** ป้ายช่องทางชำระ — ชุดเดียวกับ METHOD_LABEL ของหน้าเว็บ ค่าที่ไม่รู้จักใช้ชื่อของตัวเอง */
    private const METHOD_TH = [
        'cash'       => 'เงินสด',
        'transfer'   => 'BBL',
        'qr'         => 'QR Payment',
        'credit'     => 'บัตรเครดิต',
        'thungngern' => 'ถุงเงิน',
        'unknown'    => 'ไม่ระบุช่องทาง',
    ];

    private const CHANNEL_TH = ['all' => 'ทั้งหมด', 'main' => 'งานตัดแว่น', 'pos' => 'POS'];
    private const STATUS_TH  = ['all' => 'ทั้งหมด', 'closed' => 'จบแล้ว', 'open' => 'ยังไม่จบ'];
    private const GROUP_TH   = ['all' => 'ทั้งหมด', 'shop' => 'ลูกค้าร้าน', 'sightfirst' => 'SightFirst'];

    /** แหล่งที่มาของเงินแต่ละก้อน — ป้ายเดียวกับตัวกรอง "แหล่งที่มา" ของหน้าเว็บ */
    private const SOURCE_TH = ['main' => 'งานตัดแว่น', 'pos' => 'POS หน้าร้าน'];

    private const HEAD = [
        'วันที่', 'เวลา', 'Case ID / Bill No.', 'ชื่อลูกค้า', 'ประเภทลูกค้า', 'แหล่งที่มา',
        'รายการสินค้า / รายละเอียด', 'ยอดขาย', 'ยอดรับครั้งนี้', 'ช่องทางชำระเงิน', 'สถานะการชำระ',
        'ยอดคงเหลือ', 'พนักงานผู้รับเงิน', 'หมายเหตุ',
    ];

    /** แถวของชีทรายละเอียดตามตัวกรอง เรียงจากเงินก้อนแรกของช่วง */
    public static function rows(
        string $from,
        string $to,
        string $channel,
        string $status = 'all',
        string $group = 'all'
    ): array {
        return self::detail(SalesReport::receipts($from, $to, $channel, $group, $status));
    }

    /**
     * ตาราง "รายละเอียดรายการรับเงิน" ใต้กราฟของหน้าเว็บ — แถวชุดเดียวกับชีทรายละเอียด
     *
     * ยอดท้ายตารางมาจาก `receiptSummary()` ของเงินชุดเดียวกับที่ Dashboard ใช้ ไม่ใช่
     * บวกแถวเอง ยอดท้ายตารางกับ "รับเงินรวม" จึงเท่ากันโดยโครงสร้าง · ส่งเฉพาะช่องที่
     * ตารางใช้ ช่วงหลายปีมีเป็นหมื่นแถว ช่องที่ไม่ได้ใช้คือไบต์ที่เบราว์เซอร์ต้องโหลดฟรี ๆ
     */
    public static function transactions(
        string $from,
        string $to,
        string $channel,
        string $status = 'all',
        string $group = 'all'
    ): array {
        $receipts = SalesReport::receipts($from, $to, $channel, $group, $status);
        $sum      = SalesReport::receiptSummary($receipts);
        $keep     = array_flip([
            'key', 'paid_at', 'code', 'source', 'source_label', 'customer', 'items', 'kind', 'method',
            'amount', 'employee', 'open', 'legacy',
        ]);

        return [
            'count' => $sum['count'],
            'total' => $sum['total'],
            'rows'  => array_map(
                static fn(array $r) => array_intersect_key($r, $keep) + ['source_label' => $r['channel']],
                self::detail($receipts)
            ),
        ];
    }

    /** ชื่อไฟล์ที่ผู้ใช้เห็นตอนดาวน์โหลด — ไฟล์ที่กรองประเภทลูกค้าต้องบอกในชื่อ */
    public static function fileName(string $from, string $to, string $group = 'all'): string
    {
        $suffix = ['shop' => ' (ลูกค้าร้าน)', 'sightfirst' => ' (SightFirst)'][$group] ?? '';
        return "รายงานการรับเงิน $from ถึง $to$suffix.xlsx";
    }

    /** ประกอบสมุดงานทั้งเล่ม */
    public static function workbook(
        string $from,
        string $to,
        string $channel,
        string $status = 'all',
        string $group = 'all'
    ): Xlsx {
        $receipts = SalesReport::receipts($from, $to, $channel, $group, $status);
        $rows     = self::detail($receipts);

        $book = new Xlsx();
        self::summarySheet($book, [$from, $to, $channel, $status, $group], SalesReport::receiptSummary($receipts), $rows);
        self::detailSheet($book, $rows);
        return $book;
    }

    /* ------------------------------------------------------------------ */

    /** เงินแต่ละก้อนจาก receipts() -> แถวที่มีรายละเอียดของบิลครบ */
    private static function detail(array $receipts): array
    {
        usort(
            $receipts,
            fn(array $a, array $b) => [$a['paid_at'], $a['src'], $a['id']] <=> [$b['paid_at'], $b['src'], $b['id']]
        );

        $ids = ['order' => [], 'legacy' => [], 'pos' => []];
        foreach ($receipts as $p) {
            [$kind, $billId] = self::billOf($p);
            if ($kind !== null) {
                $ids[$kind][$billId] = $billId;
            }
        }
        $bills = [
            'order'  => self::orderBills(array_values($ids['order'])),
            'legacy' => self::legacyBills(array_values($ids['legacy'])),
            'pos'    => self::posBills(array_values($ids['pos'])),
        ];
        $paidAfter = self::paidAfter($ids);

        $rows = [];
        foreach ($receipts as $p) {
            [$kind, $billId] = self::billOf($p);
            $bill = $kind !== null ? ($bills[$kind][$billId] ?? null) : null;
            $paid = $kind !== null ? ($paidAfter[$kind][$p['id']] ?? null) : null;

            /* บิลที่ยังไม่ตั้งราคา (ยอด 0 — หน้ารับเงินยอมให้รับมัดจำได้) ไม่มียอดให้เทียบ
               ยอดคงเหลือติดลบของบิลแบบนั้นอ่านว่า "จ่ายเกิน" ซึ่งไม่จริง จึงเว้นว่าง */
            $priced  = $bill !== null && $bill['revenue'] > 0.001;
            $balance = $priced && $paid !== null ? round2($bill['revenue'] - $paid) : null;

            /* เงินก้อนนี้กดแล้วเปิดหน้าไหน — เคสมาก่อนใบสั่ง เพราะร้านตามงานด้วยเคส และหน้าเคส
               มีทุกใบสั่งกับทุกงวดที่รับอยู่แล้ว · ขายสินค้าระบบเดิมไม่มีหน้ารายละเอียด */
            $caseId = $kind === 'order' ? ($bill['case_id'] ?? $p['case_id']) : ($kind === null ? $p['case_id'] : null);
            $open   = match (true) {
                $kind === 'pos'   => ['kind' => 'pos', 'id' => $billId],
                $caseId !== null  => ['kind' => 'case', 'id' => (int) $caseId],
                $kind === 'order' => ['kind' => 'order', 'id' => $billId],
                default           => null,
            };

            $rows[] = [
                'key'        => $p['src'] . ':' . $p['id'],
                'paid_at'    => (string) $p['paid_at'],
                'code'       => $bill['code'] ?? ($p['case_id'] ? 'เคส #' . $p['case_id'] : ''),
                'customer'   => $bill['customer'] ?? '',
                /* กติกาเดียวกับ receipts(): เฉพาะงานตัดแว่นที่เป็น SightFirst ได้ · ขาย
                   หน้าร้านไม่มีประเภทลูกค้า นับเป็นลูกค้าร้าน */
                'group'      => $p['channel'] === 'main' && $p['category'] === 'sight_first' ? 'SightFirst' : 'ลูกค้าร้าน',
                'source'     => $p['channel'],
                'channel'    => self::SOURCE_TH[$p['channel']],
                'kind'       => PAYMENT_KIND_TH[$p['kind']] ?? '',
                'open'       => $open,
                'legacy'     => $kind === 'legacy',
                'items'      => $bill['items'] ?? '',
                'revenue'    => $bill['revenue'] ?? null,
                'amount'     => (float) $p['amount'],
                'method'     => self::METHOD_TH[$p['method']] ?? $p['method'],
                'pay_status' => match (true) {
                    $bill === null     => 'ไม่ผูกบิล',
                    !$priced           => 'ยังไม่ตั้งราคา',
                    $balance > 0.005   => 'ชำระบางส่วน',
                    $balance < -0.005  => 'ชำระเกิน',
                    default            => 'ชำระครบ',
                },
                'balance'    => $balance,
                'employee'   => (string) ($p['employee_name'] ?? ''),
                'note'       => self::joined(' · ', [
                    /* ป้ายประเภทการรับอยู่ใน routes/payments.php — index.php โหลดทุกไฟล์
                       เส้นทางก่อนตอบคำขอเสมอ · เงินของ POS ไม่มีประเภท */
                    PAYMENT_KIND_TH[$p['kind']] ?? '',
                    $p['notes'],
                    $p['reference'] !== null && trim((string) $p['reference']) !== '' ? 'อ้างอิง ' . $p['reference'] : '',
                ]),
                'bill'       => $kind !== null ? "$kind:$billId" : null,
            ];
        }
        return $rows;
    }

    /**
     * เงินก้อนนี้เป็นของบิลไหน — [ชนิดบิล, id]
     *
     * `payments` ผูกได้ทั้งออเดอร์ (order_id) และการขายของระบบเดิม (sale_id) · `pos_payments`
     * ผูกกับ pos_sales ด้วย sale_id ซึ่งเป็นคนละตารางกับ sale_id ข้างบน
     */
    private static function billOf(array $p): array
    {
        return match (true) {
            $p['src'] === 'pos_payments' => ['pos', (int) $p['sale_id']],
            $p['order_id'] !== null      => ['order', (int) $p['order_id']],
            $p['sale_id'] !== null       => ['legacy', (int) $p['sale_id']],
            default                      => [null, null],
        };
    }

    /**
     * ยอดที่บิลได้รับสะสมหลังเงินแต่ละก้อน — [ชนิดบิล][id ของเงินก้อนนั้น]
     *
     * อ่านทุกงวดของบิลที่อยู่ในไฟล์ ไม่ใช่เฉพาะงวดในช่วงวันที่ · งวดที่ยกเลิกไม่นับ
     * เหมือนที่ยอดชำระแล้วของบิลทุกหน้าไม่นับ
     */
    private static function paidAfter(array $ids): array
    {
        $out     = ['order' => [], 'legacy' => [], 'pos' => []];
        $ledgers = ['order' => ['payments', 'order_id'], 'legacy' => ['payments', 'sale_id'], 'pos' => ['pos_payments', 'sale_id']];
        foreach ($ledgers as $kind => [$table, $col]) {
            $list = array_values($ids[$kind]);
            if (!$list) {
                continue;
            }
            $sum = [];
            foreach (Db::all(
                "SELECT id, $col AS bill, amount FROM $table
                  WHERE $col IN (" . self::marks($list) . ') AND cancelled_at IS NULL
                  ORDER BY paid_at, id',
                ...$list
            ) as $r) {
                $sum[$r['bill']]              = ($sum[$r['bill']] ?? 0.0) + (float) $r['amount'];
                $out[$kind][(int) $r['id']] = round2($sum[$r['bill']]);
            }
        }
        return $out;
    }

    /** ออเดอร์งานตัดแว่น — เลขเคสมาก่อนเลขใบสั่ง เพราะร้านตามงานด้วยเลขเคส */
    private static function orderBills(array $ids): array
    {
        if (!$ids) {
            return [];
        }
        $out = [];
        foreach (Db::all(
            'SELECT o.id, o.case_id, o.invoice_code, o.frame_name, o.lens_name, o.lens_r_name, o.lens_l_name,
                    ROUND(o.total_price - o.discount, 2) AS revenue,
                    c.first_name, c.mid_name, c.last_name, cs.case_code
               FROM custom_orders o
               LEFT JOIN customers c ON c.id  = o.customer_id
               LEFT JOIN cases cs    ON cs.id = o.case_id
              WHERE o.id IN (' . self::marks($ids) . ')',
            ...$ids
        ) as $r) {
            $out[(int) $r['id']] = [
                'case_id'  => $r['case_id'] !== null ? (int) $r['case_id'] : null,
                /* เคสเดียวมีได้หลายใบสั่ง — เลขใบสั่งต่อท้ายไว้ให้แยกออกว่าเงินก้อนไหนของใบไหน */
                'code'     => self::joined(' / ', [$r['case_code'], $r['invoice_code']]),
                'customer' => self::personName($r),
                'items'    => self::joined(' + ', array_unique(array_map(
                    fn($v) => trim((string) $v),
                    [$r['frame_name'], $r['lens_name'], $r['lens_r_name'], $r['lens_l_name']]
                ))),
                'revenue'  => round2($r['revenue']),
            ];
        }
        return $out;
    }

    /** การขายสินค้าของระบบเดิม — หนึ่งแถวคือหนึ่งชิ้น */
    private static function legacyBills(array $ids): array
    {
        if (!$ids) {
            return [];
        }
        $out = [];
        foreach (Db::all(
            'SELECT sa.id, sa.invoice_code, ROUND(sa.price - sa.discount, 2) AS revenue,
                    COALESCE(sa.product_name_snapshot, st.product_name) AS item,
                    c.first_name, c.mid_name, c.last_name
               FROM sales sa
               LEFT JOIN customers c        ON c.id  = sa.customer_id
               LEFT JOIN v_stock_lot_all st ON st.id = sa.product_stock_id
              WHERE sa.id IN (' . self::marks($ids) . ')',
            ...$ids
        ) as $r) {
            $out[(int) $r['id']] = [
                'code'     => (string) $r['invoice_code'],
                'customer' => self::personName($r),
                'items'    => (string) $r['item'],
                'revenue'  => round2($r['revenue']),
            ];
        }
        return $out;
    }

    /** บิล POS — ลูกค้าขาจรที่ไม่ได้ผูกทะเบียนใช้ชื่อที่พิมพ์ไว้ในบิล */
    private static function posBills(array $ids): array
    {
        if (!$ids) {
            return [];
        }
        $marks = self::marks($ids);
        $out   = [];
        foreach (Db::all(
            "SELECT s.id, s.pos_no, ROUND(s.total_amount, 2) AS revenue, s.customer_name_snapshot,
                    c.first_name, c.mid_name, c.last_name, it.names
               FROM pos_sales s
               LEFT JOIN customers c ON c.id = s.customer_id
               LEFT JOIN (SELECT sale_id, GROUP_CONCAT(product_name_snapshot ORDER BY sort_order SEPARATOR ', ') names
                            FROM pos_sale_items WHERE sale_id IN ($marks) GROUP BY sale_id) it ON it.sale_id = s.id
              WHERE s.id IN ($marks)",
            ...$ids,
            ...$ids
        ) as $r) {
            $out[(int) $r['id']] = [
                'code'     => (string) $r['pos_no'],
                'customer' => self::personName($r) ?: trim((string) $r['customer_name_snapshot']),
                'items'    => (string) $r['names'],
                'revenue'  => round2($r['revenue']),
            ];
        }
        return $out;
    }

    /* ---- ชีท ---------------------------------------------------------- */

    /** ชีทแรก — ตัวกรองที่ใช้ ยอดรวม และตารางแยกตามช่องทางชำระ */
    private static function summarySheet(Xlsx $book, array $filter, array $sum, array $rows): void
    {
        [$from, $to, $channel, $status, $group] = $filter;
        $sh = $book->sheet('สรุป');
        $sh->widths([32, 18, 18, 14]);

        $sh->row([Xlsx::t('รายงานการรับเงิน', Xlsx::TITLE)]);
        $sh->row([Xlsx::t(
            sprintf(
                'ช่วง %s ถึง %s · ช่องทาง: %s · สถานะงาน: %s · ประเภทลูกค้า: %s · ออกไฟล์เมื่อ %s',
                self::dmy($from),
                self::dmy($to),
                self::CHANNEL_TH[$channel] ?? $channel,
                self::STATUS_TH[$status] ?? $status,
                self::GROUP_TH[$group] ?? $group,
                date('d/m/Y H:i')
            ),
            Xlsx::MUTED
        )]);
        /* หน้าอื่นนับด้วยวันเปิดบิล — บอกไว้ก่อนว่าไฟล์นี้นับด้วยวันรับเงิน คนที่เอาไป
           เทียบกับรายงานยอดขายจะได้ไม่สรุปว่าอันใดอันหนึ่งพัง */
        $sh->row([Xlsx::t(
            'นับตามวันที่รับเงิน ไม่ใช่วันที่เปิดบิล — ใช้ตัวกรองชุดเดียวกับหน้า รายงาน > การรับเงิน แล้วยอดรวมต้องตรงกันทุกบาท',
            Xlsx::MUTED
        )]);
        $sh->gap();

        $bills = count(array_unique(array_filter(array_column($rows, 'bill'))));
        $sh->row([Xlsx::t('ช่วงวันที่'), Xlsx::t(self::dmy($from) . ' ถึง ' . self::dmy($to))]);
        $sh->row([Xlsx::t('รับเงินรวม', Xlsx::BOLD), Xlsx::n($sum['total'], Xlsx::MONEY_BOLD)]);
        $sh->row([Xlsx::t('จากงานตัดแว่น'), Xlsx::n($sum['by_channel']['main'])]);
        $sh->row([Xlsx::t('จากหน้าร้าน / POS'), Xlsx::n($sum['by_channel']['pos'])]);
        $sh->row([Xlsx::t('จำนวนรายการรับเงิน'), Xlsx::n($sum['count'], Xlsx::INT)]);
        $sh->row([Xlsx::t('จำนวนบิล'), Xlsx::n($bills, Xlsx::INT)]);
        $sh->gap();

        $sh->row([Xlsx::t('สรุปยอดแยกตามช่องทางชำระเงิน', Xlsx::BOLD)]);
        $sh->row([
            Xlsx::t('ช่องทางชำระเงิน', Xlsx::HEAD),
            Xlsx::t('จำนวนครั้ง', Xlsx::HEAD),
            Xlsx::t('ยอดเงิน', Xlsx::HEAD),
            Xlsx::t('สัดส่วน %', Xlsx::HEAD),
        ]);
        if (!$sum['by_method']) {
            $sh->row([Xlsx::t('ช่วงนี้ไม่มีการรับเงินตามตัวกรองที่เลือก', Xlsx::MUTED)]);
            return;
        }
        $first = $sh->nextRow();
        foreach ($sum['by_method'] as $m) {
            $sh->row([
                Xlsx::t(self::METHOD_TH[$m['method']] ?? $m['method']),
                Xlsx::n($m['count'], Xlsx::INT),
                Xlsx::n($m['amount']),
                Xlsx::n($m['share'], Xlsx::PCT),
            ]);
        }
        $last = $sh->nextRow() - 1;
        $sh->row([
            Xlsx::t('รวม', Xlsx::BOLD),
            Xlsx::f("SUM(B$first:B$last)", $sum['count'], Xlsx::INT_BOLD),
            Xlsx::f("SUM(C$first:C$last)", $sum['total']),
            Xlsx::n(100, Xlsx::PCT),
        ]);
    }

    /** ชีทที่สอง — หนึ่งแถวต่อเงินหนึ่งก้อน พร้อมปุ่มกรองบนหัวตาราง */
    private static function detailSheet(Xlsx $book, array $rows): void
    {
        $sh = $book->sheet('รายละเอียดการรับเงิน');
        $sh->widths([12, 8, 26, 26, 13, 13, 40, 14, 14, 16, 14, 14, 20, 40]);
        $sh->row(array_map(fn(string $h) => Xlsx::t($h, Xlsx::HEAD), self::HEAD));

        $first = $sh->nextRow();
        foreach ($rows as $r) {
            $sh->row([
                Xlsx::d($r['paid_at']),
                Xlsx::time($r['paid_at']),
                Xlsx::t($r['code']),
                Xlsx::t($r['customer']),
                Xlsx::t($r['group']),
                Xlsx::t($r['channel']),
                Xlsx::t($r['items']),
                $r['revenue'] === null ? Xlsx::blank() : Xlsx::n($r['revenue']),
                Xlsx::n($r['amount']),
                Xlsx::t($r['method']),
                Xlsx::t($r['pay_status']),
                $r['balance'] === null ? Xlsx::blank() : Xlsx::n($r['balance']),
                Xlsx::t($r['employee']),
                Xlsx::t($r['note']),
            ]);
        }
        $last = $sh->nextRow() - 1;
        $sh->freeze(1);
        $sh->filterFrom(1, count(self::HEAD), $last);
        if (!$rows) {
            return;
        }

        /* เว้นหนึ่งบรรทัดก่อนแถวรวม — ติดกันแล้ว Excel นับแถวรวมเป็นส่วนของตาราง กรอง
           คอลัมน์ไหนแถวรวมจะโดนซ่อนไปด้วย · ไม่รวมคอลัมน์ยอดขาย เพราะบิลที่รับหลายงวด
           ปรากฏหลายแถว บวกกันแล้วได้ยอดขายซ้ำ */
        $sh->gap();
        $sh->row([
            Xlsx::t('รวม ' . number_format(count($rows)) . ' รายการ', Xlsx::BOLD),
            null, null, null, null, null, null, null,
            Xlsx::f("SUM(I$first:I$last)", array_sum(array_column($rows, 'amount'))),
        ]);
    }

    /* ---- เครื่องมือเล็ก ------------------------------------------------ */

    private static function marks(array $ids): string
    {
        return implode(',', array_fill(0, count($ids), '?'));
    }

    /** ต่อข้อความที่ไม่ว่างด้วยตัวคั่น */
    private static function joined(string $glue, array $parts): string
    {
        return implode($glue, array_filter(array_map(fn($v) => trim((string) $v), $parts), fn($v) => $v !== ''));
    }

    private static function personName(array $r): string
    {
        return self::joined(' ', [$r['first_name'], $r['mid_name'], $r['last_name']]);
    }

    /** 'YYYY-MM-DD' -> '06/09/2026' รูปเดียวกับช่องวันที่บนหน้ารายงาน */
    private static function dmy(string $ymd): string
    {
        [$y, $m, $d] = array_map('intval', explode('-', substr($ymd, 0, 10)) + [0, 0, 0]);
        return $y ? sprintf('%02d/%02d/%04d', $d, $m, $y) : $ymd;
    }
}
