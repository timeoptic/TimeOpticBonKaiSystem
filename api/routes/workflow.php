<?php
/**
 * The bench steps between "lenses in hand" and "customer collects":
 * centering, frame fitting, the production job, and QC.
 *
 * The first three are one row per case, so they share upsertFactory().
 */
declare(strict_types=1);

POST('/api/centerings', upsertFactory([
    'table'  => 'centerings',
    'action' => 'centering_saved',
    'status' => 'order_confirm',
    'cols'   => ['order_id', 'frame_product_id', 'r_pd', 'l_pd', 'pd_total', 'r_height', 'l_height',
        'r_seg_height', 'l_seg_height', 'vertex_distance', 'pantoscopic_tilt', 'wrap_angle',
        'center_point_note', 'other_params', 'measured_at',
        'performed_by', 'photo_taken_by', 'recorded_by', 'notes'],
    'intCols' => ['order_id', 'frame_product_id', 'performed_by', 'photo_taken_by', 'recorded_by'],
]));

GET('/api/centerings/:case_id', fn(array $r) => Db::get(
    'SELECT * FROM centerings WHERE case_id = ? ORDER BY id DESC LIMIT 1',
    int_or($r['params']['case_id'])
));

POST('/api/frame-fittings', upsertFactory([
    'table'  => 'frame_fittings',
    'action' => 'frame_fitting_saved',
    'status' => 'lens_source',
    'cols'   => ['order_id', 'frame_size', 'lens_width', 'bridge_width', 'temple_length', 'ed', 'dbl',
        'frame_box_a', 'frame_box_b',
        'r_pd', 'l_pd', 'r_height', 'l_height', 'fitting_data', 'other_params',
        'performed_by', 'recorded_by', 'notes'],
    'intCols' => ['order_id', 'performed_by', 'recorded_by'],
]));

GET('/api/frame-fittings/:case_id', fn(array $r) => Db::get(
    'SELECT * FROM frame_fittings WHERE case_id = ? ORDER BY id DESC LIMIT 1',
    int_or($r['params']['case_id'])
));

POST('/api/production-jobs', upsertFactory([
    'table'  => 'production_jobs',
    'action' => 'production_saved',
    /* the packing checklist and its two employees are no longer on the บันทึกงานผลิต
       form, so they are not listed here either — an upsert writes every column it
       names, and naming a field nobody sends is how saved values get wiped */
    'cols'   => ['order_id', 'matched_at', 'matched_by', 'match_customer_ok', 'match_rx_ok',
        'match_note', 'assigned_technician', 'edging_started_at', 'edging_finished_at',
        'edged_by', 'edging_remark', 'packed_at', 'packing_note', 'pickup_at',
        'handed_over_by', 'adjustment_by', 'adjustment_remark'],
    'intCols' => ['order_id', 'matched_by', 'assigned_technician', 'edged_by',
        'handed_over_by', 'adjustment_by'],
    'boolCols' => ['match_customer_ok', 'match_rx_ok'],
]));

/**
 * QC keeps every attempt, so this appends rather than upserts. A failure
 * pushes the case back to qc_failed; a pass moves it on to packing.
 */
POST('/api/qc-checks', function (array $req) {
    $body   = $req['body'];
    $caseId = int_or($body['case_id'] ?? null);
    if (!$caseId) {
        bad('กรุณาระบุเคส');
    }
    $result = str_or($body['result'] ?? null) === 'fail' ? 'fail' : 'pass';
    $lensOd = boolInt($body['check_lens_od'] ?? null);
    $lensOs = boolInt($body['check_lens_os'] ?? null);

    $id = Db::tx(function (Tx $q) use ($body, $caseId, $result, $lensOd, $lensOs) {
        $a = $q->get('SELECT COALESCE(MAX(attempt),0) n FROM qc_checks WHERE case_id = ?', $caseId);
        $r = $q->run(
            'INSERT INTO qc_checks (case_id, job_id, attempt, result, action_taken,
               check_rx, check_centering, check_lens, check_lens_od, check_lens_os,
               check_frame, check_finish, defects, note, checked_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            $caseId,
            int_or($body['job_id'] ?? null),
            (int) $a['n'] + 1,
            $result,
            nul($body['action_taken'] ?? null),
            boolInt($body['check_rx'] ?? null),
            boolInt($body['check_centering'] ?? null),
            $lensOd && $lensOs ? 1 : 0,
            $lensOd,
            $lensOs,
            boolInt($body['check_frame'] ?? null),
            boolInt($body['check_finish'] ?? null),
            nul($body['defects'] ?? null),
            nul($body['note'] ?? null),
            int_or($body['checked_by'] ?? null)
        );
        logEvent($q, $caseId, [
            'action'      => 'qc_' . $result,
            'entity'      => 'qc_check',
            'entity_id'   => $r['insertId'],
            'employee_id' => int_or($body['checked_by'] ?? null),
            'note'        => nul($body['defects'] ?? null),
        ]);
        setStatus($q, $caseId, $result === 'pass' ? 'packing' : 'qc_failed', [
            'employee_id' => int_or($body['checked_by'] ?? null),
            'action'      => 'qc_' . $result,
        ]);
        /* A failed check is the one place a process is put into "มีปัญหา"
           without someone pressing a button for it, and it sends production
           back to work. A pass is NOT auto-confirmed here — ✓ QC ผ่าน stays a
           deliberate action (api/routes/processes.php). */
        if ($result === 'fail') {
            saveProcess($q, $caseId, 'qc', ['status' => 'problem', 'completed_at' => null]);
            saveProcess($q, $caseId, 'production', ['status' => 'in_progress', 'completed_at' => null]);
        }
        return $r['insertId'];
    });

    return Db::get('SELECT * FROM qc_checks WHERE id = ?', $id);
});

