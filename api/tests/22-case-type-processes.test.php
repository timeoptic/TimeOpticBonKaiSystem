<?php

declare(strict_types=1);

/**
 * ประเภทงานเป็นตัวกำหนดว่าเคสมีขั้นตอนอะไรบ้าง
 *
 * สเปก: docs/superpowers/specs/2026-09-16-exam-only-case-flow-design.md
 *
 * โจทย์: ลูกค้ามาตรวจสายตาอย่างเดียว เคสควรมีแค่ รับลูกค้า → วัดสายตา แล้วจบ
 * แต่ `CASE_PROCESSES` เป็นรายการตายตัว 6 ขั้น เคสแบบนี้จึงไม่มีวันเสร็จ —
 * `advanceCaseStatus()` รอขั้นขาย/ชำระเงิน/วัด Center/ส่งมอบ ที่จะไม่มีวันถูกเติม
 *
 * สองเรื่องที่ไฟล์นี้เฝ้าไว้:
 *
 *   1. **เคสตรวจสายตาจบเองได้** — ยืนยันผลวัดแล้วต้อง `completed` + มี `closed_at`
 *      โดยไม่ต้องมีปุ่มปิดเคสแยก (setStatus() เซ็ต closed_at ให้เองเมื่อสถานะ
 *      ปลายทาง is_terminal = 1 — ดู core/Sql.php)
 *   2. **เคสตัดแว่นต้องไม่เปลี่ยนพฤติกรรม** — ยืนยันขั้นวัดสายตาแล้วเคสต้องยังเปิดอยู่
 *      ข้อนี้สำคัญกว่าข้อแรก เพราะงานหลักของร้านคือเคสตัดแว่น 7,752 ใบ
 *
 * ค่า case_type ที่ไม่รู้จัก (ข้อมูลเก่าใช้ 'new_glasses' ภาษาอังกฤษ ส่วน Lookups
 * วันนี้ให้ข้อความไทย) ต้องได้ครบ 6 ขั้นเสมอ — ของเดิมห้ามเปลี่ยนความหมาย
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('ขั้นตอนของเคสตามประเภทงาน');

const EXAM_ONLY_TYPE = 'ตรวจสายตา';
const GLASSES_TYPE   = 'ตัดแว่นใหม่';

/**
 * เคสหนึ่งใบพร้อมใบค่าสายตาที่ยืนยันแล้ว — พอให้ขั้น "วัดสายตา" ผ่านเกณฑ์
 * (processMissing() ถือว่ามี final = วัดสายตาเสร็จ)
 */
function typeFixture(Tx $q, string $caseType): array
{
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'ประเภทงาน',
        '0000000000'
    )['insertId'];

    $code = 'TEST-TYPE-' . bin2hex(random_bytes(4));
    $case = $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type, opened_at)
         VALUES (?,?,?,?,NOW())',
        $code,
        $cust,
        'reception',
        $caseType
    )['insertId'];

    $q->run(
        "INSERT INTO prescriptions (case_id, customer_id, kind, test_date, test_for,
            r_sphere, l_sphere, confirmed_at)
         VALUES (?,?, 'final', NOW(), 'Distance', '-1.00', '-1.00', NOW())",
        $case,
        $cust
    );

    return ['id' => (int) $case, 'code' => $code, 'customer_id' => (int) $cust];
}

/* ---------------------------------------------------------------------------
   1. กฎ "ประเภทงาน → ขั้นตอน" ตัวมันเอง
   --------------------------------------------------------------------------- */

test('ตรวจสายตา มีแค่ รับลูกค้า → วัดสายตา', function (): void {
    eq(processesFor(EXAM_ONLY_TYPE), ['reception', 'exam'], 'ขั้นตอนของเคสตรวจสายตา');
});

test('ตัดแว่นใหม่ ยังครบ 6 ขั้นเหมือนเดิม', function (): void {
    eq(processesFor(GLASSES_TYPE), CASE_PROCESSES, 'ขั้นตอนของเคสตัดแว่น');
});

/* ข้อมูลเก่าใช้คำศัพท์คนละชุด ('new_glasses') และบางใบไม่ได้ระบุประเภทเลย —
   ทั้งสองแบบต้องได้ครบ 6 ขั้น ไม่ใช่โดนตัดขั้นเพราะระบบไม่รู้จักค่า */
