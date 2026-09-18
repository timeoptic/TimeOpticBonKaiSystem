<?php

declare(strict_types=1);

/**
 * ไฟล์ Excel ของหน้า รายงาน > การรับเงิน — ชีทสรุปหนึ่งใบ ชีทรายการรับเงินหนึ่งใบ
 *
 * โจทย์จากร้าน (12 ก.ย. 2026): ไฟล์เดิมมีแต่ตารางสรุปตามช่องทางชำระ เอาไปตรวจเงิน
 * ย้อนหลังไม่ได้ · ไฟล์ใหม่ต้องเป็นหนึ่งแถวต่อการรับเงินหนึ่งครั้ง ไม่ใช่หนึ่งแถวต่อเคส
 * เพราะเคสเดียวจ่ายได้หลายงวด และต้องใช้ตัวกรองชุดเดียวกับหน้าจอทั้งหมด
 *
 * สิ่งที่ต้องไม่พังเงียบ: ยอดในไฟล์เท่ากับตัวเลขบนหน้าจอเมื่อใช้ตัวกรองชุดเดียวกัน
 *
 * ของทดสอบลงวันที่ปี 2031 ในทรานแซกชันที่ roll back — ไม่ปนกับข้อมูลจริงของร้าน
 */

group('ส่งออก Excel หน้าการรับเงิน');

const PX_BEFORE = '2031-03-01';
const PX_D1     = '2031-03-10';
const PX_D2     = '2031-03-11';

/**
 * ออเดอร์ที่ยังเปิดอยู่จ่ายสามงวด (งวดแรกก่อนช่วงวันที่ และมีงวดที่ถูกยกเลิก) ·
 * ออเดอร์ SightFirst ที่ปิดแล้ว · บิล POS ที่ส่งของแล้ว ที่ยังรอส่ง และที่ถูกยกเลิก ·
 * ขายสินค้าของระบบเดิมหนึ่งใบ
 *
 * ในช่วง PX_D1–PX_D2: งานตัดแว่น 3,000 + 5,000 + 1,500 = 9,500 ·
 * หน้าร้าน 800 + 200 + 400 = 1,400 · รวม 10,900 จาก 6 รายการ 5 บิล
 */
