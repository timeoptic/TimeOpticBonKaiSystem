<?php
/**
 * รายงานยอดขาย — เจ็ดหน้าใต้เมนู "รายงาน"
 *
 * แยกไฟล์จาก `routes/reports.php` โดยตั้งใจ: ที่นั่นคือเอกสารปิดยอดรายวันและ
 * เอกสารพิมพ์ของหน้าร้าน (เช็คลิสต์สต็อก · ป้ายราคา · ใบสั่งตัดแว่น) ซึ่งพนักงาน
 * กดใช้ทำงานประจำวัน · ที่นี่คือรายงานวิเคราะห์ธุรกิจของเจ้าของร้าน คนละคนอ่าน
 * คนละเวลาที่อ่าน และเวลาแก้ก็แทบไม่แก้พร้อมกัน
 *
 * เส้นทางยังขึ้นต้นด้วย `/api/reports/` เหมือนกัน เพราะประตูที่สองใน `index.php`
 * กันด้วยคำนำหน้าเส้นทาง — เส้นทางใหม่ที่ขึ้นต้นด้วยคำนี้จึงถูกกันให้เฉพาะแอดมิน
 * โดยไม่ต้องมีใครจำได้ว่าต้องไปเติมชื่ออะไรที่ไหน
 *
 * ทั้งเจ็ดเส้นรับพารามิเตอร์ชุดเดียวกัน `?from=&to=&channel=all|main|pos` และอ่าน
 * บิลจาก `SalesReport` ที่เดียว — ตัวเลขในหน้าภาพรวมกับหน้าย่อยจึงตรงกันเสมอ
 */
declare(strict_types=1);

/**
 * ส่วนหัวที่ทุกหน้าได้เหมือนกัน — ช่วงวันที่ที่ถูกตีความแล้ว
 *
 * หน้าเว็บเอาไปโชว์ว่า "กำลังดูช่วงไหนอยู่" ได้โดยไม่ต้องเดาเองว่า server ตีความ
 * พารามิเตอร์ที่ส่งไปยังไง (ส่ง to มาก่อน from ก็ถูกสลับให้แล้ว)
 */
function reportMeta(array $r): array
{
    return [
        'from'    => $r['from'],
        'to'      => $r['to'],
        'channel' => $r['channel'],
        'status'  => $r['status'],
        'group'   => $r['group'],
        /* ขอบเขตของข้อมูลที่ร้านมีจริง — หน้าจอที่ว่างใช้บอกว่าทำไมถึงว่าง
           และเสนอช่วงที่มีข้อมูลให้กดได้ แทนที่จะขึ้น ฿0 เฉย ๆ */
        'bounds'  => SalesReport::bounds($r['channel']),
    ];
}

/**
 * ภาพรวม — KPI ห้าตัว การ์ดเทียบสองช่องทาง และยอดรายวัน
 *
 * "ยอดค้างชำระ" ที่เป็น KPI คือค้างของบิลที่เปิดในช่วงนี้ ไม่ใช่ค้างสะสมทั้งร้าน
 * เพราะตัวเลขที่ไม่ขยับตามตัวกรองวันที่ที่อยู่ข้างบนมันอ่านว่าตัวกรองพัง · ค้างสะสม
 * ทั้งร้านส่งไปด้วยในชื่อ `outstanding_all_time` ให้หน้าเว็บวางเป็นบรรทัดรองใต้
 * ตัวเลขหลัก ซึ่งเป็นเลขที่เจ้าของร้านอยากรู้จริง ๆ แต่คนละคำถามกัน
 */
