<?php

declare(strict_types=1);

/**
 * กระดานงาน: ตัวกรองช่วงวันที่
 *
 * opened_at เป็น DATETIME — ขอบบนของช่วงต้องรวมทั้งวันสุดท้าย ไม่ใช่แค่ 00:00:00
 * ของวันนั้น (บั๊กที่หน้ารายงานอื่นเคยมี: `<= '2026-09-14'` ทิ้งเคสบ่ายวันที่ 14)
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('กระดานงาน: กรองช่วงวันที่');

/** เคสหนึ่งใบที่เปิดตามเวลาที่กำหนด — คืน case_code ไว้ค้นให้เหลือใบเดียว */
function dateFixture(Tx $q, string $openedAt): string
{
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'ช่วงวันที่',
        '0000000000'
    )['insertId'];

    $code = 'TEST-DATE-' . bin2hex(random_bytes(4));
    $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type, opened_at) VALUES (?,?,?,?,?)',
        $code,
        $cust,
        'reception',
        'new_glasses',
        $openedAt
    );
    return $code;
}

/** จำนวนเคสที่กระดาน (โหมดลิสต์) เห็นเมื่อค้นด้วยรหัสเคสนี้ภายใต้ช่วงที่ให้ */
function dateHits(string $code, array $range): int
{
    $res = Router::dispatch('GET', '/api/cases', ['paged' => '1', 'q' => $code, 'limit' => '20'] + $range);
    return (int) $res['total'];
}

test('เคสที่เปิดบ่ายวันสุดท้ายของช่วง ยังอยู่ในช่วง', function (): void {
    rollback(function (Tx $q): void {
        $code = dateFixture($q, '2026-09-14 16:30:00');
        eq(dateHits($code, ['from' => '2026-09-01', 'to' => '2026-09-14']), 1, 'เคสบ่ายวันที่ 14');
        eq(dateHits($code, ['from' => '2026-09-14', 'to' => '2026-09-14']), 1, 'ช่วงวันเดียว');
    });
});

test('เคสนอกช่วงไม่โผล่ ทั้งก่อนและหลัง', function (): void {
    rollback(function (Tx $q): void {
        $code = dateFixture($q, '2026-09-15 00:00:00');
        eq(dateHits($code, ['from' => '2026-09-01', 'to' => '2026-09-14']), 0, 'เที่ยงคืนวันถัดไปอยู่นอกช่วง');
        eq(dateHits($code, ['from' => '2026-09-16']), 0, 'ก่อนขอบล่าง');
        eq(dateHits($code, ['to' => '2026-09-15']), 1, 'มีแค่ขอบบนก็กรองได้');
    });
});

test('วันที่ที่อ่านไม่ออกไม่ถูกใช้กรอง', function (): void {
    rollback(function (Tx $q): void {
        $code = dateFixture($q, '2026-09-10 10:00:00');
        eq(dateHits($code, ['from' => 'garbage', 'to' => '14/09/2026']), 1, 'ค่าขยะต้องไม่ทำให้เคสหาย');
    });
});

test('นับ counts และ by_stage จากช่วงวันที่เดียวกับรายการ', function (): void {
    rollback(function (Tx $q): void {
        $code = dateFixture($q, '2026-09-10 10:00:00');
        $in  = Router::dispatch('GET', '/api/cases', [
            'paged' => '1', 'q' => $code, 'group_by' => 'stage', 'from' => '2026-09-10', 'to' => '2026-09-10',
        ]);
        $out = Router::dispatch('GET', '/api/cases', [
            'paged' => '1', 'q' => $code, 'group_by' => 'stage', 'from' => '2026-09-11',
        ]);
        eq($in['counts']['all'], 1, 'counts ในช่วง');
        eq(array_sum($in['by_stage']), 1, 'by_stage ในช่วง');
        eq($out['counts']['all'], 0, 'counts นอกช่วง');
        eq(array_sum($out['by_stage']), 0, 'by_stage นอกช่วง');
    });
});
