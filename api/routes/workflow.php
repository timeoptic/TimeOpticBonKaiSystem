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
        'center_point_note', 'other_params', 'performed_by', 'photo_taken_by', 'recorded_by', 'notes'],
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
    'cols'   => ['order_id', 'matched_at', 'matched_by', 'match_customer_ok', 'match_rx_ok',
        'match_note', 'assigned_technician', 'edging_started_at', 'edging_finished_at',
        'edged_by', 'edging_remark', 'pack_glasses', 'pack_case', 'pack_cloth',
        'pack_warranty', 'pack_prescription', 'pack_accessories', 'packed_by',
        'pack_checked_by', 'packed_at', 'packing_note', 'pickup_at', 'handed_over_by',
        'adjustment_by', 'adjustment_remark'],
    'intCols' => ['order_id', 'matched_by', 'assigned_technician', 'edged_by', 'packed_by',
        'pack_checked_by', 'handed_over_by', 'adjustment_by'],
    'boolCols' => ['match_customer_ok', 'match_rx_ok', 'pack_glasses', 'pack_case', 'pack_cloth',
        'pack_warranty', 'pack_prescription', 'pack_accessories'],
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
        return $r['insertId'];
    });

    return Db::get('SELECT * FROM qc_checks WHERE id = ?', $id);
});
