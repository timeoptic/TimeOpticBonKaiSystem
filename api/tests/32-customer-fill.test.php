<?php

declare(strict_types=1);

/**
 * "เติมข้อมูลลูกค้า" จากขั้นรับลูกค้า — POST /api/customers/:id/fill
 *
 * หน้าเคสมีข้อมูลลูกค้าไม่ครบทุกคอลัมน์ (ไม่มีชื่อกลาง ไม่มีหมายเหตุ) ถ้าเติมผ่าน
 * PUT /api/customers/:id ซึ่งเขียนทับทั้งสิบช่อง สองช่องนั้นจะถูกลบทิ้งเงียบ ๆ
 * เส้นนี้จึงเขียนเฉพาะช่องที่ส่งมา และเขียนได้เฉพาะช่องที่ยังว่างอยู่เท่านั้น
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('เติมข้อมูลลูกค้าจากหน้าเคส');

/** ลูกค้าหนึ่งคน คอลัมน์ที่ไม่ส่งมาเป็น NULL */
function fillCustomer(Tx $q, array $cols = []): int
{
    $cols += ['first_name' => 'ทดสอบ', 'last_name' => 'เติมข้อมูล'];
    $keys = array_keys($cols);
    return (int) $q->run(
        'INSERT INTO customers (' . implode(',', $keys) . ') VALUES (' . implode(',', array_fill(0, count($keys), '?')) . ')',
        ...array_values($cols)
    )['insertId'];
}

function fillCase(Tx $q, int $customerId): int
{
    return (int) $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        'TEST-FILL-' . bin2hex(random_bytes(4)),
        $customerId,
        'appointment',
        'new_glasses'
    )['insertId'];
}

/** คนหน้าร้านตัวจริงจากฐาน — เส้นนี้ลงไทม์ไลน์ว่าใครเป็นคนเติม */
function fillActor(): array
{
    $r = Db::get(
        "SELECT a.id, a.username, a.display_name, a.employee_id
           FROM admins a JOIN admin_roles r ON r.admin_id = a.id
          WHERE r.role = 'owner' AND a.is_active = 1 LIMIT 1"
    );
    if (!$r) {
        failTest('ไม่มีบัญชี owner ในฐาน');
    }
    $roles = \Optic\Auth::rolesOf((int) $r['id']);
    return [
        'id' => (int) $r['id'], 'username' => $r['username'], 'displayName' => $r['display_name'],
        'roles' => $roles, 'perms' => \Optic\Roles::permsOf($roles),
        'employeeId' => $r['employee_id'] === null ? null : (int) $r['employee_id'],
    ];
}

function fillCall(int $customerId, array $body): mixed
{
    StockModule::boot();
    return \Optic\Auth::as(fillActor(), fn() => Router::dispatch('POST', "/api/customers/$customerId/fill", [], $body));
}

/** @return array{status:?int, reason:?string, msg:string} */
function fillError(int $customerId, array $body): array
{
    try {
        fillCall($customerId, $body);
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null, 'msg' => $e->getMessage()];
    }
    return ['status' => null, 'reason' => null, 'msg' => ''];
}

function fillRow(Tx $q, int $id): array
{
    return $q->get('SELECT * FROM customers WHERE id = ?', $id);
}

test('เติมวันเกิดกับเบอร์โทรที่ว่างอยู่ — ชื่อกลาง หมายเหตุ และ LINE เดิมไม่หาย', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q, ['mid_name' => 'กลาง', 'notes' => 'หมายเหตุเดิม', 'line_id' => 'line-old']);
        $res = fillCall($id, ['birth_date' => '1981-03-12', 'phone' => ' 081-234-5678 ']);
        $row = fillRow($q, $id);
        eq(substr((string) $row['birth_date'], 0, 10), '1981-03-12', 'วันเกิด');
        eq($row['phone'], '081-234-5678', 'เบอร์โทร (ตัดช่องว่างหัวท้าย)');
        eq([$row['mid_name'], $row['notes'], $row['line_id']], ['กลาง', 'หมายเหตุเดิม', 'line-old'], 'ช่องที่ไม่ได้ส่งมา');
        eq($res['filled'] ?? null, ['birth_date', 'phone'], 'ช่องที่เติม');
        eq((int) ($res['customer']['id'] ?? 0), $id, 'ลูกค้าที่ส่งกลับ');
    });
});

test('ช่องที่มีค่าอยู่แล้วห้ามเขียนทับ — ตอบ 409 และไม่แก้อะไรเลยทั้งคำขอ', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q, ['phone' => '0811111111']);
        $r = fillError($id, ['phone' => '0899999999', 'birth_date' => '1990-01-01']);
        eq([$r['status'], $r['reason']], [409, 'already_filled'], 'สถานะ/เหตุผล');
        $row = fillRow($q, $id);
        eq($row['phone'], '0811111111', 'เบอร์เดิม');
        eq($row['birth_date'], null, 'วันเกิดต้องยังว่าง');
    });
});

test('ค่าที่มีแต่ช่องว่างในฐาน ถือว่ายังว่าง เติมได้', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q, ['phone' => '   ']);
        $res = fillCall($id, ['phone' => '0812345678']);
        eq($res['filled'] ?? null, ['phone'], 'ช่องที่เติม');
        eq(fillRow($q, $id)['phone'], '0812345678', 'เบอร์โทร');
    });
});

test('ช่องที่ส่งมาเป็นค่าว่าง ถือว่าไม่ได้เติมช่องนั้น', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q);
        $res = fillCall($id, ['birth_date' => '', 'phone' => '0812345678', 'email' => '  ']);
        eq($res['filled'] ?? null, ['phone'], 'ช่องที่เติม');
        eq(fillRow($q, $id)['email'], null, 'อีเมลยังว่าง');
    });
});

