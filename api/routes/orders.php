<?php
/**
 * Custom (prescription) orders — the shop's main money document.
 *
 * An order moves through: created → filled with real stock items → closed.
 * Closing marks its lens/frame rows sold and books the remaining balance.
 */
declare(strict_types=1);

const ORDER_COLS = ['case_id', 'customer_id', 'employee_id', 'recorded_by',
    'final_prescription_id', 'order_date', 'appointment_date', 'appointment_time',
    'lens_type', 'frame_product_id', 'frame_name', 'frame_brand', 'frame_model',
    'frame_color', 'frame_size', 'frame_sku', 'lens_product_id', 'right_lens_product_id',
    'lens_name', 'lens_brand', 'lens_design', 'lens_index', 'lens_coating', 'lens_tint',
    'lens_addons', 'lens_r_name', 'lens_r_sku', 'lens_l_name', 'lens_l_sku',
    'frame_price', 'lens_od_price', 'lens_os_price', 'options_price',
    'total_price', 'discount', 'deposit', 'deposit_pay_type',
    'marketing', 'notes'];

const INT_ORDER_COLS = ['case_id', 'customer_id', 'employee_id', 'recorded_by',
    'final_prescription_id', 'frame_product_id', 'lens_product_id', 'right_lens_product_id'];

const MONEY_ORDER_COLS = ['frame_price', 'lens_od_price', 'lens_os_price', 'options_price',
    'total_price', 'discount', 'deposit'];

function orderVals(array $b): array
{
    $hasBreakdown = array_key_exists('frame_price', $b) || array_key_exists('lens_od_price', $b)
        || array_key_exists('lens_os_price', $b) || array_key_exists('options_price', $b);
    if ($hasBreakdown) {
        $b['total_price'] = num($b['frame_price'] ?? null) + num($b['lens_od_price'] ?? null)
            + num($b['lens_os_price'] ?? null) + num($b['options_price'] ?? null);
    }
    $total    = num($b['total_price'] ?? null);
    $discount = num($b['discount'] ?? null);
    if ($discount > $total) {
        bad('ส่วนลดห้ามมากกว่ายอดรวม');
    }

    $out = [];
    foreach (ORDER_COLS as $c) {
        if (in_array($c, INT_ORDER_COLS, true)) {
            $out[] = int_or($b[$c] ?? null);
        } elseif (in_array($c, MONEY_ORDER_COLS, true)) {
            $out[] = num($b[$c] ?? null);
        } elseif ($c === 'order_date') {
            $out[] = str_or($b['order_date'] ?? null) ?: nowStamp();
        } else {
            $out[] = nul($b[$c] ?? null);
        }
    }
    return $out;
}

/** the three slots an order can hold a stock unit in */
const ORDER_STOCK_SLOTS = ['lens_product_id', 'right_lens_product_id', 'frame_product_id'];

/**
 * Move the order's hold on stock from whatever it was pointing at to what it
 * points at now, one slot at a time.
 *
 * เลือกสินค้าเข้าออเดอร์ = ตัดสต็อกทันที ซึ่งแปลว่า /fill เรียกซ้ำได้ต้องไม่ทำให้
 * ของหายทีละชิ้น: ช่องไหนเลขเปลี่ยน คืนชิ้นเดิมเข้าคลังก่อน แล้วค่อยตัดชิ้นใหม่
 * ช่องไหนเลขเดิมไม่ต้องแตะ — คืนแล้วตัดซ้ำจะได้ inventory_logs สองแถวที่ไม่มีอะไรเกิดขึ้นจริง
 *
 * @param array<string,?int> $before  slot => stock_lot id the order held
 * @param array<string,?int> $after   slot => stock_lot id the order should hold
 */
function moveOrderStock(Tx $q, array $before, array $after, string $note): void
{
    $release = [];
    $take    = [];
    foreach (ORDER_STOCK_SLOTS as $slot) {
        $old = $before[$slot] ? (int) $before[$slot] : null;
        $new = $after[$slot] ? (int) $after[$slot] : null;
        if ($old === $new) {
            continue;
        }
        if ($old) {
            $release[] = $old;
        }
        if ($new) {
            $take[] = $new;
        }
    }
    /* คืนให้หมดก่อนแล้วค่อยหยิบ — ย้ายชิ้นเดิมจากช่องหนึ่งไปอีกช่องหนึ่งจะได้ไม่ไป
       ติดว่า "ชิ้นนี้ถูกขายแล้ว" ด้วยตัวมันเองที่ยังไม่ได้คืน */
    foreach ($release as $lot) {
        releaseLot($q, $lot, "คืนของ: $note");
    }
    foreach ($take as $lot) {
        if (!pickLot($q, $lot, $note)) {
            bad('สินค้าชิ้นนี้ถูกขายไปแล้วระหว่างนี้ — เลือกชิ้นอื่น');
        }
    }
}