function paymentExportFixtures(Tx $q): array
{
    $tag  = bin2hex(random_bytes(3));
    $emp  = (int) $q->run('INSERT INTO employees (employee_name) VALUES (?)', "พนักงานทดสอบ $tag")['insertId'];
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'สมชาย', 'ทดสอบจ่าย')['insertId'];

    $case = static fn(string $code, string $cat) => (int) $q->run(
        'INSERT INTO cases (case_code, customer_id, customer_category, opened_at) VALUES (?, ?, ?, ?)',
        $code, $cust, $cat, PX_BEFORE . ' 09:00:00'
    )['insertId'];
    $shopCase = $case("TEST-PX-SHOP-$tag", 'customer');
    $sfCase   = $case("TEST-PX-SF-$tag", 'sight_first');

    $order = static fn(int $caseId, string $invoice, float $price, int $closed) => (int) $q->run(
        "INSERT INTO custom_orders (customer_id, case_id, invoice_code, order_date, total_price, discount,
                                    frame_name, lens_name, order_closed)
         VALUES (?, ?, ?, ?, ?, 0, 'กรอบทดสอบ', 'เลนส์ทดสอบ', ?)",
        $cust, $caseId, $invoice, PX_BEFORE . ' 09:30:00', $price, $closed
    )['insertId'];
    $openOrder   = $order($shopCase, "INV-PX1-$tag", 10000, 0);
    $closedOrder = $order($sfCase, "INV-PX2-$tag", 1500, 1);

    $pay = static fn(array $p) => $q->run(
        'INSERT INTO payments (case_id, order_id, sale_id, kind, method, amount, reference, received_by,
                               paid_at, notes, cancelled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        $p['case'] ?? null, $p['order'] ?? null, $p['sale'] ?? null, $p['kind'], $p['method'], $p['amount'],
        $p['ref'] ?? null, $emp, $p['at'], $p['notes'] ?? null, $p['cancelled'] ?? null
    );
    $open = ['case' => $shopCase, 'order' => $openOrder];
    $pay($open + ['kind' => 'deposit', 'method' => 'Cash', 'amount' => 2000, 'at' => PX_BEFORE . ' 10:00:00']);
    $pay($open + ['kind' => 'partial', 'method' => 'BBL', 'amount' => 3000, 'at' => PX_D1 . ' 10:15:00',
                  'notes' => 'งวดสอง', 'ref' => 'REF123']);
    $pay($open + ['kind' => 'partial', 'method' => 'Cash', 'amount' => 999, 'at' => PX_D1 . ' 10:20:00',
                  'cancelled' => PX_D1 . ' 10:21:00']);
    $pay($open + ['kind' => 'final', 'method' => 'Credit Card', 'amount' => 5000, 'at' => PX_D2 . ' 16:40:00']);
    $pay(['case' => $sfCase, 'order' => $closedOrder, 'kind' => 'full', 'method' => 'Cash', 'amount' => 1500,
          'at' => PX_D1 . ' 11:00:00']);

    $posSale = static fn(string $no, float $total, float $paid, string $fulfil, string $status, ?string $name) => (int) $q->run(
        'INSERT INTO pos_sales (pos_no, sale_date, customer_name_snapshot, subtotal, total_amount, paid_amount,
                                balance_amount, status, payment_status, fulfillment_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        $no, PX_D1 . ' 12:00:00', $name, $total, $total, $paid, $total - $paid, $status,
        $paid >= $total ? 'paid' : 'partial', $fulfil
    )['insertId'];
    $posDone = $posSale("TEST-PX-POS1-$tag", 800, 800, 'delivered', 'active', 'ลูกค้าขาจร ทดสอบ');
    $posWait = $posSale("TEST-PX-POS2-$tag", 600, 200, 'waiting', 'active', null);
    $posVoid = $posSale("TEST-PX-POS3-$tag", 300, 300, 'delivered', 'void', null);
    foreach ([[$posDone, 'แว่นกันแดด', 1], [$posDone, 'ผ้าเช็ดเลนส์', 2], [$posWait, 'สายคล้องแว่น', 1]] as [$sale, $name, $sort]) {
        $q->run(
            'INSERT INTO pos_sale_items (sale_id, product_name_snapshot, quantity, unit_price, line_total, sort_order)
             VALUES (?, ?, 1, 0, 0, ?)',
            $sale, $name, $sort
        );
    }
    $posPay = static fn(int $sale, string $method, float $amount, string $at, ?string $note) => $q->run(
        'INSERT INTO pos_payments (sale_id, payment_method, amount, paid_at, note) VALUES (?, ?, ?, ?, ?)',
        $sale, $method, $amount, $at, $note
    );
    $posPay($posDone, 'transfer', 800, PX_D2 . ' 12:30:00', 'โอนผ่านแอป');
    $posPay($posWait, 'cash', 200, PX_D1 . ' 13:00:00', null);
    $posPay($posVoid, 'cash', 300, PX_D1 . ' 13:30:00', null);

    $legacy = (int) $q->run(
        "INSERT INTO sales (invoice_code, sale_date, product_name_snapshot, customer_id, price, discount)
         VALUES (?, ?, 'คอนแทคเลนส์', ?, 400, 0)",
        "TEST-PX-LEG-$tag", PX_D1, $cust
    )['insertId'];
    $pay(['sale' => $legacy, 'kind' => 'full', 'method' => 'Cash', 'amount' => 400, 'at' => PX_D1 . ' 14:00:00',
          'notes' => 'ขายสินค้าทั่วไป']);

    return [
        'tag' => $tag, 'emp' => $emp, 'cust' => $cust, 'shopCase' => $shopCase, 'sfCase' => $sfCase,
        'posDone' => $posDone, 'posWait' => $posWait, 'legacy' => $legacy,
    ];
}

/** ตาราง "รายละเอียดรายการรับเงิน" ใต้กราฟของหน้า รายงาน > การรับเงิน */
function pxTx(array $filter): array
{
    return Router::dispatch('GET', '/api/reports/payments/transactions', ['from' => PX_D1, 'to' => PX_D2] + $filter, []);
}

/** แถวของตารางบนหน้าจอที่เลขอ้างอิงขึ้นต้นด้วย $prefix */
function pxTxRows(array $tx, string $prefix): array
{
    return array_values(array_filter($tx['rows'], static fn($r) => str_starts_with($r['code'], $prefix)));
}

