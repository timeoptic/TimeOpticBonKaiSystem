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
    /* สามแบบ: คิวที่ยังทำอยู่ (ปกติ) · เฉพาะเคสที่จบแล้ว (closed=1) ·
       ทั้งสองอย่างรวมกัน (open=0) — กระดานงานเคยมีแต่แบบที่สาม */
    $closedOnly = str_or($q['closed'] ?? null) === '1';
    if ($closedOnly) {
        $where[] = 'is_terminal = 1';
    } elseif (str_or($q['open'] ?? null) !== '0') {
        $where[] = 'is_terminal = 0';
    }
    if (($q['rush'] ?? null) === '1') {
        $where[] = 'is_rush = 1';
    }
    /* The shop thinks in two books of work before it thinks in anything else:
       งาน SightFirst and งานลูกค้าร้าน. That split is customer_category, not
       case_type — case_type says what the job is (ตัดแว่นใหม่ / เปลี่ยนเลนส์ / …),
       which is a different question and used to be crowded out by this one.
       Everything unlabelled is the shop's own: a case nobody marked came in
       through the door. */
    /* จงใจไม่ยัดลง $where ตรงนี้ — โหมดแบ่งหน้าต้องนับเลขบนปุ่ม
       "ทั้งหมด / SightFirst / ลูกค้าร้าน" จากชุดก่อนกรองด้วยปุ่มพวกนี้เอง
       ไม่งั้นพอกด SightFirst อีกสองปุ่มจะขึ้น 0 ทั้งคู่ */
    $client = str_or($q['client'] ?? null);
    $clientSql = match ($client) {
        'sightfirst' => "customer_category = 'sight_first'",
        'shop'       => "(customer_category IS NULL OR customer_category <> 'sight_first')",
        default      => null,
    };
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

    /* เคสที่จบแล้วไม่มีคิวให้เรียง — สิ่งที่อยากเห็นก่อนคือ "เพิ่งปิดไปเมื่อไหร่" */
    $order = $closedOnly
        ? 'closed_at IS NULL, closed_at DESC, opened_at DESC'
        : 'is_rush DESC, status_order, opened_at';

    if (str_or($q['paged'] ?? null) === '1') {
        return caseBoardPage($q, $where, $args, $clientSql, $client, $closedOnly, $order);
    }

    /* ── โหมดเดิม: คืนทั้งก้อนเป็น array ────────────────────────────────────
       ProcessCaseList กับหน้าขั้นตอนทั้งห้ายังใช้เส้นนี้ (กรองด้วย stage_group
       เหลือหลักสิบแถว จึงไม่ต้องแบ่งหน้า) · กระดานงานย้ายไป paged=1 แล้ว */
    if ($clientSql) {
        $where[] = $clientSql;
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    /**
     * เพดานเดิมคือ 1,000 ซึ่งพอตอนที่ฐานมีข้อมูลตัวอย่างไม่กี่สิบเคส
     *
     * พอข้อมูลจริงเข้ามา เคสที่ยังทำไม่จบมี 1,164 เคส — กระดานงานจึงตัดทิ้ง 164 เคส
     * เงียบ ๆ และที่แย่กว่านั้นคือ **ตัวเลขบนชิปผิด** เพราะหน้าเว็บนับจากแถวที่ได้มา
     * ไม่ใช่จากของจริง (ชิป SightFirst ขึ้น 9 ทั้งที่มี 200)
     *
     * 5,000 คือเพดานที่เผื่อไว้ให้โตได้อีกหลายปี · ไม่ปล่อยไร้เพดานเพราะพารามิเตอร์
     * ที่ผู้ใช้ส่งมาได้ไม่ควรสั่งให้ฐานคายทุกแถวที่มี
     */
    $args[] = min(int_or($q['limit'] ?? null, 300), 5000);

    $rows = Db::all(
        "SELECT * FROM v_case_board $sqlWhere ORDER BY $order LIMIT ?",
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

/**
 * กระดานงานแบบแบ่งหน้า — ค้นหา กรอง นับ และตัดหน้า ทำที่นี่ทั้งหมด
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ทำไมไม่ใช่ LIMIT/OFFSET ตรง ๆ ใน SQL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * คอลัมน์บนกระดานคือ `process_stage` ซึ่ง **ไม่ใช่คอลัมน์ในฐานข้อมูล** — มันถูก
 * คำนวณใน PHP โดย caseStageMap() (api/routes/processes.php) จากงานที่เคสทำไป
 * จริง ไม่ใช่จาก cases.status ที่คนตั้งด้วยมือแล้วเพี้ยน · เขียน
 * `WHERE process_stage = ?` หรือ `GROUP BY` ลง SQL จึงทำไม่ได้
 *
 * ลำดับที่นี่จึงเป็น: เอา id ที่ตรงตัวกรองมาก่อน (แค่สองคอลัมน์ ไม่ใช่ทั้งแถว)
 * → คำนวณขั้นของ id ชุดนั้น → นับ/กรอง/ตัดหน้าใน PHP → ค่อยดึงข้อมูลเต็มเฉพาะ
 * แถวที่จะส่งจริง · หน้าเมนูหลักใช้วิธีเดียวกันนี้อยู่แล้ว (routes/dashboard.php)
 *
 * ของเดิมส่ง 1,173 แถวเต็ม (~1 MB) ใหม่ทุกครั้งที่พิมพ์ค้นหาหรือกดชิป แล้วให้
 * เบราว์เซอร์กรองเอง · ตอนนี้ส่ง 20 แถวต่อคอลัมน์ พร้อมยอดรวมที่ตรงกับตัวกรอง
 *
 * ─────────────────────────────────────────────────────────────────────────
 * รูปแบบที่คืน
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   group_by=stage : { groups: { <ขั้น>: {rows, total} }, counts, by_stage }
 *   ไม่ใช่         : { rows, total, counts, by_stage }
 *
 * `counts` (ทั้งหมด/SightFirst/ลูกค้าร้าน) นับโดย **ไม่สนตัวกรอง client** เพราะ
 * มันคือเลขบนปุ่มที่ใช้เลือก client เอง · `by_stage` นับโดยไม่สนตัวกรอง stage
 * ด้วยเหตุผลเดียวกัน — และเพื่อให้ "ซ่อนขั้นที่ว่าง" รู้ว่าคอลัมน์ไหนว่างจริง
 */
function caseBoardPage(
    array $q,
    array $where,
    array $args,
    ?string $clientSql,
    string $client,
    bool $closedOnly,
    string $order
): array {
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $idRows = Db::all(
        "SELECT id, customer_category FROM v_case_board $sqlWhere ORDER BY $order",
        ...$args
    );

    $isSf = static fn(array $r) => ($r['customer_category'] ?? null) === 'sight_first';
    $counts = ['all' => count($idRows), 'sightfirst' => 0, 'shop' => 0];
    foreach ($idRows as $r) {
        $counts[$isSf($r) ? 'sightfirst' : 'shop']++;
    }
    if ($clientSql !== null) {
        $keep = $client === 'sightfirst' ? $isSf : static fn(array $r) => !$isSf($r);
        $idRows = array_filter($idRows, $keep);
    }
    $ids = array_map(static fn(array $r) => (int) $r['id'], array_values($idRows));

    /**
     * เคสที่ปิดแล้วอยู่ขั้น "จบงาน" ทุกใบตามนิยาม (caseStageMap บังคับไว้ตอน
     * is_terminal = 1) — ไม่ต้องคำนวณขั้นเพื่อจะนับ ซึ่งสำคัญมากตรงนี้เพราะกอง
     * เคสที่จบแล้วมี 7,752 ใบ · ขั้นของ 20 ใบที่จะส่งจริงยังคำนวณอยู่ ใน
     * caseBoardRows() ด้านล่าง เพื่อให้ตัวเลข "x/6 ขั้น" บนการ์ดยังเป็นของจริง
     */
    $stages = $closedOnly ? [] : caseStageMap($ids);
    if ($closedOnly) {
        $byStage = ['done' => count($ids)];
    } else {
        $byStage = array_fill_keys(CASE_PROCESSES, 0);
        foreach ($ids as $id) {
            $s = $stages[$id]['process_stage'] ?? null;
            if ($s !== null) {
                $byStage[$s] = ($byStage[$s] ?? 0) + 1;
            }
        }
    }
    $stageOf = static fn(int $id) => $closedOnly ? 'done' : ($stages[$id]['process_stage'] ?? null);

    $perPage = min(max(int_or($q['limit'] ?? null, 20), 1), 200);

    /* แบบการ์ด: ขอครั้งเดียวได้ N ใบแรกของทุกคอลัมน์ ไม่ใช่ยิงหกครั้ง */
    if (str_or($q['group_by'] ?? null) === 'stage') {
        $per  = min(max(int_or($q['per_group'] ?? null, 20), 1), 200);
        $pick = [];
        foreach ($ids as $id) {
            $s = $stageOf($id);
            if ($s !== null && count($pick[$s] ?? []) < $per) {
                $pick[$s][] = $id;
            }
        }
        /* ดึงข้อมูลเต็มของทุกคอลัมน์ในคิวรีเดียว แล้วค่อยแยกกลับเข้าคอลัมน์ */
        $flat = caseBoardRows(array_merge([], ...array_values($pick)), $stages);
        $byId = [];
        foreach ($flat as $r) {
            $byId[(int) $r['id']] = $r;
        }
        $groups = [];
        foreach ($byStage as $stage => $total) {
            $groups[$stage] = [
                'rows'  => array_values(array_filter(array_map(
                    static fn(int $id) => $byId[$id] ?? null,
                    $pick[$stage] ?? []
                ))),
                'total' => $total,
            ];
        }
        return ['groups' => $groups, 'counts' => $counts, 'by_stage' => $byStage];
    }

    /* แบบลิสต์ และปุ่ม "โหลดเพิ่ม" ของคอลัมน์เดียว (ส่ง stage มาด้วย) */
    if ($wantStage = str_or($q['stage'] ?? null)) {
        $ids = array_values(array_filter($ids, static fn(int $id) => $stageOf($id) === $wantStage));
    }
    $offset = max(int_or($q['offset'] ?? null, 0), 0);

    return [
        'rows'     => caseBoardRows(array_slice($ids, $offset, $perPage), $stages),
        'total'    => count($ids),
        'counts'   => $counts,
        'by_stage' => $byStage,
    ];
}

/**
 * ข้อมูลเต็มของ id ชุดหนึ่ง เรียงตามลำดับที่ส่งเข้ามา
 *
 * ลำดับต้องมาจาก `$ids` ไม่ใช่จากที่ `IN (...)` คืนมา — MySQL ไม่รับประกันว่า
 * `IN` จะคืนตามลำดับที่เขียน และลำดับของกระดานคือ "ด่วนก่อน แล้วตามคิว" ที่
 * ORDER BY ตัดสินไปแล้วตอนเอา id มา
 *
 * `$stages` ที่คำนวณไว้แล้วถูกใช้ซ้ำ ส่วน id ที่ยังไม่มีในนั้น (กองเคสที่จบแล้ว
 * ซึ่งข้ามการคำนวณทั้งกองไป) คำนวณตรงนี้เฉพาะแถวที่จะส่งจริง
 */
function caseBoardRows(array $ids, array &$stages): array
{
    if (!$ids) {
        return [];
    }
    $missing = array_values(array_filter($ids, static fn(int $id) => !isset($stages[$id])));
    if ($missing) {
        $stages += caseStageMap($missing);
    }

    $in   = implode(',', array_fill(0, count($ids), '?'));
    $byId = [];
    foreach (Db::all("SELECT * FROM v_case_board WHERE id IN ($in)", ...$ids) as $r) {
        $byId[(int) $r['id']] = $r;
    }

    $out = [];
    foreach ($ids as $id) {
        if (!isset($byId[$id])) {
            continue;
        }
        $out[] = $byId[$id] + ($stages[$id] ?? ['process_stage' => null, 'process_done' => 0]);
    }
    return $out;
}

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
    /* ที่มาของลูกค้า — อ่านจากโน้ตให้ ถ้าคนกรอกไม่ได้เลือกมาเอง
       ค่าที่คนเลือกชนะเสมอ: ระบบเดาจากข้อความ ส่วนคนที่นั่งอยู่ตรงนั้นรู้จริง */
    $category = CaseSource::valid($body['customer_category'] ?? null)
        ?? CaseSource::detect(
            $body['notes'] ?? null,
            $body['referral_source'] ?? null
        )['sourceType'];

    $id = Db::tx(function (Tx $q) use ($body, $cid, $code, $status, $category) {
        $r = $q->run(
            'INSERT INTO cases (case_code, customer_id, status, is_new_customer, is_rush,
               priority_note, received_by, recorded_by, referral_source, referral_note,
               case_type, customer_category, reception_note, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
            $category,
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
    /* แก้โน้ตแล้วประเภทตามไปด้วย · เลือกมาเองก็ใช้ของที่เลือก
       ตรงนี้ไม่ลบเคสออนไลน์ทิ้ง แม้โน้ตจะเข้าเงื่อนไข — การกดบันทึกแล้วเคสหาย
       ต่อหน้าอ่านยังไงก็เป็นบั๊ก · การลบเดินผ่าน api/cli/classify-cases.php
       ซึ่งมี --dry-run และเขียนสำเนาไว้ก่อนลบ */
    $category = CaseSource::valid($body['customer_category'] ?? null)
        ?? CaseSource::detect(
            $body['notes'] ?? null,
            $body['referral_source'] ?? null
        )['sourceType'];
    Db::run(
        'UPDATE cases SET is_rush = ?, priority_note = ?, received_by = ?,
           referral_source = ?, referral_note = ?, case_type = ?, customer_category = ?,
           reception_note = ?, notes = ? WHERE id = ?',
        boolInt($body['is_rush'] ?? null),
        nul($body['priority_note'] ?? null),
        int_or($body['received_by'] ?? null),
        nul($body['referral_source'] ?? null),
        nul($body['referral_note'] ?? null),
        nul($body['case_type'] ?? null),
        $category,
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
