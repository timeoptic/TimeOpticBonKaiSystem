<?php
/**
 * Per-process state for the 6-process case workflow.
 *
 * The case's own `status` column stays what it always was — one status at a
 * time, the thing the board and the reports read. This file adds the second,
 * orthogonal axis the shop actually works in: each of the 6 processes carries
 * its own status, so "ขาย" can be เสร็จแล้ว while "วัดสายตา" has not started.
 *
 * A process's status is only ever changed by an explicit action here
 * (start / complete / reopen / state) — never as a side effect of opening a
 * tab. A row is written lazily: a case with no rows still reports sensible
 * statuses, derived from the data it already has (see processDerived()).
 */
declare(strict_types=1);

/** canonical order — matches case_statuses.stage_group, so the board agrees */
const CASE_PROCESSES = ['reception', 'exam', 'sales', 'payment', 'centering', 'delivery'];

/**
 * Processes whose "เริ่ม/เสร็จ" action is gated by more than their own form
 * being filled in. Only ส่งมอบ is: there is nothing to hand a customer until
 * the sale has said what they are collecting.
 */
const GATED_PROCESSES = ['delivery'];

function assertProcess(string $p): string
{
    if (!in_array($p, CASE_PROCESSES, true)) {
        bad("ไม่รู้จักขั้นตอน \"$p\"");
    }
    return $p;
}

/**
 * What each process still needs before it can be marked "เสร็จแล้ว".
 * Returns process => string[] (empty array = ready to complete).
 */
function processMissing(array $c): array
{
    $order   = $c['order'] ?? null;
    $rx      = $c['prescriptions'] ?? [];
    $ce      = $c['centering'] ?? null;
    $dlv     = $c['delivery'] ?? null;
    $balance = $c['balance'];

    $hasFinalRx = false;
    foreach ($rx as $r) {
        if (($r['kind'] ?? '') === 'final' || !empty($r['confirmed_at'])) {
            $hasFinalRx = true;
            break;
        }
    }

    $m = [];

    $m['reception'] = array_values(array_filter([
        empty($c['customer_id']) ? 'ข้อมูลลูกค้า' : null,
        empty($c['received_by']) ? 'พนักงานผู้รับเรื่อง' : null,
    ]));

    $m['exam'] = $hasFinalRx ? [] : ['ค่าสายตาที่ยืนยันแล้ว'];

    $m['sales'] = array_values(array_filter([
        !$order ? 'ออเดอร์' : null,
        $order && empty($order['frame_name']) ? 'กรอบแว่น' : null,
        $order && empty($order['lens_name']) ? 'เลนส์' : null,
        $order && (float) ($order['total_price'] ?? 0) <= 0 ? 'ราคารวม' : null,
    ]));

    /* PD อย่างเดียวที่บังคับ — เลนส์สั่งตัดไม่ได้ถ้าไม่รู้ระยะรูม่านตา
       ส่วน FH / FRAME BOX / มุมและระยะสวมใส่ ไม่บังคับ: งานหลายแบบไม่ต้องใช้
       (เปลี่ยนเลนส์กรอบเดิม ชั้นเดียว ฯลฯ) กรอกได้ถ้ามี ไม่มีก็ปิดขั้นตอนได้ */
    $m['centering'] = array_values(array_filter([
        !$ce ? 'ค่า Center' : null,
        $ce && empty($ce['pd_total']) ? 'PD' : null,
    ]));

    /* วันนัดรับบังคับที่ขั้นนี้ — คนที่จ่ายเงินคือคนที่ถามว่า "มารับได้วันไหน"
       ถ้าปล่อยให้ข้าม เคสจะไปถึงขั้นส่งมอบโดยไม่มีวันนัดให้ใครตามงาน */
    $m['payment'] = array_values(array_filter([
        !count($c['payments'] ?? []) ? 'การรับเงิน' : null,
        $balance !== null && (float) $balance > 0
            ? 'ยอดคงเหลือ ' . round2($balance) : null,
        empty($order['appointment_date']) ? 'วันนัดรับ' : null,
    ]));

    /* ยอดค้างชำระไม่ใช่เงื่อนไขของการส่งมอบ — ลูกค้ารับแว่นได้ แล้วเก็บเงินที่ขั้น
       ชำระเงินตามปกติ ที่นี่ถามอย่างเดียวว่าบันทึกการส่งมอบไว้หรือยัง */
    $m['delivery'] = $dlv && !empty($dlv['delivered_at']) ? [] : ['บันทึกการส่งมอบ'];

    return $m;
}