/** ตัวเลขที่หน้าจอ รายงาน > การรับเงิน โชว์ด้วยตัวกรองชุดนี้ */
function pxScreen(array $filter): array
{
    return Router::dispatch('GET', '/api/reports/payments', ['from' => PX_D1, 'to' => PX_D2] + $filter, []);
}

/** แถวของออเดอร์ที่จ่ายหลายงวด เรียงตามที่อยู่ในไฟล์ */
function pxOpenOrderRows(array $rows, string $tag): array
{
    return array_values(array_filter($rows, static fn($r) => str_starts_with($r['code'], "TEST-PX-SHOP-$tag")));
}

/**
 * เปิดไฟล์ .xlsx ที่สร้างได้ออกมาอ่าน — ตรวจสิ่งที่คนเปิดใน Excel จะเห็นจริง
 *
 * คืน `sheets` = [ชื่อชีท => ['rows' => [เลขแถว => [คอลัมน์ => ค่า]], 'filter' => ช่วง]]
 * ค่าเป็นข้อความเมื่อเซลล์เป็นข้อความ และเป็น float เมื่อเป็นตัวเลข
 */
function pxReadBook(string $bytes): array
{
    $tmp = tempnam(sys_get_temp_dir(), 'pxt');
    file_put_contents($tmp, $bytes);
    $zip = new ZipArchive();
    ok($zip->open($tmp) === true, 'ไฟล์ที่ได้ต้องเป็น zip ที่เปิดได้');
    try {
        $sheets = [];
        $n      = 0;
        foreach (simplexml_load_string($zip->getFromName('xl/workbook.xml'))->sheets->sheet as $sheet) {
            $n++;
            $doc  = simplexml_load_string($zip->getFromName("xl/worksheets/sheet$n.xml"));
            $rows = [];
            foreach ($doc->sheetData->row as $row) {
                $cells = [];
                foreach ($row->c as $c) {
                    $col         = preg_replace('/\d+/', '', (string) $c['r']);
                    $cells[$col] = isset($c->is) ? (string) $c->is->t : (isset($c->v) ? (float) (string) $c->v : null);
                }
                $rows[(int) $row['r']] = $cells;
            }
            $sheets[(string) $sheet['name']] = [
                'rows'   => $rows,
                'filter' => isset($doc->autoFilter) ? (string) $doc->autoFilter['ref'] : null,
            ];
        }
        return ['sheets' => $sheets, 'styles' => (string) $zip->getFromName('xl/styles.xml')];
    } finally {
        $zip->close();
        @unlink($tmp);
    }
}

test('หน้าจอ: ตัวกรองสถานะงานใช้กับเงินที่รับ — นับจากสถานะของบิลที่เงินก้อนนั้นผูกอยู่', function () {
    rollback(function (Tx $q) {
        paymentExportFixtures($q);
        eq(pxScreen([])['total'], 10900.0, 'ทั้งหมด');
        eq(pxScreen(['status' => 'closed'])['total'], 2700.0, 'จบแล้ว: ออเดอร์ที่ปิด + POS ที่ส่งของแล้ว + ขายระบบเดิม');
        eq(pxScreen(['status' => 'open'])['total'], 8200.0, 'ยังไม่จบ: ออเดอร์ที่เปิดอยู่ + POS ที่รอส่งของ');
    });
});

test('หนึ่งแถวต่อการรับเงินหนึ่งครั้ง — ออเดอร์ที่จ่ายสองงวดในช่วงได้สองแถว ไม่นับงวดที่ยกเลิก', function () {
    rollback(function (Tx $q) {
        $f    = paymentExportFixtures($q);
        $rows = PaymentExport::rows(PX_D1, PX_D2, 'all', 'all', 'all');
        eq(count($rows), 6, 'จำนวนแถว');
        eq(array_column(pxOpenOrderRows($rows, $f['tag']), 'amount'), [3000.0, 5000.0], 'สองงวดของออเดอร์เดียวกัน');
        eq($rows[0]['paid_at'], PX_D1 . ' 10:15:00', 'เรียงจากเงินก้อนแรกของช่วง');
        eq($rows[5]['paid_at'], PX_D2 . ' 16:40:00', 'จบที่เงินก้อนสุดท้ายของช่วง');
    });
});

