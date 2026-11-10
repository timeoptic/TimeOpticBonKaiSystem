<?php
/** The case board — one case is one customer's job from reception to pickup. */
declare(strict_types=1);

/* Bewell: ใบเบิกเลนส์ — บันทึกการใช้เลนส์ / ยกเลิกเมื่อออเดอร์หรือเคสถูกยกเลิก (ไม่พึ่งลำดับโหลด routes/lens.php) */
require_once __DIR__ . '/../services/LensRequisition.php';

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
    /* ช่วงวันที่ — กรองด้วยวันไหนของเคสก็ได้: เปิดเคส (ค่าตั้งต้น) · นัดรับ · ปิดเคส
       ชื่อคอลัมน์มาจาก match นี้เท่านั้น ไม่ใช่จากค่าที่ส่งมา จึงต่อลง SQL ได้
       · opened_at/closed_at เป็น DATETIME ขอบบนจึงเป็น "ก่อนเที่ยงคืนของวันถัดไป"
       ไม่ใช่ `<= วันนั้น` ซึ่งได้แค่ 00:00:00 และทิ้งเคสที่เปิดทั้งวันสุดท้ายไป
       · วันที่ที่อ่านไม่ออกไม่ถูกใช้ — ส่งขยะไปเทียบกับ DATETIME ได้ผลว่างเงียบ ๆ */
    $dateCol = match (str_or($q['date_field'] ?? null)) {
        'appointment' => 'appointment_date',
        'closed'      => 'closed_at',
        default       => 'opened_at',
    };
    $isYmd = static fn(string $d) => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
    if ($isYmd($from = str_or($q['from'] ?? null))) {
        $where[] = "$dateCol >= ?";
        $args[]  = $from;
    }
    if ($isYmd($to = str_or($q['to'] ?? null))) {
        $where[] = "$dateCol < DATE_ADD(?, INTERVAL 1 DAY)";
        $args[]  = $to;
    }

    /* เคสที่จบแล้วไม่มีคิวให้เรียง — สิ่งที่อยากเห็นก่อนคือ "เพิ่งปิดไปเมื่อไหร่" */
    $order = $closedOnly
        ? 'closed_at IS NULL, closed_at DESC, opened_at DESC'
        : 'is_rush DESC, status_order, opened_at';

    if (str_or($q['paged'] ?? null) === '1') {
        return caseBoardPage($q, $where, $args, $clientSql, $client, $closedOnly, $order);
    }

    /* ── โหมดเดิม: คืนทั้งก้อนเป็น array ────────────────────────────────────
       ProcessCaseList กับหน้าขั้นตอนทั้งสี่ยังใช้เส้นนี้ — แบ่งหน้าในเบราว์เซอร์
       เพราะการ์ดตัวเลขบนหน้านั้นนับจากทั้งขั้น ไม่ใช่แค่หน้าแรก
       กระดานงานย้ายไป paged=1 แล้ว */
    if ($clientSql) {
        $where[] = $clientSql;
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    /**
     * กรองด้วย "ขั้นที่งานอยู่จริง" — ตัวเดียวกับที่กระดานงานใช้แบ่งคอลัมน์
     *
     * `stage_group` ข้างบนอ่านจาก cases.status ซึ่งคนตั้งด้วยมือและไม่มีอะไร
     * บังคับให้ตรงกับงานที่ทำไปจริง · เคสที่กดปุ่ม "เริ่ม" ที่ขั้นวัดสายตาแล้ว
     * แต่ status ยังค้างอยู่ "รับลูกค้า / ลงข้อมูล" จึงขึ้นในคอลัมน์วัดสายตาบน
     * กระดานงาน แต่หายไปทั้งใบจากหน้า /exam — สองหน้าตอบคนละคำถามอยู่
     *
     * `process_stage` คำนวณใน PHP (caseStageMap) จึงเขียน WHERE ลง SQL ไม่ได้
     * ลำดับที่นี่เหมือน caseBoardPage() ทุกอย่าง: เอา id ที่ตรงตัวกรองอื่นมาก่อน
     * → คำนวณขั้น → กรอง → ค่อยดึงแถวเต็มเฉพาะที่จะส่งจริง
     *
     * LIMIT ต้องมาหลังการกรอง ไม่ใช่ก่อน — ถ้าตัดที่ SQL ก่อน ขั้นที่มีเคสน้อย
     * (วัดสายตามีใบเดียวในกองเปิด 1,175 ใบ) จะโดนตัดทิ้งทั้งขั้น
     */
    $limit = min(int_or($q['limit'] ?? null, 300), 5000);
    if ($wantStage = str_or($q['process_stage'] ?? null)) {
        $ids = array_map(
            static fn(array $r) => (int) $r['id'],
            Db::all("SELECT id FROM v_case_board $sqlWhere ORDER BY $order", ...$args)
        );
        $stages = caseStageMap($ids);
        $keep = array_values(array_filter(
            $ids,
            static fn(int $id) => ($stages[$id]['process_stage'] ?? null) === $wantStage
        ));
        return caseBoardRows(array_slice($keep, 0, $limit), $stages);
    }

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
    $args[] = $limit;

    $rows = Db::all(
        "SELECT * FROM v_case_board $sqlWhere ORDER BY $order LIMIT ?",
        ...$args
    );

    /* Which process the case is really on — cases.status is set by hand and
       nothing checks it against the work, so the board reads this instead
       (api/routes/processes.php) */
    $stages = caseStageMap(array_column($rows, 'id'));
    $lens   = caseRxLens(array_column($rows, 'id'));
    foreach ($rows as &$r) {
        $r += $stages[(int) $r['id']] ?? ['process_stage' => null, 'process_done' => 0];
        $r += $lens[(int) $r['id']] ?? NO_RX_LENS;
    }
    unset($r);
    return $rows;
});