/**
 * Business gate — why a process cannot be *acted on* yet (as opposed to
 * merely incomplete). Only ส่งมอบ has one; the rest of the flow
 * (รับลูกค้า / วัดสายตา / ขาย / ชำระเงิน / วัด Center) is deliberately always open.
 */
function processBlocking(array $c): array
{
    $order = $c['order'] ?? null;

    return [
        'reception' => [],
        'exam'      => [],
        'sales'     => [],
        'payment'   => [],
        'centering' => [],
        'delivery'  => $order ? [] : ['ยังไม่มีออเดอร์'],
    ];
}

/**
 * The status a process has when nobody has pressed any of its buttons yet —
 * read off the data the case already carries, so cases created before this
 * table existed still show a truthful stepper.
 */
function processDerived(array $c, array $missing): array
{
    $order = $c['order'] ?? null;
    $out   = [];

    foreach (CASE_PROCESSES as $p) {
        $done = !count($missing[$p] ?? []);
        $out[$p] = $done ? 'completed' : 'not_started';
    }

    if (count($c['prescriptions'] ?? []) && $out['exam'] !== 'completed') {
        $out['exam'] = 'in_progress';
    }
    if ($order && $out['sales'] !== 'completed') {
        $out['sales'] = 'in_progress';
    }
    if (count($c['payments'] ?? []) && $out['payment'] !== 'completed') {
        $out['payment'] = 'in_progress';
    }
    if (($c['centering'] ?? null) && $out['centering'] !== 'completed') {
        $out['centering'] = 'in_progress';
    }
    /* a case parked on a terminal status has been handed over, whatever else
       is still open — ส่งมอบ is the step that closes the case */
    if ((int) ($c['is_terminal'] ?? 0) === 1) {
        $out['delivery'] = 'completed';
    }
    return $out;
}

/** stored rows (if any) merged over the derived defaults, plus the extras the UI needs */
function caseProcessStates(array $c): array
{
    $rows = Db::all('SELECT * FROM case_processes WHERE case_id = ?', (int) $c['id']);
    $byId = [];
    foreach ($rows as $r) {
        $byId[$r['process']] = $r;
    }

    $missing  = processMissing($c);
    $blocking = processBlocking($c);
    $derived  = processDerived($c, $missing);

    $out = [];
    foreach (CASE_PROCESSES as $p) {
        $row    = $byId[$p] ?? null;
        $status = $row['status'] ?? $derived[$p];
        $locked = $status === 'not_started'
            && in_array($p, GATED_PROCESSES, true)
            && count($blocking[$p]);
        $out[$p] = [
            'process'      => $p,
            'status'       => $locked ? 'locked' : $status,
            'stored'       => $row ? 1 : 0,
            'started_at'   => $row['started_at'] ?? null,
            'completed_at' => $row['completed_at'] ?? null,
            'updated_at'   => $row['updated_at'] ?? null,
            'note'         => $row['note'] ?? null,
            'missing'      => $missing[$p],
            'blocking'     => $blocking[$p],
        ];
    }
    return $out;
}

