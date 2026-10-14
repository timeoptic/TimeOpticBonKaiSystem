<?php

declare(strict_types=1);

/**
 * Prescription Safety Alert — API บันทึก Clinical Review + ตั้งค่าเกณฑ์
 *
 * ยิงเส้นทางตัวจริงผ่าน Router::dispatch() · ของทดสอบทุกชิ้นอยู่ในทรานแซกชันที่ roll back
 * เสมอ จึงไม่มีค่าสายตาสมมติค้างในข้อมูลลูกค้าจริง
 * spec: docs/superpowers/specs/2026-10-14-rx-safety-alert-design.md ข้อ 7, 10.2
 */

require_once __DIR__ . '/../services/RxSafety.php';
require_once __DIR__ . '/../routes/rx-safety.php';

group('Rx Safety — API');

RxSafetyStore::ensure();

function rxaActor(): array
{
    StockModule::boot();
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

function rxaCall(string $method, string $path, array $body = []): mixed
{
    StockModule::boot(); // โหลดคลาส \Optic\Auth ก่อนอ้างถึง
    return \Optic\Auth::as(rxaActor(), fn() => Router::dispatch($method, $path, [], $body));
}

/** @return array{status:?int, reason:?string} */
function rxaError(callable $fn): array
{
    try {
        $fn();
    } catch (HttpError $e) {
        return ['status' => $e->status, 'reason' => $e->payload['reason'] ?? null];
    }
    return ['status' => null, 'reason' => null];
}

/**
 * ลูกค้า + เคส + ใบ old / measured / final (final ยืนยันแล้ว)
 * @param ?array $old  [r_sphere => …] ของแถว kind='old' — null = ไม่มีแถว old
 * @param array  $measuredExtra คอลัมน์เพิ่มของแถว measured (เช่น old_r_sphere แบบเก่า)
 */
function rxaFixtures(Tx $q, ?array $old, array $final, array $measuredExtra = []): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "RxSafety-$tag")['insertId'];
    $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-RXS-$tag", $cust)['insertId'];
    $ins  = function (string $kind, array $cols) use ($q, $case, $cust): int {
        $cols = array_merge(['case_id' => $case, 'customer_id' => $cust, 'kind' => $kind, 'test_date' => date('Y-m-d H:i:s')], $cols);
        $names = implode(',', array_keys($cols));
        $marks = implode(',', array_fill(0, count($cols), '?'));
        return (int) $q->run("INSERT INTO prescriptions ($names) VALUES ($marks)", ...array_values($cols))['insertId'];
    };
    $measured = $ins('measured', array_merge(['r_sphere' => '-3.00', 'l_sphere' => '-2.00'], $measuredExtra));
    $oldId    = $old === null ? null : $ins('old', $old);
    $finalId  = $ins('final', array_merge(['test_for' => 'Distance', 'r_va' => '1.0', 'l_va' => '1.0', 'confirmed_at' => date('Y-m-d H:i:s')], $final));
    return ['case' => $case, 'final' => $finalId, 'old' => $oldId, 'measured' => $measured];
}

const RXA_OLD = ['r_sphere' => '-2.00', 'l_sphere' => '-2.00'];

function rxaCount(Tx $q, int $case): int
{
    return (int) $q->get('SELECT COUNT(*) n FROM rx_reviews WHERE case_id = ?', $case)['n'];
}

test('ไม่มี CRITICAL → {review: null} และไม่เพิ่มแถว', function () {
    rollback(function (Tx $q) {
        $f   = rxaFixtures($q, RXA_OLD, ['r_sphere' => '-2.25', 'l_sphere' => '-2.00']);
        $out = rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final'], 'reason' => 'x']);
        eq($out['review'], null, 'review');
        eq(rxaCount($q, $f['case']), 0, 'จำนวนแถว');
    });
});

