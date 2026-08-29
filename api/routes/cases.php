<?php
/** The case board — one case is one customer's job from reception to pickup. */
declare(strict_types=1);

GET('/api/cases', function (array $req) {
    $q = $req['query'];
    $where = [];
    $args  = [];

    if ($status = str_or($q['status'] ?? null)) {
        $where[] = 'status = ?';
        $args[]  = $status;
    }
    if ($group = str_or($q['stage_group'] ?? null)) {
        $where[] = 'stage_group = ?';
        $args[]  = $group;
    }
    if (str_or($q['open'] ?? null) !== '0') {
        $where[] = 'is_terminal = 0';
    }
    if (($q['rush'] ?? null) === '1') {
        $where[] = 'is_rush = 1';
    }
    /* The shop thinks in two books of work before it thinks in anything else:
       งาน SIGHTFIRST and งานลูกค้าร้าน. Everything without a type is the shop's
       own — a case nobody labelled came in through the door. */
    $client = str_or($q['client'] ?? null);
    if ($client === 'sightfirst') {
        $where[] = "case_type = 'SIGHTFIRST'";
    } elseif ($client === 'shop') {
        $where[] = "(case_type IS NULL OR case_type <> 'SIGHTFIRST')";
    }
    if ($caseType = str_or($q['case_type'] ?? null)) {
        $where[] = 'case_type = ?';
        $args[]  = $caseType;
    }
    if (($q['unpaid'] ?? null) === '1') {
        $where[] = 'balance > 0';
    }
    if ($term = str_or($q['q'] ?? null)) {
        $p = like($term);
        $where[] = '(case_code LIKE ? OR first_name LIKE ? OR last_name LIKE ?
                     OR phone LIKE ? OR invoice_code LIKE ?)';
        array_push($args, $p, $p, $p, $p, $p);
    }

    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[] = min(int_or($q['limit'] ?? null, 300), 1000);

    $rows = Db::all(
        "SELECT * FROM v_case_board $sqlWhere
          ORDER BY is_rush DESC, status_order, opened_at LIMIT ?",
        ...$args
    );

    /* Which process the case is really on — cases.status is set by hand and
       nothing checks it against the work, so the board reads this instead
       (api/routes/processes.php) */
    $stages = caseStageMap(array_column($rows, 'id'));
    foreach ($rows as &$r) {
        $r += $stages[(int) $r['id']] ?? ['process_stage' => null, 'process_done' => 0];
    }
    unset($r);
    return $rows;
});

