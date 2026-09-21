<?php

declare(strict_types=1);

/**
 * ใบเบิกเลนส์ของ Bewell — กติกาสถานะ การหาค่าสายตาสุดท้าย และ sync จากหน้าขาย
 * ทุกข้อที่แตะฐานรันใน transaction ที่ roll back เสมอ
 */

group('ใบเบิกเลนส์ — กติกาสถานะ');

test('เดินหน้าทีละขั้นได้', function () {
    eq(LensRequisition::transitionError('pending', 'issued', true), null, 'รอเบิก → เบิกแล้ว');
    eq(LensRequisition::transitionError('received', 'assembled', true), null, 'ได้รับ → ประกอบ');
});

test('ข้ามขั้นได้', function () {
    eq(LensRequisition::transitionError('pending', 'ordered', true), null, 'รอเบิก → สั่งเลนส์');
});

test('ย้อนสถานะไม่ได้', function () {
    ok(LensRequisition::transitionError('ordered', 'issued', true) !== null, 'สั่งเลนส์ → เบิกแล้ว ต้องไม่ได้');
});

test('ยกเลิกได้จนกว่าจะประกอบแล้ว', function () {
    eq(LensRequisition::transitionError('received', 'cancelled', false), null, 'ได้รับ → ยกเลิก');
    ok(LensRequisition::transitionError('assembled', 'cancelled', true) !== null, 'ประกอบแล้วยกเลิกไม่ได้');
    ok(LensRequisition::transitionError('cancelled', 'issued', true) !== null, 'ยกเลิกแล้วไปต่อไม่ได้');
});

test('ไม่มีค่าสายตาสุดท้าย เบิกไม่ได้', function () {
    ok(LensRequisition::transitionError('pending', 'issued', false) !== null, 'ต้องห้ามเบิก');
});

test('รายการเลนส์: คำนวณยอดและบังคับยี่ห้อ', function () {
    $rows = LensRequisition::cleanItems([
        ['eye' => 'r', 'brand' => 'HOYA', 'design' => 'Nulux', 'quantity' => 1, 'unit_price' => 1500],
    ]);
    eq($rows[0]['eye'], 'R', 'ข้าง');
    eq($rows[0]['line_total'], 1500.0, 'ยอดบรรทัด');
    eq(array_keys($rows[0])[0], 'eye', 'คีย์แรกตรงกับลำดับคอลัมน์');
    $threw = false;
    try {
        LensRequisition::cleanItems([['eye' => 'L', 'brand' => '']]);
    } catch (HttpError $e) {
        $threw = $e->status === 400;
    }
    ok($threw, 'ไม่มียี่ห้อต้องตอบ 400');
});
