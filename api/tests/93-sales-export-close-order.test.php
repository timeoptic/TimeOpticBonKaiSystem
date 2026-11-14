<?php

declare(strict_types=1);

/**
 * ไฟล์ Excel รายงานยอดขาย — ชีทรายเดือนเรียงตามวันปิดงานเก่าไปใหม่
 *
 * ร้านขอ 24 ก.ย. 2026: ไล่ดูตามลำดับที่ส่งมอบ · ใบที่ยังไม่ปิด (ไม่มีวันปิด)
 * ไปอยู่ท้ายชีท · วันปิดเท่ากันเรียงตามวันเปิดบิล
 *
 * ของทดสอบอยู่ในเดือนอนาคต (มี.ค. 2031) ที่ไม่มีข้อมูลจริง และ roll back เสมอ
 */

group('Excel ยอดขาย: เรียงตามวันปิดงาน');

test('ชีทรายเดือนเรียงตามวันปิดงาน ใบที่ยังไม่ปิดต่อท้าย', function () {
    rollback(function (Tx $q) {
        $tag  = bin2hex(random_bytes(3));
        $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "เรียง-$tag")['insertId'];
        /* [เลขเคส, วันเปิดบิล, วันปิดงาน|null] — ใส่สลับลำดับไว้ก่อน */
        $spec = [
            ["SORT-C-$tag", '2031-03-01 10:00:00', '2031-03-20 12:00:00'],
            ["SORT-OPEN-$tag", '2031-03-02 10:00:00', null],
            ["SORT-A-$tag", '2031-03-05 10:00:00', '2031-03-10 12:00:00'],
            ["SORT-B-$tag", '2031-03-03 10:00:00', '2031-03-10 09:00:00'],
        ];
        foreach ($spec as [$code, $opened, $closed]) {
            $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', $code, $cust)['insertId'];
            $q->run(
                'INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount, deposit,
                   order_closed, order_close_date) VALUES (?, ?, ?, 1000, 0, 0, ?, ?)',
                $cust, $case, $opened, $closed ? 1 : 0, $closed
            );
        }

        $book  = pxReadBook(SalesExport::workbook('2031-03-01', '2031-03-31', 'main', 'all')->toBytes());
        $sheet = null;
        foreach ($book['sheets'] as $name => $s) {
            if ($name !== array_key_first($book['sheets'])) {
                $sheet = $s;
            }
        }
        ok($sheet !== null, 'ต้องมีชีทของเดือน มี.ค.');
        $codes = [];
        foreach ($sheet['rows'] as $cells) {
            $c = $cells['C'] ?? null;
            if (is_string($c) && str_starts_with($c, 'SORT-')) {
                $codes[] = $c;
            }
        }
        eq($codes, ["SORT-B-$tag", "SORT-A-$tag", "SORT-C-$tag", "SORT-OPEN-$tag"], 'ลำดับเลขเคสในชีท');
    });
});