test('ประเภทที่ไม่รู้จักหรือไม่ได้ระบุ ได้ครบ 6 ขั้น', function (): void {
    eq(processesFor('new_glasses'), CASE_PROCESSES, 'ค่าเก่าภาษาอังกฤษ');
    eq(processesFor(null), CASE_PROCESSES, 'ไม่ได้ระบุประเภท');
    eq(processesFor(''), CASE_PROCESSES, 'ประเภทว่าง');
});

/* ---------------------------------------------------------------------------
   2. พฤติกรรมจริงของเคส
   --------------------------------------------------------------------------- */

test('เคสตรวจสายตา: ยืนยันผลวัดแล้วเคสปิดเอง', function (): void {
    rollback(function (Tx $q): void {
        $c = typeFixture($q, EXAM_ONLY_TYPE);

        Router::dispatch('POST', "/api/cases/{$c['id']}/processes/exam/complete", [], []);

        $row = $q->get('SELECT status, closed_at FROM cases WHERE id = ?', $c['id']);
        eq($row['status'], 'completed', 'สถานะเคสหลังยืนยันผลวัด');
        ok($row['closed_at'] !== null, 'เคสต้องมีเวลาปิด (closed_at)');
    });
});

/* ด่านกัน regression ของงานหลัก — เคสตัดแว่นยืนยันขั้นวัดสายตาแล้วยังต้องเดินต่อ
   ไปขั้นขาย ไม่ใช่ปิดตัวเองทิ้ง */
test('เคสตัดแว่น: ยืนยันผลวัดแล้วเคสยังไม่ปิด', function (): void {
    rollback(function (Tx $q): void {
        $c = typeFixture($q, GLASSES_TYPE);

        Router::dispatch('POST', "/api/cases/{$c['id']}/processes/exam/complete", [], []);

        $row = $q->get('SELECT status, closed_at FROM cases WHERE id = ?', $c['id']);
        ok($row['status'] !== 'completed', 'เคสตัดแว่นต้องยังไม่จบที่ขั้นวัดสายตา');
        eq($row['closed_at'], null, 'เคสตัดแว่นต้องยังไม่มีเวลาปิด');
    });
});

/* ---------------------------------------------------------------------------
   3. สิ่งที่หน้าเว็บได้รับ
   --------------------------------------------------------------------------- */

test('caseDetail ส่งเฉพาะขั้นของเคสนั้น พร้อมรายการขั้นตอน', function (): void {
    rollback(function (Tx $q): void {
        $c = typeFixture($q, EXAM_ONLY_TYPE);

        $detail = caseDetail($c['id']);

        eq(array_keys($detail['processes']), ['reception', 'exam'], 'คีย์ของ processes');
        eq($detail['process_list'] ?? null, ['reception', 'exam'], 'รายการขั้นตอนที่ส่งให้หน้าเว็บ');
    });
});

/* การ์ดบนกระดานเขียนว่า "x/6 ขั้น" โดยเอา 6 มาจากค่าคงที่ของทั้งแอป — เคสตรวจสายตา
   ที่ทำครบแล้วจึงอ่านว่า "2/6 ขั้น" เหมือนค้างอยู่ ทั้งที่จบงานไปแล้ว · ตัวหารต้องมา
   จากเคสใบนั้น ไม่ใช่จากค่าคงที่ */
test('กระดานงานส่งจำนวนขั้นทั้งหมดของเคสนั้นมาด้วย', function (): void {
    rollback(function (Tx $q): void {
        $exam    = typeFixture($q, EXAM_ONLY_TYPE);
        $glasses = typeFixture($q, GLASSES_TYPE);

        $map = caseStageMap([$exam['id'], $glasses['id']]);

        eq($map[$exam['id']]['process_total'] ?? null, 2, 'เคสตรวจสายตามีสองขั้น');
        eq($map[$glasses['id']]['process_total'] ?? null, 6, 'เคสตัดแว่นมีหกขั้น');
    });
});

/* นับเฉพาะขั้นที่เคสใบนี้มีจริง — ไม่งั้นตัวตั้งกับตัวหารมาจากคนละชุด */
test('จำนวนขั้นที่ทำแล้ว ต้องไม่เกินจำนวนขั้นของเคสนั้น', function (): void {
    rollback(function (Tx $q): void {
        $exam = typeFixture($q, EXAM_ONLY_TYPE);

        $row = caseStageMap([$exam['id']])[$exam['id']];

        ok(
            $row['process_done'] <= $row['process_total'],
            "ทำแล้ว {$row['process_done']} ขั้น จากทั้งหมด {$row['process_total']} ขั้น"
        );
    });
});