/** write one process row (create or update) */
function saveProcess(Tx $q, int $caseId, string $process, array $set): void
{
    $row = $q->get('SELECT id FROM case_processes WHERE case_id = ? AND process = ?', $caseId, $process);
    $cols = ['status', 'started_at', 'completed_at', 'note'];
    if ($row) {
        $sets = [];
        $args = [];
        foreach ($cols as $col) {
            if (array_key_exists($col, $set)) {
                $sets[] = "$col = ?";
                $args[] = $set[$col];
            }
        }
        if (!$sets) {
            return;
        }
        $args[] = (int) $row['id'];
        $q->run('UPDATE case_processes SET ' . implode(', ', $sets) . ' WHERE id = ?', ...$args);
        return;
    }
    $q->run(
        'INSERT INTO case_processes (case_id, process, status, started_at, completed_at, note)
         VALUES (?,?,?,?,?,?)',
        $caseId,
        $process,
        str_or($set['status'] ?? 'in_progress', 'in_progress'),
        $set['started_at'] ?? null,
        $set['completed_at'] ?? null,
        $set['note'] ?? null
    );
}

/** first non-terminal status of a stage group, in sort order — where a case lands */
function entryStatusOfGroup(string $group): ?string
{
    $row = Db::get(
        'SELECT code FROM case_statuses WHERE stage_group = ? AND is_terminal = 0
          ORDER BY sort_order LIMIT 1',
        $group
    );
    return $row['code'] ?? null;
}

/**
 * Completing a process nudges the case's own status forward to the first
 * process that is still open, so the board keeps telling the truth. It never
 * moves the case backwards.
 */
function advanceCaseStatus(Tx $q, array $c, array $states): void
{
    /* same reading as the board: the case is at the furthest step anything has
       happened on — not the first gap, which would drag a case back to ชำระเงิน
       the moment it takes a deposit instead of the full amount */
    $order = CASE_PROCESSES;
    $furthest = 0;
    foreach ($order as $idx => $p) {
        if (($states[$p]['status'] ?? 'not_started') !== 'not_started') {
            $furthest = $idx;
        }
    }
    $next = null;
    if (($states[$order[$furthest]]['status'] ?? '') !== 'completed') {
        $next = $order[$furthest];
    } else {
        for ($i = $furthest + 1; $i < count($order); $i++) {
            if (($states[$order[$i]]['status'] ?? '') !== 'completed') {
                $next = $order[$i];
                break;
            }
        }
    }
    $code = $next === null ? 'completed' : entryStatusOfGroup($next);
    if (!$code) {
        return;
    }
    $target = $q->get('SELECT sort_order FROM case_statuses WHERE code = ?', $code);
    $now    = $q->get(
        'SELECT s.sort_order FROM cases c JOIN case_statuses s ON s.code = c.status WHERE c.id = ?',
        (int) $c['id']
    );
    if ($target && $now && (int) $target['sort_order'] <= (int) $now['sort_order']) {
        return; // already at or past that point — don't drag the case back
    }
    setStatus($q, (int) $c['id'], $code, ['action' => 'process_completed']);
}

/** เริ่มทำขั้นตอนนี้ */
POST('/api/cases/:id/processes/:process/start', function (array $req) {
    $id      = int_or($req['params']['id']);
    $process = assertProcess((string) $req['params']['process']);
    caseDetail($id); // 404s if the case is gone

    Db::tx(function (Tx $q) use ($id, $process) {
        saveProcess($q, $id, $process, ['status' => 'in_progress', 'started_at' => nowStamp()]);
        logEvent($q, $id, [
            'action' => 'process_started', 'entity' => 'case_process', 'note' => $process,
        ]);
    });
    return caseDetail($id)['processes'];
});

