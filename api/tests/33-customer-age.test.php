<?php

declare(strict_types=1);

/**
 * อายุที่ลูกค้าบอกมา — customers.age_years / age_recorded_on
 *
 * ร้านขอ 16 ก.ย. 2026: ลูกค้าบางรายบอกมาแค่อายุ ไม่ทราบหรือไม่บอกวันเกิด แต่ขั้นวัดสายตา
 * ต้องใช้อายุคิดค่า ADD · จึงต้องจดอายุได้ตรง ๆ ไม่ใช่เดาวันเกิดขึ้นมาแทน
 *
 * สองกติกาที่เทสต์ทั้งไฟล์นี้ยืนอยู่บนมัน:
 *
 *   1. วันเกิดชนะเสมอ — มีวันเกิดเมื่อไหร่ age_years ต้องถูกล้าง ไม่ใช่นอนคู่กัน
 *      ค่าที่ไม่มีใครอ่านแต่ยังอยู่ในฐาน คือค่าที่วันหนึ่งจะมีคนอ่านแล้วได้เลขผิด
 *   2. age_recorded_on ขยับเฉพาะตอนตัวเลขอายุเปลี่ยน — ถ้าขยับทุกครั้งที่กดบันทึก
 *      อายุจะไม่มีวันโตขึ้นเลย เพราะฐานนับหนึ่งใหม่ทุกครั้งที่มีคนเปิดหน้าแก้ไข
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('อายุลูกค้าที่บอกมาโดยไม่มีวันเกิด');

/** คนหน้าร้านตัวจริงจากฐาน — เส้นลูกค้าเดินผ่านด่านสิทธิ์เหมือนของจริง */
function ageActor(): array
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

function ageCall(string $method, string $path, array $body): mixed
{
    StockModule::boot();
    return \Optic\Auth::as(ageActor(), fn() => Router::dispatch($method, $path, [], $body));
}

/** @return array{status:?int, reason:?string, msg:string} */
function ageError(string $method, string $path, array $body): array
{
    try {
        ageCall($method, $path, $body);
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null, 'msg' => $e->getMessage()];
    }
    return ['status' => null, 'reason' => null, 'msg' => ''];
}

function ageRow(Tx $q, int $id): array
{
    return $q->get('SELECT * FROM customers WHERE id = ?', $id);
}

/** ลูกค้าหนึ่งคนที่ใส่เองตรง ๆ — คอลัมน์ที่ไม่ส่งมาเป็น NULL */
function ageCustomer(Tx $q, array $cols = []): int
{
    $cols += ['first_name' => 'ทดสอบ', 'last_name' => 'อายุ'];
    $keys = array_keys($cols);
    return (int) $q->run(
        'INSERT INTO customers (' . implode(',', $keys) . ') VALUES (' . implode(',', array_fill(0, count($keys), '?')) . ')',
        ...array_values($cols)
    )['insertId'];
}

/** ตัวลูกค้าที่ POST /api/customers ต้องการอย่างน้อย */
const AGE_BASE = ['first_name' => 'ทดสอบ', 'last_name' => 'อายุใหม่'];

test('เปิดลูกค้าใหม่ด้วยอายุอย่างเดียว — เก็บอายุพร้อมวันที่ถาม วันเกิดยังว่าง', function () {
    rollback(function (Tx $q) {
        $c = ageCall('POST', '/api/customers', AGE_BASE + ['age_years' => '45']);
        $row = ageRow($q, (int) $c['id']);
        eq((int) $row['age_years'], 45, 'อายุ');
        eq(substr((string) $row['age_recorded_on'], 0, 10), today(), 'วันที่ถาม = วันนี้');
        eq($row['birth_date'], null, 'ไม่เดาวันเกิดให้');
    });
});

test('อายุ 0 คือค่าที่ใช้ได้ ไม่ใช่ช่องว่าง', function () {
    rollback(function (Tx $q) {
        $c = ageCall('POST', '/api/customers', AGE_BASE + ['age_years' => '0']);
        $row = ageRow($q, (int) $c['id']);
        eq((int) $row['age_years'], 0, 'อายุ');
        eq(substr((string) $row['age_recorded_on'], 0, 10), today(), 'วันที่ถาม');
    });
});

test('กรอกมาทั้งวันเกิดและอายุ — วันเกิดชนะ อายุไม่ถูกเก็บ', function () {
    rollback(function (Tx $q) {
        $c = ageCall('POST', '/api/customers', AGE_BASE + ['birth_date' => '1981-03-12', 'age_years' => '12']);
        $row = ageRow($q, (int) $c['id']);
        eq(substr((string) $row['birth_date'], 0, 10), '1981-03-12', 'วันเกิด');
        eq([$row['age_years'], $row['age_recorded_on']], [null, null], 'อายุต้องว่าง');
    });
});

test('อายุที่ไม่ใช่ตัวเลข / เกิน 120 ตอบ 400 ไม่ใช่เงียบ ๆ ทิ้งค่า', function () {
    rollback(function () {
        foreach (['121', '-3', 'สี่สิบห้า', '45.5', '1e2'] as $bad) {
            $r = ageError('POST', '/api/customers', AGE_BASE + ['age_years' => $bad]);
            eq([$r['status'], $r['reason']], [400, 'bad_age'], "อายุ $bad");
        }
    });
});

