<?php

declare(strict_types=1);

group('ส่งมอบต้องมีหลักฐาน');
/**
 * ส่งมอบต้องมีหลักฐานครบ (ร้านขอ 10 พ.ย. 2026)
 *   รูปหน้าวัดสายตา (หัวข้อ 6) · รูปการวัดหน้า PD · PD ขวา/ซ้าย
 *   เลนส์ Progressive / Bi-focal / Degressive ต้องกรอกหน้า PD ครบทุกช่อง
 *   ยกเว้นเคส OLD- · งานซ่อม/ปรับแว่น · เคสที่ส่งมอบแล้ว
 */

function evFixtures(Tx $q, array $opt = []): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "หลักฐาน-$tag")['insertId'];
    $code = ($opt['code'] ?? 'TEST-EV-') . $tag;
    $case = (int) $q->run('INSERT INTO cases (case_code, customer_id, case_type) VALUES (?, ?, ?)', $code, $cust, $opt['type'] ?? 'ตัดแว่นใหม่')['insertId'];
    $q->run('INSERT INTO custom_orders (customer_id, case_id, order_date, total_price, discount, deposit) VALUES (?, ?, NOW(), 1000, 0, 0)', $cust, $case);
    if (isset($opt['test_for'])) {
        $q->run("INSERT INTO prescriptions (case_id, customer_id, kind, test_for) VALUES (?, ?, 'final', ?)", $case, $cust, $opt['test_for']);
    }
    if (!empty($opt['photos'])) {
        foreach (['exam', 'centering'] as $k) {
            $q->run("INSERT INTO case_photos (case_id, kind, file_name) VALUES (?, ?, 'x.jpg')", $case, $k);
        }
    }
    if (!empty($opt['pd'])) {
        $q->run('INSERT INTO centerings (case_id, r_pd, l_pd, pd_total) VALUES (?, 31, 31, 62)', $case);
    }
    if (!empty($opt['full'])) {
        $q->run("UPDATE centerings SET r_height = 18, l_height = 18, corridor = '14', vertex_distance = 12, pantoscopic_tilt = 8 WHERE case_id = ?", $case);
        $q->run('INSERT INTO frame_fittings (case_id, frame_box_a, frame_box_b, dbl, ed) VALUES (?, 52, 30, 18, 58)', $case);
    }
    return ['case' => $case];
}

$evGaps = fn(int $case) => deliveryEvidenceMissing(caseDetail($case));

test('ไม่มีรูปและ PD — ส่งมอบไม่ได้ บอกครบทุกข้อ', function () use ($evGaps) {
    rollback(function (Tx $q) use ($evGaps) {
        $g = $evGaps(evFixtures($q)['case']);
        eq($g, ['รูปภาพหน้าวัดสายตา (หัวข้อ 6)', 'รูปภาพการวัด (หน้า PD)', 'PD ขวา/ซ้าย'], 'gaps');
        ok(count(processBlocking(caseDetail(evFixtures($q)['case']))['delivery']) === 3, 'processBlocking ส่งต่อ');
    });
});

test('เลนส์ชั้นเดียว: รูปครบ + PD ครบ = ผ่าน ไม่ต้องกรอก FH/FRAME BOX', function () use ($evGaps) {
    rollback(function (Tx $q) use ($evGaps) {
        eq($evGaps(evFixtures($q, ['photos' => 1, 'pd' => 1, 'test_for' => 'Distance'])['case']), [], 'gaps');
    });
});

test('Progressive: ขาดค่าหน้า PD — บอกช่องที่ขาด · กรอกครบแล้วผ่าน', function () use ($evGaps) {
    rollback(function (Tx $q) use ($evGaps) {
        $g = $evGaps(evFixtures($q, ['photos' => 1, 'pd' => 1, 'test_for' => 'Progressive'])['case']);
        eq($g, ['ค่าหน้า PD ของเลนส์ Progressive: FH ขวา FH ซ้าย Cor. A B DBL ED CVD Panto'], 'gaps');
        eq($evGaps(evFixtures($q, ['photos' => 1, 'pd' => 1, 'full' => 1, 'test_for' => 'Bi-focal'])['case']), [], 'ครบ');
    });
});

test('ยกเว้น: เคส OLD- และงานซ่อม/ปรับแว่น · เคสที่เปิดก่อน 10 พ.ย. ไม่ยกเว้น', function () use ($evGaps) {
    rollback(function (Tx $q) use ($evGaps) {
        eq($evGaps(evFixtures($q, ['code' => 'OLD-T'])['case']), [], 'OLD');
        eq($evGaps(evFixtures($q, ['type' => 'ซ่อม/ปรับแว่น'])['case']), [], 'ซ่อม');
        $old = evFixtures($q)['case'];
        $q->run("UPDATE cases SET created_at = '2026-11-09 23:59:59' WHERE id = ?", $old);
        eq(count($evGaps($old)), 3, 'เปิดก่อน 10 พ.ย. ก็ต้องมีหลักฐาน');
    });
});

