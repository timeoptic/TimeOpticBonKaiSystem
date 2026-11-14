<?php
/**
 * ไฟล์ Excel ของรายงานยอดขาย — ชีทสรุปหนึ่งใบ แล้วแยกชีทรายเดือน
 *
 * **แบ่งเดือนด้วยวันเดียวกับที่หน้ารายงานบนเว็บนับอยู่** (วันปิดบิลหรือวันเปิดบิล
 * ตามตัวเลือก "นับตาม" — ดู SalesReport::BYS) — ยอดรวมในไฟล์
 * ต้องเท่ากับตัวเลขบนหน้าจอทุกบาทเมื่อใช้ตัวกรองชุดเดียวกัน · `api/cli/check-report-export.php`
 * ตรวจข้อนี้ให้ทั้งตาราง (ช่วง × ช่องทาง × สถานะ) รันได้ทุกเมื่อ
 *
 * บทเรียนที่ยังใช้อยู่: ไฟล์กับหน้าจอต้องนับด้วยวันเดียวกันเสมอ ·
 * เคยลองแบ่งไฟล์ด้วยวันปิดงานขณะที่หน้าจอยังนับวันเปิดบิล เพราะคำถามที่เจ้าของร้านถามคือ "เดือนนั้นปิดงาน
 * ไปเท่าไหร่" ซึ่งวันปิดตอบตรงกว่า · แต่ผลคือไฟล์กับหน้าจอไม่ตรงกันสักครั้งเดียว
 * (ปี 2026 ต่างกัน 58 ใบ ฿354,508 จากบิลที่เปิดปี 2025 แล้วมาปิดปี 2026) แล้วทุก
 * ครั้งที่ไม่ตรง คนอ่านต้องหยุดมาสืบว่าฝั่งไหนพัง ซึ่งแพงกว่าประโยชน์ที่ได้ ·
 * ตั้งแต่ 30 ก.ย. 2026 หน้าจอเลือกวันที่นับได้ แล้วไฟล์ตามหน้าจอ ทั้งสองคอลัมน์วันที่
 * ยังอยู่ครบในไฟล์เสมอ
 *
 * ตัวกรองมาจากหน้ารายงานทั้งชุด (ช่วงวันที่ + ช่องทาง + สถานะงาน) — ไม่มีโหมด
 * พิเศษของ "ทั้งปี" ช่วงคร่อมกี่เดือนก็ได้ชีทเท่านั้นเดือน กดปุ่ม "ปีนี้" จึงได้
 * สิบสองชีทเอง
 */
declare(strict_types=1);

final class SalesExport
{
    private const MONTHS_TH = [
        1 => 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
    ];

    /** ป้ายสถานะงานในไฟล์ — คำเดียวกับที่กล่องตัวกรองบนหน้าเว็บใช้ */
    public const DONE   = 'จบแล้ว';
    public const UNDONE = 'ยังไม่จบ';

    /**
     * งานตัดแว่นในช่วง — หนึ่งแถวต่อหนึ่งใบสั่ง
     *
     * เงื่อนไข WHERE กับสูตรทุกช่องต้องเหมือน `SalesReport::mainBills` ทุกตัวอักษร
     * ไม่งั้นไฟล์กับหน้าจอจะค่อย ๆ เพี้ยนออกจากกันโดยไม่มีใครรู้ · ที่ไม่เรียกใช้
     * ตัวนั้นตรง ๆ เพราะไฟล์ต้องการวันปิดงานกับเลขเคสมาแสดงเป็นคอลัมน์ ซึ่งรายงาน
     * บนหน้าจอไม่ได้ใช้ — แต่ตัวเลขเงินทุกตัวมาจากสูตรเดียวกัน และ
     * `api/cli/check-report-export.php` คอยเทียบให้ว่ายังตรงกันอยู่
     */
    public static function mainRows(
        string $from,
        string $to,
        string $status = 'all',
        string $group = 'all',
        string $by = 'open'
    ): array {
        $where = SalesReport::mainWhereSql($status, $by) . SalesReport::groupSql($group, 'cs.customer_category');
        $date  = SalesReport::mainDateSql($status, $by);
        $rows  = Db::all(
            "SELECT DATE($date)                                           AS counted_on,
                    DATE(o.order_date)                                    AS opened_on,
                    DATE(o.order_close_date)                              AS closed_on,
                    o.order_closed,
                    COALESCE(NULLIF(cs.case_code, ''), o.invoice_code)    AS code,
                    o.customer_id,
                    c.first_name, c.mid_name, c.last_name,
                    ROUND(o.total_price - o.discount, 2)                       AS revenue,
                    ROUND(COALESCE(pay.paid, 0), 2)                            AS paid,
                    ROUND(o.total_price - o.discount - COALESCE(pay.paid,0),2) AS balance
               FROM custom_orders o
               JOIN customers c      ON c.id  = o.customer_id
               LEFT JOIN cases cs    ON cs.id = o.case_id
               LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments
                           WHERE order_id IS NOT NULL AND cancelled_at IS NULL
                           GROUP BY order_id) pay ON pay.order_id = o.id
              WHERE $where
              ORDER BY counted_on, o.id",
            $from,
            $to
        );