/**
 * "เริ่มผลิต" — only allowed once frame + both lenses are attached to the
 * order (fill already happened) and none of the three is already sold.
 * Withdraws all three via pickLot() in one transaction and marks the job
 * IN_PRODUCTION.
 */
POST('/api/production-jobs/:id/start', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    if ($job['started_at'] !== null || $job['status'] === 'IN_PRODUCTION' || $job['status'] === 'COMPLETED') {
        bad('งานนี้เริ่มผลิตไปแล้ว');
    }
    $order = $job['order_id'] ? Db::get('SELECT * FROM custom_orders WHERE id = ?', (int) $job['order_id']) : null;
    if (!$order) {
        bad('ไม่พบออเดอร์ของเคสนี้');
    }
    $items = [
        'frame'   => $order['frame_product_id'],
        'lens_od' => $order['lens_product_id'],
        'lens_os' => $order['right_lens_product_id'],
    ];
    foreach ($items as $type => $sid) {
        if (!$sid) {
            bad("ยังไม่มีสินค้า ($type) ในออเดอร์ — เข้าสู่ Flow สั่งสินค้าก่อน");
        }
        $s = Db::get('SELECT sold FROM v_stock_lot WHERE id = ?', (int) $sid);
        if (!$s || (int) $s['sold']) {
            bad("สินค้า ($type) ไม่พร้อมในสต็อก — เข้าสู่ Flow สั่งสินค้าก่อน");
        }
    }

    $empId = int_or($body['employee_id'] ?? null);
    Db::tx(function (Tx $q) use ($id, $job, $items, $empId) {
        foreach ($items as $type => $sid) {
            if (!pickLot($q, (int) $sid, 'เริ่มผลิต')) {
                bad("สินค้า ($type) ถูกขายไปแล้วระหว่างนี้ — ลองใหม่");
            }
            $q->run(
                'INSERT INTO production_withdrawals (case_id, production_job_id, item_type,
                   stock_lot_id, is_extra, withdrawn_by, idem_key) VALUES (?,?,?,?,0,?,?)',
                (int) $job['case_id'], $id, $type, (int) $sid, $empId,
                'case-' . (int) $job['case_id'] . '-' . $type . '-1'
            );
            /* the hold taken at the เลนส์ step becomes the cut — leaving it
               'active' would keep the unit reserved after it had already left
               the shelf, and every other case would see one fewer than there is */
            $q->run(
                "UPDATE stock_reservations SET status='consumed', consumed_at=?
                  WHERE case_id=? AND item_type=? AND status='active'",
                nowStamp(), (int) $job['case_id'], $type
            );
        }
        $q->run(
            "UPDATE production_jobs SET status='IN_PRODUCTION', started_at=?, started_by=? WHERE id=?",
            nowStamp(), $empId, $id
        );
        logEvent($q, (int) $job['case_id'], [
            'action' => 'production_started', 'entity' => 'production_job',
            'entity_id' => $id, 'employee_id' => $empId,
        ]);
        /* the process is now under way — confirming it stays a button press */
        saveProcess($q, (int) $job['case_id'], 'production', [
            'status' => 'in_progress', 'started_at' => nowStamp(), 'completed_at' => null,
        ]);
        /* the move itself logs as a status change — the action above already named it,
           and two rows saying the same thing made the production timeline read double */
        setStatus($q, (int) $job['case_id'], 'edging', ['employee_id' => $empId]);
    });
    return Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
});