test('API: ยืนยันขั้นส่งมอบโดยหลักฐานไม่ครบ = 400', function () {
    rollback(function (Tx $q) {
        $f = evFixtures($q, ['photos' => 1, 'pd' => 1, 'test_for' => 'Degressive']);
        $q->run('INSERT INTO case_deliveries (case_id, delivered_at) VALUES (?, NOW())', $f['case']);
        StockModule::boot();
        $r = Db::get("SELECT a.id, a.username, a.display_name, a.employee_id FROM admins a
            JOIN admin_roles r ON r.admin_id = a.id WHERE r.role = 'owner' AND a.is_active = 1 LIMIT 1");
        $roles = \Optic\Auth::rolesOf((int) $r['id']);
        $owner = ['id' => (int) $r['id'], 'username' => $r['username'], 'displayName' => $r['display_name'],
            'roles' => $roles, 'perms' => \Optic\Roles::permsOf($roles), 'employeeId' => null];
        $status = null;
        try {
            \Optic\Auth::as($owner, fn() => Router::dispatch('POST', "/api/cases/{$f['case']}/processes/delivery/complete", [], []));
        } catch (HttpError $e) {
            $status = $e->status;
        }
        eq($status, 400, 'status');
    });
});

/** เดินทางเดียวกับพนักงาน: ขาดหลักฐาน → ติด · ไม่เลือกคนเจีย → ติด · ครบ → ส่งมอบได้ เคสปิด บิลปิด */
test('ทางเดินจริง: Progressive เคสเก่า — ขาดอะไรติดตรงนั้น ครบแล้วส่งมอบได้', function () {
    rollback(function (Tx $q) {
        StockModule::boot();
        $r = Db::get("SELECT a.id, a.username, a.display_name FROM admins a
            JOIN admin_roles r ON r.admin_id = a.id WHERE r.role = 'owner' AND a.is_active = 1 LIMIT 1");
        $roles = \Optic\Auth::rolesOf((int) $r['id']);
        $owner = ['id' => (int) $r['id'], 'username' => $r['username'], 'displayName' => $r['display_name'],
            'roles' => $roles, 'perms' => \Optic\Roles::permsOf($roles), 'employeeId' => null];
        $call = fn(string $m, string $p, array $b = []) => \Optic\Auth::as($owner, fn() => Router::dispatch($m, $p, [], $b));
        $err = function (string $m, string $p, array $b = []) use ($call) {
            try { $call($m, $p, $b); } catch (HttpError $e) { return $e->getMessage(); }
            return null;
        };
        $f = evFixtures($q, ['test_for' => 'Progressive']);
        $case = $f['case'];
        $q->run("UPDATE cases SET created_at = '2026-10-01 10:00:00' WHERE id = ?", $case);
        $emp = (int) $q->run('INSERT INTO employees (employee_name, active) VALUES (?, 1)', 'ช่างเจีย-' . $case)['insertId'];
        $order = (int) Db::get('SELECT id FROM custom_orders WHERE case_id = ?', $case)['id'];
        $dlv = ['case_id' => $case, 'order_id' => $order, 'handed_over_by' => $emp, 'employee_id' => $emp, 'delivered_at' => date('Y-m-d H:i')];
        $complete = "/api/cases/$case/processes/delivery/complete";

        $withGrinder = $dlv + ['grinder_employee_id' => $emp];
        $m = (string) $err('POST', '/api/case-deliveries', $withGrinder);
        ok(str_contains($m, 'รูปภาพหน้าวัดสายตา') && str_contains($m, 'PD ขวา/ซ้าย'), 'ยังไม่มีอะไรเลย: ' . $m);
        ok(!Db::get('SELECT 1 FROM case_deliveries WHERE case_id = ?', $case), 'ไม่มีแถวส่งมอบค้าง');

        foreach (['exam', 'centering'] as $k) {
            $q->run("INSERT INTO case_photos (case_id, kind, file_name) VALUES (?, ?, 'x.jpg')", $case, $k);
        }
        $q->run('INSERT INTO centerings (case_id, r_pd, l_pd, pd_total) VALUES (?, 31, 31, 62)', $case);
        $m = (string) $err('POST', '/api/case-deliveries', $withGrinder);
        ok(str_contains($m, 'ค่าหน้า PD ของเลนส์ Progressive') && !str_contains($m, 'รูปภาพ'), 'รูป+PD แล้ว เหลือค่าหน้า PD: ' . $m);

        $q->run("UPDATE centerings SET r_height = 18, l_height = 18, corridor = '14', vertex_distance = 12, pantoscopic_tilt = 8 WHERE case_id = ?", $case);
        $q->run('INSERT INTO frame_fittings (case_id, frame_box_a, frame_box_b, dbl, ed) VALUES (?, 52, 30, 18, 58)', $case);
        eq($err('POST', '/api/case-deliveries', $dlv), 'กรุณาเลือกคนเจีย', 'ไม่เลือกคนเจีย');

        $call('POST', '/api/case-deliveries', $dlv + ['grinder_employee_id' => $emp]);
        $call('POST', $complete);
        $c = Db::get('SELECT c.status, s.is_terminal FROM cases c JOIN case_statuses s ON s.code = c.status WHERE c.id = ?', $case);
        eq((int) $c['is_terminal'], 1, 'เคสปิดแล้ว (' . $c['status'] . ')');
        eq((int) Db::get('SELECT order_closed FROM custom_orders WHERE id = ?', $order)['order_closed'], 1, 'บิลปิดแล้ว');
        eq((int) Db::get('SELECT grinder_employee_id FROM case_deliveries WHERE case_id = ?', $case)['grinder_employee_id'], $emp, 'บันทึกคนเจีย');
    });
});