        return array_map(fn(array $r) => [
            /* วันที่ที่ใบนี้ถูกนับ — ตัวแบ่งเดือนของไฟล์ */
            'date'        => (string) $r['counted_on'],
            'opened'      => (string) $r['opened_on'],
            'closed'      => (string) ($r['closed_on'] ?? ''),
            'code'        => (string) $r['code'],
            /* ชื่อกลางไปรวมกับชื่อจริง — คนที่มีชื่อกลางในระบบมีไม่กี่คน การเพิ่ม
               คอลัมน์ที่ว่างทั้งใบเพื่อสองสามแถวแลกกับข้อมูลหายไม่คุ้มทั้งคู่ */
            'first'       => trim(implode(' ', array_filter([$r['first_name'], $r['mid_name']]))),
            'last'        => trim((string) $r['last_name']),
            'revenue'     => round2($r['revenue']),
            'paid'        => round2($r['paid']),
            'balance'     => round2($r['balance']),
            'channel'     => 'งานตัดแว่น',
            'status'      => ((int) $r['order_closed']) ? self::DONE : self::UNDONE,
            'customer_id' => $r['customer_id'] !== null ? (int) $r['customer_id'] : null,
        ], $rows);
    }

    /**
     * ขายหน้าร้านในช่วง — POS ใหม่ ต่อท้ายด้วยการขายของระบบเดิม
     *
     * ฝั่งนี้ไม่มี "วันปิดงาน" แยกต่างหาก เพราะขายแล้วจบในใบเดียว — วันขายทำหน้าที่
     * ทั้งวันเปิดบิลและวันปิดงาน · ส่วนที่ยังไม่จบคือใบที่ลูกค้ายังไม่ได้รับของ
     * (`fulfillment_status = 'waiting'`) ซึ่งวันปิดยังไม่เกิด จึงเว้นว่างไว้
     */
    public static function posRows(string $from, string $to, string $status = 'all', string $group = 'all'): array
    {
        if (!SalesReport::groupHasPos($group)) {
            return [];
        }
        $out        = [];
        $onlyStatus = SalesReport::statusSql(
            $status,
            "s.fulfillment_status = 'delivered'",
            "s.fulfillment_status <> 'delivered'"
        );

        foreach (Db::all(
            "SELECT DATE(s.sale_date) AS sold_on, s.pos_no AS code, s.customer_id,
                    s.fulfillment_status,
                    c.first_name, c.mid_name, c.last_name, s.customer_name_snapshot,
                    ROUND(s.total_amount, 2)   AS revenue,
                    ROUND(s.paid_amount, 2)    AS paid,
                    ROUND(s.balance_amount, 2) AS balance
               FROM pos_sales s
               LEFT JOIN customers c ON c.id = s.customer_id
              WHERE s.status = 'active' AND DATE(s.sale_date) BETWEEN ? AND ? $onlyStatus
              ORDER BY sold_on, s.id",
            $from,
            $to
        ) as $r) {
            $out[] = self::posRow($r, (string) $r['customer_name_snapshot']);
        }

        /* ตาราง `sales` ของระบบเดิมไม่มีคอลัมน์สถานะ ทุกใบนับเป็นจบแล้ว —
           ถามหางานที่ยังไม่จบ ฝั่งนี้จึงไม่มีอะไรจะตอบ (เหมือน SalesReport::posBills) */
        foreach ($status === 'open' ? [] : Db::all(
            "SELECT DATE(sa.sale_date) AS sold_on, sa.invoice_code AS code, sa.customer_id,
                    'delivered' AS fulfillment_status,
                    c.first_name, c.mid_name, c.last_name,
                    ROUND(sa.price - sa.discount, 2)                         AS revenue,
                    ROUND(COALESCE(pay.paid, 0), 2)                          AS paid,
                    ROUND(sa.price - sa.discount - COALESCE(pay.paid, 0), 2) AS balance
               FROM sales sa
               LEFT JOIN customers c ON c.id = sa.customer_id
               LEFT JOIN (SELECT sale_id, SUM(amount) paid FROM payments
                           WHERE sale_id IS NOT NULL AND cancelled_at IS NULL
                           GROUP BY sale_id) pay ON pay.sale_id = sa.id
              WHERE DATE(sa.sale_date) BETWEEN ? AND ?
              ORDER BY sold_on, sa.id",
            $from,
            $to
        ) as $r) {
            $out[] = self::posRow($r, '');
        }

        return $out;
    }

    /**
     * แถวขายหน้าร้านหนึ่งแถว
     *
     * ลูกค้าขาจรที่ไม่ได้ผูกกับทะเบียนลูกค้ามีแต่ชื่อที่พิมพ์ไว้ในใบเป็นก้อนเดียว —
     * ตัดที่ช่องว่างแรกเป็นชื่อ/นามสกุล ซึ่งถูกกับชื่อไทยเกือบทั้งหมด และถ้าผิดก็
     * ยังเห็นชื่อเต็มครบทุกคำในสองช่องรวมกัน ไม่มีอะไรหาย
     */
    private static function posRow(array $r, string $snapshot): array
    {
        $first = trim(implode(' ', array_filter([$r['first_name'], $r['mid_name']])));
        $last  = trim((string) $r['last_name']);
        if ($first === '' && $last === '' && trim($snapshot) !== '') {
            $parts = preg_split('/\s+/u', trim($snapshot), 2) ?: [];
            $first = $parts[0] ?? '';
            $last  = $parts[1] ?? '';
        }
        $done = ($r['fulfillment_status'] ?? 'delivered') === 'delivered';
        return [
            'date'        => (string) $r['sold_on'],
            'opened'      => (string) $r['sold_on'],
            /* ใบที่ลูกค้ายังไม่ได้รับของยังไม่มีวันปิด — เว้นว่างเหมือนงานตัดแว่น
               ที่ยังไม่ได้กดปิดการขาย ไม่ใช่ใส่วันขายลงไปให้ดูเหมือนจบแล้ว */
            'closed'      => $done ? (string) $r['sold_on'] : '',
            'code'        => (string) $r['code'],
            'first'       => $first,
            'last'        => $last,
            'revenue'     => round2($r['revenue']),
            'paid'        => round2($r['paid']),
            'balance'     => round2($r['balance']),
            'channel'     => 'ขายหน้าร้าน',
            'status'      => $done ? self::DONE : self::UNDONE,
            'customer_id' => $r['customer_id'] !== null ? (int) $r['customer_id'] : null,
        ];
    }

    /** แถวทั้งหมดตามตัวกรอง เรียงตามวันที่ที่ถูกนับ แล้วตามเลขเคส */
    public static function rows(
        string $from,
        string $to,
        string $channel,
        string $status = 'all',
        string $group = 'all',
        string $by = 'open'
    ): array {
        $rows = array_merge(
            SalesReport::wantsMain($channel) ? self::mainRows($from, $to, $status, $group, $by) : [],
            SalesReport::wantsPos($channel)  ? self::posRows($from, $to, $status, $group)  : []
        );
        usort($rows, fn(array $a, array $b) => [$a['date'], $a['code']] <=> [$b['date'], $b['code']]);
        return $rows;
    }

    /** ยอดรวมของแถวชุดหนึ่ง — นิยามเดียวกับ SalesReport::totals */
    public static function totals(array $rows): array
    {
        $revenue = 0.0;
        $paid    = 0.0;
        $balance = 0.0;
        $known   = [];
        foreach ($rows as $r) {
            $revenue += (float) $r['revenue'];
            $paid    += (float) $r['paid'];
            /* ค้างชำระติดลบ = จ่ายเกิน ซึ่งไม่ใช่หนี้ · ปัดขึ้นเป็นศูนย์เหมือนที่
               หน้ารายงานทำ ไม่งั้นใบที่จ่ายเกินจะไปลบหนี้ของใบอื่นทิ้ง */
            $balance += max(0.0, (float) $r['balance']);
            if (!empty($r['customer_id'])) {
                $known[(int) $r['customer_id']] = true;
            }
        }
        $n = count($rows);
        return [
            'bills'     => $n,
            'revenue'   => round2($revenue),
            'paid'      => round2($paid),
            'balance'   => round2($balance),
            'avg'       => $n ? round2($revenue / $n) : 0.0,
            'customers' => count($known),
        ];
    }

    /** ทุกเดือนที่ช่วงนี้คร่อม เป็น 'YYYY-MM' เรียงจากเก่าไปใหม่ */
    public static function months(string $from, string $to): array
    {
        $cur  = new DateTimeImmutable(substr($from, 0, 7) . '-01');
        $last = new DateTimeImmutable(substr($to, 0, 7) . '-01');
        $out  = [];
        while ($cur <= $last) {
            $out[] = $cur->format('Y-m');
            $cur   = $cur->modify('+1 month');
        }
        return $out;
    }

    /**
     * ป้ายเดือน — 'ม.ค.' เฉย ๆ เมื่อทั้งไฟล์อยู่ในปีเดียว
     *
     * ปีถูกเขียนไว้แล้วบนหัวชีทสรุป การแปะซ้ำบนแท็บทุกใบทำให้แท็บยาวจนอ่านชื่อ
     * เดือนไม่ทันตอนมีสิบสองใบเรียงกัน · แต่ไฟล์ที่คร่อมปี (เช่น ธ.ค. ถึง ม.ค.)
     * ต้องมีปีกำกับ ไม่งั้นสองแท็บจะชื่อซ้ำกันจนแยกไม่ออกว่าอันไหนปีไหน
     */
    public static function monthLabel(string $ym, bool $withYear = false): string
    {
        $m    = (int) substr($ym, 5, 2);
        $name = self::MONTHS_TH[$m] ?? $ym;
        return $withYear ? $name . ' ' . substr($ym, 0, 4) : $name;
    }

    /** ช่วงนี้คร่อมปีหรือเปล่า — ตัวตัดสินว่าป้ายเดือนต้องมีปีกำกับไหม */
    public static function spansYears(string $from, string $to): bool
    {
        return substr($from, 0, 4) !== substr($to, 0, 4);
    }

    /* ------------------------------------------------------------------ */

    /** ชื่อไฟล์ที่ผู้ใช้จะเห็นตอนดาวน์โหลด */
    public static function fileName(string $from, string $to, string $group = 'all'): string
    {
        $y = substr($from, 0, 4);
        /* ไฟล์ที่กรองประเภทลูกค้าไว้ต้องบอกในชื่อ — ตัวเลขในไฟล์ SightFirst เปิดดูทีหลัง
           แล้วเข้าใจว่าเป็นยอดทั้งร้านได้ง่ายมาก */
        $suffix = ['shop' => ' (ลูกค้าร้าน)', 'sightfirst' => ' (SightFirst)'][$group] ?? '';
        /* ทั้งปีพอดี = ตั้งชื่อด้วยปี · ช่วงอื่นเขียนวันที่ให้ครบ ไม่งั้นไฟล์สอง
           ช่วงของปีเดียวกันจะชื่อชนกันในโฟลเดอร์ดาวน์โหลด */
        if ($from === "$y-01-01" && $to === "$y-12-31") {
            return "รายงานยอดขาย $y$suffix.xlsx";
        }
        return "รายงานยอดขาย $from ถึง $to$suffix.xlsx";
    }

    /** ประกอบสมุดงานทั้งเล่ม */
    public static function workbook(
        string $from,
        string $to,
        string $channel,
        string $status = 'all',
        string $group = 'all',
        string $by = 'open'
    ): Xlsx {
        $rows = self::rows($from, $to, $channel, $status, $group, $by);

        /* จัดกลุ่มตามเดือนก่อน แล้วค่อยวาด — เดือนที่ไม่มีเคสจะไม่มีชีท แต่ยังมี
           บรรทัดของตัวเองในตารางสรุปพร้อมเลขศูนย์ ให้เห็นว่าเดือนนั้นเงียบจริง
           ไม่ใช่ลืมใส่ */
        $byMonth = [];
        foreach ($rows as $r) {
            $byMonth[substr($r['date'], 0, 7)][] = $r;
        }

        $withYear = self::spansYears($from, $to);
        $book     = new Xlsx();
        self::dashboard($book, $from, $to, $channel, $status, $rows, $byMonth, $withYear, $by);
        foreach (self::months($from, $to) as $ym) {
            if (!empty($byMonth[$ym])) {
                self::monthSheet($book, $ym, $byMonth[$ym], $channel, $status, $withYear);
            }
        }
        return $book;
    }

    /** ชีทแรก — KPI ตารางสรุปรายเดือน สัดส่วนช่องทาง และสัดส่วนสถานะงาน */
    private static function dashboard(
        Xlsx $book,
        string $from,
        string $to,
        string $channel,
        string $status,
        array $rows,
        array $byMonth,
        bool $withYear,
        string $by = 'open'
    ): void {
        $sh = $book->sheet('Dashboard');
        /* คอลัมน์ G เว้นไว้เป็นช่องไฟก่อนถึงกราฟที่ลอยอยู่ตั้งแต่ H ไปทางขวา */
        $sh->widths([26, 16, 16, 16, 16, 12, 3]);

        $chName = ['all' => 'ทั้งหมด', 'main' => 'งานตัดแว่น', 'pos' => 'ขายหน้าร้าน'][$channel] ?? 'ทั้งหมด';
        $stName = ['all' => 'ทั้งหมด', 'closed' => self::DONE, 'open' => self::UNDONE][$status] ?? 'ทั้งหมด';
        $all    = self::totals($rows);

        $sh->row([Xlsx::t('รายงานยอดขาย', Xlsx::TITLE)]);
        $sh->row([Xlsx::t(
            sprintf(
                'ช่วง %s ถึง %s · ช่องทาง: %s · สถานะงาน: %s · ออกไฟล์เมื่อ %s',
                self::thaiDate($from),
                self::thaiDate($to),
                $chName,
                $stName,
                self::thaiDate(date('Y-m-d')) . ' ' . date('H:i')
            ),
            Xlsx::MUTED
        )]);
        /* บอกให้ชัดว่าไฟล์นี้แบ่งเดือนด้วยวันอะไร — คนที่เอาไปเทียบกับหน้ารายงาน
           บนเว็บ (ซึ่งสลับวันที่นับได้) จะได้รู้ก่อนว่าทำไมตัวเลขไม่เท่ากัน
           แทนที่จะไปสรุปว่าอันใดอันหนึ่งพัง */
        $sh->row([Xlsx::t(self::basisNote($status, $by), Xlsx::MUTED)]);
        $sh->gap();

        $sh->row([Xlsx::t('สรุปรวมทั้งช่วง', Xlsx::BOLD)]);
        $sh->row([Xlsx::t('ยอดขายรวม'), Xlsx::n($all['revenue'], Xlsx::MONEY_BOLD)]);
        $sh->row([Xlsx::t('จำนวนเคส'), Xlsx::n($all['bills'], Xlsx::INT)]);
        $sh->row([Xlsx::t('ลูกค้า (ที่มีประวัติในระบบ)'), Xlsx::n($all['customers'], Xlsx::INT)]);
        $sh->row([Xlsx::t('รับเงินแล้ว'), Xlsx::n($all['paid'])]);
        $sh->row([Xlsx::t('ค้างชำระ'), Xlsx::n($all['balance'])]);
        $sh->row([Xlsx::t('เฉลี่ยต่อเคส'), Xlsx::n($all['avg'])]);
        $sh->gap();

        /* ---- ตารางสรุปรายเดือน ---- */
        $sh->row([Xlsx::t('สรุปรายเดือน', Xlsx::BOLD)]);
        $head = $sh->nextRow();
        $sh->row([
            Xlsx::t('เดือน', Xlsx::HEAD),
            Xlsx::t('จำนวนเคส', Xlsx::HEAD),
            Xlsx::t('ยอดสุทธิ', Xlsx::HEAD),
            Xlsx::t('รับเงินแล้ว', Xlsx::HEAD),
            Xlsx::t('ค้างชำระ', Xlsx::HEAD),
            Xlsx::t('สัดส่วน', Xlsx::HEAD),
        ]);
        $first       = $sh->nextRow();
        $monthLabels = [];
        $monthValues = [];
        foreach (self::months($from, $to) as $ym) {
            $t             = self::totals($byMonth[$ym] ?? []);
            $monthLabels[] = self::monthLabel($ym, $withYear);
            $monthValues[] = $t['revenue'];
            $sh->row([
                Xlsx::t(self::monthLabel($ym, $withYear)),
                Xlsx::n($t['bills'], Xlsx::INT),
                Xlsx::n($t['revenue']),
                Xlsx::n($t['paid']),
                Xlsx::n($t['balance']),
                Xlsx::n($all['revenue'] > 0 ? round($t['revenue'] / $all['revenue'] * 100, 1) : 0, Xlsx::PCT),
            ]);
        }
        $lastRow = $sh->nextRow() - 1;
        $sh->row([
            Xlsx::t('รวม', Xlsx::BOLD),
            Xlsx::f("SUM(B$first:B$lastRow)", $all['bills'], Xlsx::INT_BOLD),
            Xlsx::f("SUM(C$first:C$lastRow)", $all['revenue']),
            Xlsx::f("SUM(D$first:D$lastRow)", $all['paid']),
            Xlsx::f("SUM(E$first:E$lastRow)", $all['balance']),
            Xlsx::blank(),
        ]);
        $sh->gap();

        /* ---- แยกตามช่องทาง ---- */
        $sh->row([Xlsx::t('แยกตามช่องทาง', Xlsx::BOLD)]);
        $sh->row([
            Xlsx::t('ช่องทาง', Xlsx::HEAD),
            Xlsx::t('จำนวนเคส', Xlsx::HEAD),
            Xlsx::t('ยอดสุทธิ', Xlsx::HEAD),
            Xlsx::t('รับเงินแล้ว', Xlsx::HEAD),
            Xlsx::t('ค้างชำระ', Xlsx::HEAD),
            Xlsx::t('สัดส่วน', Xlsx::HEAD),
        ]);
        $chanFirst  = $sh->nextRow();
        $chanLabels = [];
        $chanValues = [];
        foreach (['งานตัดแว่น', 'ขายหน้าร้าน'] as $label) {
            $t            = self::totals(array_values(array_filter($rows, fn($r) => $r['channel'] === $label)));
            $chanLabels[] = $label;
            $chanValues[] = $t['revenue'];
            $sh->row([
                Xlsx::t($label),
                Xlsx::n($t['bills'], Xlsx::INT),
                Xlsx::n($t['revenue']),
                Xlsx::n($t['paid']),
                Xlsx::n($t['balance']),
                Xlsx::n($all['revenue'] > 0 ? round($t['revenue'] / $all['revenue'] * 100, 1) : 0, Xlsx::PCT),
            ]);
        }

        /* ---- แยกตามสถานะงาน — เฉพาะตอนเอาทั้งสองแบบมารวมกัน ----
           กรองมาแบบเดียวแล้วตารางนี้จะมีบรรทัดเดียวที่เท่ากับแถวรวมข้างบนพอดี
           ซึ่งไม่ได้บอกอะไรใหม่ */
        if ($status === 'all') {
            $sh->gap();
            $sh->row([Xlsx::t('แยกตามสถานะงาน', Xlsx::BOLD)]);
            $sh->row([
                Xlsx::t('สถานะ', Xlsx::HEAD),
                Xlsx::t('จำนวนเคส', Xlsx::HEAD),
                Xlsx::t('ยอดสุทธิ', Xlsx::HEAD),
                Xlsx::t('รับเงินแล้ว', Xlsx::HEAD),
                Xlsx::t('ค้างชำระ', Xlsx::HEAD),
                Xlsx::t('สัดส่วน', Xlsx::HEAD),
            ]);
            $stFirst  = $sh->nextRow();
            $stLabels = [];
            $stValues = [];
            foreach ([self::DONE, self::UNDONE] as $label) {
                $t          = self::totals(array_values(array_filter($rows, fn($r) => $r['status'] === $label)));
                $stLabels[] = $label;
                $stValues[] = $t['revenue'];
                $sh->row([
                    Xlsx::t($label),
                    Xlsx::n($t['bills'], Xlsx::INT),
                    Xlsx::n($t['revenue']),
                    Xlsx::n($t['paid']),
                    Xlsx::n($t['balance']),
                    Xlsx::n($all['revenue'] > 0 ? round($t['revenue'] / $all['revenue'] * 100, 1) : 0, Xlsx::PCT),
                ]);
            }
        }

        if (!$rows) {
            $sh->gap();
            $sh->row([Xlsx::t('ช่วงนี้ไม่มีเคสตามตัวกรองที่เลือก จึงไม่มีชีทรายเดือนต่อท้าย', Xlsx::MUTED)]);
        }

        /* ---- กราฟ ----
           วางลอยทางขวาของตาราง (ตั้งแต่คอลัมน์ H) ไม่ใช่ข้างล่าง — เปิดไฟล์มา
           ต้องเห็นตัวเลขกับรูปพร้อมกันในหน้าจอเดียว ไม่ต้องเลื่อนไปเทียบ
           · กราฟอ้างเซลล์จริงในตาราง แก้ตัวเลขแล้วรูปขยับตาม
           · ร้านที่ยังไม่มียอดเลยไม่ต้องมีกราฟ วงกลมว่าง ๆ ไม่ได้บอกอะไร */
        if ($rows) {
            $sh->chart([
                'kind'   => 'col',
                'title'  => 'ยอดขายรายเดือน',
                'anchor' => [7, 3, 17, 22],
                'cats'   => [
                    'ref'    => Xlsx::ref('Dashboard', 'A', $first, $lastRow),
                    'labels' => $monthLabels,
                ],
                'series' => [[
                    'name'   => 'ยอดสุทธิ',
                    'ref'    => Xlsx::ref('Dashboard', 'C', $first, $lastRow),
                    'values' => $monthValues,
                    'color'  => '2F80ED',
                ]],
            ]);
            $sh->chart([
                'kind'   => 'doughnut',
                'title'  => 'สัดส่วนช่องทาง',
                'anchor' => [7, 23, 12, 41],
                'cats'   => [
                    'ref'    => Xlsx::ref('Dashboard', 'A', $chanFirst, $chanFirst + 1),
                    'labels' => $chanLabels,
                ],
                'series' => [[
                    'name'   => 'ยอดสุทธิ',
                    'ref'    => Xlsx::ref('Dashboard', 'C', $chanFirst, $chanFirst + 1),
                    'values' => $chanValues,
                    'colors' => ['2F80ED', 'F2994A'],
                ]],
            ]);
            if ($status === 'all') {
                $sh->chart([
                    'kind'   => 'doughnut',
                    'title'  => 'สัดส่วนสถานะงาน',
                    'anchor' => [12, 23, 17, 41],
                    'cats'   => [
                        'ref'    => Xlsx::ref('Dashboard', 'A', $stFirst, $stFirst + 1),
                        'labels' => $stLabels,
                    ],
                    'series' => [[
                        'name'   => 'ยอดสุทธิ',
                        'ref'    => Xlsx::ref('Dashboard', 'C', $stFirst, $stFirst + 1),
                        'values' => $stValues,
                        'colors' => ['27AE60', 'BDBDBD'],
                    ]],
                ]);
            }
        }

        /* ตรึงสามบรรทัดหัวเรื่องไว้ ตารางข้างล่างจึงยังรู้ว่าเป็นไฟล์ของช่วงไหน
           ตอนเลื่อนดูสิบสองเดือน */
        $sh->freeze(3);
    }

    /**
     * หนึ่งเดือน = หนึ่งชีท รายเคสเรียงตามวันเปิดบิล ปิดท้ายด้วยแถวรวม
     *
     * มีสองคอลัมน์วันที่เสมอ ไม่ใช่คอลัมน์เดียว — วันเปิดบิลคือวันที่ใช้แบ่งเดือน
     * (ฐานเดียวกับหน้าเว็บ) ส่วนวันปิดงานคือสิ่งที่เจ้าของร้านอยากเห็น · งานที่ยัง
     * ไม่จบไม่มีวันปิด และใบเก่าที่ย้ายมาจาก Access บางใบก็ไม่มีทั้งที่จบแล้ว
     * ช่องนั้นจึงว่างได้ ซึ่งบอกอะไรในตัวมันเอง
     *
     * คอลัมน์ท้ายสองอันโผล่เฉพาะตอนที่มันบอกอะไรใหม่ — กรองช่องทางเดียวแล้ว
     * คอลัมน์ช่องทางจะเป็นค่าซ้ำทั้งใบ เปลืองความกว้างเปล่า ๆ (สถานะก็เหมือนกัน)
     */
    private static function monthSheet(
        Xlsx $book,
        string $ym,
        array $rows,
        string $channel,
        string $status,
        bool $withYear = false
    ): void {
        $withChannel = $channel === 'all';
        $withStatus  = $status === 'all';
        $sh          = $book->sheet(self::monthLabel($ym, $withYear));

        /* ร้านอ่านชีทเรียงตามวันปิดงาน (ส่งมอบ) เก่าไปใหม่ · ใบที่ยังไม่ปิดไม่มีวันปิด
           ไปต่อท้าย · วันเท่ากันเรียงตามวันเปิดบิลแล้วเลขเคส */
        usort($rows, fn(array $a, array $b) => [$a['closed'] === '', $a['closed'], $a['opened'], $a['code']]
            <=> [$b['closed'] === '', $b['closed'], $b['opened'], $b['code']]);

        $widths = [13, 13, 16, 18, 18, 14, 14, 14];
        if ($withStatus) {
            $widths[] = 12;
        }
        if ($withChannel) {
            $widths[] = 14;
        }
        $sh->widths($widths);

        $head = [
            Xlsx::t('วันเปิดบิล', Xlsx::HEAD),
            Xlsx::t('วันปิดงาน', Xlsx::HEAD),
            Xlsx::t('เลขเคส', Xlsx::HEAD),
            Xlsx::t('ชื่อจริง', Xlsx::HEAD),
            Xlsx::t('นามสกุล', Xlsx::HEAD),
            Xlsx::t('ยอดสุทธิ', Xlsx::HEAD),
            Xlsx::t('รับเงินแล้ว', Xlsx::HEAD),
            Xlsx::t('ค้างชำระ', Xlsx::HEAD),
        ];
        if ($withStatus) {
            $head[] = Xlsx::t('สถานะ', Xlsx::HEAD);
        }
        if ($withChannel) {
            $head[] = Xlsx::t('ช่องทาง', Xlsx::HEAD);
        }
        $sh->row($head);

        $first = $sh->nextRow();
        foreach ($rows as $r) {
            $line = [
                Xlsx::d($r['opened']),
                Xlsx::d($r['closed']),
                Xlsx::t($r['code']),
                Xlsx::t($r['first']),
                Xlsx::t($r['last']),
                Xlsx::n($r['revenue']),
                Xlsx::n($r['paid']),
                Xlsx::n(max(0.0, (float) $r['balance'])),
            ];
            if ($withStatus) {
                $line[] = Xlsx::t($r['status']);
            }
            if ($withChannel) {
                $line[] = Xlsx::t($r['channel']);
            }
            $sh->row($line);
        }
        $last = $sh->nextRow() - 1;
        $t    = self::totals($rows);

        /* เว้นหนึ่งบรรทัดก่อนแถวรวม — ติดกันแล้ว Excel นับแถวรวมเป็นส่วนหนึ่งของ
           ตาราง เวลากดกรองคอลัมน์ไหนแถวรวมจะโดนซ่อนไปด้วย */
        $sh->gap();
        $sh->row([
            Xlsx::t('รวม ' . number_format($t['bills']) . ' เคส', Xlsx::BOLD),
            null,
            null,
            null,
            null,
            Xlsx::f("SUM(F$first:F$last)", $t['revenue']),
            Xlsx::f("SUM(G$first:G$last)", $t['paid']),
            Xlsx::f("SUM(H$first:H$last)", $t['balance']),
        ]);

        $sh->freeze(1);
        $sh->filterFrom(1, count($head), $last);
    }

    /** บรรทัดกำกับว่าไฟล์นี้นับอะไร ด้วยวันไหน และเทียบกับหน้าเว็บได้แค่ไหน */
    private static function basisNote(string $status, string $by = 'open'): string
    {
        /* โหมดวันปิดบิลนับเฉพาะงานตัดแว่นที่ปิดแล้ว (ขายหน้าร้านยังนับตามวันขาย) ·
           ถามหา "ยังไม่จบ" ในโหมดนั้นไม่มีวันปิดให้นับ จึงตกมาใช้วันเปิดบิล */
        if ($by === 'close' && $status !== 'open') {
            return 'งานตัดแว่นนับเฉพาะใบที่ปิดบิลแล้ว แบ่งเดือนตามวันปิดบิล (วันส่งมอบ)'
                . ' · ขายหน้าร้านนับตามวันขาย'
                . ' — ฐานเดียวกับหน้ารายงานบนเว็บเมื่อเลือก "นับตาม: วันปิดบิล"'
                . ' · งานที่ยังไม่ส่งมอบไม่อยู่ในไฟล์นี้';
        }
        $tail = ' แบ่งเดือนตามวันเปิดบิล ฐานเดียวกับหน้ารายงานบนเว็บ'
            . ($by === 'close' ? '' : ' เมื่อเลือก "นับตาม: วันเปิดบิล"')
            . ' — ใช้ตัวกรองชุดเดียวกันแล้วยอดรวมต้องตรงกันทุกบาท'
            . ' · วันปิดงานอยู่ในคอลัมน์ของตัวเอง เรียงหรือกรองต่อได้';
        return match ($status) {
            'closed' => 'นับเฉพาะงานที่จบแล้ว' . $tail,
            'open'   => 'นับเฉพาะงานที่ยังไม่จบ' . $tail,
            default  => 'นับทุกเคสทั้งที่จบแล้วและยังไม่จบ' . $tail,
        };
    }

    /** 'YYYY-MM-DD' -> '4/9/2026' ให้ตรงกับที่ตารางบนหน้าเว็บเขียนวันที่ */
    private static function thaiDate(string $ymd): string
    {
        [$y, $m, $d] = array_map('intval', explode('-', substr($ymd, 0, 10)) + [0, 0, 0]);
        return $y ? "$d/$m/$y" : $ymd;
    }
}