/** เคสที่ไม่ได้สั่งตัดเลนส์ RX — ศูนย์ทั้งคู่ ไม่ใช่ไม่มีคีย์ หน้าจอจะได้ไม่ต้องเดา */
const NO_RX_LENS = ['rx_lens_total' => 0, 'rx_lens_arrived' => 0];

/**
 * เลนส์สั่งตัด RX ของแต่ละเคส มาถึงร้านแล้วกี่ข้าง จากทั้งหมดกี่ข้าง — ร้านขอไว้ 14 ก.ย. 2026
 *
 * คลังติ๊ก "เลนส์มาถึงแล้ว" บนหน้าใบสั่งตัด (`rx_orders.arrived_at` ของฝั่งคลัง) · กระดานงาน
 * ขึ้นป้าย "เลนส์เข้า 1/2" จากตัวเลขนี้ หน้าร้านจะได้ไม่ต้องเดินไปถามคลัง · ใบสั่งผูกกับ
 * ออเดอร์ผ่าน lens_r_rx_id / lens_l_rx_id · ใบที่ยกเลิกแล้วไม่นับ
 *
 * @param array<int|string> $caseIds
 * @return array<int,array{rx_lens_total:int,rx_lens_arrived:int}>
 */
function caseRxLens(array $caseIds): array
{
    $caseIds = array_values(array_unique(array_map('intval', $caseIds)));
    if (!$caseIds) {
        return [];
    }
    $in  = implode(',', array_fill(0, count($caseIds), '?'));
    $out = [];
    foreach (Db::all(
        "SELECT o.case_id,
                COUNT(r.log_id) AS total,
                COALESCE(SUM(r.arrived_at IS NOT NULL), 0) AS arrived
           FROM custom_orders o
           JOIN rx_orders r
             ON r.log_id IN (o.lens_r_rx_id, o.lens_l_rx_id)
            AND r.cancelled_at IS NULL
          WHERE o.case_id IN ($in)
          GROUP BY o.case_id",
        ...$caseIds
    ) as $row) {
        $out[(int) $row['case_id']] = [
            'rx_lens_total'   => (int) $row['total'],
            'rx_lens_arrived' => (int) $row['arrived'],
        ];
    }
    return $out;
}

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

    $lens = caseRxLens($ids);
    $out  = [];
    foreach ($ids as $id) {
        if (!isset($byId[$id])) {
            continue;
        }
        $out[] = $byId[$id]
            + ($stages[$id] ?? ['process_stage' => null, 'process_done' => 0])
            + ($lens[$id] ?? NO_RX_LENS);
    }
    return $out;
}