GET('/api/reports/overview', function (array $req) {
    $r  = SalesReport::range($req['query']);
    $ch = $r['channel'];

    $main = SalesReport::wantsMain($ch) ? SalesReport::mainBills($r['from'], $r['to'], $r['status'], $r['group']) : [];
    $pos  = SalesReport::wantsPos($ch)  ? SalesReport::posBills($r['from'], $r['to'], $r['status'], $r['group'])  : [];

    $mt  = SalesReport::totals($main);
    $pt  = SalesReport::totals($pos);
    $all = SalesReport::totals(array_merge($main, $pos));

    $cust  = SalesReport::customers(array_merge($main, $pos));
    $total = $all['revenue'];

    return reportMeta($r) + [
        'kpi' => [
            'revenue'              => $all['revenue'],
            'bills'                => $all['bills'],
            'customers'            => $cust['known'],
            'walk_in'              => $cust['walk_in'],
            'balance'              => $all['balance'],
            'outstanding_all_time' => SalesReport::outstandingAllTime($ch, $r['group']),
            'avg_bill'             => $all['avg'],
            'paid'                 => $all['paid'],
        ],
        /* สัดส่วนคิดจากยอดขายรวม · ยอดรวมเป็นศูนย์ (ยังไม่มีบิลในช่วงนี้) ให้
           สัดส่วนเป็น 0 ทั้งคู่ ไม่ใช่หารด้วยศูนย์แล้วได้ NaN ไปโผล่ที่โดนัท */
        'channels' => [
            [
                'key'     => 'main',
                'label'   => 'Main Process',
                'sub'     => 'งานตัดแว่น 6 ขั้น',
                'revenue' => $mt['revenue'],
                'bills'   => $mt['bills'],
                'paid'    => $mt['paid'],
                'balance' => $mt['balance'],
                'share'   => $total > 0 ? round($mt['revenue'] / $total * 100, 1) : 0,
            ],
            [
                'key'     => 'pos',
                'label'   => 'POS',
                'sub'     => 'ขายหน้าร้าน',
                'revenue' => $pt['revenue'],
                'bills'   => $pt['bills'],
                'paid'    => $pt['paid'],
                'balance' => $pt['balance'],
                'share'   => $total > 0 ? round($pt['revenue'] / $total * 100, 1) : 0,
            ],
        ],
        'daily' => SalesReport::daily($r['from'], $r['to'], [
            'main' => [$main, 'order_date'],
            'pos'  => [$pos,  'sale_date'],
        ]),
    ];
});

/**
 * งานตัดแว่น — KPI ห้าตัว สามกราฟ และตารางเคส
 *
 * กราฟประเภทเลนส์อ่านโค้ดจาก `custom_orders.lens_type` แล้วแปลป้ายด้วย
 * `list_len_type` — ไม่ hardcode รายชื่อประเภทไว้ที่นี่ เพราะร้านเพิ่มประเภทใหม่
 * ในตารางลุกอัปได้ และรายงานควรเห็นมันโดยไม่ต้องแก้โค้ด
 */
GET('/api/reports/main-process', function (array $req) {
    $r = SalesReport::range($req['query']);
    if (!SalesReport::wantsMain($r['channel'])) {
        return reportMeta($r) + ['kpi' => SalesReport::totals([]), 'bills' => [],
            'by_lens' => [], 'by_employee' => [], 'daily' => [], 'profit' => null];
    }

    $bills  = SalesReport::mainBills($r['from'], $r['to'], $r['status'], $r['group']);
    $labels = SalesReport::lensTypeLabels();

    $profit    = 0.0;
    $costed    = 0;
    $uncosted  = 0;
    $rows      = [];
    foreach ($bills as $b) {
        $m = SalesReport::margin($b);
        if ($m['has_cost']) {
            $profit += (float) $m['profit'];
            $costed++;
        } else {
            $uncosted++;
        }
        $rows[] = [
            'id'            => (int) $b['id'],
            'case_id'       => $b['case_id'] !== null ? (int) $b['case_id'] : null,
            'code'          => $b['case_code'] ?: $b['invoice_code'],
            'date'          => $b['order_date'],
            'customer'      => trim(implode(' ', array_filter(
                [$b['first_name'], $b['mid_name'], $b['last_name']]
            ))) ?: '(ไม่มีชื่อ)',
            'employee'      => $b['employee_name'],
            'lens_type'     => $labels[$b['lens_type']] ?? $b['lens_type'],
            'product'       => trim((string) ($b['frame_name'] ?: '')) ?: null,
            'revenue'       => (float) $b['revenue'],
            'paid'          => (float) $b['paid'],
            'balance'       => max(0.0, (float) $b['balance']),
            'stage_group'   => $b['stage_group'],
            'status'        => $b['status_label_th'],
            'order_closed'  => (int) $b['order_closed'],
            'profit'        => $m['profit'],
        ];
    }

    return reportMeta($r) + [
        'kpi'    => SalesReport::totals($bills) + [
            'profit'   => $costed ? round2($profit) : null,
            'costed'   => $costed,
            'uncosted' => $uncosted,
        ],
        'daily'  => SalesReport::daily($r['from'], $r['to'], ['main' => [$bills, 'order_date']]),
        'by_lens' => SalesReport::groupBy(
            $bills,
            fn($b) => $b['lens_type'] === null ? null : ($labels[$b['lens_type']] ?? $b['lens_type']),
            'ยังไม่ระบุเลนส์'
        ),
        'by_employee' => SalesReport::groupBy($bills, fn($b) => $b['employee_name'], 'ไม่ระบุพนักงาน'),
        'bills'       => $rows,
    ];
});