test('แก้อายุเป็นเลขใหม่ — วันที่ถามขยับมาเป็นวันนี้', function () {
    rollback(function (Tx $q) {
        $id = ageCustomer($q, ['age_years' => 45, 'age_recorded_on' => '2023-01-01']);
        ageCall('PUT', "/api/customers/$id", AGE_BASE + ['age_years' => '48']);
        $row = ageRow($q, $id);
        eq((int) $row['age_years'], 48, 'อายุใหม่');
        eq(substr((string) $row['age_recorded_on'], 0, 10), today(), 'วันที่ถามขยับ');
    });
});

test('กดบันทึกโดยไม่แตะตัวเลขอายุ — วันที่ถามต้องอยู่ที่เดิม', function () {
    rollback(function (Tx $q) {
        $id = ageCustomer($q, ['age_years' => 45, 'age_recorded_on' => '2023-01-01']);
        ageCall('PUT', "/api/customers/$id", AGE_BASE + ['age_years' => '45', 'phone' => '0812345678']);
        $row = ageRow($q, $id);
        eq((int) $row['age_years'], 45, 'อายุเดิม');
        eq(substr((string) $row['age_recorded_on'], 0, 10), '2023-01-01', 'วันที่ถามไม่ขยับ');
        eq($row['phone'], '0812345678', 'ช่องอื่นยังบันทึกได้ตามปกติ');
    });
});

test('ใส่วันเกิดให้ลูกค้าที่เคยมีแต่อายุ — อายุถูกล้างทิ้ง', function () {
    rollback(function (Tx $q) {
        $id = ageCustomer($q, ['age_years' => 45, 'age_recorded_on' => '2023-01-01']);
        ageCall('PUT', "/api/customers/$id", AGE_BASE + ['birth_date' => '1981-03-12', 'age_years' => '45']);
        $row = ageRow($q, $id);
        eq(substr((string) $row['birth_date'], 0, 10), '1981-03-12', 'วันเกิด');
        eq([$row['age_years'], $row['age_recorded_on']], [null, null], 'อายุถูกล้าง');
    });
});

test('ลบอายุออก — ทั้งตัวเลขและวันที่ถามหายไปพร้อมกัน', function () {
    rollback(function (Tx $q) {
        $id = ageCustomer($q, ['age_years' => 45, 'age_recorded_on' => '2023-01-01']);
        ageCall('PUT', "/api/customers/$id", AGE_BASE + ['age_years' => '']);
        eq(array_map(fn($v) => $v, [ageRow($q, $id)['age_years'], ageRow($q, $id)['age_recorded_on']]), [null, null], 'ว่างทั้งคู่');
    });
});

test('เติมข้อมูลลูกค้าจากหน้าเคส: กรอกอายุได้ และได้วันที่ถามติดมาด้วย', function () {
    rollback(function (Tx $q) {
        $id = ageCustomer($q);
        $res = ageCall('POST', "/api/customers/$id/fill", ['age_years' => '45']);
        eq($res['filled'] ?? null, ['age_years'], 'ช่องที่เติม');
        $row = ageRow($q, $id);
        eq((int) $row['age_years'], 45, 'อายุ');
        eq(substr((string) $row['age_recorded_on'], 0, 10), today(), 'วันที่ถาม');
    });
});

test('เติมอายุให้ลูกค้าที่มีวันเกิดอยู่แล้ว ตอบ 409 — ไม่ให้ฐานมีสองคำตอบ', function () {
    rollback(function (Tx $q) {
        $id = ageCustomer($q, ['birth_date' => '1981-03-12']);
        $r = ageError('POST', "/api/customers/$id/fill", ['age_years' => '45']);
        eq([$r['status'], $r['reason']], [409, 'already_filled'], 'สถานะ/เหตุผล');
        eq(ageRow($q, $id)['age_years'], null, 'อายุยังว่าง');
    });
});

test('เติมอายุผิดรูปแบบ ตอบ 400 ด้วยข้อความเดียวกับหน้าแก้ไขลูกค้า', function () {
    rollback(function (Tx $q) {
        $id = ageCustomer($q);
        $r = ageError('POST', "/api/customers/$id/fill", ['age_years' => '999']);
        eq([$r['status'], $r['reason']], [400, 'bad_age'], 'สถานะ/เหตุผล');
    });
});

test('Lions กลับเข้าช่อง "รู้จักเราจากช่องทางไหน" และยังเป็นป้ายเดียวกับของเก่าในฐาน', function () {
    $codes = array_map(fn($o) => $o[0], Lookups::lists()['referral_source']);
    ok(in_array('lions', $codes, true), 'มี lions ในตัวเลือก');
    /* ของเก่าเก็บเป็น "Lions" ตัวใหญ่ · รายงานช่องทางจัดกลุ่มตามป้าย ถ้าป้ายไม่ตรงกัน
       เจ้าของร้านจะเห็นไลออนส์เป็นสองแท่งแล้วอ่านสัดส่วนผิด */
    eq(SalesReport::referralLabel('lions'), 'Lions', 'ป้ายของโค้ดใหม่');
    eq(SalesReport::referralLabel('Lions'), 'Lions', 'ป้ายของค่าเก่าในฐาน');
});

test('ติ๊ก Lions แล้วเคสเข้าสมุด SightFirst เอง เมื่อไม่ได้เลือกประเภทลูกค้ามา', function () {
    eq(CaseSource::detect(null, 'lions')['sourceType'], CaseSource::SIGHT_FIRST, 'โค้ดใหม่');
    eq(CaseSource::detect(null, 'Lions')['sourceType'], CaseSource::SIGHT_FIRST, 'ค่าเก่าในฐาน');
});