/** ✓ ยืนยันว่าขั้นตอนนี้เสร็จแล้ว — ตรวจ requirement ก่อนเสมอ */
POST('/api/cases/:id/processes/:process/complete', function (array $req) {
    $id      = int_or($req['params']['id']);
    $process = assertProcess((string) $req['params']['process']);
    $c       = caseDetail($id);
    $missing = processMissing($c)[$process];
    if ($missing) {
        bad('ยังยืนยันขั้นตอนนี้ไม่ได้ — ขาด: ' . implode(', ', $missing));
    }
    $note = nul($req['body']['note'] ?? null);

    /* ยืนยันขั้น "ขาย" = ของออกจากคลังจริง
       ตรวจแผนก่อนแตะฐานข้อมูล เพราะ plan() อ่านอย่างเดียว ไม่ยิงเน็ต — ใบที่มี
       ช่องซึ่งหา SKU ไม่เจอ ควรถูกปฏิเสธตั้งแต่ยังไม่ได้บันทึกอะไรเลย ดีกว่าไป
       ตายกลางทางแล้วต้องถอนคืน */
    if ($process === 'sales') {
        foreach (CaseStock::plan($c) as $line) {
            if ($line['missing']) {
                bad($line['missing']);
            }
        }
    }

    Db::tx(function (Tx $q) use ($id, $process, $note, $c) {
        saveProcess($q, $id, $process, [
            'status'       => 'completed',
            'completed_at' => nowStamp(),
            'note'         => $note,
        ]);
        $q->run(
            'UPDATE case_processes SET started_at = COALESCE(started_at, ?) WHERE case_id = ? AND process = ?',
            nowStamp(),
            $id,
            $process
        );
        logEvent($q, $id, [
            'action' => 'process_completed', 'entity' => 'case_process',
            'note'   => $process . ($note ? " — $note" : ''),
        ]);
        /* ส่งมอบเป็นขั้นสุดท้าย — ยืนยันแล้วเคสจบ ไม่มีขั้น "จบงาน" ให้กดซ้ำอีกที */
        if ($process === 'delivery') {
            setStatus($q, $id, 'completed', ['action' => 'process_completed']);
            return;
        }
        advanceCaseStatus($q, $c, caseDetail($id)['processes']);
    });

    /*
     * ตัดของออกจากคลังจริง — นอก transaction ข้างบนโดยตั้งใจ
     *
     * การตัดสต็อกยิงข้าม HTTP ไปที่บริการของฝั่งคลัง ทีละบรรทัด · ถือ transaction
     * ค้างไว้ข้ามการยิงเน็ตหลายรอบจะได้ lock timeout ไม่ใช่ความปลอดภัย
     *
     * ถ้าตัดไม่สำเร็จ ขั้นตอนถูกเปิดกลับเป็น "กำลังทำ" แล้วโยนสาเหตุกลับไปให้คน
     * กดเห็น · ปล่อยให้ขั้นตอนค้างเป็น "เสร็จแล้ว" ทั้งที่ของไม่ได้ออกจากคลัง คือ
     * บั๊กเดิมในรูปใหม่: ระบบบอกว่าขายแล้ว แต่จำนวนในคลังไม่ลด
     *
     * CaseStock กันตัดซ้ำเองด้วย idem_key ต่อช่องต่อสินค้า กดยืนยันซ้ำจึงไม่ตัดสองรอบ
     */
    if ($process === 'sales') {
        try {
            CaseStock::issueForCase(caseDetail($id), int_or($req['body']['employee_id'] ?? null));
        } catch (Throwable $e) {
            Db::tx(function (Tx $q) use ($id, $e) {
                saveProcess($q, $id, 'sales', ['status' => 'in_progress', 'completed_at' => null]);
                logEvent($q, $id, [
                    'action' => 'stock_issue_failed', 'entity' => 'case_process',
                    'note'   => mb_substr($e->getMessage(), 0, 250),
                ]);
            });
            throw $e;
        }
    }

    return caseDetail($id)['processes'];
});