/**
 * ขายหน้าร้าน — KPI สี่ตัว กราฟหมวดสินค้า และตารางบิล
 *
 * `products` ใน KPI คือจำนวน *ชิ้น* ที่ขายได้ ไม่ใช่จำนวนรายการในบิล — ขายน้ำยา
 * สามขวดในบิลเดียวคือสามชิ้น ซึ่งเป็นตัวเลขที่ใช้เทียบกับสต็อกได้
 */
GET('/api/reports/pos', function (array $req) {
    $r = SalesReport::range($req['query']);
    /* ขายหน้าร้านไม่มีประเภทลูกค้า — เลือก SightFirst แล้วหน้านี้ว่างเหมือนตอนกรองช่องทางออก */
    if (!SalesReport::wantsPos($r['channel']) || !SalesReport::groupHasPos($r['group'])) {
        return reportMeta($r) + ['kpi' => SalesReport::totals([]), 'bills' => [],
            'by_category' => [], 'daily' => [], 'voided' => ['bills' => 0, 'amount' => 0.0]];
    }

    $bills = SalesReport::posBills($r['from'], $r['to'], $r['status']);
    $qty   = 0;
    $rows  = [];
    foreach ($bills as $b) {
        $qty   += (int) $b['item_qty'];
        $rows[] = [
            'id'         => (int) $b['id'],
            'src'        => $b['src'],
            'bill_no'    => $b['bill_no'],
            'date'       => $b['sale_date'],
            'employee'   => $b['employee_name'],
            'customer'   => trim(implode(' ', array_filter(
                [$b['first_name'] ?? null, $b['mid_name'] ?? null, $b['last_name'] ?? null]
            ))) ?: ($b['customer_name_snapshot'] ?? null),
            'items'      => $b['item_names'],
            'qty'        => (int) $b['item_qty'],
            'lines'      => (int) $b['item_lines'],
            'revenue'    => (float) $b['revenue'],
            'paid'       => (float) $b['paid'],
            'balance'    => max(0.0, (float) $b['balance']),
            'pay_status' => $b['payment_status'],
            'fulfil'     => $b['fulfillment_status'],
        ];
    }

    return reportMeta($r) + [
        'kpi'         => SalesReport::totals($bills) + ['products' => $qty],
        'daily'       => SalesReport::daily($r['from'], $r['to'], ['pos' => [$bills, 'sale_date']]),
        'by_category' => SalesReport::posCategories($r['from'], $r['to']),
        'bills'       => $rows,
        /* ใบที่ยกเลิก — ไม่นับเป็นยอดขาย แต่ต้องนับให้เห็น ไม่งั้นหน้าจอที่ว่าง
           ถูกอ่านว่า "ระบบไม่บันทึกการขาย" ทั้งที่บันทึกครบแล้วถูกยกเลิกทีหลัง */
        'voided'      => SalesReport::voidedPos($r['from'], $r['to']),
    ];
});

/**
 * การรับเงิน — รวมสองระบบ แยกตามช่องทางชำระ
 *
 * หน้านี้เป็นหน้าเดียวที่นับด้วย `paid_at` ไม่ใช่วันที่เปิดบิล · เงินที่รับในช่วงนี้
 * จึงมากกว่าหรือน้อยกว่ายอดขายในช่วงเดียวกันได้ และนั่นถูกแล้ว
 *
 * "ผ่อนชำระ" ไม่ใช่ช่องทางชำระ แต่เป็นบิลที่จ่ายมาแล้วบางส่วนและยังค้างอยู่ —
 * ส่งแยกเป็น `installment` ให้หน้าเว็บวางเป็นการ์ดข้าง Pie ไม่ใช่ยัดเป็นชิ้นที่หก
 * ของกราฟที่ชิ้นอื่นเป็นวิธีจ่ายเงิน
 */
GET('/api/reports/payments', function (array $req) {
    $r        = SalesReport::range($req['query']);
    $receipts = SalesReport::receipts($r['from'], $r['to'], $r['channel'], $r['group'], $r['status']);

    /* บิลที่ผ่อนอยู่ — จ่ายมาแล้วบางส่วน ยังไม่ครบ นับจากบิลที่เปิดในช่วงนี้ */
    $main = SalesReport::wantsMain($r['channel']) ? SalesReport::mainBills($r['from'], $r['to'], $r['status'], $r['group']) : [];
    $pos  = SalesReport::wantsPos($r['channel'])  ? SalesReport::posBills($r['from'], $r['to'], $r['status'], $r['group'])  : [];
    $inst = ['bills' => 0, 'balance' => 0.0, 'paid' => 0.0];
    foreach (array_merge($main, $pos) as $b) {
        if ((float) $b['paid'] > 0.001 && (float) $b['balance'] > 0.001) {
            $inst['bills']++;
            $inst['balance'] += (float) $b['balance'];
            $inst['paid']    += (float) $b['paid'];
        }
    }
    $inst['balance'] = round2($inst['balance']);
    $inst['paid']    = round2($inst['paid']);

    /* total · count · by_method · by_channel มาจากตัวเดียวกับที่ไฟล์ Excel ใช้ */
    return reportMeta($r) + SalesReport::receiptSummary($receipts) + [
        'installment' => $inst,
        'daily'       => (function () use ($r, $receipts) {
            /* รับเงินไม่ใช่บิล จึงยืมโครง daily() ไม่ได้ตรง ๆ — ห่อให้หน้าตา
               เหมือนบิลก่อน (revenue = ยอดเงิน, paid_at = วันที่) */
            $asBills = array_map(
                fn($p) => ['revenue' => $p['amount'], 'paid_at' => $p['paid_at']],
                $receipts
            );
            return SalesReport::daily($r['from'], $r['to'], ['amount' => [$asBills, 'paid_at']]);
        })(),
    ];
});

