<?php

declare(strict_types=1);

/**
 * เปิดเคสใหม่ — ประตูหน้าของทั้งระบบ
 *
 * ทุกอย่างที่ตามมา (วัดสายตา ขาย ชำระเงิน วัด Center ส่งมอบ ใบเสร็จ รายงาน)
 * ห้อยอยู่กับแถวเดียวที่เส้นนี้สร้าง ถ้ามันสร้างผิดตั้งแต่แรก ความผิดจะไม่โผล่
 * ตรงนี้ แต่จะไปโผล่ปลายทางในรูปที่ไล่กลับมาหาต้นทางไม่ได้ — เคสไม่มีเลข
 * เคสที่โผล่ในกระดานแต่เปิดไม่ได้ ยอดในรายงานที่ไม่มีใบให้กด
 *
 * สี่เรื่องที่ไฟล์นี้เฝ้าไว้:
 *
 *   1. **เลขเคสห้ามซ้ำ** — `nextCode()` อ่านเลขสูงสุดแล้ว +1 ซึ่งไม่ใช่ตัวนับ
 *      ที่ฐานบังคับ · เลขซ้ำแปลว่าใบเสร็จผูกผิดใบ
 *   2. **ต้องมีลูกค้าจริงเสมอ** — เคสที่ชี้ไปที่ลูกค้าที่ไม่มีอยู่ทำให้ caseDetail()
 *      (ซึ่ง JOIN customers แบบ INNER) ตอบ 404 ทั้งที่แถวมีอยู่ = เคสผี
 *   3. **สมุดเหตุการณ์ต้องมีบรรทัดแรก** — หน้าไทม์ไลน์ของเคสอ่านจาก case_events
 *      ถ้าไม่มีบรรทัด case_opened ประวัติจะเริ่มกลางเรื่อง
 *   4. **ประเภทลูกค้า** — ค่าที่คนเลือกต้องชนะค่าที่ระบบเดาจากโน้ตเสมอ
 *      คนที่นั่งอยู่ตรงนั้นรู้จริงกว่าคำค้น
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('เปิดเคสใหม่');

/** ลูกค้าหนึ่งรายสำหรับผูกเคส */
function caseCustomer(Tx $q, string $first = 'ทดสอบ'): int
{
    return (int) $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        $first,
        'เปิดเคส',
        '0899999999'
    )['insertId'];
}

/** ยิงเส้นทางจริงที่ปุ่ม "บันทึกเปิดเคส" ในหน้า /cases/new/ เรียก */
function openCase(array $body): array
{
    return Router::dispatch('POST', '/api/cases', [], $body);
}

/** @return array{status:?int,msg:string} */
function openCaseError(array $body): array
{
    try {
        openCase($body);
    } catch (HttpError $e) {
        return ['status' => $e->status, 'msg' => $e->getMessage()];
    }
    return ['status' => null, 'msg' => ''];
}

test('เปิดเคสให้ลูกค้าที่มีอยู่ ได้เลขเคสและสถานะเริ่มต้น', function () {
    rollback(function (Tx $q) {
        $cust = caseCustomer($q);

        $c = openCase(['customer_id' => $cust]);

        eq((int) $c['customer_id'], $cust, 'ผูกกับลูกค้าที่ส่งไป');
        eq($c['status'], 'reception', 'สถานะเริ่มต้นคือขั้นรับลูกค้า');
        ok(str_starts_with((string) $c['case_code'], 'CASE-'), 'เลขเคสขึ้นต้นด้วย CASE- — ได้ ' . $c['case_code']);
        /* caseDetail() JOIN case_statuses แบบ INNER — เปิดได้แปลว่าสถานะที่ใส่มี
           อยู่ในตารางสถานะจริง ไม่ใช่สตริงที่พิมพ์ลอย ๆ */
        ok(($c['status_label_th'] ?? '') !== '', 'ต้องได้ชื่อสถานะภาษาไทยติดมาด้วย');
    });
});

test('ไม่เลือกลูกค้า เปิดเคสไม่ได้', function () {
    rollback(function (Tx $q) {
        $e = openCaseError([]);
        eq($e['status'], 400, 'ต้องเป็น 400');
        eq($e['msg'], 'กรุณาเลือกลูกค้า', 'ข้อความที่คนหน้าร้านจะเห็น');
    });
});

/* เคสที่ชี้ไปที่ลูกค้าที่ไม่มีอยู่จะเปิดหน้ารายละเอียดไม่ได้เลยตลอดกาล
   (caseDetail JOIN customers แบบ INNER) — ต้องกันตั้งแต่ตอนสร้าง */
test('ลูกค้าที่ไม่มีอยู่จริง เปิดเคสไม่ได้', function () {
    rollback(function (Tx $q) {
        $e = openCaseError(['customer_id' => 999999999]);
        eq($e['status'], 400, 'ต้องเป็น 400');
        eq($e['msg'], 'ไม่พบลูกค้ารายนี้', 'ข้อความที่คนหน้าร้านจะเห็น');
    });
});

test('เปิดสองใบติดกัน เลขเคสต้องไม่ซ้ำ', function () {
    rollback(function (Tx $q) {
        $cust = caseCustomer($q);

        $a = openCase(['customer_id' => $cust]);
        $b = openCase(['customer_id' => $cust]);

        ok($a['case_code'] !== $b['case_code'], "เลขซ้ำกัน: {$a['case_code']}");
        ok((int) $a['id'] !== (int) $b['id'], 'ต้องเป็นคนละใบ');
    });
});