test('คอลัมน์ของงานตัดแว่น: เลขเคส/ใบสั่ง ลูกค้า ประเภท รายการ ยอดขาย ช่องทาง ผู้รับเงิน หมายเหตุ', function () {
    rollback(function (Tx $q) {
        $f   = paymentExportFixtures($q);
        $row = PaymentExport::rows(PX_D1, PX_D2, 'all', 'all', 'all')[0];
        eq($row['code'], "TEST-PX-SHOP-{$f['tag']} / INV-PX1-{$f['tag']}", 'Case ID / Bill No.');
        eq($row['customer'], 'สมชาย ทดสอบจ่าย', 'ชื่อลูกค้า');
        eq($row['group'], 'ลูกค้าร้าน', 'ประเภทลูกค้า');
        eq($row['channel'], 'งานตัดแว่น', 'ประเภทการขาย');
        eq($row['items'], 'กรอบทดสอบ + เลนส์ทดสอบ', 'รายการสินค้า');
        eq($row['revenue'], 10000.0, 'ยอดขาย');
        eq($row['amount'], 3000.0, 'ยอดรับครั้งนี้');
        eq($row['method'], 'BBL', 'ช่องทางชำระ — ป้ายเดียวกับหน้าจอ');
        eq($row['employee'], "พนักงานทดสอบ {$f['tag']}", 'ผู้รับเงิน');
        eq($row['note'], 'จ่ายบางส่วน · งวดสอง · อ้างอิง REF123', 'หมายเหตุ');

        $sf = array_values(array_filter(
            PaymentExport::rows(PX_D1, PX_D2, 'all', 'all', 'sightfirst'),
            static fn($r) => $r['channel'] === 'งานตัดแว่น'
        ));
        eq(array_column($sf, 'group'), ['SightFirst'], 'เคส SightFirst');
    });
});

test('ยอดคงเหลือกับสถานะการชำระนับ ณ ตอนรับเงินครั้งนั้น รวมงวดที่รับก่อนช่วงวันที่', function () {
    rollback(function (Tx $q) {
        $f     = paymentExportFixtures($q);
        $order = pxOpenOrderRows(PaymentExport::rows(PX_D1, PX_D2, 'all', 'all', 'all'), $f['tag']);
        eq([$order[0]['balance'], $order[0]['pay_status']], [5000.0, 'ชำระบางส่วน'], 'งวดสอง: 10,000 − 2,000 − 3,000');
        eq([$order[1]['balance'], $order[1]['pay_status']], [0.0, 'ชำระครบ'], 'งวดสุดท้าย');
    });
});

test('คอลัมน์ของขายหน้าร้าน: POS ใช้ชื่อในบิลกับรายการสินค้า · ขายระบบเดิมอยู่ในไฟล์ · ใบยกเลิกไม่อยู่', function () {
    rollback(function (Tx $q) {
        $f    = paymentExportFixtures($q);
        $rows = PaymentExport::rows(PX_D1, PX_D2, 'pos', 'all', 'all');
        $by   = array_column($rows, null, 'code');
        eq(count($rows), 3, 'POS สองใบที่ยังใช้งาน + ขายระบบเดิมหนึ่งใบ');

        $done = $by["TEST-PX-POS1-{$f['tag']}"];
        eq(
            [$done['customer'], $done['group'], $done['channel'], $done['items'], $done['method'], $done['note']],
            ['ลูกค้าขาจร ทดสอบ', 'ลูกค้าร้าน', 'POS หน้าร้าน', 'แว่นกันแดด, ผ้าเช็ดเลนส์', 'BBL', 'โอนผ่านแอป'],
            'POS ที่ส่งของแล้ว'
        );
        $wait = $by["TEST-PX-POS2-{$f['tag']}"];
        eq(
            [$wait['revenue'], $wait['amount'], $wait['balance'], $wait['pay_status']],
            [600.0, 200.0, 400.0, 'ชำระบางส่วน'],
            'POS ที่จ่ายมาบางส่วน'
        );
        $legacy = $by["TEST-PX-LEG-{$f['tag']}"];
        eq(
            [$legacy['items'], $legacy['customer'], $legacy['balance'], $legacy['pay_status']],
            ['คอนแทคเลนส์', 'สมชาย ทดสอบจ่าย', 0.0, 'ชำระครบ'],
            'ขายสินค้าระบบเดิม'
        );
    });
});