/**
 * รายละเอียดรายการรับเงิน — ตารางใต้กราฟของหน้าการรับเงิน หนึ่งแถวต่อเงินหนึ่งก้อน
 *
 * แยกเส้นจาก `/api/reports/payments` ให้ Dashboard ไม่ต้องรอตารางที่ช่วงหลายปีมีเป็น
 * หมื่นแถว และเส้นเดิมไม่ถูกแตะเลย · ตัวกรองชุดเดียวกัน อ่านเงินจาก receipts() ตัวเดียวกัน
 * ยอดท้ายตารางจึงเท่ากับ "รับเงินรวม" ทุกบาท ดู `PaymentExport::transactions()`
 */
GET('/api/reports/payments/transactions', function (array $req) {
    $r = SalesReport::range($req['query']);
    return reportMeta($r) + PaymentExport::transactions($r['from'], $r['to'], $r['channel'], $r['status'], $r['group']);
});

/**
 * กำไร — ฝั่งงานตัดแว่นได้ตัวเลขจริง ฝั่ง POS ยังไม่มีข้อมูลต้นทุน
 *
 * `pos.has_cost = false` ไม่ใช่ 0 · ศูนย์อ่านว่า "ต้นทุนศูนย์บาท" ซึ่งจะทำให้
 * กำไรของ POS เท่ากับยอดขายทั้งก้อน แล้วเจ้าของร้านเอาไปตัดสินใจผิด · หน้าเว็บ
 * เห็นธงนี้แล้วเขียนว่ายังไม่ได้บันทึกต้นทุน
 *
 * ออเดอร์ที่ยังไม่ได้เลือกกรอบ/เลนส์จากคลังก็ไม่มีต้นทุนเหมือนกัน — นับแยกไว้ที่
 * `uncosted` เพื่อให้อ่านออกว่ากำไรก้อนนี้คิดจากกี่ใบในกี่ใบ
 */
GET('/api/reports/profit', function (array $req) {
    $r = SalesReport::range($req['query']);

    $main    = SalesReport::wantsMain($r['channel']) ? SalesReport::mainBills($r['from'], $r['to'], $r['status'], $r['group']) : [];
    $posRows = SalesReport::wantsPos($r['channel'])  ? SalesReport::posBills($r['from'], $r['to'], $r['status'], $r['group'])  : [];

    /* `revenue` คือยอดขายทั้งหมด · `costed_revenue` คือยอดขายเฉพาะใบที่รู้ต้นทุน
       — อัตรากำไรต้องหารด้วยตัวหลัง ไม่ใช่ตัวแรก · หารด้วยยอดรวมทั้งก้อนแปลว่า
       เอากำไรของ 17 ใบ ไปหารด้วยยอดขายของ 20 ใบ แล้วได้เปอร์เซ็นต์ที่ต่ำกว่าจริง
       โดยไม่มีอะไรบอกว่าทำไม */
    $sum = ['revenue' => 0.0, 'costed_revenue' => 0.0, 'frame_cost' => 0.0,
        'lens_cost' => 0.0, 'other_cost' => 0.0, 'profit' => 0.0];
    $costed   = 0;
    $uncosted = 0;
    $daily    = [];

    foreach ($main as $b) {
        $m = SalesReport::margin($b);
        $sum['revenue'] += $m['revenue'];
        if (!$m['has_cost']) {
            $uncosted++;
            continue;
        }
        $costed++;
        $sum['costed_revenue'] += $m['revenue'];
        $sum['frame_cost'] += (float) $m['frame_cost'];
        $sum['lens_cost']  += (float) $m['lens_cost'];
        $sum['profit']     += (float) $m['profit'];

        $d = substr((string) $b['order_date'], 0, 10);
        if (!isset($daily[$d])) {
            $daily[$d] = ['date' => $d, 'cost' => 0.0, 'profit' => 0.0];
        }
        $daily[$d]['cost']   += (float) $m['frame_cost'] + (float) $m['lens_cost'];
        $daily[$d]['profit'] += (float) $m['profit'];
    }
    foreach ($sum as $k => $v) {
        $sum[$k] = round2($v);
    }
    ksort($daily);
    foreach ($daily as &$d) {
        $d['cost']   = round2($d['cost']);
        $d['profit'] = round2($d['profit']);
    }
    unset($d);

    $posTotals = SalesReport::totals($posRows);

    return reportMeta($r) + [
        'main' => $sum + [
            'bills'    => count($main),
            'costed'   => $costed,
            'uncosted' => $uncosted,
            'margin'   => $sum['costed_revenue'] > 0
                ? round($sum['profit'] / $sum['costed_revenue'] * 100, 1)
                : null,
            'has_cost' => $costed > 0,
        ],
        'pos' => [
            'revenue'  => $posTotals['revenue'],
            'bills'    => $posTotals['bills'],
            'cost'     => null,
            'profit'   => null,
            'has_cost' => false,
            'note'     => 'ระบบยังไม่บันทึกต้นทุนของสินค้าที่ขายผ่าน POS',
        ],
        'daily' => array_values($daily),
    ];
});

