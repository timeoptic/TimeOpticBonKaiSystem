<?php
/**
 * ขั้น "เลนส์" — the sales-side step between taking the money and the bench.
 *
 * The production room does not go shopping. Before a case reaches it, somebody
 * on the floor has to answer three questions for every piece the sale picked:
 * is it here, if not who is bringing it and when, and — the part the old flow
 * had no answer for — is it *ours*.
 *
 * That last one is what this file adds. A lot's remaining_qty counts units
 * nobody has cut yet, which is not the same as units nobody has promised. Two
 * cases could both see "เหลือ 1 ชิ้น", both press เริ่มผลิต, and one of them
 * would lose — after the customer had already been given a date. So this step
 * takes a *reservation*: the unit stays physically on the shelf (nothing is cut
 * from stock, no inventory_logs row, nothing for the warehouse to reconcile)
 * but it stops counting as available to anybody else.
 *
 *     available = stock_lots.remaining_qty − Σ qty of other cases' active
 *                 reservations on that lot
 *
 * Stock is still only ever *cut* at เริ่มผลิต, where the reservation turns into
 * a production_withdrawal. Reserve → consume, never reserve → forget.
 */
declare(strict_types=1);

/** the three pieces a pair of glasses is made of — same vocabulary as PRODUCTION_ITEMS */
const LENS_ITEM_TYPES = ['frame', 'lens_od', 'lens_os'];

const LENS_ITEM_LABEL = [
    'frame'   => 'กรอบ',
    'lens_od' => 'เลนส์ขวา (OD)',
    'lens_os' => 'เลนส์ซ้าย (OS)',
];

function assertLensItem(string $t): string
{
    if (!in_array($t, LENS_ITEM_TYPES, true)) {
        bad("ไม่รู้จักรายการ \"$t\"");
    }
    return $t;
}

/** per-item ordering / one-eye-job state, keyed by item_type */
function lensFulfillment(int $caseId): array
{
    $out = [];
    foreach (Db::all('SELECT * FROM case_item_fulfillment WHERE case_id = ?', $caseId) as $r) {
        $out[$r['item_type']] = $r;
    }
    return $out;
}

/** the units this case is currently holding, keyed by item_type */
function lensReservations(int $caseId): array
{
    $out = [];
    foreach (Db::all(
        "SELECT * FROM stock_reservations WHERE case_id = ? AND status = 'active'",
        $caseId
    ) as $r) {
        $out[$r['item_type']] = $r;
    }
    return $out;
}

/** how many units of a lot are spoken for right now, by anybody */
function lotReservedQty(?int $lotId): int
{
    if (!$lotId) {
        return 0;
    }
    return (int) Db::get(
        "SELECT COALESCE(SUM(qty),0) n FROM stock_reservations
          WHERE stock_lot_id = ? AND status = 'active'",
        $lotId
    )['n'];
}

/** the three item rows for a case, as the เลนส์ screen and the bench both read them */
function lensItems(array $c): array
{
    return productionItems($c['order'] ?? null, $c['production'] ?? null, $c['lens_job'] ?? null);
}

/** what still stands between this case and the production room */
function lensMissing(array $c): array
{
    if (empty($c['order'])) {
        return ['ออเดอร์'];
    }
    return productionReadiness(lensItems($c))['blocking'];
}

/** has anybody touched this step yet, and is it parked waiting on a supplier */
function lensProgress(array $c): array
{
    $caseId  = (int) $c['id'];
    $held    = lensReservations($caseId);
    $ful     = lensFulfillment($caseId);
    $waiting = false;
    foreach ($ful as $f) {
        if ((int) $f['is_required'] && $f['status'] === 'ordered' && empty($f['received_at'])) {
            $waiting = true;
        }
    }
    return ['touched' => (bool) (count($held) || count($ful)), 'waiting' => $waiting];
}

/** create the fulfilment row on first touch — nothing writes it until somebody edits an item */
function lensFulfillmentRow(Tx $q, int $caseId, ?int $orderId, string $type): array
{
    $row = $q->get(
        'SELECT * FROM case_item_fulfillment WHERE case_id = ? AND item_type = ?',
        $caseId,
        $type
    );
    if ($row) {
        return $row;
    }
    $q->run(
        'INSERT INTO case_item_fulfillment (case_id, order_id, item_type) VALUES (?,?,?)',
        $caseId,
        $orderId,
        $type
    );
    return $q->get(
        'SELECT * FROM case_item_fulfillment WHERE case_id = ? AND item_type = ?',
        $caseId,
        $type
    );
}