function orderDetail(?int $id): array
{
    $sel  = Sql::ORDER_SELECT;
    $from = Sql::ORDER_FROM;

    $o = Db::get(
        "SELECT $sel, c.sex, c.email, c.nationality, c.notes AS customer_notes $from WHERE o.id = ?",
        $id
    );
    if (!$o) {
        missing();
    }
    $o['prescription'] = $o['final_prescription_id']
        ? Db::get('SELECT * FROM prescriptions WHERE id = ?', (int) $o['final_prescription_id'])
        : null;

    $item = fn($sid) => $sid ? Db::get('SELECT * FROM v_stock_lot WHERE id = ?', (int) $sid) : null;
    $o['left_lens']  = $item($o['lens_product_id']);
    $o['right_lens'] = $item($o['right_lens_product_id']);
    $o['frame']      = $item($o['frame_product_id']);

    $o['payment_rows'] = Db::all(
        'SELECT p.*, e.employee_name AS received_by_name FROM payments p
           LEFT JOIN employees e ON e.id = p.received_by
          WHERE p.order_id = ? ORDER BY p.paid_at',
        $id
    );
    $o['balance'] = round2((float) $o['total_price'] - (float) $o['discount'] - (float) $o['paid']);
    return $o;
}

GET('/api/orders', function (array $req) {
    $q      = $req['query'];
    $status = str_or($q['status'] ?? null, 'all') ?: 'all';
    $where  = [];
    $args   = [];
    $unf    = Sql::UNFILLED;

    if ($status === 'unfilled') {
        $where[] = "o.order_closed = 0 AND $unf";
    } elseif ($status === 'unclosed') {
        $where[] = "o.order_closed = 0 AND NOT $unf";
    } elseif ($status === 'open') {
        $where[] = 'o.order_closed = 0';
    } elseif ($status === 'closed') {
        $where[] = 'o.order_closed = 1';
    }

    if ($cid = int_or($q['customer_id'] ?? null)) {
        $where[] = 'o.customer_id = ?';
        $args[]  = $cid;
    }
    if ($caseId = int_or($q['case_id'] ?? null)) {
        $where[] = 'o.case_id = ?';
        $args[]  = $caseId;
    }
    if ($term = str_or($q['q'] ?? null)) {
        $p = like($term);
        $where[] = '(c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?
                  OR o.invoice_code LIKE ? OR o.lens_name LIKE ? OR o.frame_name LIKE ?
                  OR CAST(o.id AS CHAR) = ?)';
        array_push($args, $p, $p, $p, $p, $p, $p, $term);
    }
    if ($fromDate = str_or($q['from'] ?? null)) {
        $where[] = 'DATE(o.order_date) >= ?';
        $args[]  = $fromDate;
    }
    if ($toDate = str_or($q['to'] ?? null)) {
        $where[] = 'DATE(o.order_date) <= ?';
        $args[]  = $toDate;
    }

    $sel      = Sql::ORDER_SELECT;
    $from     = Sql::ORDER_FROM;
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[]   = min(int_or($q['limit'] ?? null, 200), 2000);

    return Db::all(
        "SELECT $sel $from $sqlWhere ORDER BY o.order_date DESC, o.id DESC LIMIT ?",
        ...$args
    );
});

GET('/api/orders/:id', fn(array $r) => orderDetail(int_or($r['params']['id'])));

POST('/api/orders', function (array $req) {
    $body = $req['body'];
    $cid  = int_or($body['customer_id'] ?? null);
    if (!$cid) {
        bad('กรุณาเลือกลูกค้า');
    }
    if (!Db::get('SELECT id FROM customers WHERE id = ?', $cid)) {
        bad('ไม่พบลูกค้ารายนี้');
    }
    $code = str_or($body['invoice_code'] ?? null)
        ?: nextCode('INV', 'custom_orders', 'invoice_code');

    $id = Db::tx(function (Tx $q) use ($body, $code) {
        $names = implode(',', ORDER_COLS);
        $marks = implode(',', array_fill(0, count(ORDER_COLS), '?'));
        $r = $q->run(
            "INSERT INTO custom_orders (invoice_code, $names) VALUES (?, $marks)",
            ...[$code, ...orderVals($body)]
        );
        $oid     = $r['insertId'];
        $deposit = num($body['deposit'] ?? null);

        if ($deposit > 0) {
            $q->run(
                'INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, notes)
                 VALUES (?,?,?,?,?,?,?)',
                int_or($body['case_id'] ?? null),
                $oid,
                'deposit',
                str_or($body['deposit_pay_type'] ?? null, 'Cash') ?: 'Cash',
                $deposit,
                int_or($body['employee_id'] ?? null),
                'มัดจำตอนเปิดออเดอร์'
            );
        }
        logEvent($q, int_or($body['case_id'] ?? null), [
            'action'      => 'order_created',
            'entity'      => 'custom_order',
            'entity_id'   => $oid,
            'employee_id' => int_or($body['employee_id'] ?? null),
            'note'        => $code,
        ]);
        if (int_or($body['case_id'] ?? null)) {
            setStatus($q, int_or($body['case_id']), $deposit > 0 ? 'appointment' : 'order_confirm', [
                'employee_id' => int_or($body['employee_id'] ?? null),
                'action'      => 'order_created',
            ]);
        }
        return $oid;
    });

    return orderDetail($id);
});