test('แถวในไฟล์ใช้ตัวกรองชุดเดียวกับหน้าจอ — ช่องทาง × สถานะงาน × ประเภทลูกค้า', function () {
    rollback(function (Tx $q) {
        paymentExportFixtures($q);
        foreach ([
            ['all', 'all', 'all'], ['main', 'all', 'all'], ['pos', 'all', 'all'],
            ['all', 'closed', 'all'], ['all', 'open', 'all'], ['pos', 'open', 'all'],
            ['all', 'all', 'sightfirst'], ['all', 'all', 'shop'], ['main', 'open', 'shop'],
        ] as [$channel, $status, $group]) {
            $screen = pxScreen(compact('channel', 'status', 'group'));
            $rows   = PaymentExport::rows(PX_D1, PX_D2, $channel, $status, $group);
            $what   = "channel=$channel status=$status group=$group";
            eq(count($rows), $screen['count'], "$what: จำนวนรายการ");
            eq(round(array_sum(array_column($rows, 'amount')), 2), $screen['total'], "$what: ยอดรวม");
        }
    });
});

test('ชีทสรุป: ช่วงวันที่ ยอดรวม แยกงานตัดแว่น/POS จำนวนรายการ จำนวนบิล และตารางช่องทางชำระ ตรงกับหน้าจอ', function () {
    rollback(function (Tx $q) {
        paymentExportFixtures($q);
        $screen = pxScreen([]);
        $book   = pxReadBook(PaymentExport::workbook(PX_D1, PX_D2, 'all', 'all', 'all')->toBytes());
        eq(array_keys($book['sheets']), ['สรุป', 'รายละเอียดการรับเงิน'], 'ชื่อชีท');

        $summary = $book['sheets']['สรุป']['rows'];
        $value   = static function (string $label) use ($summary): mixed {
            foreach ($summary as $cells) {
                if (($cells['A'] ?? null) === $label) {
                    return $cells['B'] ?? null;
                }
            }
            failTest("ชีทสรุปไม่มีบรรทัด \"$label\"");
        };
        eq($value('ช่วงวันที่'), '10/03/2031 ถึง 11/03/2031', 'ช่วงวันที่');
        eq($value('รับเงินรวม'), $screen['total'], 'รับเงินรวม');
        eq($value('จากงานตัดแว่น'), $screen['by_channel']['main'], 'จากงานตัดแว่น');
        eq($value('จากหน้าร้าน / POS'), $screen['by_channel']['pos'], 'จากหน้าร้าน / POS');
        eq($value('จำนวนรายการรับเงิน'), (float) $screen['count'], 'จำนวนรายการรับเงิน');
        eq($value('จำนวนบิล'), 5.0, 'บิลที่มีเงินเข้า: ออเดอร์ 2 · POS 2 · ขายระบบเดิม 1');

        foreach ($screen['by_method'] as $m) {
            $label = ['cash' => 'เงินสด', 'transfer' => 'BBL', 'credit' => 'บัตรเครดิต'][$m['method']] ?? $m['method'];
            $line  = array_values(array_filter($summary, static fn($c) => ($c['A'] ?? null) === $label && isset($c['C'])));
            ok(count($line) === 1, "ตารางช่องทางต้องมีบรรทัด \"$label\" หนึ่งบรรทัด");
            eq(
                [$line[0]['B'], $line[0]['C'], $line[0]['D']],
                [(float) $m['count'], $m['amount'], (float) $m['share']],
                "ช่องทาง $label: ครั้ง ยอดเงิน สัดส่วน"
            );
        }
    });
});