/**
 * ผลงานพนักงาน — รวมงานสองฝั่งไว้ในแถวเดียวกันของคนคนเดียวกัน
 *
 * สองระบบบันทึก "ใครขาย" คนละที่: งานตัดแว่นเก็บ `employee_id` (ตาราง employees)
 * ส่วน POS เก็บ `created_by` ซึ่งเป็นบัญชีผู้ใช้ (ตาราง admins) · เชื่อกันด้วย
 * `admins.employee_id` ซึ่งเป็น UNIQUE — บัญชีที่ยังไม่ผูกกับพนักงานจะตกไปอยู่
 * แถว "ไม่ระบุพนักงาน" ไม่ใช่หายไปจากรายงาน
 *
 * Conversion = ออเดอร์ที่ปิดการขายแล้ว ÷ ออเดอร์ทั้งหมดของคนนั้น · ระบบไม่มี
 * คอนเซปต์ lead จึงไม่มี conversion แบบการตลาด · ตัวนี้ตอบว่า "งานที่รับไป
 * ปิดจบกี่เปอร์เซ็นต์" ซึ่งใช้แถวเดียวกับคอลัมน์อื่นในตาราง อ่านแล้วไม่ขัดกัน
 */
GET('/api/reports/employees', function (array $req) {
    $r = SalesReport::range($req['query']);

    $main = SalesReport::wantsMain($r['channel']) ? SalesReport::mainBills($r['from'], $r['to'], $r['status'], $r['group']) : [];
    $pos  = SalesReport::wantsPos($r['channel'])  ? SalesReport::posBills($r['from'], $r['to'], $r['status'], $r['group'])  : [];

    $blank = 'ไม่ระบุพนักงาน';
    $rows  = [];
    $slot  = function (?string $name) use (&$rows, $blank): string {
        $k = $name ?: $blank;
        if (!isset($rows[$k])) {
            $rows[$k] = [
                'employee' => $k, 'customers' => [], 'walk_in' => 0,
                'cases' => 0, 'main_revenue' => 0.0, 'pos_bills' => 0,
                'pos_revenue' => 0.0, 'closed' => 0, 'balance' => 0.0,
            ];
        }
        return $k;
    };

    foreach ($main as $b) {
        $k = $slot($b['employee_name']);
        $rows[$k]['cases']++;
        $rows[$k]['main_revenue'] += (float) $b['revenue'];
        $rows[$k]['balance']      += max(0.0, (float) $b['balance']);
        if ((int) $b['order_closed'] === 1) {
            $rows[$k]['closed']++;
        }
        if (!empty($b['customer_id'])) {
            $rows[$k]['customers'][(int) $b['customer_id']] = true;
        } else {
            $rows[$k]['walk_in']++;
        }
    }
    foreach ($pos as $b) {
        $k = $slot($b['employee_name']);
        $rows[$k]['pos_bills']++;
        $rows[$k]['pos_revenue'] += (float) $b['revenue'];
        $rows[$k]['balance']     += max(0.0, (float) $b['balance']);
        if (!empty($b['customer_id'])) {
            $rows[$k]['customers'][(int) $b['customer_id']] = true;
        } else {
            $rows[$k]['walk_in']++;
        }
    }

    $out = [];
    foreach ($rows as $row) {
        $mainRev = round2($row['main_revenue']);
        $posRev  = round2($row['pos_revenue']);
        $out[]   = [
            'employee'     => $row['employee'],
            'customers'    => count($row['customers']),
            'walk_in'      => $row['walk_in'],
            'cases'        => $row['cases'],
            'main_revenue' => $mainRev,
            'pos_bills'    => $row['pos_bills'],
            'pos_revenue'  => $posRev,
            'total'        => round2($mainRev + $posRev),
            'balance'      => round2($row['balance']),
            'closed'       => $row['closed'],
            /* ไม่มีออเดอร์เลย = ตอบคำถามนี้ไม่ได้ ไม่ใช่ 0% ที่อ่านว่าทำงานล้มเหลว */
            'conversion'   => $row['cases'] > 0
                ? round($row['closed'] / $row['cases'] * 100, 1)
                : null,
        ];
    }
    usort($out, fn($a, $b) => $b['total'] <=> $a['total']);

    return reportMeta($r) + ['rows' => $out];
});

