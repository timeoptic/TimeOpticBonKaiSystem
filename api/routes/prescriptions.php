<?php
/**
 * Eye-test results.
 *
 * The value columns are VARCHAR in the Access-derived schema — they may hold
 * '-1.25', '+2.00', 'plano' or ''. Nothing is coerced to a number here; the
 * front-end formats them.
 */
declare(strict_types=1);

const RX_VALUE_COLS = [
    'r_sphere', 'r_cylinder', 'r_axis', 'r_add', 'r_pd', 'r_va', 'r_prism', 'r_base',
    'l_sphere', 'l_cylinder', 'l_axis', 'l_add', 'l_pd', 'l_va', 'l_prism', 'l_base',
    'pd_total',
    'bin_r_sphere', 'bin_r_add', 'bin_r_va', 'bin_r_pd',
    'bin_l_sphere', 'bin_l_add', 'bin_l_va', 'bin_l_pd',
    'dist_vertical_r', 'dist_vertical_l', 'dist_monitor_r', 'dist_monitor_l',
    /* VA ตาเปล่า และค่าแว่นเดิม — คอลัมน์มีมาตั้งแต่แอปเดิม แต่ตอน port มา PHP
       ตกหล่นไป ทำให้บันทึกไม่ลง */
    'va_naked_r', 'va_naked_l',
    'old_r_sphere', 'old_r_cylinder', 'old_r_axis', 'old_r_add', 'old_r_va', 'old_r_pd',
    'old_l_sphere', 'old_l_cylinder', 'old_l_axis', 'old_l_add', 'old_l_va', 'old_l_pd',
];

const RX_HEALTH = ['health_cataract', 'health_eye_surgery', 'health_diabetes',
    'health_bp', 'health_heart', 'health_eye_disease', 'health_drug_allergy',
    'health_medication'];

const RX_BASE = 'SELECT p.*, c.first_name, c.last_name, c.phone, e.employee_name
                   FROM prescriptions p
                   JOIN customers c      ON c.id = p.customer_id
                   LEFT JOIN employees e ON e.id = p.performed_by';

GET('/api/prescriptions', function (array $req) {
    $q     = $req['query'];
    $base  = RX_BASE;
    $cid   = int_or($q['customer_id'] ?? null);
    $term  = str_or($q['q'] ?? null);
    $limit = min(int_or($q['limit'] ?? null, 200), 1000);

    if ($cid) {
        return Db::all("$base WHERE p.customer_id = ? ORDER BY p.test_date DESC", $cid);
    }
    if ($term !== '') {
        $p = like($term);
        return Db::all(
            "$base
              WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?
                 OR CAST(p.id AS CHAR) = ?
              ORDER BY p.test_date DESC LIMIT ?",
            $p, $p, $p, $term, $limit
        );
    }
    return Db::all("$base ORDER BY p.test_date DESC, p.id DESC LIMIT ?", $limit);
});

GET('/api/prescriptions/:id', function (array $req) {
    $r = Db::get(
        'SELECT p.*, c.first_name, c.last_name, c.phone, c.sex, c.nationality,
                e.employee_name
           FROM prescriptions p
           JOIN customers c      ON c.id = p.customer_id
           LEFT JOIN employees e ON e.id = p.performed_by
          WHERE p.id = ?',
        int_or($req['params']['id'])
    );
    if (!$r) {
        missing();
    }
    return $r;
});