test('ชีทรายละเอียด: หัวตาราง 14 คอลัมน์ ปุ่ม Filter วันที่/เวลา/เงินเป็นค่าจริง และแถวรวมอยู่นอกช่วงกรอง', function () {
    rollback(function (Tx $q) {
        paymentExportFixtures($q);
        $book   = pxReadBook(PaymentExport::workbook(PX_D1, PX_D2, 'all', 'all', 'all')->toBytes());
        $detail = $book['sheets']['รายละเอียดการรับเงิน'];

        eq(array_values($detail['rows'][1]), [
            'วันที่', 'เวลา', 'Case ID / Bill No.', 'ชื่อลูกค้า', 'ประเภทลูกค้า', 'แหล่งที่มา',
            'รายการสินค้า / รายละเอียด', 'ยอดขาย', 'ยอดรับครั้งนี้', 'ช่องทางชำระเงิน', 'สถานะการชำระ',
            'ยอดคงเหลือ', 'พนักงานผู้รับเงิน', 'หมายเหตุ',
        ], 'หัวตาราง');
        eq($detail['filter'], 'A1:N7', 'Filter ครอบหัวตาราง + 6 แถว');

        $first = $detail['rows'][2];
        eq($first['A'], Xlsx::serial(PX_D1), 'วันที่เป็นเลขวันของ Excel ไม่ใช่ข้อความ');
        ok(abs($first['B'] - (10 * 60 + 15) / 1440) < 1e-5, 'เวลา 10:15 เป็นเศษส่วนของวัน — ได้ ' . $first['B']);
        eq([$first['H'], $first['I'], $first['L']], [10000.0, 3000.0, 5000.0], 'ยอดขาย ยอดรับ คงเหลือเป็นตัวเลข');
        ok(str_contains($book['styles'], 'formatCode="hh:mm"'), 'มีรูปแบบเวลา hh:mm');
        ok(str_contains($book['styles'], 'formatCode="#,##0.00"'), 'มีรูปแบบเงิน #,##0.00');

        /* หัว 1 · ข้อมูล 2–7 · เว้น 8 · รวม 9 */
        eq([$detail['rows'][9]['A'] ?? null, $detail['rows'][9]['I'] ?? null], ['รวม 6 รายการ', 10900.0], 'แถวรวม');
    });
});

test('ไฟล์ที่กรองไว้บอกตัวกรองบนชีทสรุปและในชื่อไฟล์ · ช่วงที่ไม่มีเงินเข้ายังได้ไฟล์ที่เปิดได้', function () {
    rollback(function (Tx $q) {
        paymentExportFixtures($q);
        $book = pxReadBook(PaymentExport::workbook(PX_D1, PX_D2, 'pos', 'open', 'shop')->toBytes());
        $line = $book['sheets']['สรุป']['rows'][2]['A'] ?? '';
        foreach (['ช่องทาง: POS', 'สถานะงาน: ยังไม่จบ', 'ประเภทลูกค้า: ลูกค้าร้าน'] as $part) {
            ok(str_contains($line, $part), "บรรทัดตัวกรองต้องมี \"$part\" — ได้ \"$line\"");
        }
        eq($book['sheets']['รายละเอียดการรับเงิน']['filter'], 'A1:N2', 'POS ที่รอส่งของหนึ่งรายการ');

        $empty = pxReadBook(PaymentExport::workbook('2031-12-01', '2031-12-02', 'all', 'all', 'all')->toBytes());
        eq($empty['sheets']['รายละเอียดการรับเงิน']['filter'], 'A1:N1', 'ไม่มีรายการก็ยังมีหัวตาราง');

        eq(
            PaymentExport::fileName(PX_D1, PX_D2, 'sightfirst'),
            'รายงานการรับเงิน 2031-03-10 ถึง 2031-03-11 (SightFirst).xlsx',
            'ชื่อไฟล์'
        );
    });
});

/* ── ตาราง "รายละเอียดรายการรับเงิน" บนหน้าเว็บ (ร้านขอ 14 ก.ย. 2026) ─────────── */

test('ตารางรายการรับเงิน: จำนวนแถวและยอดท้ายตารางเท่ากับ Dashboard ทุกชุดตัวกรอง', function () {
    rollback(function (Tx $q) {
        paymentExportFixtures($q);
        foreach ([
            ['all', 'all', 'all'], ['main', 'all', 'all'], ['pos', 'all', 'all'],
            ['all', 'closed', 'all'], ['all', 'open', 'all'], ['pos', 'open', 'all'],
            ['all', 'all', 'sightfirst'], ['all', 'all', 'shop'], ['main', 'open', 'shop'],
        ] as [$channel, $status, $group]) {
            $screen = pxScreen(compact('channel', 'status', 'group'));
            $tx     = pxTx(compact('channel', 'status', 'group'));
            $what   = "channel=$channel status=$status group=$group";
            eq([$tx['count'], $tx['total']], [$screen['count'], $screen['total']], "$what: ยอดท้ายตาราง");
            eq(count($tx['rows']), $screen['count'], "$what: จำนวนแถว");
            eq(round(array_sum(array_column($tx['rows'], 'amount')), 2), $screen['total'], "$what: ผลรวมของแถว");
        }
    });
});

