<?php
/**
 * Prescription Safety Alert — เกณฑ์แจ้งเตือน + Clinical Review
 *
 * spec: docs/superpowers/specs/2026-10-14-rx-safety-alert-design.md ข้อ 7
 *
 * ส่วนเพิ่มล้วน: ไม่แตะ POST /api/prescriptions/:id/confirm เดิม — หน้าวัดสายตายืนยันตามเดิม
 * แล้วค่อยเรียก POST /api/cases/:id/rx-reviews เมื่อมีค่าเปลี่ยนถึงเกณฑ์ทบทวน (CRITICAL)
 *
 * /api/settings/* อ่านได้ทุกคนที่ล็อกอิน (หน้าวัดสายตาต้องรู้เกณฑ์) แต่เขียนได้เฉพาะผู้ถือ
 * system.zone — ประตูใน index.php กันให้ด้วยคำนำหน้าเส้นทาง ไม่ต้องเช็กซ้ำที่นี่
 */
declare(strict_types=1);

GET('/api/settings/rx-alert-rules', function () {
    $cur = RxSafetyStore::current();
    return [
        'version'  => $cur['version'],
        'rules'    => $cur['rules'],
        'defaults' => RxSafety::DEFAULT_RULES,
        'history'  => RxSafetyStore::history(),
    ];
});

PUT('/api/settings/rx-alert-rules', function (array $req) {
    $body  = $req['body'];
    $rules = is_array($body['rules'] ?? null) ? $body['rules'] : bad('ไม่มีเกณฑ์ที่จะบันทึก');
    $cur   = RxSafetyStore::save($rules, $body['note'] ?? null, StockModule::actor());
    return ['version' => $cur['version'], 'rules' => $cur['rules'], 'history' => RxSafetyStore::history()];
});

/**
 * ค่า 3 ชุดของเคสตามที่อยู่ในฐานข้อมูล — ไม่เชื่อค่าที่หน้าเว็บส่งมา
 *
 * แว่นเดิม: แถว kind='old' ล่าสุดของเคส · ไม่มี → คอลัมน์ old_* บนแถว measured (ข้อมูลก่อนมีแถว old
 * แยก — รูปเดียวกับ examSessions() ใน prescriptions.php)
 */
function rxCaseSets(int $caseId, int $finalId): array
{
    $final = Db::get('SELECT * FROM prescriptions WHERE id = ? AND case_id = ?', $finalId, $caseId);
    if (!$final) {
        missing('ไม่พบใบค่าสายตานี้ในเคส');
    }
    $oldRow = Db::get("SELECT * FROM prescriptions WHERE case_id = ? AND kind = 'old' ORDER BY id DESC LIMIT 1", $caseId);
    $measuredRow = Db::get(
        "SELECT * FROM prescriptions WHERE case_id = ? AND kind NOT IN ('old', 'final') ORDER BY id DESC LIMIT 1",
        $caseId
    );
    $old = $oldRow ? RxSafety::eyesOf($oldRow) : null;
    if ($old === null && $measuredRow) {
        $legacy = RxSafety::eyesOf($measuredRow, 'old_');
        foreach ($legacy as $eye) {
            foreach ($eye as $v) {
                if ($v !== null && trim((string) $v) !== '') {
                    $old = $legacy;
                    break 2;
                }
            }
        }
    }
    return [
        'old'      => $old,
        'measured' => $measuredRow ? RxSafety::eyesOf($measuredRow) : null,
        'final'    => RxSafety::eyesOf($final),
        'finalRow' => $final,
    ];
}

function rxReviewOut(array $r): array
{
    foreach (['old_rx', 'measured_rx', 'final_rx', 'alerts'] as $k) {
        $r[$k] = $r[$k] === null ? null : json_decode($r[$k], true);
    }
    foreach (['id', 'case_id', 'prescription_id', 'rule_version', 'reviewed_by'] as $k) {
        $r[$k] = $r[$k] === null ? null : (int) $r[$k];
    }
    return $r;
}