/** @return array{cols: string[], vals: array} */
function rxColsValues(array $b): array
{
    $cols = array_merge(
        ['case_id', 'customer_id', 'kind', 'source', 'based_on_id', 'adjust_reason',
            'test_date', 'test_for', 'dominant_eye'],
        RX_VALUE_COLS,
        ['old_glasses_type', 'external_place', 'external_date'],
        RX_HEALTH,
        ['health_note', 'known_from', 'exam_note', 'notes', 'performed_by', 'recorded_by']
    );

    $intCols = ['case_id', 'customer_id', 'based_on_id', 'performed_by', 'recorded_by'];
    $vals = [];
    foreach ($cols as $c) {
        if (in_array($c, $intCols, true)) {
            $vals[] = int_or($b[$c] ?? null);
        } elseif ($c === 'kind') {
            $k = str_or($b['kind'] ?? null);
            $vals[] = in_array($k, ['old', 'measured', 'final'], true) ? $k : 'measured';
        } elseif ($c === 'test_date') {
            $vals[] = str_or($b['test_date'] ?? null) ?: nowStamp();
        } elseif ($c === 'dominant_eye') {
            /* ตาหลัก/ตารอง มีได้สามคำตอบเท่านั้น อะไรที่ไม่ใช่ = ยังไม่ได้ระบุ (NULL)
               ปล่อยข้อความอิสระลงช่องนี้ไม่ได้ ใบพิมพ์อ่านค่านี้ไปตัดสินว่าจะติดป้ายข้างไหน */
            $d = strtolower(str_or($b['dominant_eye'] ?? null));
            $vals[] = in_array($d, ['r', 'l', 'both'], true) ? $d : null;
        } elseif (in_array($c, RX_HEALTH, true)) {
            $vals[] = boolInt($b[$c] ?? null);
        } else {
            $vals[] = nul($b[$c] ?? null);
        }
    }
    return ['cols' => $cols, 'vals' => $vals];
}

POST('/api/prescriptions', function (array $req) {
    $body = $req['body'];
    if (!int_or($body['customer_id'] ?? null)) {
        bad('กรุณาเลือกลูกค้า');
    }
    ['cols' => $cols, 'vals' => $vals] = rxColsValues($body);

    $id = Db::tx(function (Tx $q) use ($cols, $vals, $body) {
        $names = implode(',', $cols);
        $marks = implode(',', array_fill(0, count($cols), '?'));
        $res = $q->run("INSERT INTO prescriptions ($names) VALUES ($marks)", ...$vals);
        $kindIdx = array_search('kind', $cols, true);
        logEvent($q, int_or($body['case_id'] ?? null), [
            'action'      => 'prescription_added',
            'entity'      => 'prescription',
            'entity_id'   => $res['insertId'],
            'employee_id' => int_or($body['performed_by'] ?? null),
            'note'        => 'kind=' . $vals[$kindIdx],
        ]);
        return $res['insertId'];
    });

    return Db::get('SELECT * FROM prescriptions WHERE id = ?', $id);
});

PUT('/api/prescriptions/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    if (!Db::get('SELECT id FROM prescriptions WHERE id = ?', $id)) {
        missing();
    }
    ['cols' => $cols, 'vals' => $vals] = rxColsValues($req['body']);
    $set = implode(',', array_map(fn($c) => "$c=?", $cols));
    Db::run("UPDATE prescriptions SET $set WHERE id=?", ...[...$vals, $id]);
    return Db::get('SELECT * FROM prescriptions WHERE id = ?', $id);
});

POST('/api/prescriptions/:id/confirm', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $rx   = Db::get('SELECT * FROM prescriptions WHERE id = ?', $id);
    if (!$rx) {
        missing();
    }
    /* "ใช้สำหรับ / Test For" บังคับก่อนยืนยัน (ร้านขอ 14 ก.ย. 2026) — ค่านี้พิมพ์ลงใบสั่งตัด
       ห้องผลิตต้องรู้ว่าเลนส์คู่นี้สั่งไว้ใช้ทำอะไร · หน้าวัดสายตาเตือนก่อนแล้ว ด่านจริงอยู่ที่นี่
       ใบที่ยืนยันไปก่อนหน้านี้ไม่ย้อนบังคับ */
    if (trim((string) ($rx['test_for'] ?? '')) === '') {
        throw new HttpError(
            400,
            'ยังยืนยันค่าสายตาไม่ได้ — กรุณาเลือก ใช้สำหรับ / Test For',
            ['reason' => 'test_for_required']
        );
    }
    Db::tx(function (Tx $q) use ($id, $rx, $body) {
        $q->run(
            "UPDATE prescriptions SET kind = 'final', confirmed_by = ?, confirmed_at = NOW()
              WHERE id = ?",
            int_or($body['employee_id'] ?? null),
            $id
        );
        if ($rx['case_id']) {
            $q->run(
                'UPDATE custom_orders SET final_prescription_id = ? WHERE case_id = ?',
                $id,
                (int) $rx['case_id']
            );
            logEvent($q, (int) $rx['case_id'], [
                'action'      => 'prescription_confirmed',
                'entity'      => 'prescription',
                'entity_id'   => $id,
                'employee_id' => int_or($body['employee_id'] ?? null),
            ]);
        }
    });
    return Db::get('SELECT * FROM prescriptions WHERE id = ?', $id);
});