test('ไม่มีอะไรให้เติม ตอบ 400', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q);
        $r = fillError($id, ['birth_date' => '', 'phone' => null]);
        eq([$r['status'], $r['reason']], [400, 'nothing_to_fill'], 'สถานะ/เหตุผล');
    });
});

test('ช่องนอกรายการ (ชื่อ หมายเหตุ) ส่งมาก็ไม่ถูกเขียน', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q, ['notes' => 'เดิม']);
        fillCall($id, ['first_name' => 'แก้ชื่อ', 'notes' => 'แก้หมายเหตุ', 'phone' => '0812345678']);
        $row = fillRow($q, $id);
        eq([$row['first_name'], $row['notes']], ['ทดสอบ', 'เดิม'], 'ชื่อ/หมายเหตุ');
    });
});

test('วันเกิดผิดรูปแบบ / ไม่มีวันนั้นจริง / อยู่ในอนาคต / อายุเกิน 120 ปี ตอบ 400', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q);
        foreach (['12/03/1981', '2024-02-30', '2524-03-12', '1880-01-01'] as $bad) {
            $r = fillError($id, ['birth_date' => $bad]);
            eq([$r['status'], $r['reason']], [400, 'bad_birth_date'], "วันเกิด $bad");
        }
        eq(fillRow($q, $id)['birth_date'], null, 'วันเกิดยังว่าง');
    });
});

test('เบอร์โทรมีตัวเลขไม่ถึง 9 หลัก ตอบ 400', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q);
        $r = fillError($id, ['phone' => '12-34']);
        eq([$r['status'], $r['reason']], [400, 'bad_phone'], 'สถานะ/เหตุผล');
    });
});

/* ความยาวตามคอลัมน์บน production (phone varchar(40), line_id varchar(80), email varchar(120))
   ยาวเกินแล้วปล่อยลงฐาน = 500 จาก MariaDB แทนที่จะเป็นข้อความที่คนกดอ่านรู้เรื่อง */
test('ยาวเกินช่องในฐาน — เบอร์เกิน 40 ตัว LINE เกิน 80 อีเมลเกิน 120 ตอบ 400', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q);
        $r = fillError($id, ['phone' => '0812345678' . str_repeat('-', 31)]);
        eq([$r['status'], $r['reason']], [400, 'bad_phone'], 'เบอร์ 41 ตัว');
        $r = fillError($id, ['line_id' => str_repeat('a', 81)]);
        eq([$r['status'], $r['reason']], [400, 'bad_line'], 'LINE 81 ตัว');
        $r = fillError($id, ['email' => str_repeat('a', 110) . '@example.com']);
        eq([$r['status'], $r['reason']], [400, 'bad_email'], 'อีเมล 122 ตัว');
        $row = fillRow($q, $id);
        eq([$row['phone'], $row['line_id'], $row['email']], [null, null, null], 'ไม่มีอะไรถูกเขียน');
    });
});

test('อีเมลผิดรูปแบบ ตอบ 400', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q);
        $r = fillError($id, ['email' => 'not-an-email']);
        eq([$r['status'], $r['reason']], [400, 'bad_email'], 'สถานะ/เหตุผล');
    });
});

test('เพศต้องเป็นค่าจากรายการของร้าน', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q);
        $r = fillError($id, ['sex' => 'ไม่มีในรายการ']);
        eq([$r['status'], $r['reason']], [400, 'bad_sex'], 'สถานะ/เหตุผล');
        $codes = Lookups::lists()['sex'] ?? [];
        if ($codes) {
            fillCall($id, ['sex' => $codes[0]]);
            eq(fillRow($q, $id)['sex'], $codes[0], 'เพศจากรายการ');
        }
    });
});

test('ลูกค้าไม่มีอยู่ ตอบ 404', function () {
    rollback(function (Tx $q) {
        $r = fillError(999999999, ['phone' => '0812345678']);
        eq($r['status'], 404, 'สถานะ');
    });
});

test('เติมจากหน้าเคส — ไทม์ไลน์ของเคสลง "เติมข้อมูลลูกค้า" พร้อมช่องที่เติม', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q);
        $case = fillCase($q, $id);
        fillCall($id, ['case_id' => $case, 'birth_date' => '1981-03-12', 'phone' => '0812345678']);
        $ev = $q->get('SELECT * FROM case_events WHERE case_id = ? ORDER BY id DESC LIMIT 1', $case);
        eq($ev['action'] ?? null, 'customer_filled', 'action');
        ok(str_contains((string) $ev['note'], 'วันเกิด') && str_contains((string) $ev['note'], 'เบอร์โทร'), "note: {$ev['note']}");
        $payload = json_decode((string) $ev['payload'], true);
        eq($payload['customer_id'] ?? null, $id, 'payload.customer_id');
        eq($payload['fields'] ?? null, ['birth_date' => '1981-03-12', 'phone' => '0812345678'], 'payload.fields');
    });
});

test('case_id เป็นเคสของลูกค้าคนอื่น ตอบ 400 และไม่แก้ลูกค้า', function () {
    rollback(function (Tx $q) {
        $id = fillCustomer($q);
        $other = fillCustomer($q);
        $case = fillCase($q, $other);
        $r = fillError($id, ['case_id' => $case, 'phone' => '0812345678']);
        eq([$r['status'], $r['reason']], [400, 'case_mismatch'], 'สถานะ/เหตุผล');
        eq(fillRow($q, $id)['phone'], null, 'เบอร์ยังว่าง');
    });
});
