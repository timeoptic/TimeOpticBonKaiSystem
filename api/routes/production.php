<?php
/**
 * The production floor: what each job needs, whether it is on the shelf, and
 * the board of everything waiting to be made.
 *
 * A job needs three physical things — a frame and one lens per eye — and the
 * shop cannot start cutting until every one it needs is actually in stock.
 * That check lives here so the list, the case screen and the start endpoint all
 * answer it the same way.
 */
declare(strict_types=1);

const PRODUCTION_ITEMS = [
    'frame'   => ['field' => 'frame_product_id', 'label' => 'กรอบ'],
    'lens_od' => ['field' => 'lens_product_id', 'label' => 'เลนส์ขวา (OD)'],
    'lens_os' => ['field' => 'right_lens_product_id', 'label' => 'เลนส์ซ้าย (OS)'],
];

/**
 * One row per thing the job consumes, with where that thing stands:
 *   not_chosen   — the sale never picked it
 *   withdrawn    — already taken out of stock for this job
 *   ready        — on the shelf, waiting to be taken
 *   ordered      — not on the shelf, but on order from a supplier
 *   out_of_stock — not on the shelf and nobody has ordered it
 */
function productionItems(?array $order, ?array $job, ?array $lensJob = null): array
{
    $withdrawn = [];
    if ($job) {
        foreach (Db::all(
            'SELECT item_type, COUNT(*) n FROM production_withdrawals
              WHERE production_job_id = ? GROUP BY item_type',
            (int) $job['id']
        ) as $w) {
            $withdrawn[$w['item_type']] = (int) $w['n'];
        }
    }

    $out = [];
    foreach (PRODUCTION_ITEMS as $type => $meta) {
        $lotId = $order ? int_or($order[$meta['field']] ?? null) : null;
        $row = [
            'item_type'    => $type,
            'label'        => $meta['label'],
            'stock_lot_id' => $lotId,
            'withdrawn'    => $withdrawn[$type] ?? 0,
            'product_name' => null, 'brand' => null, 'sku' => null,
            'lens_index'   => null, 'coating' => null, 'remaining_qty' => null,
            'status'       => 'not_chosen',
            'note'         => null,
        ];

        if ($lotId) {
            $lot = Db::get('SELECT * FROM v_stock_lot WHERE id = ?', $lotId);
            if ($lot) {
                $row['product_name']  = $lot['product_name'];
                $row['brand']         = $lot['brand'] ?: ($lot['brand_name'] ?? null);
                $row['sku']           = $lot['sku'];
                $row['lens_index']    = $lot['lens_index'] ?? null;
                $row['coating']       = $lot['coating'] ?? null;
                $row['remaining_qty'] = (int) ($lot['remaining_qty'] ?? 0);
                $row['status'] = (int) $lot['sold'] === 0 && (int) $lot['remaining_qty'] > 0
                    ? 'ready' : 'out_of_stock';
            } else {
                $row['status'] = 'out_of_stock';
            }
        }

        /* a lens that is not on the shelf may already be on its way */
        if ($row['status'] === 'out_of_stock' && $type !== 'frame' && $lensJob) {
            $ordered = in_array($lensJob['status'] ?? '', ['ordered', 'waiting', 'in_transit'], true)
                || !empty($lensJob['order_no']) || !empty($lensJob['expected_arrival']);
            if ($ordered && empty($lensJob['received_at'])) {
                $row['status'] = 'ordered';
                $row['note'] = $lensJob['expected_arrival']
                    ? 'คาดว่าจะถึง ' . substr((string) $lensJob['expected_arrival'], 0, 10)
                    : 'สั่งแล้ว รอสินค้าเข้า';
            }
        }

        if ($row['withdrawn'] > 0) {
            $row['status'] = 'withdrawn';
        }
        $out[] = $row;
    }
    return $out;
}

/** can the shop start cutting? and if not, exactly what is in the way */
function productionReadiness(array $items): array
{
    $blocking = [];
    foreach ($items as $i) {
        if (in_array($i['status'], ['ready', 'withdrawn'], true)) {
            continue;
        }
        $blocking[] = $i['label'] . match ($i['status']) {
            'not_chosen'   => ' (ยังไม่ได้เลือกสินค้า)',
            'ordered'      => ' (สั่งแล้ว รอของเข้า)',
            default        => ' (หมดสต็อก)',
        };
    }
    return ['ready' => !count($blocking), 'blocking' => $blocking];
}

/** one word for the whole job's stock situation, for the list's colour chip */
function productionStockState(array $items): string
{
    $state = 'ready';
    foreach ($items as $i) {
        if ($i['status'] === 'out_of_stock' || $i['status'] === 'not_chosen') {
            return $i['status'] === 'not_chosen' ? 'not_chosen' : 'out_of_stock';
        }
        if ($i['status'] === 'ordered') {
            $state = 'ordered';
        }
    }
    return $state;
}

/**
 * The production board — every case that has a sale and has not been delivered
 * yet, with what it needs and where it stands.
 */
