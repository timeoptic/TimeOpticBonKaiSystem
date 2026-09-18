<?php

declare(strict_types=1);

use Optic\Db;
use Optic\Roles;
use Optic\Service\Rx;

/**
 * ใบสั่งตัด RX · เลขเคส ข้างตา ช่วงวันที่ และติ๊กว่าเลนส์มาถึง — ร้านขอไว้ 14 ก.ย. 2026
 *
 * ใบสั่งตัดที่เปิดจากหน้าเคสผูกกับออเดอร์ผ่าน `custom_orders.lens_r_rx_id / lens_l_rx_id`
 * (ช่องขวา/ซ้ายของออเดอร์) — เลขเคส ข้างตา และพนักงานผู้ขายจึงอ่านจากตรงนั้นได้ ไม่ต้อง
 * ให้ใครกรอกเพิ่ม · กล่องสั่งตัดในหน้าเคสไม่เคยส่งข้างตามา ใบเก่าทั้งหมดจึงมีข้างตาว่าง
 *
 * ติ๊ก "เลนส์มาถึงแล้ว" บันทึกเวลาและคนติ๊ก · เลนส์ของเคสมาครบทุกข้างแล้วได้ข้อความ
 * สำหรับ Telegram หนึ่งใบ — ตัวบริการคืนข้อความ ส่วนการส่งเป็นของเส้น API เทสต์นี้จึง
 * ไม่ยิงเข้ากลุ่มจริง
 *
 * ของทดสอบสร้างเองในทรานแซกชันที่ roll back · รันเดี่ยวได้ (`run.php 73-`)
 */

group('ใบสั่งตัด RX · เลขเคส ข้างตา ช่วงวันที่ เลนส์มาถึง');

/** รุ่นเลนส์สั่งตัดของเทสต์นี้เอง · คืน SKU */
function arrivalLensSku(): string
{
    $sku = 'RXA-' . strtoupper(bin2hex(random_bytes(3)));
    $lens = (int) Db::value("SELECT id FROM categories WHERE code = 'Lens'");
    Db::run(
        'INSERT INTO products (sku, category_id, product_type, name, base_selling_price, is_custom_made)
         VALUES (?, ?, ?, ?, ?, 1)',
        [$sku, $lens, 'Lens', "เลนส์สั่งตัดทดสอบ $sku", '0.00'],
    );
    return $sku;
}

/**
 * เคสหนึ่งใบ ออเดอร์สั่งตัดสองข้าง ผู้ขายเป็นพนักงานคนแรกในฐาน (ถ้ามี)
 *
 * @return array{case:int,code:string,right:int,left:int,sales:?string,tag:string}
 */
function arrivalCase(): array
{
    $tag = strtoupper(bin2hex(random_bytes(3)));
    $sku = arrivalLensSku();
    $right = (int) Rx::order(['sku' => $sku, 'reference_doc' => "RXA-R-$tag"], [Roles::OWNER], 1)['id'];
    $left = (int) Rx::order(['sku' => $sku, 'reference_doc' => "RXA-L-$tag"], [Roles::OWNER], 1)['id'];

    Db::run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', ['ทดสอบ', 'เลนส์มาถึง']);
    $customer = (int) Db::conn()->lastInsertId();
    $code = "CASE-RXA-$tag";
    Db::run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', [$code, $customer]);
    $case = (int) Db::conn()->lastInsertId();

    $emp = Db::one('SELECT id, employee_name, first_name, last_name FROM employees ORDER BY id LIMIT 1');
    $sales = null;
    if ($emp !== null) {
        $sales = trim((string) ($emp['employee_name'] ?? '')) !== ''
            ? trim((string) $emp['employee_name'])
            : trim(($emp['first_name'] ?? '') . ' ' . ($emp['last_name'] ?? ''));
    }

    Db::run(
        'INSERT INTO custom_orders (customer_id, case_id, employee_id, lens_r_rx_id, lens_r_rx_doc, lens_l_rx_id, lens_l_rx_doc)
         VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$customer, $case, $emp['id'] ?? null, $right, "RXA-R-$tag", $left, "RXA-L-$tag"],
    );

    return ['case' => $case, 'code' => $code, 'right' => $right, 'left' => $left, 'sales' => $sales, 'tag' => $tag];
}

/** แถวของใบนี้ในสมุดใบสั่ง ภายใต้ตัวกรองที่ให้ · null ถ้าไม่อยู่ */
function arrivalRow(int $id, ?string $q, array $filter = []): ?array
{
    foreach (Rx::orders($q, false, 1, 100, true, $filter)['rows'] as $r) {
        if ($r['id'] === $id) {
            return $r;
        }
    }
    return null;
}

