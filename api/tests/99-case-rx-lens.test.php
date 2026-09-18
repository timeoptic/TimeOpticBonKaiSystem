<?php

declare(strict_types=1);

/**
 * เลนส์สั่งตัด RX มาถึงร้านแล้วหรือยัง — หน้าเคสกับกระดานงาน (ร้านขอไว้ 14 ก.ย. 2026)
 *
 * คลังติ๊ก "เลนส์มาถึงแล้ว" บนใบสั่งตัด (`rx_orders.arrived_at`, migration 036 ฝั่งคลัง)
 * หน้าร้านต้องเห็นเองโดยไม่ต้องเดินไปถาม:
 *
 *   กระดานงาน   rx_lens_arrived / rx_lens_total ต่อเคส — "เลนส์เข้า 1/2"
 *   ออเดอร์      lens_r_rx_arrived_at / lens_l_rx_arrived_at — การ์ดเลนส์แต่ละข้างในหน้าเคส
 *
 * ใบสั่งตัดผูกกับออเดอร์ผ่าน lens_r_rx_id / lens_l_rx_id (id แถว RX_ORDER ในสมุดคลัง)
 * · ใบที่ถูกยกเลิกไม่นับ · ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ
 */

group('เลนส์สั่งตัด RX มาถึง — หน้าเคสและกระดานงาน');

/**
 * เคสหนึ่งใบกับออเดอร์ · `$sides` บอกว่าข้างไหนสั่งตัด และมาถึงเมื่อไร (null = ยังไม่มา)
 *
 * @param array<string,?string> $sides เช่น ['r' => '2026-09-14 15:20:00', 'l' => null]
 * @return array{code:string,case:int,order:int}
 */
function rxLensFixture(Tx $q, array $sides, bool $cancelLeft = false): array
{
    $tag  = bin2hex(random_bytes(4));
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'เลนส์มาถึง',
        '0000000000'
    )['insertId'];

    $code = 'TEST-RXL-' . $tag;
    $case = $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type, opened_at) VALUES (?,?,?,?,?)',
        $code,
        $cust,
        'reception',
        'new_glasses',
        nowStamp()
    )['insertId'];

    $product = $q->run(
        "INSERT INTO products (sku, category_id, product_type, name, base_selling_price, is_custom_made)
         VALUES (?, (SELECT id FROM categories WHERE code = 'Lens' LIMIT 1), 'Lens', ?, '0.00', 1)",
        'TRXL-' . $tag,
        'เลนส์ทดสอบ ' . $tag
    )['insertId'];

    $ids = ['r' => null, 'l' => null];
    foreach ($sides as $side => $arrivedAt) {
        $log = $q->run(
            "INSERT INTO inventory_logs (product_id, action_type, quantity, reference_doc, created_by, created_by_kind, created_at)
             VALUES (?, 'RX_ORDER', -1, ?, (SELECT MIN(id) FROM admins), 'user', NOW())",
            $product,
            "RX-TEST-$side-$tag"
        )['insertId'];
        $q->run(
            'INSERT INTO rx_orders (log_id, arrived_at, cancelled_at, cancelled_note) VALUES (?,?,?,?)',
            $log,
            $arrivedAt,
            $side === 'l' && $cancelLeft ? nowStamp() : null,
            $side === 'l' && $cancelLeft ? 'ยกเลิกทดสอบ' : null
        );
        $ids[$side] = $log;
    }

    $order = $q->run(
        'INSERT INTO custom_orders (customer_id, case_id, lens_r_rx_id, lens_r_rx_doc, lens_l_rx_id, lens_l_rx_doc)
         VALUES (?,?,?,?,?,?)',
        $cust,
        $case,
        $ids['r'],
        $ids['r'] ? "RX-TEST-r-$tag" : null,
        $ids['l'],
        $ids['l'] ? "RX-TEST-l-$tag" : null
    )['insertId'];

    return ['code' => $code, 'case' => (int) $case, 'order' => (int) $order];
}

/** แถวของเคสนี้บนกระดานงานแบบแบ่งหน้า */
function rxBoardRow(string $code): array
{
    $res = Router::dispatch('GET', '/api/cases', ['paged' => '1', 'q' => $code, 'limit' => '20']);
    return $res['rows'][0] ?? [];
}

test('กระดานงานบอกจำนวนเลนส์สั่งตัดที่มาแล้ว ต่อจำนวนทั้งหมด', function (): void {
    rollback(function (Tx $q): void {
        $half = rxLensFixture($q, ['r' => '2026-09-14 15:20:00', 'l' => null]);
        $row = rxBoardRow($half['code']);
        eq([(int) ($row['rx_lens_arrived'] ?? -1), (int) ($row['rx_lens_total'] ?? -1)], [1, 2], 'มาข้างเดียว');

        $full = rxLensFixture($q, ['r' => '2026-09-14 15:20:00', 'l' => '2026-09-14 15:25:00']);
        $row = rxBoardRow($full['code']);
        eq([(int) ($row['rx_lens_arrived'] ?? -1), (int) ($row['rx_lens_total'] ?? -1)], [2, 2], 'มาครบ');
    });
});

test('เคสที่ไม่ได้สั่งตัด RX ได้ 0/0 · ใบสั่งที่ยกเลิกแล้วไม่นับ', function (): void {
    rollback(function (Tx $q): void {
        $none = rxLensFixture($q, []);
        $row = rxBoardRow($none['code']);
        eq([(int) ($row['rx_lens_arrived'] ?? -1), (int) ($row['rx_lens_total'] ?? -1)], [0, 0], 'ไม่ได้สั่งตัด');

        $cancelled = rxLensFixture($q, ['r' => null, 'l' => null], true);
        $row = rxBoardRow($cancelled['code']);
        eq([(int) ($row['rx_lens_arrived'] ?? -1), (int) ($row['rx_lens_total'] ?? -1)], [0, 1], 'ข้างที่ยกเลิกไม่นับ');
    });
});

test('กระดานงานแบบเดิม (ไม่แบ่งหน้า) ก็มีตัวเลขเดียวกัน', function (): void {
    rollback(function (Tx $q): void {
        $f = rxLensFixture($q, ['r' => '2026-09-14 15:20:00', 'l' => null]);
        $rows = Router::dispatch('GET', '/api/cases', ['q' => $f['code']]);
        $row = $rows[0] ?? [];
        eq([(int) ($row['rx_lens_arrived'] ?? -1), (int) ($row['rx_lens_total'] ?? -1)], [1, 2], 'โหมดลิสต์');
    });
});

test('ออเดอร์บอกเวลาที่เลนส์แต่ละข้างมาถึง — ยังไม่มาเป็น null', function (): void {
    rollback(function (Tx $q): void {
        $f = rxLensFixture($q, ['r' => '2026-09-14 15:20:00', 'l' => null]);
        $o = orderDetail($f['order']);
        eq($o['lens_r_rx_arrived_at'] ?? 'missing', '2026-09-14 15:20:00', 'ข้างขวามาแล้ว');
        eq(array_key_exists('lens_l_rx_arrived_at', $o) ? $o['lens_l_rx_arrived_at'] : 'missing', null, 'ข้างซ้ายยังไม่มา');
    });
});