/* ---------------------------------------------------------------------------
   ใบค่าสายตาที่วัดจาก POS ต้องไม่ไหลเข้าเคส
   ---------------------------------------------------------------------------

   เหตุการณ์จริง 16 ก.ย. 2026 (CASE-2026-00002): ลูกค้าวัดสายตาที่ POS ตอนซื้อ
   คอนแทคเลนส์ → ได้ใบ `case_id = NULL, kind = 'final', source = 'contact_lens'`
   พอเปิดเคสใหม่ให้ลูกค้าคนเดิม ขั้น "วัดสายตา" ขึ้น ✓ เสร็จแล้วทันทีทั้งที่ยังไม่มี
   ใครวัดอะไรในเคสนั้น — เพราะ caseDetail() ดึงใบที่ไม่ผูกเคสของลูกค้ามาด้วย
   (cases.php) แล้ว processMissing() เห็นว่ามีใบ final (processes.php)

   ต้องกันสองทางพร้อมกัน ไม่ใช่ทางเดียว:
     · ใบจาก POS ต้องไม่ถูกนับเป็นผลวัดของเคส
     · ใบเก่าที่ไม่ผูกเคส (ข้อมูลจาก Access 8,401 ใบ ซึ่ง source เป็น NULL)
       ต้องยังถูกดึงเข้าเคสเหมือนเดิม — ไม่งั้นแก้ปัญหาเล็กแล้วสร้างปัญหาใหญ่กว่า
*/

/** ลูกค้าหนึ่งคน + เคสหนึ่งใบที่ยังไม่มีใบค่าสายตาเป็นของตัวเอง */
function loneCase(Tx $q, string $caseType = GLASSES_TYPE): array
{
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'ใบไม่ผูกเคส',
        '0000000000'
    )['insertId'];

    $case = $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type, opened_at)
         VALUES (?,?,?,?,NOW())',
        'TEST-LEAK-' . bin2hex(random_bytes(4)),
        $cust,
        'reception',
        $caseType
    )['insertId'];

    return ['id' => (int) $case, 'customer_id' => (int) $cust];
}

/** ใบค่าสายตาที่ไม่ผูกเคส — `source` เป็นตัวบอกว่ามันมาจากไหน */
function looseRx(Tx $q, int $customerId, ?string $source): void
{
    $q->run(
        "INSERT INTO prescriptions (case_id, customer_id, kind, source, test_date,
            r_sphere, l_sphere)
         VALUES (NULL, ?, 'final', ?, NOW(), '-1.00', '-1.00')",
        $customerId,
        $source
    );
}

test('ใบที่วัดจาก POS ไม่ทำให้ขั้นวัดสายตาของเคสขึ้นเสร็จเอง', function (): void {
    rollback(function (Tx $q): void {
        $c = loneCase($q);
        looseRx($q, $c['customer_id'], 'contact_lens');

        $detail = caseDetail($c['id']);

        ok(
            ($detail['processes']['exam']['status'] ?? '') !== 'completed',
            'ขั้นวัดสายตาต้องยังไม่เสร็จ — ได้ ' . ($detail['processes']['exam']['status'] ?? 'ไม่มีค่า')
        );
    });
});

test('ใบเก่าที่ไม่ผูกเคส ยังถูกดึงเข้าเคสเหมือนเดิม', function (): void {
    rollback(function (Tx $q): void {
        $c = loneCase($q);
        looseRx($q, $c['customer_id'], null);

        $detail = caseDetail($c['id']);

        eq(
            $detail['processes']['exam']['status'] ?? null,
            'completed',
            'ข้อมูลเดิมจาก Access ต้องยังนับเป็นผลวัดของเคส'
        );
    });
});

/* ยิง API ตรงไปที่ขั้นที่เคสนี้ไม่มี ต้องไม่ผ่าน — ไม่งั้นเคสตรวจสายตาจะมีขั้นขาย
   งอกขึ้นมาในฐานได้ ทั้งที่หน้าจอไม่เคยแสดงปุ่มนั้น */
test('เริ่มขั้นที่เคสนี้ไม่มี ต้องถูกปฏิเสธ', function (): void {
    rollback(function (Tx $q): void {
        $c = typeFixture($q, EXAM_ONLY_TYPE);

        $status = null;
        try {
            Router::dispatch('POST', "/api/cases/{$c['id']}/processes/sales/start", [], []);
        } catch (HttpError $e) {
            $status = $e->status;
        }
        eq($status, 400, 'ขั้นที่ไม่อยู่ในประเภทงานนี้');
    });
});