test('แถวใบสั่งบอกเลขเคส ข้างตาจากช่องในออเดอร์ และพนักงานผู้ขายของเคส · ค้นด้วยเลขเคสได้', function () {
    withRollback(function () {
        $c = arrivalCase();

        $r = arrivalRow($c['right'], $c['code']);
        ok($r !== null, 'ค้นด้วยเลขเคสต้องเจอใบข้างขวา');
        eq([$r['caseId'], $r['caseCode']], [$c['case'], $c['code']], 'เลขเคส');
        eq($r['eyeSide'], 'right', 'ข้างตาจากช่องขวาของออเดอร์');
        eq($r['salesName'], $c['sales'], 'พนักงานผู้ขายของเคส');

        $l = arrivalRow($c['left'], $c['code']);
        ok($l !== null, 'ค้นด้วยเลขเคสต้องเจอใบข้างซ้าย');
        eq($l['eyeSide'], 'left', 'ข้างตาจากช่องซ้ายของออเดอร์');
    });
});

test('ใบที่ไม่ได้เปิดจากเคส: เลขเคสว่าง และข้างตาตามที่กรอกบนใบสั่ง', function () {
    withRollback(function () {
        $tag = strtoupper(bin2hex(random_bytes(3)));
        $id = (int) Rx::order(
            ['sku' => arrivalLensSku(), 'reference_doc' => "RXA-S-$tag", 'eye_side' => 'left'],
            [Roles::OWNER],
            1,
        )['id'];

        $r = arrivalRow($id, "RXA-S-$tag");
        ok($r !== null, 'ต้องอยู่ในสมุด');
        eq([$r['caseId'], $r['caseCode'], $r['salesName']], [null, null, null], 'ไม่มีเคส');
        eq($r['eyeSide'], 'left', 'ข้างตาที่กรอกไว้');
    });
});

test('กรองช่วงวันที่เปิดใบสั่ง — ขอบบนรวมทั้งวันสุดท้าย', function () {
    withRollback(function () {
        $c = arrivalCase();
        Db::run('UPDATE inventory_logs SET created_at = ? WHERE id = ?', ['2026-09-14 16:30:00', $c['right']]);

        ok(arrivalRow($c['right'], $c['code'], ['from' => '2026-09-14', 'to' => '2026-09-14']) !== null, 'บ่ายวันสุดท้ายของช่วง');
        ok(arrivalRow($c['right'], $c['code'], ['from' => '2026-09-01', 'to' => '2026-09-14']) !== null, 'ช่วงหลายวัน');
        eq(arrivalRow($c['right'], $c['code'], ['from' => '2026-09-15']), null, 'ก่อนขอบล่าง');
        eq(arrivalRow($c['right'], $c['code'], ['to' => '2026-09-13']), null, 'หลังขอบบน');
        ok(arrivalRow($c['right'], $c['code'], ['from' => 'ไม่ใช่วันที่']) !== null, 'วันที่อ่านไม่ออกไม่ถูกใช้กรอง');
    });
});

test('ติ๊กเลนส์มาถึง: บันทึกเวลาและคนติ๊ก · ติ๊กซ้ำไม่เปลี่ยนเวลาเดิม · เอาติ๊กออกได้', function () {
    withRollback(function () {
        $c = arrivalCase();

        $out = Rx::setArrived($c['right'], true, [Roles::STOCK], 1);
        ok(is_string($out['arrivedAt']), 'ได้เวลาที่มาถึง — ได้ ' . render($out['arrivedAt']));
        $r = arrivalRow($c['right'], $c['code']);
        ok(is_string($r['arrivedAt']) && $r['arrivedByName'] !== null, 'แถวบอกเวลาและคนติ๊ก — ได้ ' . render([$r['arrivedAt'], $r['arrivedByName']]));

        Db::run('UPDATE rx_orders SET arrived_at = ? WHERE log_id = ?', ['2026-09-14 09:15:00', $c['right']]);
        Rx::setArrived($c['right'], true, [Roles::STOCK], 1);
        eq(arrivalRow($c['right'], $c['code'])['arrivedAt'], '2026-09-14 09:15:00', 'ติ๊กซ้ำ เวลาเดิมอยู่');

        Rx::setArrived($c['right'], false, [Roles::STOCK], 1);
        $r = arrivalRow($c['right'], $c['code']);
        eq([$r['arrivedAt'], $r['arrivedByName']], [null, null], 'เอาติ๊กออกแล้ว');
    });
});