/** "เบิกเพิ่ม" — an item already withdrawn broke; pick a replacement unit. */
POST('/api/production-jobs/:id/withdraw', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    $type = str_or($body['item_type'] ?? null);
    if (!in_array($type, ['frame', 'lens_od', 'lens_os'], true)) {
        bad('กรุณาระบุประเภทสินค้า (frame, lens_od, lens_os)');
    }
    $sid = int_or($body['stock_lot_id'] ?? null);
    if (!$sid) {
        bad('กรุณาเลือกสินค้าจากสต็อก');
    }
    $s = Db::get('SELECT sold FROM v_stock_lot WHERE id = ?', $sid);
    if (!$s || (int) $s['sold']) {
        bad('สินค้าชิ้นนี้ไม่พร้อมในสต็อก');
    }
    $empId = int_or($body['employee_id'] ?? null);

    Db::tx(function (Tx $q) use ($id, $job, $type, $sid, $empId, $body) {
        if (!pickLot($q, $sid, 'เบิกเพิ่ม: ' . str_or($body['reason'] ?? null))) {
            bad('สินค้าชิ้นนี้ถูกขายไปแล้วระหว่างนี้ — ลองใหม่');
        }
        /* the key stays the same however many times this call is retried:
           it is the n-th time this case took this piece, not a fresh uuid */
        $seq = 1 + (int) $q->get(
            'SELECT COUNT(*) n FROM production_withdrawals WHERE case_id = ? AND item_type = ?',
            (int) $job['case_id'], $type
        )['n'];
        $q->run(
            'INSERT INTO production_withdrawals (case_id, production_job_id, item_type,
               stock_lot_id, is_extra, reason, withdrawn_by, idem_key) VALUES (?,?,?,?,1,?,?,?)',
            (int) $job['case_id'], $id, $type, $sid, nul($body['reason'] ?? null), $empId,
            'case-' . (int) $job['case_id'] . '-' . $type . '-' . $seq
        );
        logEvent($q, (int) $job['case_id'], [
            'action' => 'production_withdraw_extra', 'entity' => 'production_withdrawal',
            'employee_id' => $empId, 'note' => "$type: " . str_or($body['reason'] ?? null),
        ]);
    });
    return Db::all('SELECT * FROM production_withdrawals WHERE production_job_id = ? ORDER BY id', $id);
});

/** "หยุดการผลิต / รอสินค้า" */
POST('/api/production-jobs/:id/pause', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    $empId = int_or($body['employee_id'] ?? null);
    Db::tx(function (Tx $q) use ($id, $job, $empId, $body) {
        /* หยุดรอสินค้า: เก็บว่ารออะไร เพราะอะไร ใครสั่งหยุด เมื่อไหร่ —
           กระดานผลิตจะได้บอกได้ว่าเคสนี้ค้างเพราะรอชิ้นไหน */
        $q->run(
            "UPDATE production_jobs
                SET status='WAITING_FOR_ITEM', waiting_item=?, waiting_reason=?,
                    paused_at=?, paused_by=?
              WHERE id=?",
            nul($body['waiting_item'] ?? null),
            nul($body['reason'] ?? null),
            nowStamp(),
            $empId,
            $id
        );
        logEvent($q, (int) $job['case_id'], [
            'action' => 'production_paused', 'entity' => 'production_job', 'entity_id' => $id,
            'employee_id' => $empId, 'note' => str_or($body['reason'] ?? null),
        ]);
        saveProcess($q, (int) $job['case_id'], 'production', ['status' => 'waiting']);
        setStatus($q, (int) $job['case_id'], 'waiting_edging', ['employee_id' => $empId]);
    });
    return Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
});

/** กลับมาผลิตต่อ */
POST('/api/production-jobs/:id/resume', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    $empId = int_or($body['employee_id'] ?? null);
    Db::tx(function (Tx $q) use ($id, $job, $empId) {
        $q->run(
            "UPDATE production_jobs
                SET status='IN_PRODUCTION', waiting_item=NULL, waiting_reason=NULL,
                    paused_at=NULL, paused_by=NULL
              WHERE id=?",
            $id
        );
        logEvent($q, (int) $job['case_id'], [
            'action' => 'production_resumed', 'entity' => 'production_job', 'entity_id' => $id,
            'employee_id' => $empId,
        ]);
        saveProcess($q, (int) $job['case_id'], 'production', ['status' => 'in_progress']);
        setStatus($q, (int) $job['case_id'], 'edging', ['employee_id' => $empId]);
    });
    return Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
});

/** ส่งมอบ — records who handed it over and who received it. */
POST('/api/production-jobs/:id/deliver', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    $empId = int_or($body['handed_over_by'] ?? null);
    Db::tx(function (Tx $q) use ($id, $job, $empId, $body) {
        $q->run(
            "UPDATE production_jobs SET status='COMPLETED', pickup_at=?, handed_over_by=?,
               received_by_customer_name=? WHERE id=?",
            str_or($body['pickup_at'] ?? null) ?: nowStamp(),
            $empId,
            nul($body['received_by_customer_name'] ?? null),
            $id
        );
        logEvent($q, (int) $job['case_id'], [
            'action' => 'delivered', 'entity' => 'production_job', 'entity_id' => $id,
            'employee_id' => $empId, 'note' => str_or($body['received_by_customer_name'] ?? null),
        ]);
        saveProcess($q, (int) $job['case_id'], 'delivery', [
            'status' => 'in_progress', 'started_at' => nowStamp(),
        ]);
        setStatus($q, (int) $job['case_id'], 'pickup', ['employee_id' => $empId]);
    });
    return Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
});