/** เปิดขั้นตอนที่ยืนยันไปแล้วกลับมาแก้ไข */
POST('/api/cases/:id/processes/:process/reopen', function (array $req) {
    $id      = int_or($req['params']['id']);
    $process = assertProcess((string) $req['params']['process']);
    caseDetail($id);
    $note = nul($req['body']['note'] ?? null);

    /* เปิดขั้น "ขาย" กลับมาแก้ = ของที่ตัดไปแล้วต้องกลับเข้าคลัง
       คืนก่อนเปิดขั้นตอน เพราะถ้าคืนไม่สำเร็จ ขั้นตอนต้องยังเป็น "เสร็จแล้ว" อยู่
       ให้ตรงกับของที่ยังออกไปจากคลังจริง ๆ */
    if ($process === 'sales') {
        CaseStock::returnForCase(caseDetail($id), 'เปิดขั้นการขายกลับมาแก้');
    }

    Db::tx(function (Tx $q) use ($id, $process, $note) {
        saveProcess($q, $id, $process, [
            'status' => 'in_progress', 'completed_at' => null, 'note' => $note,
        ]);
        logEvent($q, $id, [
            'action' => 'process_reopened', 'entity' => 'case_process',
            'note'   => $process . ($note ? " — $note" : ''),
        ]);
    });
    return caseDetail($id)['processes'];
});

/** ตั้งสถานะพิเศษ (รอ / มีปัญหา / ยังไม่เริ่ม) */
POST('/api/cases/:id/processes/:process/state', function (array $req) {
    $id      = int_or($req['params']['id']);
    $process = assertProcess((string) $req['params']['process']);
    $status  = str_or($req['body']['status'] ?? null);
    if (!in_array($status, ['not_started', 'in_progress', 'waiting', 'problem'], true)) {
        bad('สถานะไม่ถูกต้อง');
    }
    caseDetail($id);
    $note = nul($req['body']['note'] ?? null);

    Db::tx(function (Tx $q) use ($id, $process, $status, $note) {
        saveProcess($q, $id, $process, [
            'status' => $status, 'completed_at' => null, 'note' => $note,
        ]);
        logEvent($q, $id, [
            'action' => 'process_status', 'entity' => 'case_process',
            'note'   => "$process → $status" . ($note ? " — $note" : ''),
        ]);
    });
    return caseDetail($id)['processes'];
});

GET('/api/cases/:id/processes', fn(array $r) => caseDetail(int_or($r['params']['id']))['processes']);

/**
 * Where each case actually is, for a whole list at once.
 *
 * The board used to read cases.status, which is a value somebody sets by hand
 * and nothing ever checks against the work: a case could sit in "ส่งมอบ" with
 * no order and no centering. This computes the same answer the case page shows
 * — the first of the 6 processes that is not finished — for every case in one
 * pass, so the board and the case agree.
 *
 * Six aggregate queries, not one caseDetail() per row.
 */