GET('/api/production', function (array $req) {
    $q = $req['query'];
    $rows = Db::all(
        "SELECT c.id AS case_id, c.case_code, c.opened_at, c.is_rush,
                cu.first_name, cu.last_name, cu.phone,
                o.id AS order_id, o.frame_name, o.frame_brand, o.frame_size,
                o.lens_name, o.frame_product_id, o.lens_product_id, o.right_lens_product_id,
                j.id AS job_id, j.status AS job_status, j.started_at, j.completed_at,
                j.pickup_at, j.waiting_item, j.waiting_reason, j.assigned_technician,
                e.employee_name AS technician_name,
                rx.r_sphere, rx.r_cylinder, rx.r_axis, rx.l_sphere, rx.l_cylinder, rx.l_axis
           FROM cases c
           JOIN customers cu ON cu.id = c.customer_id
           JOIN case_statuses s ON s.code = c.status
           LEFT JOIN custom_orders o
                  ON o.id = (SELECT MAX(o2.id) FROM custom_orders o2 WHERE o2.case_id = c.id)
           LEFT JOIN production_jobs j
                  ON j.id = (SELECT MAX(j2.id) FROM production_jobs j2 WHERE j2.case_id = c.id)
           LEFT JOIN employees e ON e.id = j.assigned_technician
           LEFT JOIN prescriptions rx
                  ON rx.id = (SELECT MAX(r2.id) FROM prescriptions r2
                               WHERE r2.case_id = c.id AND r2.kind = 'final')
          WHERE s.is_terminal = 0 AND o.id IS NOT NULL
          ORDER BY c.is_rush DESC, c.opened_at"
    );

    $out = [];
    foreach ($rows as $r) {
        $job = $r['job_id'] ? ['id' => $r['job_id']] : null;
        $lensJob = Db::get(
            'SELECT * FROM lens_jobs WHERE case_id = ? ORDER BY id DESC LIMIT 1',
            (int) $r['case_id']
        );
        $items = productionItems($r, $job, $lensJob);
        $ready = productionReadiness($items);
        $status = $r['job_status'] ?: 'WAITING_FOR_ITEMS';
        if (!$r['job_id'] || $status === 'WAITING_FOR_ITEMS') {
            $status = $ready['ready'] ? 'READY_TO_PRODUCE' : 'WAITING_FOR_ITEMS';
        }
        $r['items']       = $items;
        $r['stock_state'] = productionStockState($items);
        $r['blocking']    = $ready['blocking'];
        $r['job_status']  = $status;
        $out[] = $r;
    }

    /* the four numbers at the top of the board */
    $today = today();
    $summary = ['waiting' => 0, 'ready' => 0, 'in_production' => 0, 'done_today' => 0];
    foreach ($out as $r) {
        if ($r['job_status'] === 'IN_PRODUCTION') {
            $summary['in_production']++;
        } elseif ($r['job_status'] === 'WAITING_FOR_ITEM' || $r['job_status'] === 'WAITING_FOR_ITEMS') {
            $summary['waiting']++;
        } elseif ($r['job_status'] === 'READY_TO_PRODUCE') {
            $summary['ready']++;
        }
        if ($r['completed_at'] && substr((string) $r['completed_at'], 0, 10) === $today) {
            $summary['done_today']++;
        }
    }

    $status = str_or($q['status'] ?? null);
    $stock  = str_or($q['stock'] ?? null);
    $term   = mb_strtolower(str_or($q['q'] ?? null));
    $filtered = array_values(array_filter($out, function ($r) use ($status, $stock, $term) {
        if ($status !== '' && $r['job_status'] !== $status) {
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

/** everything the bench needs for one job, in one call */
GET('/api/production/:case_id', function (array $req) {
    $caseId = int_or($req['params']['case_id']);
    $c = caseDetail($caseId);
    $job = $c['production'];
    $items = productionItems($c['order'], $job, $c['lens_job']);
    $ready = productionReadiness($items);
    return [
        'case_id'   => $caseId,
        'items'     => $items,
        'ready'     => $ready['ready'],
        'blocking'  => $ready['blocking'],
        'stock_state' => productionStockState($items),
    ];
});

/** "ปิดงานผลิต" — the glasses are made; QC is next. */
POST('/api/production-jobs/:id/complete', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $job  = Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
    if (!$job) {
        missing();
    }
    if ($job['status'] !== 'IN_PRODUCTION') {
        bad('ต้องเริ่มผลิตก่อนจึงจะปิดงานผลิตได้');
    }
    $empId = int_or($body['employee_id'] ?? null);

    Db::tx(function (Tx $q) use ($id, $job, $empId) {
        $q->run(
            "UPDATE production_jobs
                SET status='COMPLETED', completed_at=?, completed_by=?,
                    waiting_item=NULL, waiting_reason=NULL
              WHERE id=?",
            nowStamp(),
            $empId,
            $id
        );
        logEvent($q, (int) $job['case_id'], [
            'action' => 'production_completed', 'entity' => 'production_job',
            'entity_id' => $id, 'employee_id' => $empId,
        ]);
        setStatus($q, (int) $job['case_id'], 'waiting_qc', ['employee_id' => $empId]);
    });
    return Db::get('SELECT * FROM production_jobs WHERE id = ?', $id);
});
