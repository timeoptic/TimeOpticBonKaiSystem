<?php

declare(strict_types=1);

/**
 * ผู้ดูแลระบบแก้รายการของบิล POS — PUT /api/pos/sales/:id/items (ร้านขอ 28 ต.ค. 2026)
 *
 * ไฟล์นี้เฝ้า:
 *
 *   1. แก้ชื่อ / จำนวน / ราคา · ลบแถว · เพิ่มแถว แล้วยอดของใบคำนวณใหม่
 *   2. ของจากคลัง: ลบแถว = ของกลับล็อต · แก้จำนวน = คืนก้อนเดิมแล้วตัดใหม่ · เพิ่มแถว = ตัด
 *   3. ด่าน: ผู้ดูแลระบบเท่านั้น (เจ้าของร้านก็ไม่ได้) · เหตุผล · ยอดต่ำกว่าเงินที่รับแล้ว ·
 *      ใบที่ยกเลิก · แถวของใบอื่น · ไม่มีอะไรเปลี่ยน
 *
 * ใช้ posCall / posCallError / posPaidSale / posItemId / posOwner จาก 80-pos-items.test.php
 * และ posStockFixture / posLotLeft จาก 81-pos-stock-sale.test.php · ทุกอย่างอยู่ใน rollback()
 */

group('ผู้ดูแลระบบแก้รายการบิล POS');

/** actor ที่ถือบทบาทที่ให้มา (ใช้บัญชี owner ในฐานเป็นตัวคน) */
function posEditActor(array $roles): array
{
    $a = ['roles' => $roles] + posOwner();
    $a['perms'] = \Optic\Roles::permsOf($roles);
    return $a;
}

function posItemsCall(array $sale, array $body, array $roles = ['superuser']): array
{
    StockModule::boot();
    return \Optic\Auth::as(
        posEditActor($roles),
        fn() => Router::dispatch('PUT', "/api/pos/sales/{$sale['id']}/items", [], $body + ['reason' => 'ทดสอบแก้บิล'])
    );
}

/** @return array{status:?int,msg:string} */
function posItemsError(array $sale, array $body, array $roles = ['superuser']): array
{
    try {
        posItemsCall($sale, $body, $roles);
    } catch (HttpError $e) {
        return ['status' => $e->status, 'msg' => $e->getMessage()];
    }
    return ['status' => null, 'msg' => ''];
}

/** แถวเดิมของใบในรูปที่ส่งกลับไปได้ — แก้ทีละช่องด้วย `$patch` (คีย์ = ลำดับแถว) */
function posKeepRows(array $sale, array $patch = []): array
{
    return array_map(
        fn(array $r, int $i) => ($patch[$i] ?? []) + [
            'id'           => (int) $r['id'],
            'product_name' => $r['product_name_snapshot'],
            'quantity'     => (int) $r['quantity'],
            'unit_price'   => (float) $r['unit_price'],
        ],
        $sale['items'],
        array_keys($sale['items'])
    );
}

/** บิลสองแถว ค่าประกอบ 350 + ค่าบริการ 150 = 500 ยังไม่รับเงิน มีชื่อลูกค้า */
function posTwoLineSale(Tx $q): array
{
    $srv = posItemId($q, 'SRV-0001');
    return posCall('POST', '/api/pos/sales', [
        'items'         => [
            ['product_id' => $srv, 'quantity' => 1, 'unit_price' => 350],
            ['product_id' => $srv, 'quantity' => 1, 'unit_price' => 150],
        ],
        'delivered'     => true,
        'customer_name' => 'ลูกค้าทดสอบ',
        'payment'       => ['amount' => 0, 'method' => 'cash'],
    ]);
}

test('แก้ราคา จำนวน ชื่อ แล้วยอดใบคำนวณใหม่', function () {
    rollback(function (Tx $q) {
        $sale = posTwoLineSale($q);
        $out  = posItemsCall($sale, ['items' => posKeepRows($sale, [
            0 => ['unit_price' => 400, 'product_name' => 'ค่าประกอบ (แก้ชื่อ)'],
            1 => ['quantity' => 2],
        ])]);

        eq($out['items'][0]['product_name_snapshot'], 'ค่าประกอบ (แก้ชื่อ)', 'ชื่อ');
        eq((float) $out['items'][0]['line_total'], 400.0, 'รวมแถว 1');
        eq((float) $out['items'][1]['line_total'], 300.0, 'รวมแถว 2');
        eq((float) $out['total_amount'], 700.0, 'ยอดสุทธิ');
        eq((float) $out['balance_amount'], 700.0, 'ค้าง');
        eq($out['payment_status'], 'unpaid', 'สถานะ');
    });
});

