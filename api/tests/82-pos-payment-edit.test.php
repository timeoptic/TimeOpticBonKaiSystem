<?php

declare(strict_types=1);

/**
 * แก้งวดเงินของบิล POS — PUT /api/pos/sales/:id/payments/:pid (ร้านขอ 29 ก.ย. 2026)
 *
 * ต้นเรื่อง POS-2026-00033: ลูกค้าจ่ายวันที่ 25 แต่พนักงานกดรับเงินวันที่ 26
 * รายงานการรับเงินจึงนับผิดวัน · ไฟล์นี้เฝ้า:
 *
 *   1. แก้วันที่ / ยอด / ช่องทางได้ และยอดของใบคำนวณใหม่
 *   2. ด่าน: สิทธิ์แอดมิน · เหตุผล · วันในอนาคต · เกินยอดใบ · งวดที่ยกเลิก · ใบที่ยกเลิก
 *
 * ใช้ posCall / posCallError / posPaidSale / posItemId จาก 80-pos-items.test.php
 * ของทดสอบทุกชิ้นอยู่ใน rollback()
 */

group('แก้การรับเงินของบิล POS');

/** บิลค่าประกอบแว่น 350 บาท จ่ายเงินสดครบ — คืน [sale, payment] */
function posEditFixture(Tx $q): array
{
    $sale = posCall('POST', '/api/pos/sales', posPaidSale([
        ['product_id' => posItemId($q, 'SRV-0001'), 'quantity' => 1, 'unit_price' => 350],
    ], 350));
    return [$sale, $sale['payments'][0]];
}

function posEditPath(array $sale, array $pay): string
{
    return "/api/pos/sales/{$sale['id']}/payments/{$pay['id']}";
}

test('ย้ายวันที่รับเงินย้อนหลังได้ ยอดใบเท่าเดิม', function () {
    rollback(function (Tx $q) {
        [$sale, $pay] = posEditFixture($q);
        $back = (new DateTime('-1 day'))->format('Y-m-d') . ' 12:45';

        $out = posCall('PUT', posEditPath($sale, $pay), [
            'amount' => 350, 'method' => 'cash', 'paid_at' => $back, 'reason' => 'ลูกค้าจ่ายเมื่อวาน',
        ]);

        eq($out['payments'][0]['paid_at'], "$back:00", 'วันเวลารับเงินใหม่');
        eq((float) $out['paid_amount'], 350.0, 'ยอดชำระ');
        eq($out['payment_status'], 'paid', 'ยังจ่ายครบ');
    });
});

test('แก้ยอดลง ใบกลายเป็นค้างบางส่วน · เปลี่ยนเป็นโอนแล้วล้างเงินทอน', function () {
    rollback(function (Tx $q) {
        [$sale, $pay] = posEditFixture($q);
        $q->run('UPDATE pos_payments SET amount_received = 500, change_amount = 150 WHERE id = ?', $pay['id']);

        $out = posCall('PUT', posEditPath($sale, $pay), [
            'amount' => 200, 'method' => 'transfer', 'paid_at' => $pay['paid_at'], 'reason' => 'กดยอดผิด',
        ]);
        $p = $out['payments'][0];

        eq((float) $p['amount'], 200.0, 'ยอดงวด');
        eq($p['payment_method'], 'transfer', 'ช่องทาง');
        eq($p['amount_received'], null, 'รับมาต้องว่างเมื่อไม่ใช่เงินสด');
        eq($p['change_amount'], null, 'ทอนต้องว่างเมื่อไม่ใช่เงินสด');
        eq((float) $out['balance_amount'], 150.0, 'ค้าง');
        eq($out['payment_status'], 'partial', 'สถานะ');
    });
});

test('เงินสดแก้ยอด เงินทอนคิดใหม่จากเงินที่รับมา', function () {
    rollback(function (Tx $q) {
        [$sale, $pay] = posEditFixture($q);
        $q->run('UPDATE pos_payments SET amount_received = 500, change_amount = 150 WHERE id = ?', $pay['id']);

        $out = posCall('PUT', posEditPath($sale, $pay), [
            'amount' => 300, 'method' => 'cash', 'paid_at' => $pay['paid_at'], 'reason' => 'กดยอดผิด',
        ]);

        eq((float) $out['payments'][0]['change_amount'], 200.0, 'ทอน');
    });
});

test('ด่านที่ต้องปฏิเสธ', function () {
    rollback(function (Tx $q) {
        [$sale, $pay] = posEditFixture($q);
        $path = posEditPath($sale, $pay);
        $base = ['amount' => 350, 'method' => 'cash', 'paid_at' => $pay['paid_at'], 'reason' => 'ทดสอบ'];

        $cases = [
            'ไม่มีเหตุผล'     => [['reason' => ''] + $base, 'เหตุผล'],
            'วันในอนาคต'     => [['paid_at' => (new DateTime('+2 days'))->format('Y-m-d H:i')] + $base, 'อนาคต'],
            'เกินยอดใบ'      => [['amount' => 351] + $base, 'ไม่เกิน 350.00'],
            'ยอด 0'         => [['amount' => 0] + $base, 'มากกว่า 0'],
            'ช่องทางแปลก'    => [['method' => 'bitcoin'] + $base, 'ช่องทาง'],
            'ไม่มีอะไรเปลี่ยน' => [$base, 'ไม่มีอะไรเปลี่ยน'],
        ];
        foreach ($cases as $what => [$body, $needle]) {
            $e = posCallError('PUT', $path, $body);
            eq($e['status'], 400, "$what ต้องเป็น 400");
            ok(str_contains($e['msg'], $needle), "$what: ข้อความควรมี \"$needle\" — ได้ {$e['msg']}");
        }

        $e = posCallError('PUT', "/api/pos/sales/{$sale['id']}/payments/999999999", ['amount' => 1] + $base);
        eq($e['status'], 404, 'งวดของใบอื่น/ไม่มีจริง');

        $q->run('UPDATE pos_payments SET cancelled_at = NOW() WHERE id = ?', $pay['id']);
        $e = posCallError('PUT', $path, ['amount' => 300] + $base);
        ok(str_contains($e['msg'], 'ยกเลิกไปแล้ว'), 'งวดที่ยกเลิกแล้ว — ได้ ' . $e['msg']);

        $q->run('UPDATE pos_payments SET cancelled_at = NULL WHERE id = ?', $pay['id']);
        $q->run("UPDATE pos_sales SET status = 'void' WHERE id = ?", $sale['id']);
        $e = posCallError('PUT', $path, ['amount' => 300] + $base);
        ok(str_contains($e['msg'], 'ถูกยกเลิกแล้ว'), 'ใบที่ยกเลิกแล้ว — ได้ ' . $e['msg']);
    });
});

test('พนักงานขายแก้ไม่ได้ (403)', function () {
    rollback(function (Tx $q) {
        [$sale, $pay] = posEditFixture($q);
        $sales = ['roles' => ['sales']] + posOwner();
        $sales['perms'] = \Optic\Roles::permsOf(['sales']);

        $status = null;
        try {
            \Optic\Auth::as($sales, fn() => Router::dispatch('PUT', posEditPath($sale, $pay), [], [
                'amount' => 300, 'method' => 'cash', 'paid_at' => $pay['paid_at'], 'reason' => 'ทดสอบ',
            ]));
        } catch (HttpError $e) {
            $status = $e->status;
        }
        eq($status, 403, 'สถานะ');
        eq((float) $q->get('SELECT amount FROM pos_payments WHERE id = ?', $pay['id'])['amount'], 350.0, 'ยอดต้องไม่เปลี่ยน');
    });
});
