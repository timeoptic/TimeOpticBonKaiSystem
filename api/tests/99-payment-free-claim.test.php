<?php

declare(strict_types=1);

/**
 * รับเงิน 0 บาท — เคสเคลมที่ร้านไม่คิดเงิน
 *
 * ร้านขอ 14 ก.ย. 2026: เคส CASE-2026-00020 (เคลม) ออเดอร์ราคา 0 แต่ช่องรับเงินรับได้ตั้งแต่
 * 1 บาท บันทึกการรับเงินไม่ได้ ขั้นชำระเงินจึงยืนยันไม่ได้ (ต้องมีรายการรับเงินอย่างน้อยหนึ่งรายการ)
 *
 * กติกา:
 *   1. 0 บาทได้เฉพาะออเดอร์ที่ยอดสุทธิเป็น 0 · ออเดอร์ที่มียอดต้องจ่าย 0 บาทคือ "ยังไม่ชำระ"
 *      (98-payment-unpaid)
 *   2. ไม่ผูกออเดอร์ 0 บาทไม่ได้ · ช่องว่างไม่นับเป็น 0 · ติดลบไม่ได้
 *   3. มีรายการ 0 บาท + วันนัดรับ = ยืนยันขั้นชำระเงินได้
 *   4. แก้รายการ 0 บาทของออเดอร์ยอด 0 ได้ (เช่นเปลี่ยนวิธีชำระ) · แก้เงินของออเดอร์ที่มียอดให้เป็น 0 ไม่ได้
 *
 * ใช้ตัวช่วยของ 95-payment-guards (payFixtures/payPost/payCount) และ 98-payment-unpaid
 * (upError/upMissing/upComplete/upOwner) · ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back เสมอ
 */

group('รับเงิน 0 บาท — เคลมไม่คิดเงิน');

function freeEdit(array $owner, int $id, array $f, array $body): mixed
{
    return \Optic\Auth::as($owner, fn() => Router::dispatch('PUT', "/api/payments/$id", [], $body + [
        'kind' => 'full', 'method' => 'Cash', 'received_by' => $f['emp'],
        'paid_at' => date('Y-m-d H:i:s'), 'reason' => 'ทดสอบ',
    ]));
}

test('ออเดอร์ยอด 0 บันทึกรับเงิน 0 บาทได้', function () {
    rollback(function (Tx $q) {
        $f   = payFixtures($q, 0);
        $row = payPost($f, 0, ['kind' => 'full']);
        eq([(float) $row['amount'], $row['kind']], [0.0, 'full'], 'แถวที่บันทึก');
        eq(payCount($q, $f), 1, 'จำนวนรายการ');
    });
});

test('ออเดอร์ที่มียอดต้องจ่าย บันทึก 0 บาทไม่ได้', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 1000);
        eq(upError(fn() => payPost($f, 0, ['kind' => 'full']))['status'], 400, 'สถานะ');
        eq(payCount($q, $f), 0, 'ต้องไม่มีรายการ');
    });
});

test('ไม่ผูกออเดอร์ 0 บาทไม่ได้ · ช่องว่างไม่นับเป็น 0 · ติดลบไม่ได้', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 0);
        eq(upError(fn() => payPost($f, 0, ['order_id' => null]))['status'], 400, 'ไม่มีออเดอร์');
        eq(upError(fn() => payPost($f, 0, ['amount' => '']))['status'], 400, 'ช่องว่าง');
        eq(upError(fn() => payPost($f, -50))['status'], 400, 'ติดลบ');
        eq(payCount($q, $f), 0, 'ต้องไม่มีรายการ');
    });
});

test('รับเงิน 0 บาท + วันนัดรับ → ยืนยันขั้นชำระเงินได้', function () {
    rollback(function (Tx $q) {
        $f = payFixtures($q, 0);
        $q->run('UPDATE custom_orders SET appointment_date = ? WHERE id = ?', date('Y-m-d', strtotime('+7 days')), $f['order']);
        eq(upMissing($f), ['การรับเงิน'], 'ก่อนบันทึก');

        payPost($f, 0, ['kind' => 'full']);
        eq(upMissing($f), [], 'ไม่มีอะไรขาดแล้ว');
        eq(upComplete($f)['payment']['status'], 'completed', 'ขั้นชำระเงินเสร็จแล้ว');
    });
});

/** ออเดอร์ยอด 0 ที่มีกรอบ เลนส์ และวันนัดรับครบ — ขาดแค่ราคา */
function freeClaimFixtures(Tx $q): array
{
    $f = payFixtures($q, 0);
    $q->run(
        "UPDATE custom_orders SET frame_name = 'oldframe', lens_name = 'Hitop Progressive', appointment_date = ? WHERE id = ?",
        date('Y-m-d', strtotime('+7 days')), $f['order']
    );
    return $f;
}

/* ร้านขอ 15 ก.ย. 2026 (เคส 10459): ขั้นขายมาก่อนขั้นชำระเงิน จะให้รับเงิน 0 บาทก่อนถึงยืนยันขายได้
   ไม่ทัน — ราคา 0 ยืนยันขายได้เลย ขั้นขายไม่ถามราคาแล้ว */
test('ขั้นขาย: ออเดอร์ราคา 0 ที่มีกรอบและเลนส์ ยืนยันขายได้เลย ไม่ต้องรับเงิน 0 บาทก่อน', function () {
    rollback(function (Tx $q) {
        $f = freeClaimFixtures($q);
        eq(caseDetail($f['case'])['processes']['sales']['missing'], [], 'ยังไม่มีรายการรับเงิน');
    });
});

test('กระดาน: ออเดอร์ราคา 0 ยังไม่รับเงิน ผ่านขั้นขายไปค้างที่ชำระเงิน', function () {
    rollback(function (Tx $q) {
        $f = freeClaimFixtures($q);
        eq(caseStageMap([$f['case']])[$f['case']]['process_stage'], 'payment', 'ขั้นบนกระดาน');
    });
});

test('กระดานงาน: เคลมรับเงิน 0 บาท + วันนัดรับ ผ่านขั้นชำระเงินไปขั้นถัดไป', function () {
    rollback(function (Tx $q) {
        $f = freeClaimFixtures($q);
        $q->run("INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, paid_at) VALUES (?, ?, 'deposit', 'Cash', 0, ?, NOW())",
            $f['case'], $f['order'], $f['emp']);
        eq(caseStageMap([$f['case']])[$f['case']]['process_stage'], 'centering', 'ขั้นบนกระดาน');
    });
});

test('แก้รายการ 0 บาทของออเดอร์ยอด 0 ได้ · แก้เงินของออเดอร์ที่มียอดให้เป็น 0 ไม่ได้', function () {
    rollback(function (Tx $q) {
        $owner = upOwner();

        $f   = payFixtures($q, 0);
        $row = payPost($f, 0, ['kind' => 'full']);
        freeEdit($owner, (int) $row['id'], $f, ['amount' => 0, 'method' => 'BBL']);
        eq($q->get('SELECT method FROM payments WHERE id = ?', (int) $row['id'])['method'], 'BBL', 'วิธีชำระหลังแก้');

        $g    = payFixtures($q, 1000);
        $real = payPost($g, 500);
        eq(upError(fn() => freeEdit($owner, (int) $real['id'], $g, ['amount' => 0]))['status'], 400, 'แก้เป็น 0 บนออเดอร์ที่มียอด');
        eq((float) $q->get('SELECT amount FROM payments WHERE id = ?', (int) $real['id'])['amount'], 500.0, 'ยอดในฐานไม่เปลี่ยน');
    });
});