GET('/api/cases/:id/rx-reviews', function (array $req) {
    RxSafetyStore::ensure();
    $caseId = (int) int_or($req['params']['id']);
    return array_map('rxReviewOut', Db::all('SELECT * FROM rx_reviews WHERE case_id = ? ORDER BY id DESC', $caseId));
});

POST('/api/cases/:id/rx-reviews', function (array $req) {
    RxSafetyStore::ensure();
    $caseId  = (int) int_or($req['params']['id']);
    $finalId = (int) int_or($req['body']['prescription_id'] ?? null);
    $reason  = trim((string) ($req['body']['reason'] ?? ''));

    $sets = rxCaseSets($caseId, $finalId);
    $cur  = RxSafetyStore::current();
    $res  = RxSafety::evaluate($sets['old'], $sets['final'], $sets['finalRow']['test_for'] ?? '', $cur['rules']);
    if ($res['counts']['critical'] === 0) {
        return ['review' => null, 'alerts' => $res['alerts']];
    }

    /* ค่าชุดเดียวกันทบทวนไปแล้ว — ไม่ต้องใส่เหตุผลซ้ำ (spec 7.2 ข้อ 4) */
    $prior = Db::get(
        'SELECT * FROM rx_reviews WHERE case_id = ? AND fingerprint = ? ORDER BY id DESC LIMIT 1',
        $caseId,
        $res['fingerprint']
    );
    if ($prior && $reason === '') {
        return ['review' => rxReviewOut($prior), 'alerts' => $res['alerts']];
    }
    if ($reason === '') {
        throw new HttpError(
            422,
            'ค่าสายตาเปลี่ยนจากแว่นเดิมถึงเกณฑ์ทบทวน — กรุณาระบุเหตุผลที่ยืนยันค่านี้',
            ['reason' => 'review_reason_required', 'alerts' => $res['alerts'], 'rule_version' => $cur['version']]
        );
    }

    $actor = StockModule::actor();
    $name  = $actor['displayName'] ?? $actor['username'] ?? null;
    $json  = fn($v) => $v === null ? null : json_encode($v, JSON_UNESCAPED_UNICODE);
    $id = Db::tx(function (Tx $q) use ($caseId, $finalId, $cur, $res, $sets, $reason, $actor, $name, $json) {
        $id = (int) $q->run(
            'INSERT INTO rx_reviews (case_id, prescription_id, rule_version, fingerprint, old_rx, measured_rx,
                                     final_rx, alerts, max_severity, reason, reviewed_by, reviewed_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            $caseId, $finalId, $cur['version'], $res['fingerprint'],
            $json($sets['old']), $json($sets['measured']), $json($sets['final']), $json($res['alerts']),
            'critical', $reason,
            isset($actor['id']) ? (int) $actor['id'] : null, $name
        )['insertId'];
        logEvent($q, $caseId, [
            'action'      => 'rx_review_confirmed',
            'entity'      => 'prescription',
            'entity_id'   => $finalId,
            'employee_id' => $actor['employeeId'] ?? null,
            'note'        => "ทบทวนค่าสายตาที่เปลี่ยนมาก (เกณฑ์ v{$cur['version']}) — เหตุผล: $reason",
            'payload'     => ['review_id' => $id, 'alerts' => array_values(array_filter(
                $res['alerts'],
                fn($a) => in_array($a['level'], ['critical', 'warning'], true)
            ))],
        ]);
        return $id;
    });
    if (class_exists('ActivityLog')) {
        ActivityLog::record([], ['rx_review_id' => $id, 'counts' => $res['counts']], 'ทบทวนค่าสายตา (Clinical Review)');
    }
    return ['review' => rxReviewOut(Db::get('SELECT * FROM rx_reviews WHERE id = ?', $id)), 'alerts' => $res['alerts']];
});