test('CRITICAL ไม่มีเหตุผล / เหตุผลเป็นช่องว่าง → 422 review_reason_required', function () {
    rollback(function (Tx $q) {
        $f = rxaFixtures($q, RXA_OLD, ['r_sphere' => '-4.00', 'l_sphere' => '-2.00']);
        foreach ([[], ['reason' => '   ']] as $extra) {
            $err = rxaError(fn() => rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final']] + $extra));
            eq([$err['status'], $err['reason']], [422, 'review_reason_required'], 'ด่าน ' . render($extra));
        }
        eq(rxaCount($q, $f['case']), 0, 'ไม่มีแถว');
    });
});

test('มีเหตุผล → บันทึกครบ: เวอร์ชันเกณฑ์ · ค่า 3 ชุด · alerts · ผู้ยืนยัน · timeline', function () {
    rollback(function (Tx $q) {
        $f   = rxaFixtures($q, RXA_OLD, ['r_sphere' => '-4.00', 'l_sphere' => '-2.00']);
        $out = rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final'], 'reason' => 'ลูกค้าเห็นชัดขึ้น VA 1.0']);
        $rv  = $out['review'];
        eq($rv['rule_version'], RxSafetyStore::current()['version'], 'rule_version');
        eq($rv['max_severity'], 'critical', 'max_severity');
        eq($rv['reason'], 'ลูกค้าเห็นชัดขึ้น VA 1.0', 'reason');
        ok(($rv['reviewed_by_name'] ?? '') !== '', 'มีชื่อผู้ยืนยัน');
        eq($rv['final_rx']['r']['sphere'], '-4.00', 'สำเนา final');
        eq($rv['old_rx']['r']['sphere'], '-2.00', 'สำเนา old');
        eq($rv['measured_rx']['r']['sphere'], '-3.00', 'สำเนา measured');
        $crit = array_values(array_filter($rv['alerts'], fn($a) => $a['level'] === 'critical' && $a['field'] === 'sphere'));
        /* ผ่าน JSON มาแล้ว -2.0 อาจกลายเป็น -2 — เทียบเป็นตัวเลข */
        eq([$crit[0]['eye'], (float) $crit[0]['old'], (float) $crit[0]['final'], (float) $crit[0]['delta']], ['r', -2.0, -4.0, -2.0], 'ค่าที่ทำให้เตือน');
        $ev = $q->get("SELECT note FROM case_events WHERE case_id = ? AND action = 'rx_review_confirmed'", $f['case']);
        ok($ev && str_contains((string) $ev['note'], 'ลูกค้าเห็นชัดขึ้น'), 'timeline มีเหตุผล');
    });
});

test('ยืนยันซ้ำค่าเดิมไม่มีเหตุผล → คืนแถวเดิม ไม่เพิ่มแถว (spec 16)', function () {
    rollback(function (Tx $q) {
        $f  = rxaFixtures($q, RXA_OLD, ['r_sphere' => '-4.00', 'l_sphere' => '-2.00']);
        $a  = rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final'], 'reason' => 'ตรวจแล้ว']);
        $b  = rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final']]);
        eq($b['review']['id'], $a['review']['id'], 'แถวเดิม');
        eq(rxaCount($q, $f['case']), 1, 'ยังแถวเดียว');
        $list = rxaCall('GET', "/api/cases/{$f['case']}/rx-reviews");
        eq(count($list), 1, 'GET คืน 1 แถว');
        eq($list[0]['fingerprint'], $a['review']['fingerprint'], 'fingerprint ตรง');
    });
});

test('แก้ Final หลังทบทวน → ต้องทบทวนใหม่ · แถวเก่ายังอยู่ (spec 11)', function () {
    rollback(function (Tx $q) {
        $f = rxaFixtures($q, RXA_OLD, ['r_sphere' => '-4.00', 'l_sphere' => '-2.00']);
        rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final'], 'reason' => 'ตรวจแล้ว']);
        $q->run("UPDATE prescriptions SET r_sphere = '-4.25' WHERE id = ?", $f['final']);
        $err = rxaError(fn() => rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final']]));
        eq($err['reason'], 'review_reason_required', 'ต้องใส่เหตุผลใหม่');
        rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final'], 'reason' => 'ปรับเพิ่มอีก 0.25']);
        eq(rxaCount($q, $f['case']), 2, 'เก็บทั้งสองครั้ง');
    });
});

test('เปลี่ยนเกณฑ์ → review เดิมยังชี้เวอร์ชันเดิม (spec 15)', function () {
    rollback(function (Tx $q) {
        $f  = rxaFixtures($q, RXA_OLD, ['r_sphere' => '-4.00', 'l_sphere' => '-2.00']);
        $a  = rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final'], 'reason' => 'ตรวจแล้ว']);
        $rules = RxSafetyStore::current()['rules'];
        $rules['sph']['critical'] = 3.0;
        $saved = rxaCall('PUT', '/api/settings/rx-alert-rules', ['rules' => $rules, 'note' => 'ทดสอบ']);
        ok($saved['version'] > $a['review']['rule_version'], 'เวอร์ชันใหม่');
        $list = rxaCall('GET', "/api/cases/{$f['case']}/rx-reviews");
        eq($list[0]['rule_version'], $a['review']['rule_version'], 'review เดิมคงเวอร์ชันเดิม');
    });
});

test('แว่นเดิมแบบเก่า (old_* บนแถว measured) → ใช้เทียบได้', function () {
    rollback(function (Tx $q) {
        $f = rxaFixtures($q, null, ['r_sphere' => '-4.00', 'l_sphere' => '-2.00'], ['old_r_sphere' => '-2.00', 'old_l_sphere' => '-2.00']);
        $err = rxaError(fn() => rxaCall('POST', "/api/cases/{$f['case']}/rx-reviews", ['prescription_id' => $f['final']]));
        eq($err['reason'], 'review_reason_required', 'เห็น CRITICAL จากแว่นเดิมแบบเก่า');
    });
});

test('ใบค่าสายตาของเคสอื่น → 404', function () {
    rollback(function (Tx $q) {
        $a = rxaFixtures($q, RXA_OLD, ['r_sphere' => '-4.00', 'l_sphere' => '-2.00']);
        $b = rxaFixtures($q, RXA_OLD, ['r_sphere' => '-4.00', 'l_sphere' => '-2.00']);
        $err = rxaError(fn() => rxaCall('POST', "/api/cases/{$a['case']}/rx-reviews", ['prescription_id' => $b['final'], 'reason' => 'x']));
        eq($err['status'], 404, 'status');
    });
});

test('GET เกณฑ์: version · rules · defaults · history', function () {
    $out = rxaCall('GET', '/api/settings/rx-alert-rules');
    ok($out['version'] >= 1, 'version');
    eq($out['defaults']['sph']['warn'], 0.75, 'defaults');
    ok(count($out['history']) >= 1, 'history');
});

test('PUT เกณฑ์ผิดรูป → 422 rules_invalid', function () {
    rollback(function () {
        $rules = RxSafetyStore::current()['rules'];
        $rules['add']['critical'] = 0.25;
        $err = rxaError(fn() => rxaCall('PUT', '/api/settings/rx-alert-rules', ['rules' => $rules]));
        eq([$err['status'], $err['reason']], [422, 'rules_invalid'], 'ด่าน');
    });
});
