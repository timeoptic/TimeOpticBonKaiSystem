<?php

declare(strict_types=1);

/**
 * "รู้จักเราจากช่องทางไหน" ตอนเปิดเคส — คำถามที่ถามได้ครั้งเดียวต่อหนึ่งคน
 *
 * หน้าเปิดเคสเลิกถามช่องนี้กับลูกค้าเก่าแล้ว เพราะคนที่มาครั้งที่สองย่อม
 * "รู้จักร้าน" ไปตั้งแต่ครั้งแรก การถามซ้ำได้คำตอบที่ขัดกันเองของคนคนเดียว
 * ซึ่งทำให้รายงานการตลาดอ่านไม่ได้
 *
 * แต่ปล่อยให้ว่างเฉย ๆ ไม่ได้ เพราะ `SalesReport::referralLabel(null)` แปลค่าว่าง
 * เป็น **"ไม่ได้ถาม"** ซึ่งเป็นถังเดียวกับ "พนักงานลืมถาม" และ "เคสเก่าที่
 * นำเข้ามาโดยไม่มีข้อมูล" — สามเรื่องคนละความหมายที่แยกกันไม่ออก
 * เคสของลูกค้าเก่าจึงต้องได้ค่าของตัวเองคือ `returning`
 *
 * เส้นแบ่งอยู่ที่ **ฐานข้อมูล ไม่ใช่ปุ่มที่พนักงานกด** · `is_new_customer` มาจาก
 * body ตรง ๆ (routes/cases.php) ซึ่งเชื่อไม่ได้: ลูกค้าที่ถูกสร้างจากเมนู
 * "ลูกค้าใหม่" ไว้ก่อน พอเปิดเคสพนักงานจะกด "ลูกค้าเก่า" เพราะเห็นชื่อในระบบแล้ว
 * ทั้งที่เป็นเคสแรกในชีวิตของคนนั้น
 */

group('ช่องทางที่รู้จักร้าน ตอนเปิดเคส');

/** ลูกค้าหนึ่งรายที่ยังไม่มีเคสสักใบ */
function referralCustomer(Tx $q): int
{
    return (int) $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'ช่องทาง',
        '0877777777'
    )['insertId'];
}

/** ค่า referral_source ที่ลงฐานจริง — ไม่ใช่ค่าที่ส่งกลับมาให้หน้าเว็บ */
function savedReferral(Tx $q, int $caseId): ?string
{
    $row = $q->get('SELECT referral_source FROM cases WHERE id = ?', $caseId);
    return $row === null ? null : $row['referral_source'];
}

test('ลูกค้าที่เคยมีเคสแล้ว เปิดเคสใหม่โดยไม่ถามช่องทาง ต้องบันทึกว่าเป็นลูกค้าเก่า', function () {
    rollback(function (Tx $q) {
        $cust = referralCustomer($q);

        /* ครั้งแรก — มาจาก Facebook และถูกถามตามปกติ */
        Router::dispatch('POST', '/api/cases', [], [
            'customer_id'     => $cust,
            'referral_source' => 'fb_ig_tt',
        ]);

        /* ครั้งที่สอง — หน้าเว็บซ่อนช่องนี้แล้ว จึงไม่ส่งอะไรมา */
        $second = Router::dispatch('POST', '/api/cases', [], ['customer_id' => $cust]);

        eq(savedReferral($q, (int) $second['id']), 'returning', 'เคสใบที่สองต้องเป็นลูกค้าเก่า');
    });
});

test('ลูกค้าที่ยังไม่เคยมีเคส เปิดเคสแรก ต้องไม่ถูกตีเป็นลูกค้าเก่า', function () {
    rollback(function (Tx $q) {
        $cust = referralCustomer($q);

        /* พนักงานสร้างลูกค้าจากเมนู "ลูกค้าใหม่" ไว้ก่อน แล้วมาเปิดเคสโดยกดปุ่ม
           "ลูกค้าเก่า" เพราะเห็นชื่อในระบบแล้ว — ปุ่มโกหก แต่ฐานข้อมูลไม่โกหก */
        $first = Router::dispatch('POST', '/api/cases', [], [
            'customer_id'     => $cust,
            'is_new_customer' => 0,
        ]);

        eq(savedReferral($q, (int) $first['id']), null, 'เคสแรกของคนนี้ต้องว่างไว้ ไม่ใช่ returning');
    });
});

test('ส่งช่องทางมาเอง ต้องไม่ถูกทับด้วยลูกค้าเก่า', function () {
    rollback(function (Tx $q) {
        $cust = referralCustomer($q);

        Router::dispatch('POST', '/api/cases', [], ['customer_id' => $cust]);

        /* ลูกค้าเก่าที่กลับมาเพราะงานไลออนส์ — ถ้ามีคนตอบมา คำตอบนั้นต้องชนะ */
        $second = Router::dispatch('POST', '/api/cases', [], [
            'customer_id'     => $cust,
            'referral_source' => 'lions',
        ]);

        eq(savedReferral($q, (int) $second['id']), 'lions', 'ค่าที่ส่งมาต้องชนะเสมอ');
    });
});

test('รายงานช่องทางต้องมีป้ายภาษาไทยของลูกค้าเก่า', function () {
    eq(SalesReport::referralLabel('returning'), 'ลูกค้าเก่า', 'ไม่งั้นรายงานจะขึ้นแท่งชื่อ returning');
});