test('ส่งเลขเคสมาเอง ระบบใช้เลขนั้น ไม่ตั้งให้ใหม่', function () {
    rollback(function (Tx $q) {
        $cust = caseCustomer($q);
        $code = 'TEST-OPEN-' . bin2hex(random_bytes(4));

        $c = openCase(['customer_id' => $cust, 'case_code' => $code]);

        eq($c['case_code'], $code, 'เลขที่ส่งมาเอง');
    });
});

test('เปิดเคสแล้วสมุดเหตุการณ์ต้องมีบรรทัดแรก', function () {
    rollback(function (Tx $q) {
        $cust = caseCustomer($q);

        $c = openCase([
            'customer_id'    => $cust,
            'reception_note' => 'ลูกค้าเดินเข้ามาเอง',
        ]);

        $ev = $q->get(
            'SELECT action, to_status, note FROM case_events WHERE case_id = ? ORDER BY id LIMIT 1',
            (int) $c['id']
        );
        ok($ev !== null, 'ต้องมีบรรทัดในสมุดเหตุการณ์');
        eq($ev['action'], 'case_opened', 'ชนิดของเหตุการณ์');
        eq($ev['to_status'], 'reception', 'สถานะปลายทางที่บันทึกไว้');
        eq($ev['note'], 'ลูกค้าเดินเข้ามาเอง', 'โน้ตตอนรับลูกค้าต้องติดไปด้วย');
    });
});

/* ฟอร์มหน้าร้านมีช่อง "ผู้รับงาน" ช่องเดียว ไม่มีช่อง "ผู้บันทึก" แยก —
   ถ้าไม่ตกกลับให้ คอลัมน์ recorded_by จะว่างทั้งตาราง แล้วรายงานรายพนักงาน
   จะนับงานของคนรับเข้าไม่ได้ */
test('ไม่บอกผู้บันทึก ใช้ผู้รับงานแทน', function () {
    rollback(function (Tx $q) {
        $cust = caseCustomer($q);
        $emp  = (int) $q->run(
            'INSERT INTO employees (employee_name, active) VALUES (?,1)',
            'พนักงานทดสอบเปิดเคส'
        )['insertId'];

        $c = openCase(['customer_id' => $cust, 'received_by' => $emp]);

        $row = $q->get('SELECT received_by, recorded_by FROM cases WHERE id = ?', (int) $c['id']);
        eq((int) $row['received_by'], $emp, 'ผู้รับงาน');
        eq((int) $row['recorded_by'], $emp, 'ผู้บันทึกต้องตกกลับมาเป็นคนเดียวกัน');
    });
});

test('ผู้บันทึกที่ส่งมาเอง ต้องไม่ถูกทับด้วยผู้รับงาน', function () {
    rollback(function (Tx $q) {
        $cust = caseCustomer($q);
        $a = (int) $q->run('INSERT INTO employees (employee_name, active) VALUES (?,1)', 'คนรับงาน')['insertId'];
        $b = (int) $q->run('INSERT INTO employees (employee_name, active) VALUES (?,1)', 'คนคีย์')['insertId'];

        $c = openCase(['customer_id' => $cust, 'received_by' => $a, 'recorded_by' => $b]);

        $row = $q->get('SELECT received_by, recorded_by FROM cases WHERE id = ?', (int) $c['id']);
        eq((int) $row['received_by'], $a, 'ผู้รับงาน');
        eq((int) $row['recorded_by'], $b, 'ผู้บันทึกตามที่ส่งมา');
    });
});

group('ประเภทลูกค้าตอนเปิดเคส');

test('ไม่ได้เลือกประเภท ระบบเดาจากโน้ตให้', function () {
    rollback(function (Tx $q) {
        $cust = caseCustomer($q);

        $c = openCase(['customer_id' => $cust, 'notes' => 'ลูกค้าสั่งผ่าน TikTok']);

        eq($c['customer_category'], CaseSource::ONLINE, 'ต้องเดาได้ว่าเป็นลูกค้าออนไลน์');
    });
});

/* ระบบเดาจากคำค้น ส่วนคนที่นั่งอยู่ตรงนั้นรู้จริง — ค่าที่คนเลือกต้องชนะเสมอ
   ไม่งั้นการแก้ประเภทให้ถูกจะถูกเขียนทับกลับทุกครั้งที่กดบันทึก */
test('เลือกประเภทมาเอง ต้องชนะการเดาจากโน้ต', function () {
    rollback(function (Tx $q) {
        $cust = caseCustomer($q);

        $c = openCase([
            'customer_id'       => $cust,
            'notes'             => 'ลูกค้าสั่งผ่าน TikTok',
            'customer_category' => CaseSource::WALK_IN,
        ]);

        eq($c['customer_category'], CaseSource::WALK_IN, 'ต้องใช้ค่าที่คนเลือก');
    });
});

test('ประเภทที่ส่งมาไม่รู้จัก ต้องตกกลับไปใช้การเดา ไม่ใช่เก็บค่าเพี้ยนลงฐาน', function () {
    rollback(function (Tx $q) {
        $cust = caseCustomer($q);

        $c = openCase([
            'customer_id'       => $cust,
            'notes'             => 'ลูกค้าสั่งผ่าน TikTok',
            'customer_category' => 'ประเภทที่ไม่มีจริง',
        ]);

        eq($c['customer_category'], CaseSource::ONLINE, 'ค่าเพี้ยนต้องไม่ถูกเก็บ');
    });
});