function caseDetail(?int $id): array
{
    $c = Db::get(
        'SELECT c.*, s.stage_no, s.label_th AS status_label_th, s.label_en AS status_label_en,
                s.stage_group, s.sort_order AS status_order, s.is_waiting, s.is_terminal,
                cu.first_name, cu.last_name, cu.phone, cu.line_id, cu.email, cu.sex,
                cu.nationality, cu.birth_date,
                rb.employee_name AS received_by_name
           FROM cases c
           JOIN case_statuses s   ON s.code = c.status
           JOIN customers cu      ON cu.id  = c.customer_id
           LEFT JOIN employees rb ON rb.id  = c.received_by
          WHERE c.id = ?',
        $id
    );
    if (!$c) {
        missing();
    }

    $sel  = Sql::ORDER_SELECT;
    $from = Sql::ORDER_FROM;

    $rx = Db::all(
        "SELECT p.*, pe.employee_name AS performed_by_name
           FROM prescriptions p LEFT JOIN employees pe ON pe.id = p.performed_by
          WHERE p.case_id = ? OR (p.customer_id = ? AND p.case_id IS NULL)
          ORDER BY FIELD(p.kind,'final','measured','old'), p.test_date DESC",
        $id,
        (int) $c['customer_id']
    );
    $order = Db::get("SELECT $sel $from WHERE o.case_id = ? ORDER BY o.id DESC LIMIT 1", $id);
    $centering = Db::get('SELECT * FROM centerings WHERE case_id = ? ORDER BY id DESC LIMIT 1', $id);
    $fitting   = Db::get('SELECT * FROM frame_fittings WHERE case_id = ? ORDER BY id DESC LIMIT 1', $id);
    $delivery  = Db::get(
        'SELECT d.*, e.employee_name AS handed_over_by_name FROM case_deliveries d
           LEFT JOIN employees e ON e.id = d.handed_over_by
          WHERE d.case_id = ?',
        $id
    );
    $payments = Db::all(
        'SELECT p.*, e.employee_name AS received_by_name FROM payments p
           LEFT JOIN employees e ON e.id = p.received_by
          WHERE p.case_id = ? ORDER BY p.paid_at',
        $id
    );
    $notifs = Db::all(
        'SELECT n.*, e.employee_name AS contacted_by_name FROM customer_notifications n
           LEFT JOIN employees e ON e.id = n.contacted_by
          WHERE n.case_id = ? ORDER BY n.contacted_at DESC',
        $id
    );
    $events = Db::all(
        'SELECT ev.*, e.employee_name,
                fs.label_th AS from_label, ts.label_th AS to_label
           FROM case_events ev
           LEFT JOIN employees e      ON e.id  = ev.employee_id
           LEFT JOIN case_statuses fs ON fs.code = ev.from_status
           LEFT JOIN case_statuses ts ON ts.code = ev.to_status
          WHERE ev.case_id = ? ORDER BY ev.created_at DESC, ev.id DESC LIMIT 200',
        $id
    );

    $paid = sumCol(array_filter($payments, fn($p) => !$p['cancelled_at']), 'amount');

    $detail = $c + [
        'prescriptions' => $rx,
        'order'         => $order,
        'centering'     => $centering,
        'frame_fitting' => $fitting,
        'delivery'      => $delivery,
        'payments'      => $payments,
        'notifications' => $notifs,
        'events'        => $events,
        'paid'          => round2($paid),
        'balance'       => $order
            ? round2((float) $order['total_price'] - (float) $order['discount'] - $paid)
            : null,
    ];

    /* the 6-process status axis (api/routes/processes.php) — needs everything
       above it to decide what each process still needs */
    $detail['processes'] = caseProcessStates($detail);
    return $detail;
}

GET('/api/cases/:id', fn(array $r) => caseDetail(int_or($r['params']['id'])));

POST('/api/cases', function (array $req) {
    $body = $req['body'];
    $cid  = int_or($body['customer_id'] ?? null);
    if (!$cid) {
        bad('กรุณาเลือกลูกค้า');
    }
    if (!Db::get('SELECT id FROM customers WHERE id = ?', $cid)) {
        bad('ไม่พบลูกค้ารายนี้');
    }
    $code   = str_or($body['case_code'] ?? null) ?: nextCode('CASE', 'cases', 'case_code');
    $status = str_or($body['status'] ?? null, 'reception') ?: 'reception';

    $id = Db::tx(function (Tx $q) use ($body, $cid, $code, $status) {
        $r = $q->run(
            'INSERT INTO cases (case_code, customer_id, status, is_new_customer, is_rush,
               priority_note, received_by, recorded_by, referral_source, referral_note,
               case_type, reception_note, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            $code,
            $cid,
            $status,
            boolInt($body['is_new_customer'] ?? null),
            boolInt($body['is_rush'] ?? null),
            nul($body['priority_note'] ?? null),
            int_or($body['received_by'] ?? null),
            int_or($body['recorded_by'] ?? null) ?? int_or($body['received_by'] ?? null),
            nul($body['referral_source'] ?? null),
            nul($body['referral_note'] ?? null),
            nul($body['case_type'] ?? null),
            nul($body['reception_note'] ?? null),
            nul($body['notes'] ?? null)
        );
        logEvent($q, $r['insertId'], [
            'to_status'   => $status,
            'action'      => 'case_opened',
            'employee_id' => int_or($body['received_by'] ?? null),
            'note'        => nul($body['reception_note'] ?? null),
        ]);
        return $r['insertId'];
    });

    return caseDetail($id);
});

