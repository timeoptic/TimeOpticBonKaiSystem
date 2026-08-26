<?php
/**
 * Lens sourcing and arrival tracking.
 *
 * A case has at most one live lens job. Lenses either come off the shelf
 * (source=stock, immediately ready) or are ordered from a supplier
 * (source=order), in which case the ETA is chased with follow-ups.
 */
declare(strict_types=1);

GET('/api/lens-tracker', function (array $req) {
    $q     = $req['query'];
    $where = [];
    $args  = [];

    if ($risk = str_or($q['risk'] ?? null)) {
        $where[] = 'risk_level = ?';
        $args[]  = $risk;
    }
    if (($q['threatens'] ?? null) === '1') {
        $where[] = 'threatens_appointment = 1';
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    return Db::all(
        "SELECT * FROM v_lens_tracker $sqlWhere
          ORDER BY days_to_eta IS NULL, days_to_eta LIMIT 500",
        ...$args
    );
});

function lensJobDetail(?int $id): array
{
    $j = Db::get(
        'SELECT lj.*, s.name AS supplier_name,
                ls.product_name AS left_lens_name, rs.product_name AS right_lens_name
           FROM lens_jobs lj
           LEFT JOIN suppliers s      ON s.id  = lj.supplier_id
           LEFT JOIN v_stock_lot ls   ON ls.id = lj.left_lens_stock_id
           LEFT JOIN v_stock_lot rs   ON rs.id = lj.right_lens_stock_id
          WHERE lj.id = ?',
        $id
    );
    if (!$j) {
        missing();
    }
    $j['followups'] = Db::all(
        'SELECT f.*, e.employee_name AS contacted_by_name FROM lens_followups f
           LEFT JOIN employees e ON e.id = f.contacted_by
          WHERE f.lens_job_id = ? ORDER BY f.seq',
        $id
    );
    return $j;
}

GET('/api/lens-jobs/:id', fn(array $r) => lensJobDetail(int_or($r['params']['id'])));

/** create or update the lens job for a case */
POST('/api/lens-jobs', function (array $req) {
    $body   = $req['body'];
    $caseId = int_or($body['case_id'] ?? null);
    if (!$caseId) {
        bad('กรุณาระบุเคส');
    }
    $source = str_or($body['source'] ?? null) === 'order' ? 'order' : 'stock';
    $status = str_or($body['status'] ?? null)
        ?: ($source === 'stock' ? 'ready' : 'waiting_arrival');

    $id = Db::tx(function (Tx $q) use ($body, $caseId, $source, $status) {
        $existing = $q->get(
            'SELECT id FROM lens_jobs WHERE case_id = ? ORDER BY id DESC LIMIT 1',
            $caseId
        );
        $cols = ['order_id', 'source', 'status', 'left_lens_stock_id', 'right_lens_stock_id',
            'rx_checked', 'lens_checked', 'picked_by', 'checked_by', 'supplier_id',
            'supplier_order_no', 'order_date', 'lead_time_days', 'expected_arrival',
            'recorded_by', 'notes'];
        $vals = [
            int_or($body['order_id'] ?? null), $source, $status,
            int_or($body['left_lens_stock_id'] ?? null),
            int_or($body['right_lens_stock_id'] ?? null),
            boolInt($body['rx_checked'] ?? null),
            boolInt($body['lens_checked'] ?? null),
            int_or($body['picked_by'] ?? null),
            int_or($body['checked_by'] ?? null),
            int_or($body['supplier_id'] ?? null),
            nul($body['supplier_order_no'] ?? null),
            nul($body['order_date'] ?? null),
            int_or($body['lead_time_days'] ?? null),
            nul($body['expected_arrival'] ?? null),
            int_or($body['recorded_by'] ?? null),
            nul($body['notes'] ?? null),
        ];

        if ($existing) {
            $set = implode(',', array_map(fn($c) => "$c=?", $cols));
            $q->run(
                "UPDATE lens_jobs SET $set,
                   picked_at = CASE WHEN ? = 1 AND picked_at IS NULL THEN NOW() ELSE picked_at END
                 WHERE id = ?",
                ...[...$vals, $source === 'stock' ? 1 : 0, (int) $existing['id']]
            );
            $jid = (int) $existing['id'];
        } else {
            $names = implode(',', $cols);
            $marks = implode(',', array_fill(0, count($cols), '?'));
            $r = $q->run(
                "INSERT INTO lens_jobs (case_id, $names, original_eta, picked_at)
                 VALUES (?, $marks, ?, ?)",
                ...[
                    $caseId,
                    ...$vals,
                    nul($body['expected_arrival'] ?? null),
                    $source === 'stock' ? nowStamp() : null,
                ]
            );
            $jid = $r['insertId'];
        }

        logEvent($q, $caseId, [
            'action'      => 'lens_job_saved',
            'entity'      => 'lens_job',
            'entity_id'   => $jid,
            'employee_id' => int_or($body['recorded_by'] ?? null) ?? int_or($body['picked_by'] ?? null),
            'note'        => "source=$source status=$status",
        ]);
        setStatus(
            $q,
            $caseId,
            $source === 'stock' ? 'lens_ready' : 'waiting_lens_arrival',
            ['employee_id' => int_or($body['recorded_by'] ?? null), 'action' => 'lens_job_saved']
        );
        return $jid;
    });

    return lensJobDetail($id);
});

POST('/api/lens-jobs/:id/followup', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $j    = Db::get('SELECT * FROM lens_jobs WHERE id = ?', $id);
    if (!$j) {
        missing();
    }

    Db::tx(function (Tx $q) use ($id, $j, $body) {
        $seqRow = $q->get('SELECT COALESCE(MAX(seq),0) s FROM lens_followups WHERE lens_job_id = ?', $id);
        $newEta = nul($body['new_eta'] ?? null);

        $q->run(
            'INSERT INTO lens_followups (lens_job_id, seq, contacted_by, channel, previous_eta,
               new_eta, affects_appointment, customer_notified, notified_by,
               new_appointment_date, supplier_reply, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            $id,
            (int) $seqRow['s'] + 1,
            int_or($body['contacted_by'] ?? null),
            nul($body['channel'] ?? null),
            $j['expected_arrival'],
            $newEta,
            boolInt($body['affects_appointment'] ?? null),
            boolInt($body['customer_notified'] ?? null),
            int_or($body['notified_by'] ?? null),
            nul($body['new_appointment_date'] ?? null),
            nul($body['supplier_reply'] ?? null),
            nul($body['note'] ?? null)
        );
        $q->run(
            'UPDATE lens_jobs SET follow_up_count = follow_up_count + 1,
               expected_arrival = COALESCE(?, expected_arrival) WHERE id = ?',
            $newEta,
            $id
        );
        if (nul($body['new_appointment_date'] ?? null) !== null && $j['order_id']) {
            $q->run(
                'UPDATE custom_orders SET appointment_date = ? WHERE id = ?',
                str_or($body['new_appointment_date']),
                (int) $j['order_id']
            );
        }
        logEvent($q, int_or($j['case_id']), [
            'action'      => 'lens_followup',
            'entity'      => 'lens_job',
            'entity_id'   => $id,
            'employee_id' => int_or($body['contacted_by'] ?? null),
            'note'        => $newEta !== null ? "ETA ใหม่ $newEta" : nul($body['note'] ?? null),
        ]);
    });

    return lensJobDetail($id);
});

POST('/api/lens-jobs/:id/receive', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $j    = Db::get('SELECT * FROM lens_jobs WHERE id = ?', $id);
    if (!$j) {
        missing();
    }
    Db::tx(function (Tx $q) use ($id, $j, $body) {
        $q->run(
            "UPDATE lens_jobs SET status = 'ready', received_at = ?, received_by = ?,
               arrival_checked_by = ?, lens_checked = 1 WHERE id = ?",
            str_or($body['received_at'] ?? null) ?: nowStamp(),
            int_or($body['received_by'] ?? null),
            int_or($body['arrival_checked_by'] ?? null) ?? int_or($body['received_by'] ?? null),
            $id
        );
        logEvent($q, int_or($j['case_id']), [
            'action'      => 'lens_received',
            'entity'      => 'lens_job',
            'entity_id'   => $id,
            'employee_id' => int_or($body['received_by'] ?? null),
            'note'        => nul($body['note'] ?? null),
        ]);
        setStatus($q, int_or($j['case_id']), 'lens_received', [
            'employee_id' => int_or($body['received_by'] ?? null),
            'action'      => 'lens_received',
        ]);
    });
    return lensJobDetail($id);
});