test('ตัวกรองรอเลนส์ / เลนส์มาถึงแล้ว', function () {
    withRollback(function () {
        $c = arrivalCase();
        Rx::setArrived($c['right'], true, [Roles::STOCK], 1);

        ok(arrivalRow($c['right'], $c['code'], ['lens' => 'arrived']) !== null, 'ข้างที่มาแล้วอยู่ในมาถึงแล้ว');
        eq(arrivalRow($c['right'], $c['code'], ['lens' => 'waiting']), null, 'ข้างที่มาแล้วไม่อยู่ในรอเลนส์');
        ok(arrivalRow($c['left'], $c['code'], ['lens' => 'waiting']) !== null, 'ข้างที่ยังไม่มาอยู่ในรอเลนส์');
        eq(arrivalRow($c['left'], $c['code'], ['lens' => 'arrived']), null, 'ข้างที่ยังไม่มาไม่อยู่ในมาถึงแล้ว');
    });
});

test('สิทธิ์: คนที่ใช้ฝั่งคลังได้ติ๊กได้ · พนักงานขายล้วนติ๊กไม่ได้ · ใบที่ยกเลิกแล้วติ๊กไม่ได้', function () {
    withRollback(function () {
        $c = arrivalCase();

        throwsReason('forbidden', fn() => Rx::setArrived($c['right'], true, [Roles::SALES], 1), 'พนักงานขายล้วน');
        Rx::setArrived($c['right'], true, [Roles::SALES, Roles::STOCK], 1);
        ok(arrivalRow($c['right'], $c['code'])['arrivedAt'] !== null, 'ขายและคลังติ๊กได้');

        /* ใบที่มีราคาขายแล้วถูก "ยกเลิก" ไม่ใช่ลบ (Rx::remove) — ใบนั้นยังอยู่แต่ติ๊กไม่ได้ ·
           ใบที่ยังไม่มีตัวเลขเงินถูกลบทิ้งจริง ติ๊กแล้วจึงได้ not_found */
        $tag = strtoupper(bin2hex(random_bytes(3)));
        $priced = (int) Rx::order(
            ['sku' => arrivalLensSku(), 'reference_doc' => "RXA-P-$tag", 'sale_price' => '1500'],
            [Roles::OWNER],
            1,
        )['id'];
        Rx::remove($priced, ['note' => 'ยกเลิกทดสอบ'], [Roles::OWNER], 1);
        throwsReason('already_cancelled', fn() => Rx::setArrived($priced, true, [Roles::OWNER], 1), 'ใบที่ยกเลิกแล้ว');

        Rx::remove($c['left'], ['note' => 'ลบทดสอบ'], [Roles::OWNER], 1);
        throwsReason('not_found', fn() => Rx::setArrived($c['left'], true, [Roles::OWNER], 1), 'ใบที่ถูกลบ');
        throwsReason('not_found', fn() => Rx::setArrived(999999999, true, [Roles::OWNER], 1), 'ไม่มีใบนี้');
    });
});

test('ข้อความแจ้งเมื่อเลนส์ของเคสมาครบทุกข้าง — ข้างเดียวยังไม่แจ้ง · ติ๊กซ้ำไม่แจ้งซ้ำ', function () {
    withRollback(function () {
        $c = arrivalCase();

        eq(Rx::setArrived($c['right'], true, [Roles::STOCK], 1)['notice'], null, 'มาข้างเดียว');

        $notice = Rx::setArrived($c['left'], true, [Roles::STOCK], 1)['notice'];
        ok(is_string($notice), 'มาครบแล้วต้องได้ข้อความ');
        ok(str_contains((string) $notice, $c['code']), 'ข้อความมีเลขเคส — ได้ ' . render($notice));
        ok(
            str_contains((string) $notice, "RXA-R-{$c['tag']}") && str_contains((string) $notice, "RXA-L-{$c['tag']}"),
            'ข้อความมีเลขใบสั่งทั้งสองข้าง',
        );

        eq(Rx::setArrived($c['left'], true, [Roles::STOCK], 1)['notice'], null, 'ติ๊กซ้ำข้างที่มาแล้ว ไม่แจ้งซ้ำ');
        eq(Rx::setArrived($c['left'], false, [Roles::STOCK], 1)['notice'], null, 'เอาติ๊กออก ไม่แจ้ง');
    });
});

test('ใบที่ไม่ได้ผูกเคส ติ๊กมาถึงแล้วไม่มีข้อความแจ้ง', function () {
    withRollback(function () {
        $tag = strtoupper(bin2hex(random_bytes(3)));
        $id = (int) Rx::order(['sku' => arrivalLensSku(), 'reference_doc' => "RXA-N-$tag"], [Roles::OWNER], 1)['id'];
        eq(Rx::setArrived($id, true, [Roles::STOCK], 1)['notice'], null, 'ไม่มีเคสให้แจ้ง');
    });
});