/**
 * One customer's eye-exam history, as rounds rather than loose rows.
 *
 * A round is a case: its three value sets live as three prescriptions rows
 * (kind = old / measured / final) sharing that case_id, so nothing overwrites
 * anything and a round can always be read back exactly as it was recorded.
 *
 * Rows written before that convention kept the old glasses in the measured
 * row's own old_* columns; those are surfaced here as a synthesised "old" entry
 * (legacy = 1) so history shows all three sets for them too.
 */
function examSessions(int $customerId): array
{
    $rows = Db::all(
        'SELECT p.*, e.employee_name AS performed_by_name, cs.case_code
           FROM prescriptions p
           LEFT JOIN employees e ON e.id = p.performed_by
           LEFT JOIN cases cs    ON cs.id = p.case_id
          WHERE p.customer_id = ?
          ORDER BY p.test_date DESC, p.id DESC',
        $customerId
    );

    $slotOf = fn(?string $kind) => $kind === 'final' ? 'final' : ($kind === 'old' ? 'old' : 'measured');
    $out = [];
    foreach ($rows as $r) {
        $key = $r['case_id'] ? 'case-' . $r['case_id'] : 'rx-' . $r['id'];
        if (!isset($out[$key])) {
            $out[$key] = [
                'key'        => $key,
                'case_id'    => $r['case_id'] ? (int) $r['case_id'] : null,
                'case_code'  => $r['case_code'],
                'exam_date'  => $r['test_date'],
                'examiner'   => $r['performed_by_name'],
                'old'        => null,
                'measured'   => null,
                'final'      => null,
            ];
        }
        $slot = $slotOf($r['kind']);
        if (!$out[$key][$slot]) {
            $out[$key][$slot] = $r;
        }
        if (!$out[$key]['examiner'] && $r['performed_by_name']) {
            $out[$key]['examiner'] = $r['performed_by_name'];
        }
    }

    foreach ($out as &$s) {
        $m = $s['measured'];
        if ($s['old'] || !$m) {
            continue;
        }
        $hasLegacyOld = false;
        foreach (['old_r_sphere', 'old_l_sphere', 'old_r_add', 'old_l_add'] as $col) {
            if (($m[$col] ?? null) !== null && $m[$col] !== '') {
                $hasLegacyOld = true;
                break;
            }
        }
        if (!$hasLegacyOld) {
            continue;
        }
        $s['old'] = [
            'id' => null, 'legacy' => 1, 'kind' => 'old',
            'source' => $m['source'], 'based_on_id' => $m['based_on_id'],
            'old_glasses_type' => $m['old_glasses_type'],
            'external_place' => $m['external_place'] ?? null,
            'external_date' => $m['external_date'] ?? null,
            'test_date' => $m['test_date'],
        ];
        foreach (['r', 'l'] as $eye) {
            foreach (['sphere', 'cylinder', 'axis', 'add', 'va', 'pd'] as $f) {
                $s['old']["{$eye}_{$f}"] = $m["old_{$eye}_{$f}"] ?? null;
            }
        }
    }
    unset($s);

    return array_values($out);
}

GET('/api/customers/:id/exam-sessions', fn(array $r) => examSessions((int) int_or($r['params']['id'])));