/**
 * ช่องทางที่ลูกค้ารู้จักร้าน — รายงานการตลาด
 *
 * ตอบคนละคำถามกับหน้าอื่นทั้งหมด: หน้าอื่นถามว่า "ขายได้เท่าไหร่" หน้านี้ถามว่า
 * "คนที่มาซื้อ มาจากไหน" · ข้อมูลถูกถามตอนเปิดเคส (ขั้น "รับลูกค้า") และเก็บที่
 * `cases.referral_source` มาตั้งแต่แรก แต่ยังไม่เคยมีหน้าไหนอ่านมันเลย
 *
 * นับด้วยวันที่เปิดเคส ไม่ใช่วันที่เปิดออเดอร์ — เคสที่เปิดแล้วยังไม่ได้ขายอะไร
 * ก็ยังเป็นคนที่ช่องทางนั้นพามา และ "ช่องทางที่พาคนมาแต่ปิดการขายไม่ได้" คือ
 * ข้อมูลที่มีค่าที่สุดอย่างหนึ่งในรายงานนี้ · จึงส่ง conversion ไปด้วย
 *
 * ตัวกรองช่องทางขาย (main/pos) ไม่มีผลกับหน้านี้ — POS ไม่มีเคสและไม่ได้ถาม
 * ว่าลูกค้ารู้จักร้านจากไหน · หน้าเว็บซ่อนตัวกรองนั้นทิ้งเมื่ออยู่หน้านี้
 */