test('ลบแถว เพิ่มแถว และแก้ชื่อลูกค้า', function () {
    rollback(function (Tx $q) {
        $sale  = posTwoLineSale($q);
        $items = posKeepRows($sale);
        array_pop($items);
        $items[] = ['product_id' => posItemId($q, 'SRV-0001'), 'quantity' => 3, 'unit_price' => 10];

        $out = posItemsCall($sale, ['items' => $items, 'customer_name' => 'ชื่อใหม่']);

        eq(count($out['items']), 2, 'จำนวนแถว');
        eq((float) $out['items'][1]['line_total'], 30.0, 'แถวใหม่');
        eq((float) $out['total_amount'], 380.0, 'ยอดสุทธิ');
        eq($out['customer_name_snapshot'], 'ชื่อใหม่', 'ชื่อลูกค้า');
        eq((int) $q->get('SELECT COUNT(*) c FROM pos_sale_items WHERE sale_id = ?', $sale['id'])['c'], 2, 'แถวในฐาน');
    });
});

test('ยอดใหม่ต่ำกว่าเงินที่รับแล้ว ไม่ยอมบันทึก', function () {
    rollback(function (Tx $q) {
        $sale = posCall('POST', '/api/pos/sales', posPaidSale([
            ['product_id' => posItemId($q, 'SRV-0001'), 'quantity' => 1, 'unit_price' => 350],
        ], 350));

        $e = posItemsError($sale, ['items' => posKeepRows($sale, [0 => ['unit_price' => 300]])]);
        eq($e['status'], 400, 'สถานะ');
        ok(str_contains($e['msg'], 'ต่ำกว่าเงินที่รับแล้ว'), 'ข้อความ — ได้ ' . $e['msg']);
        eq((float) $q->get('SELECT unit_price FROM pos_sale_items WHERE sale_id = ?', $sale['id'])['unit_price'], 350.0, 'ราคาไม่เปลี่ยน');

        $e = posItemsError($sale, ['items' => posKeepRows($sale, [0 => ['unit_price' => 400]])]);
        ok(str_contains($e['msg'], 'ชื่อหรือเบอร์'), 'ขึ้นราคาแล้วกลายเป็นค้าง ต้องมีชื่อลูกค้า — ได้ ' . $e['msg']);

        $out = posItemsCall($sale, ['items' => posKeepRows($sale, [0 => ['unit_price' => 400]]), 'customer_phone' => '0800000000']);
        eq((float) $out['balance_amount'], 50.0, 'ขึ้นราคาได้ ค้างส่วนต่าง');
        eq($out['payment_status'], 'partial', 'สถานะ');
    });
});

test('ของจากคลัง: แก้จำนวน คืนก้อนเดิมแล้วตัดใหม่ · ลบแถว ของกลับล็อต', function () {
    rollback(function (Tx $q) {
        [$pid, $lot] = posStockFixture($q, 'Frame', 'TST-POSEDIT1', 5);
        $sale = posCall('POST', '/api/pos/sales', posPaidSale([
            ['stock_product_id' => $pid, 'quantity' => 1, 'unit_price' => 1000],
        ], 1000));
        eq(posLotLeft($q, $lot), 4, 'ขายแล้วเหลือ 4');

        $out = posItemsCall($sale, ['items' => posKeepRows($sale, [0 => ['quantity' => 3]]), 'edit_ref' => 'tst1', 'customer_name' => 'ลูกค้าทดสอบ']);
        eq(posLotLeft($q, $lot), 2, 'แก้เป็น 3 ชิ้น เหลือ 2');
        $meta = json_decode($out['items'][0]['item_meta'], true);
        ok(str_contains($meta['stock_idem_key'], 'pos-edit-tst1'), 'คีย์ตัดใหม่ของแถว');

        $items   = [['product_id' => posItemId($q, 'SRV-0001'), 'quantity' => 1, 'unit_price' => 3000]];
        $out = posItemsCall($sale, ['items' => $items, 'edit_ref' => 'tst2']);
        eq(posLotLeft($q, $lot), 5, 'ลบแถวกรอบ ของกลับครบ');
        eq((float) $out['total_amount'], 3000.0, 'ยอดใหม่');
    });
});