PUT('/api/orders/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    if (!Db::get('SELECT id FROM custom_orders WHERE id = ?', $id)) {
        missing();
    }
    $set = implode(',', array_map(fn($c) => "$c=?", ORDER_COLS));
    Db::run("UPDATE custom_orders SET $set WHERE id=?", ...[...orderVals($req['body']), $id]);
    return orderDetail($id);
});

POST('/api/orders/:id/fill', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $o    = Db::get('SELECT * FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    if ((int) $o['order_closed']) {
        bad('ออเดอร์นี้ปิดการขายแล้ว');
    }

    /* "ขายไปแล้ว" ห้ามหยิบ ยกเว้นชิ้นที่ออเดอร์ใบนี้ถืออยู่แล้ว — ตั้งแต่ /fill
       เป็นคนตัดสต็อก ชิ้นที่เพิ่งเลือกไปก็นับว่าขายแล้วทันที เปิดฟอร์มขึ้นมากด
       บันทึกซ้ำโดยไม่เปลี่ยนอะไรจึงจะโดนปฏิเสธด้วยของของตัวเอง */
    $pick = function (string $key) use ($body, $o) {
        $sid = int_or($body[$key] ?? null);
        if (!$sid) {
            return null;
        }
        $s = Db::get('SELECT * FROM v_stock_lot WHERE id = ?', $sid);
        if (!$s) {
            bad("ไม่พบสินค้ารหัส $sid");
        }
        $held = in_array($sid, array_map('intval', array_filter([
            $o['lens_product_id'], $o['right_lens_product_id'], $o['frame_product_id'],
        ])), true);
        if ((int) $s['sold'] && !$held) {
            bad("สินค้ารหัส $sid ({$s['product_name']}) ถูกขายไปแล้ว");
        }
        return $s;
    };
    $L = $pick('lens_product_id');
    $R = $pick('right_lens_product_id');
    $F = $pick('frame_product_id');

    Db::tx(function (Tx $q) use ($id, $o, $body, $L, $R, $F) {
        $lensRef  = $L ?? $R;
        $lensName = str_or($body['lens_name'] ?? null)
            ?: ($lensRef ? $lensRef['product_name'] : $o['lens_name']);
        $frameName = str_or($body['frame_name'] ?? null)
            ?: ($F ? $F['product_name'] : $o['frame_name']);

        $q->run(
            'UPDATE custom_orders SET lens_product_id=?, right_lens_product_id=?,
               frame_product_id=?, lens_name=?, frame_name=?, appointment_date=?, notes=?
             WHERE id=?',
            $L ? (int) $L['id'] : null,
            $R ? (int) $R['id'] : null,
            $F ? (int) $F['id'] : null,
            $lensName,
            $frameName,
            nul($body['appointment_date'] ?? null) ?? $o['appointment_date'],
            !array_key_exists('notes', $body) ? $o['notes'] : nul($body['notes']),
            $id
        );
        /* ของออกจากคลังตรงนี้ ไม่ใช่ตอนปิดการขาย — เลือกให้ลูกค้าแล้วชิ้นนั้นเป็นของเขา
           คนอื่นหยิบไม่ได้ (ห้องผลิตซึ่งเคยเป็นคนเบิกไม่มีแล้ว) */
        moveOrderStock(
            $q,
            [
                'lens_product_id'       => int_or($o['lens_product_id']),
                'right_lens_product_id' => int_or($o['right_lens_product_id']),
                'frame_product_id'      => int_or($o['frame_product_id']),
            ],
            [
                'lens_product_id'       => $L ? (int) $L['id'] : null,
                'right_lens_product_id' => $R ? (int) $R['id'] : null,
                'frame_product_id'      => $F ? (int) $F['id'] : null,
            ],
            'เลือกสินค้าเข้าออเดอร์ ' . ($o['invoice_code'] ?? '')
        );
        $parts = array_filter([
            $L ? 'L#' . $L['id'] : null,
            $R ? 'R#' . $R['id'] : null,
            $F ? 'F#' . $F['id'] : null,
        ]);
        logEvent($q, int_or($o['case_id']), [
            'action'      => 'order_filled',
            'entity'      => 'custom_order',
            'entity_id'   => $id,
            'employee_id' => int_or($body['employee_id'] ?? null),
            'note'        => implode(' ', $parts),
        ]);
    });

    return orderDetail($id);
});

