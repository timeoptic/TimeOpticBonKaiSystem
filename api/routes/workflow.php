<?php
/**
 * The two measuring steps that write one row per case — centering and frame
 * fitting — and the handover that ends a case.
 *
 * The first two share upsertFactory(). The handover has its own table
 * (case_deliveries) rather than a column on the production job it used to hang
 * off: ห้องผลิตไม่มีแล้ว แต่การส่งมอบยังมี.
 */
declare(strict_types=1);

POST('/api/centerings', upsertFactory([
    'table'  => 'centerings',
    'action' => 'centering_saved',
    'status' => 'centering',
    'cols'   => ['order_id', 'frame_product_id', 'r_pd', 'l_pd', 'pd_total', 'r_height', 'l_height',
        'r_seg_height', 'l_seg_height', 'vertex_distance', 'pantoscopic_tilt', 'wrap_angle',
        'center_point_note', 'other_params', 'measured_at', 'corridor',
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
    'status' => 'frame_fitting',
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

/**
 * ส่งมอบ — records who handed the glasses over and who received them.
 *
 * Saving this does NOT confirm the ส่งมอบ step; the ✓ on the step is still a
 * deliberate press (api/routes/processes.php), and that press is what closes
 * the case. Saving only moves the case's own status onto ส่งมอบ so the board
 * stops showing it as still waiting to be collected.
 */
POST('/api/case-deliveries', upsertFactory([
    'table'  => 'case_deliveries',
    'action' => 'delivered',
    'status' => 'pickup',
    'cols'   => ['order_id', 'delivered_at', 'handed_over_by', 'received_by_customer_name', 'note'],
    'intCols' => ['order_id', 'handed_over_by'],
]));

GET('/api/case-deliveries/:case_id', fn(array $r) => Db::get(
    'SELECT * FROM case_deliveries WHERE case_id = ?',
    int_or($r['params']['case_id'])
));

/**
 * กระดานส่งมอบ — "ตอนนี้ส่งมอบให้ใครได้บ้าง"
 *
 * ของเดิมถามว่า QC ผ่านหรือยังและมีงานผลิตหรือยัง ซึ่งสองอย่างนั้นไม่มีแล้ว
 * ตอนนี้เกณฑ์เหลือข้อเดียวตามที่ขั้นส่งมอบใช้จริง: มีออเดอร์แล้วหรือยัง
 * (ยอดค้างชำระไม่ปิดกั้นการส่งมอบ — เตือนได้ แต่ห้ามกันไว้)
 */
GET('/api/delivery', function (array $req) {
    $q = $req['query'];

    /* งาน SightFirst กับงานลูกค้าร้านแยกสมุดกันเหมือนกระดานงาน — อ่าน customer_category
       ตัวเดียวกับ /api/cases ไม่ใช่ case_type ซึ่งบอกว่าเป็นงานอะไร */
    $client = str_or($q['client'] ?? null);
    $book = '';
    if ($client === 'sightfirst') {
        $book = " AND b.customer_category = 'sight_first'";
    } elseif ($client === 'shop') {
        $book = " AND (b.customer_category IS NULL OR b.customer_category <> 'sight_first')";
    }

    $rows = Db::all(
        "SELECT b.*,
                d.id AS delivery_id, d.delivered_at,
                cp.status AS delivery_process
           FROM v_case_board b
           LEFT JOIN case_deliveries d ON d.case_id = b.id
           LEFT JOIN case_processes cp ON cp.case_id = b.id AND cp.process = 'delivery'
          WHERE b.is_terminal = 0
            AND d.delivered_at IS NULL
            AND b.stage_group = 'delivery'
            {$book}
          ORDER BY b.is_rush DESC, b.appointment_date IS NULL, b.appointment_date, b.opened_at"
    );

    /* สถานะที่แปลว่า "ของเสร็จแล้ว กำลังรอลูกค้าเข้ามารับ" */
    $waiting = ['ready_notify', 'notified', 'waiting_pickup'];

    $out = [];
    foreach ($rows as $r) {
        $ready = !empty($r['order_id']);
        $r['ready']  = $ready ? 1 : 0;
        $r['reason'] = $ready ? '' : 'ยังไม่มีออเดอร์';
        $r['bucket'] = !$ready ? 'not_ready'
            : (in_array($r['status'], $waiting, true) ? 'waiting_customer' : 'ready');
        $out[] = $r;
    }

    /* ตัวเลขบนการ์ดนับจากคิวที่ยังไม่ส่ง เสมอ — ไม่ว่ากำลังเปิดดูถังไหนอยู่ */
    $summary = ['ready' => 0, 'waiting_customer' => 0, 'not_ready' => 0, 'done_today' => 0];
    foreach ($out as $r) {
        $summary[$r['bucket']]++;
    }
    $summary['done_today'] = (int) (Db::get(
        'SELECT COUNT(*) n FROM case_deliveries WHERE DATE(delivered_at) = ?',
        today()
    )['n'] ?? 0);

    $bucket = str_or($q['bucket'] ?? null);
    $term   = mb_strtolower(str_or($q['q'] ?? null));

    /* ถังที่ห้า "ส่งมอบแล้ว" — เคสที่ปิดไปแล้ว จึงไม่อยู่ในลิสต์ข้างบน (d.delivered_at
       IS NULL ตัดออก) ต้องถามใหม่คนละคำถาม: ย้อนดูของที่ส่งไปแล้วช่วงไหน */
    if ($bucket === 'delivered') {
        $span  = str_or($q['span'] ?? null) ?: 'today';
        $since = '';
        $args  = [];
        if ($span === 'today') {
            $since = 'AND DATE(d.delivered_at) = ?';
            $args[] = today();
        } elseif (ctype_digit($span)) {
            $since = 'AND d.delivered_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
            $args[] = (int) $span;
        }

        $done = Db::all(
            "SELECT b.*,
                    d.id AS delivery_id, d.delivered_at, d.note AS delivery_note,
                    d.received_by_customer_name,
                    CONCAT_WS(' ', e.first_name, e.last_name) AS handed_over_name
               FROM v_case_board b
               JOIN case_deliveries d ON d.case_id = b.id
               LEFT JOIN employees e ON e.id = d.handed_over_by
              WHERE d.delivered_at IS NOT NULL
                {$since}
                {$book}
              ORDER BY d.delivered_at DESC",
            ...$args
        );
        foreach ($done as &$r) {
            $r['bucket'] = 'delivered';
            $r['reason'] = trim((string) ($r['received_by_customer_name'] ?? '')) !== ''
                ? 'ผู้รับ: ' . $r['received_by_customer_name']
                : '';
        }
        unset($r);
        $out = $done;
        $bucket = '';   /* กรองด้วย SQL ไปแล้ว เหลือแค่คำค้น */
    }

    $filtered = array_values(array_filter($out, function ($r) use ($bucket, $term) {
        if ($bucket !== '' && $r['bucket'] !== $bucket) {
            return false;
        }
        if ($term !== '') {
            $hay = mb_strtolower(implode(' ', [
                $r['case_code'], $r['first_name'], $r['last_name'], $r['phone'],
                $r['frame_name'], $r['lens_name'], $r['invoice_code'],
            ]));
            if (mb_strpos($hay, $term) === false) {
                return false;
            }
        }
        return true;
    }));

    return ['summary' => $summary, 'rows' => $filtered];
});