test('ตารางรายการรับเงิน: แบ่งชำระได้หนึ่งแถวต่อครั้ง ไม่นับครั้งที่ยกเลิก · เลขอ้างอิงไม่ซ้ำกันข้ามสองตาราง', function () {
    rollback(function (Tx $q) {
        $f    = paymentExportFixtures($q);
        $tx   = pxTx([]);
        $open = pxTxRows($tx, "TEST-PX-SHOP-{$f['tag']}");
        eq(array_column($open, 'amount'), [3000.0, 5000.0], 'สองงวดในช่วง · งวด 999 ที่ยกเลิกไม่อยู่');
        eq(array_column($open, 'kind'), ['จ่ายบางส่วน', 'ชำระส่วนที่เหลือ'], 'ประเภทการรับของแต่ละงวด');
        $keys = array_column($tx['rows'], 'key');
        eq(count(array_unique($keys)), count($keys), 'key ของแถวไม่ซ้ำ (payments กับ pos_payments ใช้ id ชนกันได้)');
    });
});

test('ตารางรายการรับเงิน: แถวงานตัดแว่นมีครบทุกคอลัมน์ และเปิดไปที่เคส', function () {
    rollback(function (Tx $q) {
        $f   = paymentExportFixtures($q);
        $row = pxTxRows(pxTx([]), "TEST-PX-SHOP-{$f['tag']}")[0];
        eq(
            [$row['paid_at'], $row['code'], $row['source'], $row['source_label'], $row['customer'], $row['items'],
             $row['kind'], $row['method'], $row['amount'], $row['employee']],
            [PX_D1 . ' 10:15:00', "TEST-PX-SHOP-{$f['tag']} / INV-PX1-{$f['tag']}", 'main', 'งานตัดแว่น',
             'สมชาย ทดสอบจ่าย', 'กรอบทดสอบ + เลนส์ทดสอบ', 'จ่ายบางส่วน', 'BBL', 3000.0, "พนักงานทดสอบ {$f['tag']}"],
            'วันเวลา เลขอ้างอิง แหล่งที่มา ลูกค้า รายการ ประเภท ช่องทาง ยอด ผู้รับเงิน'
        );
        eq($row['open'], ['kind' => 'case', 'id' => $f['shopCase']], 'กดเลขอ้างอิงแล้วเปิดเคส');
        eq($row['legacy'], false, 'ไม่ใช่ระบบเดิม');
    });
});

test('ตารางรายการรับเงิน: POS เปิดบิล POS · ขายระบบเดิมไม่มีหน้าให้เปิด · ออเดอร์ไม่ผูกเคสเปิดใบสั่ง', function () {
    rollback(function (Tx $q) {
        $f  = paymentExportFixtures($q);
        $tx = pxTx([]);

        $pos = pxTxRows($tx, "TEST-PX-POS1-{$f['tag']}")[0];
        eq(
            [$pos['source'], $pos['source_label'], $pos['kind'], $pos['items'], $pos['open'], $pos['legacy']],
            ['pos', 'POS หน้าร้าน', '', 'แว่นกันแดด, ผ้าเช็ดเลนส์', ['kind' => 'pos', 'id' => $f['posDone']], false],
            'บิล POS'
        );

        $legacy = pxTxRows($tx, "TEST-PX-LEG-{$f['tag']}")[0];
        eq(
            [$legacy['source'], $legacy['source_label'], $legacy['open'], $legacy['legacy']],
            ['pos', 'POS หน้าร้าน', null, true],
            'ขายระบบเดิม'
        );

        $order = (int) $q->run(
            "INSERT INTO custom_orders (customer_id, case_id, invoice_code, order_date, total_price, discount, order_closed)
             VALUES (?, NULL, ?, ?, 700, 0, 0)",
            $f['cust'], "TEST-PX-NOCASE-{$f['tag']}", PX_D1 . ' 09:00:00'
        )['insertId'];
        $q->run(
            "INSERT INTO payments (order_id, kind, method, amount, received_by, paid_at) VALUES (?, 'deposit', 'Cash', 700, ?, ?)",
            $order, $f['emp'], PX_D2 . ' 09:00:00'
        );
        $noCase = pxTxRows(pxTx([]), "TEST-PX-NOCASE-{$f['tag']}")[0];
        eq([$noCase['open'], $noCase['kind']], [['kind' => 'order', 'id' => $order], 'มัดจำ'], 'ออเดอร์ที่ไม่ผูกเคส');
    });
});
