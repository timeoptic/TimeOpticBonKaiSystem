<?php

declare(strict_types=1);

/**
 * ช่องทางชำระของสองระบบต้องยุบเป็นคีย์เดียว — `SalesReport::payMethodKey()`
 *
 * เรื่องจริง 12 ก.ย. 2026: เปลี่ยนป้าย "โอนเงิน" ของ POS เป็น "BBL" แล้วหน้ารายงาน
 * การรับเงินขึ้นสองแถว "bbl" กับ "BBL" — งานตัดแว่นเก็บช่องทางเป็นข้อความ 'BBL'
 * (list_pay_type) ส่วน POS เก็บ 'transfer' · คีย์ที่ไม่รู้จักถูกส่งต่อเป็นตัวพิมพ์เล็ก
 * 'bbl' จึงไม่ไปรวมกับ 'transfer' · บัตรเครดิตแตกแบบเดียวกัน ('Credit Card' กับ 'credit')
 */

group('ยุบช่องทางชำระของงานตัดแว่นกับ POS');

test('BBL ของงานตัดแว่นคือช่องเดียวกับโอนเงินของ POS', function () {
    foreach (['BBL', 'bbl', ' BBL ', 'transfer', 'โอน', 'โอนเงิน'] as $raw) {
        eq(SalesReport::payMethodKey($raw), 'transfer', "'$raw'");
    }
});

test('Credit Card ของงานตัดแว่นคือช่องเดียวกับบัตรเครดิตของ POS', function () {
    foreach (['Credit Card', 'credit card', 'credit', 'creditcard', 'card'] as $raw) {
        eq(SalesReport::payMethodKey($raw), 'credit', "'$raw'");
    }
});

test('ช่องทางที่เป็นคนละเรื่องไม่ถูกยุบรวม — SCB เป็นอีกธนาคาร', function () {
    eq(SalesReport::payMethodKey('SCB'), 'scb', 'SCB');
    eq(SalesReport::payMethodKey('Cash'), 'cash', 'Cash');
    eq(SalesReport::payMethodKey('ThungNgern'), 'thungngern', 'ThungNgern');
});

test('สรุปตามช่องทาง: BBL จากงานตัดแว่นกับโอนจาก POS ได้แถวเดียว', function () {
    $sum = SalesReport::receiptSummary([
        ['method' => SalesReport::payMethodKey('BBL'), 'amount' => 3000.0, 'channel' => 'main'],
        ['method' => SalesReport::payMethodKey('transfer'), 'amount' => 800.0, 'channel' => 'pos'],
        ['method' => SalesReport::payMethodKey('Cash'), 'amount' => 500.0, 'channel' => 'main'],
    ]);
    eq(array_column($sum['by_method'], 'method'), ['transfer', 'cash'], 'ช่องทางในสรุป');
    eq([$sum['by_method'][0]['count'], $sum['by_method'][0]['amount']], [2, 3800.0], 'แถว BBL รวมสองระบบ');
});