/**
 * Hold one unit for this case.
 *
 * The availability check and the insert happen inside the caller's transaction
 * with the lot row locked, so two people pressing จองของ on the last unit at
 * the same moment cannot both win — the second one is told the truth instead of
 * finding out at เริ่มผลิต.
 */
function lensReserveItem(Tx $q, int $caseId, ?int $orderId, string $type, int $lotId, ?int $empId): void
{
    $already = $q->get(
        "SELECT id FROM stock_reservations
          WHERE case_id = ? AND item_type = ? AND status = 'active'",
        $caseId,
        $type
    );
    if ($already) {
        return;
    }
    $lot = $q->get('SELECT id, product_id, remaining_qty FROM stock_lots WHERE id = ? FOR UPDATE', $lotId);
    if (!$lot) {
        bad(LENS_ITEM_LABEL[$type] . ' — ไม่พบล็อตสินค้านี้แล้ว');
    }
    /* every active hold counts — a case that needs the same lot for both eyes
       must take two units out of it, not the same one twice */
    $taken = (int) $q->get(
        "SELECT COALESCE(SUM(qty),0) n FROM stock_reservations
          WHERE stock_lot_id = ? AND status = 'active'",
        $lotId
    )['n'];
    if ((int) $lot['remaining_qty'] - $taken < 1) {
        bad(LENS_ITEM_LABEL[$type] . ' — มีคนจองไปก่อนแล้ว เหลือไม่พอ กรุณาเลือกของชิ้นอื่นหรือสั่งเพิ่ม');
    }
    $q->run(
        'INSERT INTO stock_reservations (case_id, order_id, item_type, product_id, stock_lot_id,
           qty, status, reserved_by) VALUES (?,?,?,?,?,1,?,?)',
        $caseId,
        $orderId,
        $type,
        (int) $lot['product_id'],
        $lotId,
        'active',
        $empId
    );
}

/** give a held unit back — the shelf never moved, only the promise */
function lensReleaseItem(Tx $q, int $caseId, string $type, ?int $empId): bool
{
    $row = $q->get(
        "SELECT id FROM stock_reservations
          WHERE case_id = ? AND item_type = ? AND status = 'active'",
        $caseId,
        $type
    );
    if (!$row) {
        return false;
    }
    $q->run(
        "UPDATE stock_reservations SET status='released', released_at=?, released_by=? WHERE id=?",
        nowStamp(),
        $empId,
        (int) $row['id']
    );
    return true;
}

/* ───────────────────────── endpoints ───────────────────────── */

/** everything the เลนส์ screen needs for one case */
GET('/api/cases/:id/lens', function (array $req) {
    $caseId = int_or($req['params']['id']);
    $c      = caseDetail($caseId);
    $items  = lensItems($c);
    $ready  = productionReadiness($items);
    return [
        'case_id'     => $caseId,
        'items'       => $items,
        'ready'       => $ready['ready'],
        'blocking'    => $ready['blocking'],
        'stock_state' => productionStockState($items),
        'lens_job'    => $c['lens_job'] ?? null,
    ];
});

/**
 * Edit one item: whether the job needs it at all (a one-eye job), and the note.
 * Nothing here touches stock — เลือกสินค้า still belongs to the sale.
 */
POST('/api/cases/:id/lens/items/:item_type', function (array $req) {
    $caseId = int_or($req['params']['id']);
    $type   = assertLensItem((string) $req['params']['item_type']);
    $body   = $req['body'];
    $c      = caseDetail($caseId);
    $empId  = int_or($body['employee_id'] ?? null);

    Db::tx(function (Tx $q) use ($caseId, $c, $type, $body, $empId) {
        lensFulfillmentRow($q, $caseId, int_or($c['order']['id'] ?? null), $type);
        $sets = [];
        $args = [];
        if (array_key_exists('is_required', $body)) {
            $sets[] = 'is_required = ?';
            $args[] = boolInt($body['is_required']);
        }
        if (array_key_exists('note', $body)) {
            $sets[] = 'note = ?';
            $args[] = nul($body['note']);
        }
        if (!$sets) {
            return;
        }
        $sets[] = 'updated_by = ?';
        $args[] = $empId;
        $args[] = $caseId;
        $args[] = $type;
        $q->run(
            'UPDATE case_item_fulfillment SET ' . implode(', ', $sets)
                . ' WHERE case_id = ? AND item_type = ?',
            ...$args
        );
        /* a piece the job does not use must not keep holding stock */
        if (array_key_exists('is_required', $body) && !boolInt($body['is_required'])) {
            lensReleaseItem($q, $caseId, $type, $empId);
        }
        logEvent($q, $caseId, [
            'action' => 'lens_item_saved', 'entity' => 'case_item_fulfillment',
            'employee_id' => $empId, 'note' => LENS_ITEM_LABEL[$type],
        ]);
    });
    return caseDetail($caseId);
});