PUT('/api/cases/:id', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    if (!Db::get('SELECT id FROM cases WHERE id = ?', $id)) {
        missing();
    }
    Db::run(
        'UPDATE cases SET is_rush = ?, priority_note = ?, received_by = ?,
           referral_source = ?, referral_note = ?, case_type = ?,
           reception_note = ?, notes = ? WHERE id = ?',
        boolInt($body['is_rush'] ?? null),
        nul($body['priority_note'] ?? null),
        int_or($body['received_by'] ?? null),
        nul($body['referral_source'] ?? null),
        nul($body['referral_note'] ?? null),
        nul($body['case_type'] ?? null),
        nul($body['reception_note'] ?? null),
        nul($body['notes'] ?? null),
        $id
    );
    return caseDetail($id);
});

POST('/api/cases/:id/status', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $to   = str_or($body['status'] ?? null);
    if ($to === '') {
        bad('กรุณาระบุสถานะปลายทาง');
    }
    Db::tx(function (Tx $q) use ($id, $to, $body) {
        $before = $q->get('SELECT status FROM cases WHERE id = ?', $id);
        setStatus($q, $id, $to, [
            'employee_id' => int_or($body['employee_id'] ?? null),
            'note'        => nul($body['note'] ?? null),
            'action'      => 'status_change',
        ]);
        if ($to === 'cancelled' && nul($body['note'] ?? null) !== null) {
            $q->run('UPDATE cases SET cancelled_reason = ? WHERE id = ?', str_or($body['note']), $id);
        }
        $target = $q->get('SELECT is_terminal FROM case_statuses WHERE code = ?', $to);
        if ($target && (int) $target['is_terminal'] === 1 && $before && $before['status'] !== $to) {
            $q->run('UPDATE cases SET closed_by = ? WHERE id = ?', int_or($body['employee_id'] ?? null), $id);
        }
    });
    return caseDetail($id);
});

POST('/api/cases/:id/note', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    if (str_or($body['note'] ?? null) === '') {
        bad('กรุณากรอกข้อความ');
    }
    Db::tx(fn(Tx $q) => logEvent($q, $id, [
        'action'      => 'note',
        'employee_id' => int_or($body['employee_id'] ?? null),
        'note'        => str_or($body['note']),
    ]));
    return caseDetail($id);
});

POST('/api/cases/:id/notify', function (array $req) {
    $id      = int_or($req['params']['id']);
    $body    = $req['body'];
    $channel = str_or($body['channel'] ?? null, 'phone') ?: 'phone';
    $result  = str_or($body['result'] ?? null, 'reached') ?: 'reached';

    Db::tx(function (Tx $q) use ($id, $body, $channel, $result) {
        $q->run(
            'INSERT INTO customer_notifications (case_id, channel, contacted_by, result, note)
             VALUES (?,?,?,?,?)',
            $id,
            $channel,
            int_or($body['contacted_by'] ?? null),
            $result,
            nul($body['note'] ?? null)
        );
        logEvent($q, $id, [
            'action'      => 'customer_notified',
            'entity'      => 'customer_notification',
            'employee_id' => int_or($body['contacted_by'] ?? null),
            'note'        => "$channel — $result",
        ]);
        if (str_or($body['result'] ?? null) === 'reached') {
            $cur = $q->get('SELECT status FROM cases WHERE id = ?', $id);
            if ($cur && ($cur['status'] === 'ready_notify' || $cur['status'] === 'notified')) {
                setStatus($q, $id, 'waiting_pickup', [
                    'employee_id' => int_or($body['contacted_by'] ?? null),
                    'action'      => 'customer_notified',
                ]);
            }
        }
    });
    return caseDetail($id);
});