test('ของจากคลัง: เพิ่มแถวตัดสต็อก · ของไม่พอ ใบไม่เปลี่ยนเลย', function () {
    rollback(function (Tx $q) {
        [$pid, $lot] = posStockFixture($q, 'Frame', 'TST-POSEDIT2', 1);
        $sale  = posTwoLineSale($q);
        $items = posKeepRows($sale, [0 => ['unit_price' => 1]]);

        $e = posItemsError($sale, ['items' => [...$items, ['stock_product_id' => $pid, 'quantity' => 2, 'unit_price' => 900]]]);
        eq($e['status'], 400, 'ของไม่พอต้อง 400 — ได้ ' . $e['msg']);
        eq(posLotLeft($q, $lot), 1, 'ล็อตไม่เปลี่ยน');
        eq((float) $q->get('SELECT total_amount FROM pos_sales WHERE id = ?', $sale['id'])['total_amount'], 500.0, 'ใบไม่เปลี่ยน');

        $out = posItemsCall($sale, ['items' => [...$items, ['stock_product_id' => $pid, 'quantity' => 1, 'unit_price' => 900]]]);
        eq(posLotLeft($q, $lot), 0, 'ตัดแล้ว');
        eq(count($out['items']), 3, 'จำนวนแถว');

        posCall('POST', "/api/pos/sales/{$sale['id']}/void", ['reason' => 'ทดสอบคืนของหลังแก้']);
        eq(posLotLeft($q, $lot), 1, 'ยกเลิกใบหลังแก้ ของกลับ');
    });
});

test('ด่านที่ต้องปฏิเสธ', function () {
    rollback(function (Tx $q) {
        $sale = posTwoLineSale($q);
        $rows = posKeepRows($sale);

        $cases = [
            'ไม่มีเหตุผล'      => [['items' => $rows, 'reason' => ''], 'เหตุผล'],
            'ไม่มีรายการ'      => [['items' => []], 'อย่างน้อย 1'],
            'ไม่มีอะไรเปลี่ยน'  => [['items' => $rows], 'ไม่มีอะไรเปลี่ยน'],
            'จำนวน 0'         => [['items' => posKeepRows($sale, [0 => ['quantity' => 0]])], 'อย่างน้อย 1'],
            'ราคาติดลบ'        => [['items' => posKeepRows($sale, [0 => ['unit_price' => -5]])], 'ติดลบ'],
            'แถวของใบอื่น'     => [['items' => [['id' => 999999999, 'quantity' => 1, 'unit_price' => 1]]], 'ไม่ใช่รายการของใบนี้'],
            'ลบชื่อลูกค้าใบค้าง' => [['items' => $rows, 'customer_name' => ''], 'ชื่อหรือเบอร์'],
        ];
        foreach ($cases as $what => [$body, $needle]) {
            $e = posItemsError($sale, $body);
            eq($e['status'], 400, "$what ต้องเป็น 400");
            ok(str_contains($e['msg'], $needle), "$what: ข้อความควรมี \"$needle\" — ได้ {$e['msg']}");
        }

        $q->run("UPDATE pos_sales SET status = 'void' WHERE id = ?", $sale['id']);
        $e = posItemsError($sale, ['items' => posKeepRows($sale, [0 => ['unit_price' => 1]])]);
        ok(str_contains($e['msg'], 'ถูกยกเลิกแล้ว'), 'ใบที่ยกเลิกแล้ว — ได้ ' . $e['msg']);
    });
});

test('เจ้าของร้านและพนักงานขายแก้ไม่ได้ (403)', function () {
    rollback(function (Tx $q) {
        $sale = posTwoLineSale($q);
        foreach ([['owner'], ['admin'], ['sales']] as $roles) {
            $e = posItemsError($sale, ['items' => posKeepRows($sale, [0 => ['unit_price' => 1]])], $roles);
            eq($e['status'], 403, implode(',', $roles) . ' ต้องได้ 403');
        }
        eq((float) $q->get('SELECT total_amount FROM pos_sales WHERE id = ?', $sale['id'])['total_amount'], 500.0, 'ยอดต้องไม่เปลี่ยน');
    });
});