GET('/api/reports/channels', function (array $req) {
    $r     = SalesReport::range($req['query']);
    $cases = SalesReport::referralCases($r['from'], $r['to'], $r['group']);

    /* จัดกลุ่มตาม *ป้าย* ไม่ใช่ตามโค้ด — โค้ดเก่ากับโค้ดใหม่ของช่องทางเดียวกัน
       จึงมารวมเป็นแท่งเดียว (ดู REFERRAL_LABELS) */
    $groups = [];
    $seenLegacy = [];
    foreach ($cases as $c) {
        $code  = $c['referral_source'];
        $label = SalesReport::referralLabel($code);
        if ($code !== null && isset(SalesReport::REFERRAL_MERGED[$code])) {
            $seenLegacy[$code] = $label;
        }
        if (!isset($groups[$label])) {
            $groups[$label] = [
                'label' => $label, 'cases' => 0, 'revenue' => 0.0,
                'new_customers' => 0, 'sold' => 0, 'customers' => [],
            ];
        }
        $g = &$groups[$label];
        $g['cases']++;
        $g['revenue'] += (float) $c['revenue'];
        if ((int) $c['is_new_customer'] === 1) {
            $g['new_customers']++;
        }
        /* "ปิดการขายได้" = เคสนี้มีออเดอร์ที่มียอดเงิน · เคสที่เปิดออเดอร์ไว้แต่ยอด
           เป็นศูนย์ (ยังไม่ได้ใส่ราคา) ไม่นับว่าปิดได้ */
        if ((float) $c['revenue'] > 0) {
            $g['sold']++;
        }
        if (!empty($c['customer_id'])) {
            $g['customers'][(int) $c['customer_id']] = true;
        }
        unset($g);
    }

    $totalCases   = count($cases);
    $totalRevenue = 0.0;
    foreach ($cases as $c) {
        $totalRevenue += (float) $c['revenue'];
    }

    $byReferral = [];
    foreach ($groups as $g) {
        $byReferral[] = [
            'label'         => $g['label'],
            'cases'         => $g['cases'],
            'customers'     => count($g['customers']),
            'new_customers' => $g['new_customers'],
            'revenue'       => round2($g['revenue']),
            'avg'           => $g['cases'] ? round2($g['revenue'] / $g['cases']) : 0.0,
            'sold'          => $g['sold'],
            /* ปิดการขายได้กี่ % ของเคสที่ช่องทางนี้พามา */
            'conversion'    => $g['cases'] ? round($g['sold'] / $g['cases'] * 100, 1) : null,
            'share'         => $totalCases ? round($g['cases'] / $totalCases * 100, 1) : 0,
            'revenue_share' => $totalRevenue > 0 ? round($g['revenue'] / $totalRevenue * 100, 1) : 0,
        ];
    }
    usort($byReferral, fn($a, $b) => $b['revenue'] <=> $a['revenue']);

    /* ที่มาของลูกค้า — ค่านี้ถูกจัดให้อัตโนมัติจากโน้ตและช่องทางที่ติ๊กไว้
       (ดู services/CaseSource.php) · Sight First คือคนไข้ที่โครงการส่งต่อมา
       ไม่ใช่ลูกค้าที่เดินเข้าร้านเอง — คนละธุรกิจกัน รวมยอดแล้วอ่านผลการตลาดผิด

       เคสที่ถูกจัดเป็น 'online' ไม่ถูกนับรวมที่นี่ ตามที่ร้านสั่งว่าไม่ให้นับรวม
       กับเคสปกติ · ส่งจำนวนไปต่างหากในชื่อ `excluded_online` ให้หน้าเว็บบอกได้ว่า
       กันออกไปกี่เคส ไม่ใช่หายไปเฉย ๆ */
    $catLabel = CaseSource::LABELS + ['customer' => 'เดินเข้าร้าน'];
    $cats = [];
    $excludedOnline = 0;
    foreach ($cases as $c) {
        $raw = (string) ($c['customer_category'] ?? '');
        if ($raw === CaseSource::ONLINE) {
            $excludedOnline++;
            continue;
        }
        $k = $catLabel[$raw] ?? 'ไม่ระบุ';
        if (!isset($cats[$k])) {
            $cats[$k] = ['label' => $k, 'cases' => 0, 'revenue' => 0.0];
        }
        $cats[$k]['cases']++;
        $cats[$k]['revenue'] += (float) $c['revenue'];
    }
    foreach ($cats as &$c) {
        $c['revenue'] = round2($c['revenue']);
    }
    unset($c);
    $byCategory = array_values($cats);
    usort($byCategory, fn($a, $b) => $b['cases'] <=> $a['cases']);

    /* ช่องทางที่ "ติดต่อเข้ามา" — คนละเรื่องกับช่องทางที่ "รู้จักร้าน"
       (เห็นโฆษณาบน Facebook แล้วโทรมาจอง = รู้จักทาง FB ติดต่อทางโทรศัพท์) */
    $bookLabel = ['phone' => 'โทรศัพท์', 'line' => 'LINE', 'facebook' => 'Facebook',
        'walk_in' => 'เดินเข้าร้าน', 'other' => 'อื่นๆ'];
    $byBooking = [];
    try {
        foreach (Db::all(
            "SELECT COALESCE(NULLIF(channel,''),'other') ch, COUNT(*) n,
                    SUM(case_id IS NOT NULL) converted
               FROM bookings
              WHERE booking_date BETWEEN ? AND ? AND status <> 'cancelled'
              GROUP BY ch ORDER BY n DESC",
            $r['from'],
            $r['to']
        ) as $b) {
            $byBooking[] = [
                'label'      => $bookLabel[$b['ch']] ?? $b['ch'],
                'bookings'   => (int) $b['n'],
                'converted'  => (int) $b['converted'],
                'conversion' => (int) $b['n']
                    ? round((int) $b['converted'] / (int) $b['n'] * 100, 1)
                    : null,
            ];
        }
    } catch (Throwable) {
        // ตาราง bookings อาจยังไม่มีในฐานที่เพิ่งติดตั้ง — เหมือน routes/dashboard.php
        $byBooking = [];
    }

    /* คิวจองยังไม่มีเคส จึงไม่มีประเภทลูกค้าให้แยก — กรองประเภทลูกค้าอยู่ ไม่แสดง
       ดีกว่าแสดงคิวทั้งร้านใต้หัวข้อ "SightFirst" แล้วถูกอ่านว่าเป็นของกลุ่มนั้น */
    if ($r['group'] !== 'all') {
        $byBooking = [];
    }

    $top = $byReferral[0] ?? null;

    return reportMeta($r) + [
        'kpi' => [
            'cases'         => $totalCases,
            'revenue'       => round2($totalRevenue),
            'new_customers' => array_sum(array_column($byReferral, 'new_customers')),
            'channels'      => count($byReferral),
            'top_label'     => $top['label'] ?? null,
            'top_revenue'   => $top['revenue'] ?? 0.0,
            /* เคสที่ไม่ได้ถามว่ารู้จักร้านจากไหน — ยิ่งเยอะ รายงานนี้ยิ่งเชื่อไม่ได้
               จึงต้องบอกออกไปตรง ๆ ไม่ใช่ปล่อยให้เข้าใจว่าครบ */
            'unasked'       => count(array_filter(
                $cases,
                fn($c) => $c['referral_source'] === null || $c['referral_source'] === ''
            )),
        ],
        'by_referral' => $byReferral,
        'by_category' => $byCategory,
        'excluded_online' => $excludedOnline,
        'by_booking'  => $byBooking,
        /* โค้ดเก่าที่ถูกยุบเข้ากลุ่มปัจจุบัน — หน้าเว็บเอาไปบอกผู้อ่าน */
        'merged'      => (object) $seenLegacy,
    ];
});