/** จองของ — hold what is on the shelf for this case */
POST('/api/cases/:id/lens/reserve', function (array $req) {
    $caseId = int_or($req['params']['id']);
    $body   = $req['body'];
    $c      = caseDetail($caseId);
    if (empty($c['order'])) {
        bad('ยังไม่มีออเดอร์ — กลับไปที่ขั้นขายก่อน');
    }
    $empId = int_or($body['employee_id'] ?? null);
    $only  = str_or($body['item_type'] ?? null);
    if ($only !== '') {
        assertLensItem($only);
    }
    $items = lensItems($c);

    $held = Db::tx(function (Tx $q) use ($caseId, $c, $items, $only, $empId) {
        $n = 0;
        foreach ($items as $i) {
            if ($only !== '' && $i['item_type'] !== $only) {
                continue;
            }
            if (!$i['is_required'] || $i['status'] === 'withdrawn' || $i['status'] === 'reserved') {
                continue;
            }
            if (!$i['stock_lot_id']) {
                bad($i['label'] . ' — ยังไม่ได้เลือกสินค้าที่ขั้นขาย');
            }
            lensReserveItem($q, $caseId, int_or($c['order']['id'] ?? null), $i['item_type'],
                (int) $i['stock_lot_id'], $empId);
            $n++;
        }
        if ($n) {
            logEvent($q, $caseId, [
                'action' => 'lens_reserved', 'entity' => 'stock_reservation',
                'employee_id' => $empId, 'note' => "จองของ $n รายการ",
            ]);
            saveProcess($q, $caseId, 'lens', ['status' => 'in_progress', 'started_at' => nowStamp()]);
        }
        return $n;
    });
    return ['reserved' => $held, 'case' => caseDetail($caseId)];
});

/** ยกเลิกการจอง — put the promise back, one item or all of them */
POST('/api/cases/:id/lens/release', function (array $req) {
    $caseId = int_or($req['params']['id']);
    $body   = $req['body'];
    caseDetail($caseId);
    $empId = int_or($body['employee_id'] ?? null);
    $only  = str_or($body['item_type'] ?? null);
    if ($only !== '') {
        assertLensItem($only);
    }

    Db::tx(function (Tx $q) use ($caseId, $only, $empId) {
        $n = 0;
        foreach (LENS_ITEM_TYPES as $type) {
            if ($only !== '' && $type !== $only) {
                continue;
            }
            $n += lensReleaseItem($q, $caseId, $type, $empId) ? 1 : 0;
        }
        if ($n) {
            logEvent($q, $caseId, [
                'action' => 'lens_released', 'entity' => 'stock_reservation',
                'employee_id' => $empId, 'note' => "ยกเลิกการจอง $n รายการ",
            ]);
        }
    });
    return caseDetail($caseId);
});

/** สั่งสินค้า — record that a missing piece is on its way, and from whom */
POST('/api/cases/:id/lens/order', function (array $req) {
    $caseId = int_or($req['params']['id']);
    $body   = $req['body'];
    $c      = caseDetail($caseId);
    $types  = $body['item_types'] ?? [];
    if (!is_array($types) || !count($types)) {
        bad('เลือกรายการที่ต้องสั่งอย่างน้อยหนึ่งรายการ');
    }
    foreach ($types as $t) {
        assertLensItem((string) $t);
    }
    $empId = int_or($body['employee_id'] ?? null);

    Db::tx(function (Tx $q) use ($caseId, $c, $types, $body, $empId) {
        foreach ($types as $type) {
            lensFulfillmentRow($q, $caseId, int_or($c['order']['id'] ?? null), (string) $type);
            $q->run(
                "UPDATE case_item_fulfillment
                    SET status='ordered', supplier_id=?, order_no=?, ordered_at=?,
                        expected_arrival=?, received_at=NULL, note=?, updated_by=?
                  WHERE case_id=? AND item_type=?",
                int_or($body['supplier_id'] ?? null),
                nul($body['order_no'] ?? null),
                nowStamp(),
                nul($body['expected_arrival'] ?? null),
                nul($body['note'] ?? null),
                $empId,
                $caseId,
                (string) $type
            );
        }
        $names = implode(', ', array_map(fn($t) => LENS_ITEM_LABEL[(string) $t] ?? $t, $types));
        logEvent($q, $caseId, [
            'action' => 'lens_ordered', 'entity' => 'case_item_fulfillment',
            'employee_id' => $empId, 'note' => $names,
        ]);
        saveProcess($q, $caseId, 'lens', ['status' => 'waiting', 'started_at' => nowStamp()]);
        setStatus($q, $caseId, 'lens_ordered', ['employee_id' => $empId]);
    });
    return caseDetail($caseId);
});