POST('/api/orders/:id/close', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $o    = Db::get('SELECT * FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    if ((int) $o['order_closed']) {
        bad('ออเดอร์นี้ปิดการขายไปแล้ว');
    }

    Db::tx(function (Tx $q) use ($id, $o, $body) {
        $paidRow = $q->get(
            'SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE order_id = ? AND cancelled_at IS NULL',
            $id
        );
        $balance = round2((float) $o['total_price'] - (float) $o['discount'] - (float) $paidRow['paid']);

        $rawIncome = $body['order_close_income'] ?? null;
        $income    = ($rawIncome === null || $rawIncome === '') ? $balance : num($rawIncome);

        $stamp   = str_or($body['order_close_date'] ?? null) ?: nowStamp();
        $empId   = int_or($body['order_close_employee_id'] ?? null) ?? int_or($o['employee_id']);
        $payType = str_or($body['order_close_pay_type'] ?? null, 'Cash') ?: 'Cash';

        $q->run(
            'UPDATE custom_orders SET order_closed = 1, order_close_date = ?,
               order_close_employee_id = ?, order_close_income = ?, order_close_pay_type = ?,
               notes = ? WHERE id = ?',
            $stamp,
            $empId,
            $income,
            $payType,
            !array_key_exists('notes', $body) ? $o['notes'] : nul($body['notes']),
            $id
        );

        if ($income > 0) {
            $q->run(
                'INSERT INTO payments (case_id, order_id, kind, method, amount, received_by, paid_at, notes)
                 VALUES (?,?,?,?,?,?,?,?)',
                int_or($o['case_id']),
                $id,
                'final',
                $payType,
                $income,
                $empId,
                $stamp,
                'รับเงินตอนปิดการขาย'
            );
        }
        /* ของถูกตัดไปแล้วตอนเลือกเข้าออเดอร์ (/fill) — ปิดการขายคือเรื่องเงิน ไม่ใช่เรื่องของ */
        logEvent($q, int_or($o['case_id']), [
            'action'      => 'order_closed',
            'entity'      => 'custom_order',
            'entity_id'   => $id,
            'employee_id' => $empId,
            'note'        => 'รับเพิ่ม ' . $income,
        ]);
        if ($o['case_id']) {
            setStatus($q, (int) $o['case_id'], 'completed', [
                'employee_id' => $empId,
                'action'      => 'order_closed',
            ]);
        }
    });

    return orderDetail($id);
});

POST('/api/orders/:id/reopen', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $o    = Db::get('SELECT * FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    Db::tx(function (Tx $q) use ($id, $o, $body) {
        $q->run(
            'UPDATE custom_orders SET order_closed = 0, order_close_date = NULL,
               order_close_income = NULL WHERE id = ?',
            $id
        );
        $q->run("DELETE FROM payments WHERE order_id = ? AND kind = 'final'", $id);
        /* ของยังอยู่กับออเดอร์ — เปิดกลับมาแก้ไม่ได้แปลว่าเอาของคืนขึ้นชั้น
           ถ้าจะคืนจริงคือแก้ที่ /fill ให้เลือกชิ้นอื่นหรือเอาออก */
        logEvent($q, int_or($o['case_id']), [
            'action'      => 'order_reopened',
            'entity'      => 'custom_order',
            'entity_id'   => $id,
            'employee_id' => int_or($body['employee_id'] ?? null),
        ]);
        if ($o['case_id']) {
            setStatus($q, (int) $o['case_id'], 'waiting_pickup', [
                'employee_id' => int_or($body['employee_id'] ?? null),
                'action'      => 'order_reopened',
            ]);
        }
    });
    return orderDetail($id);
});

DELETE('/api/orders/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $o  = Db::get('SELECT * FROM custom_orders WHERE id = ?', $id);
    if (!$o) {
        missing();
    }
    if ((int) $o['order_closed']) {
        bad('ลบไม่ได้ — ออเดอร์ปิดการขายแล้ว');
    }
    Db::tx(function (Tx $q) use ($id) {
        $q->run('DELETE FROM payments WHERE order_id = ?', $id);
        $q->run('DELETE FROM custom_orders WHERE id = ?', $id);
    });
    return ['ok' => true];
});