function caseStageMap(array $caseIds): array
{
    $ids = array_values(array_unique(array_map('intval', array_filter($caseIds))));
    if (!$ids) {
        return [];
    }
    $in = implode(',', array_fill(0, count($ids), '?'));

    $flat = function (array $rows, string $key = 'case_id') {
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r[$key]] = $r;
        }
        return $out;
    };

    $rx = $flat(Db::all(
        "SELECT case_id,
                MAX(kind = 'final' OR confirmed_at IS NOT NULL) AS has_final,
                COUNT(*) AS n
           FROM prescriptions WHERE case_id IN ($in) GROUP BY case_id",
        ...$ids
    ));
    $orders = $flat(Db::all(
        "SELECT o.case_id,
                MAX(o.frame_name IS NOT NULL AND o.frame_name <> ''
                    AND o.lens_name IS NOT NULL AND o.lens_name <> ''
                    AND o.total_price > 0) AS filled,
                SUM(o.total_price - o.discount) AS net,
                MAX(o.appointment_date IS NOT NULL) AS has_appt,
                COUNT(*) AS n
           FROM custom_orders o WHERE o.case_id IN ($in) GROUP BY o.case_id",
        ...$ids
    ));
    $centering = $flat(Db::all(
        "SELECT case_id,
                -- เกณฑ์เดียวกับ processMissing(): PD เท่านั้น FH ไม่บังคับ
                MAX(pd_total IS NOT NULL AND pd_total <> '') AS done,
                COUNT(*) AS n
           FROM centerings WHERE case_id IN ($in) GROUP BY case_id",
        ...$ids
    ));
    $pay = $flat(Db::all(
        "SELECT case_id, SUM(amount) AS paid, COUNT(*) AS n
           FROM payments WHERE case_id IN ($in) AND cancelled_at IS NULL GROUP BY case_id",
        ...$ids
    ));
    $dlv = $flat(Db::all(
        "SELECT case_id, MAX(delivered_at IS NOT NULL) AS delivered, COUNT(*) AS n
           FROM case_deliveries WHERE case_id IN ($in) GROUP BY case_id",
        ...$ids
    ));
    $stored = [];
    foreach (Db::all("SELECT case_id, process, status FROM case_processes WHERE case_id IN ($in)", ...$ids) as $r) {
        $stored[(int) $r['case_id']][$r['process']] = $r['status'];
    }
    $terminal = $flat(Db::all(
        "SELECT c.id AS case_id, s.is_terminal
           FROM cases c JOIN case_statuses s ON s.code = c.status
          WHERE c.id IN ($in)",
        ...$ids
    ));

    $out = [];
    foreach ($ids as $id) {
        $paid = (float) ($pay[$id]['paid'] ?? 0);
        $net  = (float) ($orders[$id]['net'] ?? 0);
        $done = [
            'reception' => true,                                     // the case exists
            'exam'      => !empty($rx[$id]['has_final']),
            'sales'     => !empty($orders[$id]['filled']),
            'payment'   => !empty($pay[$id]['n']) && $net > 0 && $paid >= $net - 0.001
                           && !empty($orders[$id]['has_appt']),   // เกณฑ์เดียวกับ processMissing()
            'centering' => !empty($centering[$id]['done']),
            'delivery'  => !empty($dlv[$id]['delivered']),
        ];
        /* Work that has visibly begun, whether or not it is finished. The shop
           does not queue: a customer can pay a deposit and go straight to วัด
           Center, so payment sits half-done while the job has already moved on. */
        $active = [
            'reception' => true,
            'exam'      => !empty($rx[$id]['n']),
            'sales'     => !empty($orders[$id]['n']),
            'payment'   => !empty($pay[$id]['n']),
            'centering' => !empty($centering[$id]['n']),
            'delivery'  => !empty($dlv[$id]['n']),
        ];

        /* an explicit ✓ on a process outranks what the data alone implies */
        foreach ($stored[$id] ?? [] as $process => $status) {
            if (isset($done[$process])) {
                $done[$process] = $status === 'completed';
                $active[$process] = $active[$process] || $status !== 'not_started';
            }
        }

        /* Where the job IS = the furthest step anything has happened on. If that
           step is unfinished, that is the answer; if it is finished, the answer
           is the next step still open. Reading "first unfinished step" instead
           would park a case in ชำระเงิน forever on a deposit, while the glasses
           are being cut. */
        $order = CASE_PROCESSES;
        $furthest = 0;
        foreach ($order as $idx => $p) {
            if (!empty($done[$p]) || !empty($active[$p])) {
                $furthest = $idx;
            }
        }
        $stage = 'done';
        if (empty($done[$order[$furthest]])) {
            $stage = $order[$furthest];
        } else {
            for ($i = $furthest + 1; $i < count($order); $i++) {
                if (empty($done[$order[$i]])) {
                    $stage = $order[$i];
                    break;
                }
            }
        }
        if ((int) ($terminal[$id]['is_terminal'] ?? 0) === 1) {
            $stage = 'done';
        }
        $out[$id] = [
            'process_stage' => $stage,
            'process_done'  => count(array_filter($done)),
        ];
    }
    return $out;
}
