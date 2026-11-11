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
$saveDelivery = upsertFactory([
    'table'  => 'case_deliveries',
    'action' => 'delivered',
    'status' => 'pickup',
    'cols'   => ['order_id', 'delivered_at', 'handed_over_by', 'grinder_employee_id', 'received_by_customer_name', 'note'],
    'intCols' => ['order_id', 'handed_over_by', 'grinder_employee_id'],
]);

/**
 * วันส่งมอบ — พนักงานทั่วไปได้ "ตอนนี้" ของเซิร์ฟเวอร์เสมอ ค่าที่หน้าเว็บส่งมาไม่นับ
 * แอดมินขึ้นไป (system.zone) ลงย้อนหลังได้ เช่น ส่งแว่นไปแล้วแต่ลืมกด (ร้านขอ 22 ต.ค. 2026)
 * ส่งมอบไปแล้วบันทึกซ้ำ วันเดิมต้องอยู่ — แก้วันที่บันทึกแล้วต้องผ่าน PUT ข้างล่างที่บังคับเหตุผล
 */
POST('/api/case-deliveries', function (array $req) use ($saveDelivery) {
    $caseId = int_or($req['body']['case_id'] ?? null);
    $ex = $caseId ? Db::get('SELECT delivered_at FROM case_deliveries WHERE case_id = ?', $caseId) : null;
    /* คนเจียบังคับตั้งแต่ 10 พ.ย. 2026 (ร้านขอ) — เฉพาะการส่งมอบครั้งแรก
       เคสที่ส่งมอบไปก่อนหน้านี้ยังเป็น NULL ได้ บันทึกซ้ำไม่โดนบล็อก
       0 = "ไม่มีคนเจีย" (11 พ.ย. 2026) — งานที่ไม่ได้เจีย เลือกได้แทนการเลือกบัญชีผู้ดูแลระบบ
       ค่าคอมงานเจียใน HRMS ไม่จ่ายงานที่เป็น 0 */
    $grinder = int_or($req['body']['grinder_employee_id'] ?? null);
    if (empty($ex['delivered_at']) && ($grinder === null || $grinder < 0)) {
        bad('กรุณาเลือกคนเจีย');
    }
    /* หลักฐานก่อนส่งมอบ (processes.php) — ตรวจตั้งแต่บันทึกฟอร์ม ไม่ใช่แค่ตอนยืนยันขั้น
       แท็บที่เปิดค้างไว้จะได้ไม่บันทึกวันส่งมอบทิ้งไว้ทั้งที่ยืนยันขั้นไม่ได้ */
    if (empty($ex['delivered_at']) && $caseId && ($gaps = processBlocking(caseDetail($caseId))['delivery'])) {
        bad('ยังส่งมอบไม่ได้ — ขาด: ' . implode(', ', $gaps));
    }
    $actor = StockModule::actor();
    if (!empty($ex['delivered_at'])) {
        $req['body']['delivered_at'] = $ex['delivered_at'];
    } elseif ($actor && \Optic\Roles::systemZone($actor['roles'] ?? [])) {
        $at = str_or($req['body']['delivered_at'] ?? null);
        $req['body']['delivered_at'] = $at === null ? nowStamp() : deliveryStamp($at);
    } else {
        $req['body']['delivered_at'] = nowStamp();
    }
    return $saveDelivery($req);
});

/** วันเวลาส่งมอบที่แอดมินพิมพ์มา → 'Y-m-d H:i:s' · ห้ามอนาคต (เผื่อนาฬิกาเครื่องเร็ว 5 นาที) */
function deliveryStamp(string $at): string
{
    $at = str_replace('T', ' ', trim($at));
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', $at)
        || !DateTime::createFromFormat('Y-m-d H:i', substr($at, 0, 16))) {
        bad('วันเวลาส่งมอบไม่ถูกต้อง');
    }
    if (strlen($at) === 16) {
        $at .= ':00';
    }
    if ($at > nowStamp(new DateTime('+5 minutes'))) {
        bad('วันเวลาส่งมอบต้องไม่เป็นเวลาในอนาคต');
    }
    return $at;
}

/**
 * แก้วันส่งมอบที่บันทึกไปแล้ว — แอดมินขึ้นไปเท่านั้น (ด่านเดียวกับแก้รายการรับเงิน)
 *
 * บังคับเหตุผล · ค่าเก่า → ค่าใหม่ลงไทม์ไลน์ของเคส · บิลของเคสที่ปิดตอนส่งมอบ
 * (วันปิด = วันส่งมอบเดิม) ขยับวันปิดตาม เพราะรายงานยอดขายนับตามวันปิดบิล ·
 * บิลที่ปิดด้วยมือคนละวันไม่ถูกแตะ
 */
PUT('/api/case-deliveries/:case_id/date', function (array $req) {
    $caseId = int_or($req['params']['case_id']) ?? 0;
    $body   = $req['body'];
    $actor  = StockModule::actor();
    if (!$actor || !\Optic\Roles::systemZone($actor['roles'] ?? [])) {
        throw new HttpError(403, 'แก้วันส่งมอบได้เฉพาะแอดมินหรือเจ้าของร้าน', ['reason' => 'forbidden']);
    }
    $reason = trim((string) ($body['reason'] ?? ''));
    if ($reason === '') {
        bad('กรุณาใส่เหตุผลที่แก้ไข');
    }
    $at = deliveryStamp((string) ($body['delivered_at'] ?? ''));

    Db::tx(function (Tx $q) use ($caseId, $at, $reason, $actor) {
        $d = $q->get('SELECT id, delivered_at FROM case_deliveries WHERE case_id = ? FOR UPDATE', $caseId);
        if (!$d || empty($d['delivered_at'])) {
            bad('เคสนี้ยังไม่ได้ส่งมอบ');
        }
        $old = (string) $d['delivered_at'];
        if ($old === $at) {
            bad('ไม่มีอะไรเปลี่ยน');
        }
        $q->run('UPDATE case_deliveries SET delivered_at = ? WHERE id = ?', $at, (int) $d['id']);
        $moved = $q->run(
            'UPDATE custom_orders SET order_close_date = ?
              WHERE case_id = ? AND order_closed = 1 AND order_close_date = ?',
            $at, $caseId, $old
        );

        $by = (string) ($actor['displayName'] ?? $actor['username'] ?? '');
        logEvent($q, $caseId, [
            'action'      => 'delivery_date_edited',
            'entity'      => 'case_deliveries',
            'entity_id'   => (int) $d['id'],
            'employee_id' => $actor['employeeId'] ?? null,
            'note'        => 'วันส่งมอบ ' . substr($old, 0, 16) . ' → ' . substr($at, 0, 16)
                . " — เหตุผล: $reason" . ($by !== '' ? " (แก้โดย $by)" : ''),
            'payload'     => ['before' => $old, 'after' => $at, 'reason' => $reason, 'by' => $by,
                'orders_moved' => (int) ($moved['affected'] ?? 0)],
        ]);
    });

    return Db::get('SELECT * FROM case_deliveries WHERE case_id = ?', $caseId);
});

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