/** ของมาถึงแล้ว — an ordered piece arrived; it can be reserved like anything else */
POST('/api/cases/:id/lens/receive', function (array $req) {
    $caseId = int_or($req['params']['id']);
    $body   = $req['body'];
    caseDetail($caseId);
    $types = $body['item_types'] ?? [];
    if (!is_array($types) || !count($types)) {
        bad('เลือกรายการที่ได้รับ');
    }
    foreach ($types as $t) {
        assertLensItem((string) $t);
    }
    $empId = int_or($body['employee_id'] ?? null);

    Db::tx(function (Tx $q) use ($caseId, $types, $empId) {
        foreach ($types as $type) {
            $q->run(
                "UPDATE case_item_fulfillment SET status='received', received_at=?, updated_by=?
                  WHERE case_id=? AND item_type=?",
                nowStamp(),
                $empId,
                $caseId,
                (string) $type
            );
        }
        $names = implode(', ', array_map(fn($t) => LENS_ITEM_LABEL[(string) $t] ?? $t, $types));
        logEvent($q, $caseId, [
            'action' => 'lens_item_received', 'entity' => 'case_item_fulfillment',
            'employee_id' => $empId, 'note' => $names,
        ]);
        saveProcess($q, $caseId, 'lens', ['status' => 'in_progress']);
        setStatus($q, $caseId, 'lens_received', ['employee_id' => $empId]);
    });
    return caseDetail($caseId);
});

/**
 * ส่งเข้าห้องผลิต — the one button that ends this step.
 *
 * Reserving and handing over are the same transaction on purpose: a case must
 * never arrive on the production board holding nothing. The availability check
 * runs again here against locked rows, so a hand-over cannot be granted on
 * stock that vanished while the screen was open.
 */
POST('/api/cases/:id/lens/send-to-production', function (array $req) {
    $caseId = int_or($req['params']['id']);
    $body   = $req['body'];
    $c      = caseDetail($caseId);
    if (empty($c['order'])) {
        bad('ยังไม่มีออเดอร์ — กลับไปที่ขั้นขายก่อน');
    }
    $empId = int_or($body['employee_id'] ?? null);
    $items = lensItems($c);

    /* everything required must at least be standing on the shelf */
    foreach ($items as $i) {
        if (!$i['is_required'] || in_array($i['status'], ['reserved', 'withdrawn'], true)) {
            continue;
        }
        if (!$i['stock_lot_id']) {
            bad($i['label'] . ' — ยังไม่ได้เลือกสินค้าที่ขั้นขาย');
        }
        if ($i['status'] !== 'ready') {
            bad($i['label'] . ' — ของยังไม่พร้อม ' . ($i['note'] ? "($i[note])" : ''));
        }
    }

    Db::tx(function (Tx $q) use ($caseId, $c, $items, $empId) {
        foreach ($items as $i) {
            if (!$i['is_required'] || $i['status'] === 'withdrawn' || $i['status'] === 'reserved') {
                continue;
            }
            lensReserveItem($q, $caseId, int_or($c['order']['id'] ?? null), $i['item_type'],
                (int) $i['stock_lot_id'], $empId);
        }
        /* the bench needs a job row to open; make it here rather than making the
           production screen invent one on first click */
        $job = $q->get('SELECT id FROM production_jobs WHERE case_id = ? ORDER BY id DESC LIMIT 1', $caseId);
        if (!$job) {
            $q->run(
                'INSERT INTO production_jobs (case_id, order_id, status) VALUES (?,?,?)',
                $caseId,
                int_or($c['order']['id'] ?? null),
                'WAITING_FOR_ITEMS'
            );
        }
        logEvent($q, $caseId, [
            'action' => 'lens_sent_to_production', 'entity' => 'case_process',
            'employee_id' => $empId, 'note' => 'lens',
        ]);
        saveProcess($q, $caseId, 'lens', [
            'status' => 'completed', 'started_at' => nowStamp(), 'completed_at' => nowStamp(),
        ]);
        $q->run(
            'UPDATE case_processes SET started_at = COALESCE(started_at, ?)
              WHERE case_id = ? AND process = ?',
            nowStamp(),
            $caseId,
            'lens'
        );
        setStatus($q, $caseId, entryStatusOfGroup('production'), ['employee_id' => $empId]);
    });
    return caseDetail($caseId);
});