/**
 * ส่งออกเป็นไฟล์ Excel — ชีทสรุปหนึ่งใบ แล้วแยกชีทรายเดือน
 *
 * รับพารามิเตอร์ชุดเดียวกับอีกเจ็ดเส้น (`?from=&to=&channel=`) เพราะปุ่มบนหน้าเว็บ
 * ส่งตัวกรองที่ผู้ใช้เห็นอยู่ตรงหน้ามาตรง ๆ — ไฟล์ที่ได้จึงเป็นช่วงเดียวกับที่
 * กำลังดู ไม่ใช่ช่วงที่ต้องไปกรอกซ้ำในหน้าต่างส่งออก
 *
 * เส้นนี้ตอบเป็นไบต์ของไฟล์ ไม่ใช่ JSON จึงต้อง `exit` เอง — ปล่อยให้ค่ากลับไปถึง
 * `index.php` เมื่อไหร่ มันจะห่อเป็น JSON ทับไฟล์ที่พิมพ์ไปแล้ว (routes/uploads.php
 * ที่ส่งไฟล์แนบใช้วิธีเดียวกัน)
 */
GET('/api/reports/export.xlsx', function (array $req) {
    $r = SalesReport::range($req['query']);
    sendXlsx(
        SalesExport::workbook($r['from'], $r['to'], $r['channel'], $r['status'], $r['group'])->toBytes(),
        SalesExport::fileName($r['from'], $r['to'], $r['group']),
        'sales-report-' . $r['from'] . '_' . $r['to'] . '.xlsx'
    );
});

/**
 * ส่งออกหน้าการรับเงินเป็นไฟล์ Excel — ชีทสรุป กับชีทรายการรับเงินทีละครั้ง
 *
 * ตัวกรองชุดเดียวกับ `/api/reports/payments` ทุกตัว (วันที่ · ช่องทาง · สถานะงาน ·
 * ประเภทลูกค้า) — ไฟล์ที่ได้คือสิ่งที่อยู่บนหน้าจอตอนกดปุ่ม ดู `PaymentExport`
 */
GET('/api/reports/payments.xlsx', function (array $req) {
    $r = SalesReport::range($req['query']);
    sendXlsx(
        PaymentExport::workbook($r['from'], $r['to'], $r['channel'], $r['status'], $r['group'])->toBytes(),
        PaymentExport::fileName($r['from'], $r['to'], $r['group']),
        'payment-report-' . $r['from'] . '_' . $r['to'] . '.xlsx'
    );
});

/** ส่งไบต์ของไฟล์ .xlsx ออกไปพร้อมชื่อไฟล์ แล้วจบคำขอตรงนี้ (เหตุผลที่ต้อง exit อยู่บนเส้น export.xlsx) */
function sendXlsx(string $bytes, string $name, string $ascii): never
{
    /* ชื่อไฟล์ภาษาไทยต้องส่งเป็น filename* ตาม RFC 5987 · filename= ธรรมดาที่มี
       ไบต์นอก ASCII เบราว์เซอร์แต่ละตัวเดาการเข้ารหัสคนละแบบ บางตัวได้ชื่อเป็น
       ขยะ · ใส่ชื่อสำรองแบบ ASCII ไว้ให้ตัวที่ยังไม่รู้จัก filename* ด้วย */
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header(sprintf(
        "Content-Disposition: attachment; filename=\"%s\"; filename*=UTF-8''%s",
        $ascii,
        rawurlencode($name)
    ));
    /* หน้าเว็บอยู่คนละพอร์ตกับ API — ไม่ประกาศตรงนี้ JavaScript อ่านชื่อไฟล์
       ที่แนบมากับ response ไม่ได้ แล้วต้องเดาชื่อเองทั้งที่เราส่งมาให้แล้ว */
    header('Access-Control-Expose-Headers: Content-Disposition');
    header('Content-Length: ' . strlen($bytes));
    header('Cache-Control: no-store');
    echo $bytes;
    exit;
}
