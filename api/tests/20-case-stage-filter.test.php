<?php

declare(strict_types=1);

/**
 * หน้าขั้นตอน (วัดสายตา / ขาย / ชำระเงิน / วัด Center) ต้องเห็นเคสชุดเดียวกับกระดานงาน
 *
 * โจทย์ที่ทำให้ต้องมีไฟล์นี้: เคสหนึ่งใบขึ้นในคอลัมน์ "วัดสายตา" ของกระดานงาน
 * แต่เปิดหน้า /exam แล้วขึ้น "ไม่มีเคสในขั้นนี้" — เพราะสองหน้าถามคนละคำถาม
 *
 *   กระดานงาน  → `process_stage` ที่ caseStageMap() คำนวณจากงานที่ทำไปจริง
 *   หน้าขั้นตอน → `stage_group` ที่อ่านจาก cases.status ซึ่งคนตั้งด้วยมือ
 *
 * ทั้งสองคอลัมน์ไม่มีอะไรบังคับให้ตรงกัน เคสที่กดปุ่ม "เริ่ม" ที่ขั้นวัดสายตาแล้ว
 * แต่ไม่มีใครไปแก้ cases.status จึงหายไปจากหน้าขั้นตอนทั้งใบ
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('หน้าขั้นตอนต้องเห็นเคสชุดเดียวกับกระดานงาน');

/**
 * เคสที่ "อยู่ขั้นวัดสายตาจริง แต่ cases.status ยังค้างอยู่ขั้นรับลูกค้า" —
 * รูปเดียวกับ CASE-2026-00009 ที่เจอหน้างาน
 */
function stageFixture(Tx $q): array
{
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'ขั้นตอน',
        '0000000000'
    )['insertId'];

    $code = 'TEST-STAGE-' . bin2hex(random_bytes(4));
    $case = $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        $code,
        $cust,
        'reception',
        'new_glasses'
    )['insertId'];

    /* กดปุ่ม "เริ่ม" ที่ขั้นวัดสายตา — งานขยับแล้ว แต่ cases.status ไม่ขยับตาม */
    $q->run(
        'INSERT INTO case_processes (case_id, process, status, started_at)
         VALUES (?,?,?,NOW())',
        $case,
        'exam',
        'in_progress'
    );

    return ['id' => $case, 'code' => $code];
}

/** ค่าที่ /api/cases คืนมาแบบลิสต์ธรรมดา (ProcessCaseList ใช้เส้นนี้) */
function stageList(string $stage): array
{
    $rows = Router::dispatch('GET', '/api/cases', [
        'process_stage' => $stage,
        'open'          => '1',
        'limit'         => '5000',
    ]);
    return array_column($rows, 'case_code');
}

test('เคสที่กระดานงานวางไว้ขั้นวัดสายตา ต้องขึ้นในหน้า /exam ด้วย', function (): void {
    rollback(function (Tx $q): void {
        $c = stageFixture($q);

        eq(
            caseStageMap([$c['id']])[$c['id']]['process_stage'],
            'exam',
            'กระดานงานวางเคสนี้ไว้ขั้นวัดสายตา'
        );

        ok(
            in_array($c['code'], stageList('exam'), true),
            'หน้า /exam ต้องเห็นเคส ' . $c['code'] . ' แต่ไม่เห็น'
        );
    });
});

test('เคสนี้ต้องไม่โผล่ในขั้นอื่น', function (): void {
    rollback(function (Tx $q): void {
        $c = stageFixture($q);

        foreach (['reception', 'sales', 'payment', 'centering', 'delivery'] as $other) {
            ok(
                !in_array($c['code'], stageList($other), true),
                'เคส ' . $c['code'] . " ไม่ควรอยู่ในขั้น $other"
            );
        }
    });
});

/**
 * ตัวเลขบนการ์ด "เคสในขั้นนี้" ของหน้าขั้นตอน กับตัวเลขหัวคอลัมน์บนกระดานงาน
 * มาจากคนละเส้น — ถ้าสองเส้นนี้ไม่ตรงกัน ผู้ใช้จะเห็นเลขขัดกันสองที่เหมือนเดิม
 */
test('จำนวนต่อขั้นของหน้าขั้นตอน ตรงกับ by_stage ของกระดานงาน', function (): void {
    rollback(function (Tx $q): void {
        stageFixture($q);

        $board = Router::dispatch('GET', '/api/cases', [
            'paged'    => '1',
            'group_by' => 'stage',
            'per_group' => '1',
        ]);

        foreach (CASE_PROCESSES as $stage) {
            eq(
                count(stageList($stage)),
                (int) ($board['by_stage'][$stage] ?? 0),
                "จำนวนเคสขั้น $stage"
            );
        }
    });
});