/**
 * The เลนส์ board — every case that has been sold but not yet handed to the
 * bench, with what it is still waiting for.
 */
GET('/api/lens', function (array $req) {
    $q    = $req['query'];
    $rows = Db::all(
        "SELECT c.id AS case_id, c.case_code, c.opened_at, c.is_rush,
                cu.first_name, cu.last_name, cu.phone,
                o.id AS order_id, o.case_id AS o_case_id, o.frame_name, o.lens_name,
                o.frame_product_id, o.lens_product_id, o.right_lens_product_id,
                o.appointment_date,
                s.stage_group,
                cp.status AS lens_state, cp.completed_at AS lens_done_at,
                j.id AS job_id, j.status AS job_status, j.started_at AS job_started_at
           FROM cases c
           JOIN customers cu ON cu.id = c.customer_id
           JOIN case_statuses s ON s.code = c.status
           LEFT JOIN custom_orders o
                  ON o.id = (SELECT MAX(o2.id) FROM custom_orders o2 WHERE o2.case_id = c.id)
           LEFT JOIN case_processes cp ON cp.case_id = c.id AND cp.process = 'lens'
           LEFT JOIN production_jobs j
                  ON j.id = (SELECT MAX(j2.id) FROM production_jobs j2 WHERE j2.case_id = c.id)
          WHERE s.is_terminal = 0 AND o.id IS NOT NULL
          ORDER BY c.is_rush DESC, c.opened_at"
    );

    $out = [];
    foreach ($rows as $r) {
        $lensJob = Db::get(
            'SELECT * FROM lens_jobs WHERE case_id = ? ORDER BY id DESC LIMIT 1',
            (int) $r['case_id']
        );
        $r['case_id'] = (int) $r['case_id'];
        $items = productionItems($r, $r['job_id'] ? ['id' => $r['job_id']] : null, $lensJob);
        $ready = productionReadiness($items);
        $r['items']       = $items;
        $r['stock_state'] = productionStockState($items);
        $r['blocking']    = $ready['blocking'];
        $r['ready']       = $ready['ready'];
        $r['lens_state']  = $r['lens_state'] ?: ($ready['ready'] ? 'in_progress' : 'not_started');
        /* off this list once the case has left it — by the button, by a job that
           is already running, or simply by being at a later stage entirely
           (cases that ran through the old flow, before this step existed) */
        $r['handed_over'] = $r['lens_state'] === 'completed'
            || !empty($r['job_started_at'])
            || in_array($r['stage_group'], ['production', 'qc', 'delivery', 'done'], true);
        $out[] = $r;
    }

    $summary = ['not_chosen' => 0, 'out_of_stock' => 0, 'ordered' => 0, 'ready' => 0, 'reserved' => 0];
    foreach ($out as $r) {
        if (!$r['handed_over'] && isset($summary[$r['stock_state']])) {
            $summary[$r['stock_state']]++;
        }
    }

    /* cases already on the bench are done here — keep them out unless asked for */
    $stock = str_or($q['stock'] ?? null);
    $term  = mb_strtolower(str_or($q['q'] ?? null));
    $showDone = str_or($q['done'] ?? null) === '1';
    $filtered = array_values(array_filter($out, function ($r) use ($stock, $term, $showDone) {
        if (!$showDone && $r['handed_over']) {
            return false;
        }
        if ($stock !== '' && $r['stock_state'] !== $stock) {
            return false;
        }
        if ($term !== '') {
            $hay = mb_strtolower(implode(' ', [
                $r['case_code'], $r['first_name'], $r['last_name'], $r['phone'],
                $r['frame_name'], $r['lens_name'],
            ]));
            if (mb_strpos($hay, $term) === false) {
                return false;
            }
        }
        return true;
    }));

    return ['summary' => $summary, 'rows' => $filtered];
});