function caseDetail(?int $id): array
{
    $c = Db::get(
        'SELECT c.*, s.stage_no, s.label_th AS status_label_th, s.label_en AS status_label_en,
                s.stage_group, s.sort_order AS status_order, s.is_waiting, s.is_terminal,
                cu.first_name, cu.last_name, cu.phone, cu.line_id, cu.email, cu.sex,
                cu.nationality, cu.birth_date, cu.age_years, cu.age_recorded_on,
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
          /* ใบที่ไม่ผูกเคสของลูกค้าคนนี้ถูกดึงมาด้วย เพราะข้อมูลเดิมจาก Access
             8,401 ใบไม่มี case_id และยังต้องนับเป็นประวัติของเคส · แต่ใบที่วัดที่
             หน้าร้านตอนขายคอนแทคเลนส์ (source = 'contact_lens') เป็นงานคนละใบกัน
             ปล่อยให้ไหลเข้ามาแล้วขั้น \"วัดสายตา\" ของเคสจะขึ้นเสร็จเองทั้งที่ยังไม่มี
             ใครวัดอะไรในเคสนั้น — เกิดจริงกับ CASE-2026-00002 เมื่อ 16 ก.ย. 2026 */
          WHERE p.case_id = ?
             OR (p.customer_id = ? AND p.case_id IS NULL
                 AND (p.source IS NULL OR p.source <> 'contact_lens'))
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
    /* หน้าเว็บต้องรู้ว่าเคสใบนี้มีขั้นอะไรบ้าง โดยไม่ต้องถือกฎเอง — กฎอยู่ที่
       Lookups::CASE_TYPE_PROCESSES ฝั่งเดียว ไม่ใช่สองที่อย่างที่ CASE_PROCESSES เป็น */
    $detail['process_list'] = caseProcessList($detail);
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

    /* "รู้จักเราจากช่องทางไหน" ตอบได้ครั้งเดียวต่อหนึ่งคน — คนที่มาครั้งที่สอง
       รู้จักร้านไปตั้งแต่ครั้งแรกแล้ว หน้าเปิดเคสจึงซ่อนช่องนี้เมื่อเลือกลูกค้าเก่า
       และปล่อยให้ที่นี่เติมค่าให้แทน
       ปล่อยว่างไม่ได้ เพราะ SalesReport::referralLabel(null) แปลว่า "ไม่ได้ถาม"
       ซึ่งเป็นถังเดียวกับเคสที่พนักงานลืมถามและเคสเก่าที่นำเข้ามาแบบไม่มีข้อมูล
       เส้นแบ่งอ่านจาก **ฐานข้อมูล** ไม่ใช่ `is_new_customer` ซึ่งมาจากปุ่มที่
       พนักงานกด: ลูกค้าที่ถูกสร้างจากเมนู "ลูกค้าใหม่" ไว้ก่อน พอมาเปิดเคสจะถูกกด
       ว่าเป็นลูกค้าเก่าเพราะมีชื่อในระบบแล้ว ทั้งที่เป็นเคสแรกในชีวิตของเขา
       เคสแรกจึงต้องว่างไว้ตามจริง ไม่ใช่ถูกตีเป็น returning */
    $referral = nul($body['referral_source'] ?? null);
    if ($referral === null && Db::get('SELECT id FROM cases WHERE customer_id = ? LIMIT 1', $cid)) {
        $referral = 'returning';
    }

    $id = Db::tx(function (Tx $q) use ($body, $cid, $code, $status, $category, $referral) {
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
            $referral,
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

/**
 * เปลี่ยนลูกค้าของเคส — แอดมิน เจ้าของร้าน ผู้ดูแลระบบ เท่านั้น (ร้านขอ 15 ก.ย. 2026)
 *
 * ที่มา: เปิดเคสแล้วเลือกลูกค้าผิดคน (CASE-2026-00021 ต้องแก้ในฐานด้วยมือ) · เกณฑ์สิทธิ์เดียวกับ
 * แก้ไขรายการรับเงิน (`system.zone`) หน้าเว็บซ่อนปุ่มก็จริง แต่ด่านอยู่ที่นี่
 *
 * ของที่ย้ายตามคือแถวที่ผูกกับเคสนี้และยังเป็นของลูกค้าคนเดิม: ออเดอร์ ค่าสายตา คิวจอง
 * · เงินที่รับ ไทม์ไลน์ รูป ผูกกับเคสอยู่แล้วจึงตามไปเอง · ค่าสายตาเก่าที่ไม่ผูกเคสเป็นประวัติ
 * ของลูกค้าคนเดิมจริง ไม่แตะ · ใบเสร็จที่ออกแล้วไม่แก้ชื่อบนใบ — GET บอกจำนวนให้หน้าเว็บเตือน
 * เทสต์: api/tests/61-case-change-customer.test.php
 */
const CASE_CUSTOMER_TABLES = ['orders' => 'custom_orders', 'prescriptions' => 'prescriptions', 'bookings' => 'bookings'];

function caseCustomerActor(): array
{
    $actor = StockModule::actor();
    if (!$actor || !\Optic\Roles::systemZone($actor['roles'] ?? [])) {
        throw new HttpError(403, 'เปลี่ยนลูกค้าของเคสได้เฉพาะแอดมินหรือเจ้าของร้าน', ['reason' => 'forbidden']);
    }
    return $actor;
}

/** สรุปก่อนเปลี่ยน — จำนวนของที่จะย้ายตาม และใบเสร็จที่ออกไปแล้ว */
GET('/api/cases/:id/customer', function (array $req) {
    caseCustomerActor();
    $id = int_or($req['params']['id']);
    $c  = Db::get('SELECT id, customer_id FROM cases WHERE id = ?', $id);
    if (!$c) {
        missing();
    }
    $out = [];
    foreach (CASE_CUSTOMER_TABLES as $key => $table) {
        $out[$key] = (int) Db::get(
            "SELECT COUNT(*) n FROM $table WHERE case_id = ? AND customer_id = ?",
            $id,
            $c['customer_id']
        )['n'];
    }
    $out['receipts'] = (int) Db::get(
        'SELECT COUNT(*) n FROM receipts r JOIN custom_orders o ON o.id = r.order_id WHERE o.case_id = ?',
        $id
    )['n'];
    return $out;
});

POST('/api/cases/:id/customer', function (array $req) {
    $actor = caseCustomerActor();
    $id    = int_or($req['params']['id']);
    $body  = $req['body'];

    $moved = Db::tx(function (Tx $q) use ($id, $body, $actor) {
        $c = $q->get('SELECT id, customer_id FROM cases WHERE id = ? FOR UPDATE', $id);
        if (!$c) {
            missing();
        }
        $toId = int_or($body['customer_id'] ?? null);
        if (!$toId) {
            bad('กรุณาเลือกลูกค้า');
        }
        $fromId = (int) $c['customer_id'];
        if ($toId === $fromId) {
            throw new HttpError(400, 'เคสนี้เป็นของลูกค้าคนนี้อยู่แล้ว', ['reason' => 'same_customer']);
        }
        $to = $q->get('SELECT id, first_name, last_name FROM customers WHERE id = ?', $toId);
        if (!$to) {
            bad('ไม่พบลูกค้ารายนี้');
        }
        $reason = trim((string) ($body['reason'] ?? ''));
        if ($reason === '') {
            bad('กรุณาใส่เหตุผลที่เปลี่ยนลูกค้า');
        }
        $from = $q->get('SELECT id, first_name, last_name FROM customers WHERE id = ?', $fromId);

        $q->run('UPDATE cases SET customer_id = ? WHERE id = ?', $toId, $id);
        $moved = [];
        foreach (CASE_CUSTOMER_TABLES as $key => $table) {
            $moved[$key] = $q->run(
                "UPDATE $table SET customer_id = ? WHERE case_id = ? AND customer_id = ?",
                $toId,
                $id,
                $fromId
            )['affected'];
        }

        $name = fn(?array $r, int $cid) => $r
            ? trim($r['first_name'] . ' ' . $r['last_name']) . " (#$cid)"
            : "#$cid";
        $by = (string) ($actor['displayName'] ?? $actor['username'] ?? '');
        logEvent($q, $id, [
            'action'      => 'customer_changed',
            'entity'      => 'customer',
            'entity_id'   => $toId,
            'employee_id' => $actor['employeeId'] ?? null,
            'note'        => $name($from, $fromId) . ' → ' . $name($to, $toId) . " — เหตุผล: $reason"
                . ($by !== '' ? " (เปลี่ยนโดย $by)" : ''),
            'payload'     => [
                'from_customer_id' => $fromId,
                'to_customer_id'   => $toId,
                'reason'           => $reason,
                'moved'            => $moved,
                'by'               => $by,
            ],
        ]);
        return $moved;
    });

    return ['case_id' => $id, 'moved' => $moved];
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
        /* Bewell: ยกเลิกเคส = ยกเลิกใบเบิกเลนส์ของเคสด้วย (ไม่ลบ) */
        if ($to === 'cancelled' && $before && $before['status'] !== 'cancelled') {
            LensRequisition::cancelFor(
                $q, 'case', $id, 'case_cancelled',
                'ยกเลิกเคส' . (nul($body['note'] ?? null) !== null ? ' · ' . str_or($body['note']) : ''),
                LensRequisition::actorEmployee() ?? int_or($body['employee_id'] ?? null)
            );
            TimeOpticRx::cancelFor($q, 'case', $id, 'ยกเลิกเคส', LensRequisition::actorEmployee() ?? int_or($body['employee_id'] ?? null));
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
