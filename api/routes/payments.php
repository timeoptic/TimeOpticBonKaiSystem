<?php
/** Money received — against an order, a case, or a walk-in sale. */
declare(strict_types=1);

GET('/api/payments', function (array $req) {
    $q     = $req['query'];
    $where = ['p.cancelled_at IS NULL'];
    $args  = [];

    if ($oid = int_or($q['order_id'] ?? null)) {
        $where[] = 'p.order_id = ?';
        $args[]  = $oid;
    }
    if ($cid = int_or($q['case_id'] ?? null)) {
        $where[] = 'p.case_id = ?';
        $args[]  = $cid;
    }
    if ($from = str_or($q['from'] ?? null)) {
        $where[] = 'DATE(p.paid_at) >= ?';
        $args[]  = $from;
    }
    if ($to = str_or($q['to'] ?? null)) {
        $where[] = 'DATE(p.paid_at) <= ?';
        $args[]  = $to;
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[]   = min(int_or($q['limit'] ?? null, 300), 2000);

    return Db::all(
        "SELECT p.*, e.employee_name AS received_by_name, o.invoice_code, c.case_code
           FROM payments p
           LEFT JOIN employees e     ON e.id = p.received_by
           LEFT JOIN custom_orders o ON o.id = p.order_id
           LEFT JOIN cases c         ON c.id = p.case_id
           $sqlWhere
          ORDER BY p.paid_at DESC, p.id DESC LIMIT ?",
        ...$args
    );
});

/**
 * ยอดเท่ากันกับออเดอร์เดียวกันภายในกี่นาทีถึงนับว่า "อาจซ้ำ" (ร้านเลือก 10 นาที)
 * — ครอบการกดซ้ำ รีเฟรช และสองคนบันทึกพร้อมกัน · ลูกค้าที่จ่ายสองงวดยอดเท่ากันจริง
 * มักห่างกันเป็นวัน และถ้าเกิดภายในช่วงนี้จริงก็แค่ต้องกดยืนยันหนึ่งครั้ง
 */
const PAYMENT_DUPLICATE_MINUTES = 10;

POST('/api/payments', function (array $req) {
    $body   = $req['body'];
    /* "ยังไม่ชำระ" = รายการ 0 บาทที่บอกว่าลูกค้าจะมาจ่ายตอนรับของ (ร้านขอ 14 ก.ย. 2026) ·
       ยอดเป็น 0 เสมอไม่ว่าหน้าเว็บส่งอะไรมา และไม่มีวิธีชำระ เพราะยังไม่มีเงินผ่านมือใคร */
    $unpaid = str_or($body['kind'] ?? null) === 'unpaid';
    $amount = $unpaid ? 0.0 : num($body['amount'] ?? null);
    /* 0 บาทได้เฉพาะออเดอร์ที่ยอดสุทธิเป็น 0 — เคสเคลมที่ร้านไม่คิดเงิน (ร้านขอ 14 ก.ย. 2026)
       ยอดของออเดอร์ตรวจข้างล่างหลังล็อกแถว · ช่องว่างไม่นับเป็น 0 ต้องพิมพ์ 0 เอง */
    if (!$unpaid && !is_numeric(trim((string) ($body['amount'] ?? '')))) {
        bad('กรุณาใส่จำนวนเงิน');
    }
    if (!$unpaid && ($amount < 0 || (!($amount > 0) && !int_or($body['order_id'] ?? null)))) {
        bad('จำนวนเงินต้องมากกว่า 0');
    }
    /* ทุกก้อนที่รับเข้ามาต้องมีชื่อคนรับติดอยู่ — ตอนยอดไม่ตรงตอนปิดร้าน คำถามแรก
       คือ "ใครรับ" แถวที่ไม่มีคนรับตอบคำถามนั้นไม่ได้ และไปตามทีหลังก็ไม่มีใครจำ */
    $receivedBy = int_or($body['received_by'] ?? null);
    if (!$receivedBy) {
        bad('กรุณาเลือกผู้รับเงิน');
    }
    $kindIn = str_or($body['kind'] ?? null);
    $kind   = in_array($kindIn, ['deposit', 'partial', 'full', 'final', 'unpaid'], true) ? $kindIn : 'partial';
    $method = $unpaid ? '' : (str_or($body['method'] ?? null, 'Cash') ?: 'Cash');

    $orderId = int_or($body['order_id'] ?? null);
    $caseId  = int_or($body['case_id'] ?? null);
    /* ผู้รับเงินต้องอยู่ในรายชื่อของขั้นชำระเงิน (ค่าคอม — ProcessStaff) · บิล POS ไม่มีเคส ไม่ตรวจ */
    ProcessStaff::check('payment', $caseId, $receivedBy);
    if ($unpaid && !$orderId) {
        bad('บันทึก "ยังไม่ชำระ" ต้องผูกกับออเดอร์');
    }

    $id = Db::tx(function (Tx $q) use ($body, $amount, $kind, $method, $receivedBy, $orderId, $caseId, $unpaid) {
        /* ด่านกันบันทึกเงินผิด — เหตุการณ์จริง 11 ก.ย. 2026 ออเดอร์ 10459 ถูกบันทึก
           ฿2,900 สามครั้งห่างกันไม่กี่วินาที · หน้าเว็บกันแล้วก็จริง แต่แท็บที่สองหรือ
           เครื่องที่สองไม่รู้เรื่องนั้น ด่านจริงจึงต้องอยู่ที่นี่

           ล็อกแถวออเดอร์ก่อนอ่านยอด — สองคำขอที่มาพร้อมกันต้องต่อคิวกัน ไม่งั้นทั้งคู่
           เห็นยอดคงเหลือเดิมแล้วผ่านด่านไปพร้อมกัน */
        if ($orderId) {
            $order = $q->get('SELECT total_price, discount FROM custom_orders WHERE id = ? FOR UPDATE', $orderId);
            if (!$order) {
                bad('ไม่พบออเดอร์นี้');
            }
            $net     = round2((float) $order['total_price'] - (float) $order['discount']);
            $paid    = round2($q->get(
                'SELECT COALESCE(SUM(amount), 0) s FROM payments WHERE order_id = ? AND cancelled_at IS NULL',
                $orderId
            )['s']);
            $balance = round2(max(0, $net - $paid));
            /* 0 บาท = ไม่คิดเงิน ใช้ได้เฉพาะออเดอร์ยอดสุทธิ 0 · ออเดอร์ที่มียอดต้องจ่ายแล้วลูกค้ายังไม่จ่าย
               คือ "ยังไม่ชำระ" ไม่ใช่รับเงิน 0 บาท */
            if (!$unpaid && !($amount > 0) && $net > 0.001) {
                bad('จำนวนเงินต้องมากกว่า 0 — ลูกค้ายังไม่จ่าย ให้เลือก "ยังไม่ชำระ"');
            }
            /* "ยังไม่ชำระ" มีความหมายเฉพาะเมื่อยังมียอดให้จ่าย และมีได้รายการเดียวต่อออเดอร์ —
               สองรายการบอกเรื่องเดียวกันซ้ำ แล้วยกเลิกไปรายการเดียวขั้นชำระเงินก็ยังผ่านอยู่ */
            if ($unpaid) {
                if (!($balance > 0.001)) {
                    throw new HttpError(400, 'ออเดอร์นี้ไม่มียอดค้าง บันทึก "ยังไม่ชำระ" ไม่ได้', ['reason' => 'nothing_due']);
                }
                if ($q->get(
                    "SELECT id FROM payments WHERE order_id = ? AND kind = 'unpaid' AND cancelled_at IS NULL LIMIT 1",
                    $orderId
                )) {
                    throw new HttpError(
                        400,
                        'บันทึกว่ายังไม่ชำระไว้แล้ว — ถ้าจะบันทึกใหม่ให้ลบรายการเดิมก่อน',
                        ['reason' => 'unpaid_exists']
                    );
                }
            }
            /* รับเกินยอดไม่ได้เลย ไม่มีทางยืนยันข้าม (ร้านตัดสินไว้) · ยอด 0 คือยังไม่ใส่
               ราคา ไม่มียอดให้เทียบ จึงรับมัดจำได้ */
            if ($net > 0 && $amount > $balance + 0.001) {
                throw new HttpError(
                    400,
                    $balance > 0
                        ? 'รับเกินยอดคงเหลือไม่ได้ — คงเหลือ ' . number_format($balance, 2) . ' บาท'
                        : 'ออเดอร์นี้ชำระครบแล้ว รับเงินเพิ่มไม่ได้',
                    ['reason' => 'over_balance', 'balance' => $balance]
                );
            }
        }

        /* ยอดเท่ากันกับออเดอร์เดียวกัน (ไม่มีออเดอร์ = เคสเดียวกัน) ภายในไม่กี่นาที =
           น่าจะกดซ้ำ · ถามก่อน ไม่ได้ห้าม — ลูกค้าจ่ายสองก้อนเท่ากันจริงก็มี
           เทียบเวลาด้วย NOW() ของฐานข้อมูลเอง เพราะ created_at ก็มาจากนาฬิกาเดียวกัน */
        if (!$unpaid && ($orderId || $caseId) && !boolInt($body['confirm_duplicate'] ?? null)) {
            $dup = $q->get(
                'SELECT p.id, p.amount, TIMESTAMPDIFF(SECOND, p.created_at, NOW()) AS seconds_ago,
                        e.employee_name
                   FROM payments p
                   LEFT JOIN employees e ON e.id = p.received_by
                  WHERE ' . ($orderId ? 'p.order_id = ?' : 'p.case_id = ?') . '
                    AND p.cancelled_at IS NULL AND p.amount = ?
                    AND p.created_at >= NOW() - INTERVAL ' . PAYMENT_DUPLICATE_MINUTES . ' MINUTE
                  ORDER BY p.id DESC LIMIT 1',
                $orderId ?: $caseId,
                $amount
            );
            if ($dup) {
                $ago = (int) $dup['seconds_ago'];
                throw new HttpError(
                    409,
                    'เพิ่งบันทึกรับเงิน ' . number_format((float) $dup['amount'], 2) . ' บาท ไปเมื่อ '
                        . ($ago < 60 ? "$ago วินาที" : intdiv($ago, 60) . ' นาที') . 'ก่อน — ถ้าไม่ใช่รายการซ้ำ ให้ยืนยันแล้วบันทึกอีกครั้ง',
                    ['reason' => 'possible_duplicate', 'duplicate' => [
                        'id'               => (int) $dup['id'],
                        'amount'           => (float) $dup['amount'],
                        'seconds_ago'      => $ago,
                        'received_by_name' => $dup['employee_name'],
                    ]]
                );
            }
        }

        $r = $q->run(
            'INSERT INTO payments (case_id, order_id, sale_id, kind, method, amount,
               reference, received_by, paid_at, notes, source)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            int_or($body['case_id'] ?? null),
            int_or($body['order_id'] ?? null),
            int_or($body['sale_id'] ?? null),
            $kind,
            $method,
            $amount,
            nul($body['reference'] ?? null),
            $receivedBy,
            str_or($body['paid_at'] ?? null) ?: nowStamp(),
            nul($body['notes'] ?? null),
            /* ขั้นที่กดรับเงิน — ค่าอื่นที่ไม่รู้จักไม่เก็บ จะได้ไม่กลายเป็นช่องข้อความอิสระ */
            in_array($body['source'] ?? null, ['payment', 'delivery'], true) ? $body['source'] : null
        );
        if (int_or($body['order_id'] ?? null) && $kind === 'deposit') {
            $q->run(
                'UPDATE custom_orders SET deposit = deposit + ?,
                   deposit_pay_type = COALESCE(deposit_pay_type, ?) WHERE id = ?',
                $amount,
                $method,
                int_or($body['order_id'])
            );
        }
        logEvent($q, int_or($body['case_id'] ?? null), [
            'action'      => 'payment',
            'entity'      => 'payment',
            'entity_id'   => $r['insertId'],
            'employee_id' => $receivedBy,
            'note'        => $unpaid ? 'ยังไม่ชำระ — ลูกค้าจะชำระตอนรับของ' : "$kind $amount ($method)",
        ]);
        /* ส่งมอบก่อนแล้วมาจ่ายส่วนที่ค้างทีหลัง — จ่ายครบเมื่อไหร่ออเดอร์ปิดเอง */
        $caseOfOrder = int_or($body['case_id'] ?? null);
        if (!$caseOfOrder && int_or($body['order_id'] ?? null)) {
            $caseOfOrder = int_or($q->get('SELECT case_id FROM custom_orders WHERE id = ?', int_or($body['order_id']))['case_id'] ?? null);
        }
        closeOrdersOfCompletedCase($q, $caseOfOrder, $receivedBy);
        return $r['insertId'];
    });

    return Db::get('SELECT * FROM payments WHERE id = ?', $id);
});

/** ป้ายประเภทการรับเงิน สำหรับข้อความในไทม์ไลน์ — ตรงกับ KIND_LABEL ของ PaymentPanel */
const PAYMENT_KIND_TH = [
    'deposit' => 'มัดจำ', 'partial' => 'จ่ายบางส่วน', 'full' => 'ชำระเต็ม', 'final' => 'ชำระส่วนที่เหลือ',
    'unpaid'  => 'ยังไม่ชำระ',
];

/**
 * แก้ไขรายการรับเงิน — แอดมิน เจ้าของร้าน ผู้ดูแลระบบ เท่านั้น (ร้านขอ 11 ก.ย. 2026)
 *
 * เกณฑ์สิทธิ์เดียวกับยกเลิกใบขาย POS (`system.zone`) · หน้าเว็บซ่อนปุ่มก็จริง แต่ด่าน
 * อยู่ที่นี่ · กติกา: บังคับเหตุผล · รายการที่ยกเลิกแล้วแก้ไม่ได้ · แก้จนเกินยอดคงเหลือ
 * ไม่ได้ (ไม่นับตัวเอง) · มัดจำในออเดอร์ขยับตาม · ค่าเก่า → ค่าใหม่ลงไทม์ไลน์ของเคส
 * ไม่มีด่านรายการซ้ำ — การแก้ไม่ได้สร้างเงินก้อนใหม่
 */
PUT('/api/payments/:id', function (array $req) {
    $id    = int_or($req['params']['id']);
    $body  = $req['body'];
    $actor = StockModule::actor();
    if (!$actor || !\Optic\Roles::systemZone($actor['roles'] ?? [])) {
        throw new HttpError(403, 'แก้ไขรายการรับเงินได้เฉพาะแอดมินหรือเจ้าของร้าน', ['reason' => 'forbidden']);
    }

    $row = Db::tx(function (Tx $q) use ($id, $body, $actor) {
        $p = $q->get('SELECT * FROM payments WHERE id = ? FOR UPDATE', $id);
        if (!$p) {
            missing();
        }
        if ($p['cancelled_at']) {
            bad('รายการนี้ถูกยกเลิกไปแล้ว แก้ไขไม่ได้');
        }
        /* "ยังไม่ชำระ" ไม่ใช่เงิน — แก้เป็นเงินจริงจะกลายเป็นรับเงินที่ไม่ผ่านด่านรับซ้ำ และแก้
           เงินจริงเป็น "ยังไม่ชำระ" คือลบเงินออกจากบัญชีโดยไม่มีร่องรอยการยกเลิก · ผิดให้ลบแล้วบันทึกใหม่ */
        if ($p['kind'] === 'unpaid' || ($body['kind'] ?? null) === 'unpaid') {
            throw new HttpError(
                400,
                'รายการ "ยังไม่ชำระ" แก้ไขไม่ได้ — ให้ลบแล้วบันทึกใหม่',
                ['reason' => 'unpaid_locked']
            );
        }
        $reason = trim((string) ($body['reason'] ?? ''));
        if ($reason === '') {
            bad('กรุณาใส่เหตุผลที่แก้ไข');
        }
        $amount = num($body['amount'] ?? null);
        if (!is_numeric(trim((string) ($body['amount'] ?? ''))) || $amount < 0) {
            bad('จำนวนเงินต้องมากกว่า 0');
        }
        /* 0 บาทได้เฉพาะรายการของออเดอร์ยอดสุทธิ 0 (เคลมไม่คิดเงิน) — กติกาเดียวกับตอนรับเงิน */
        if (!($amount > 0)) {
            $o = $p['order_id']
                ? $q->get('SELECT total_price - discount AS net FROM custom_orders WHERE id = ?', $p['order_id'])
                : null;
            if (!$o || (float) $o['net'] > 0.001) {
                bad('จำนวนเงินต้องมากกว่า 0');
            }
        }
        $receivedBy = int_or($body['received_by'] ?? null);
        $receiver   = $receivedBy ? $q->get('SELECT employee_name FROM employees WHERE id = ?', $receivedBy) : null;
        if (!$receiver) {
            bad('กรุณาเลือกผู้รับเงิน');
        }
        ProcessStaff::check('payment', int_or($p['case_id']), $receivedBy, int_or($p['received_by']));
        $kind   = array_key_exists((string) ($body['kind'] ?? ''), PAYMENT_KIND_TH) ? (string) $body['kind'] : $p['kind'];
        $method = str_or($body['method'] ?? null) ?: $p['method'];
        $paidAt = str_or($body['paid_at'] ?? null) ?: (string) $p['paid_at'];
        if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', $paidAt)) {
            bad('วันเวลาที่รับเงินไม่ถูกต้อง');
        }
        if (strlen($paidAt) === 16) {
            $paidAt .= ':00';
        }

        $before = [
            'amount'      => round2((float) $p['amount']),
            'kind'        => $p['kind'],
            'method'      => $p['method'],
            'reference'   => nul($p['reference']),
            'received_by' => (int) $p['received_by'],
            'paid_at'     => (string) $p['paid_at'],
        ];
        $after = [
            'amount'      => round2($amount),
            'kind'        => $kind,
            'method'      => $method,
            'reference'   => nul($body['reference'] ?? null),
            'received_by' => $receivedBy,
            'paid_at'     => $paidAt,
        ];
        $changed = array_keys(array_filter($before, fn($v, $k) => (string) $v !== (string) $after[$k], ARRAY_FILTER_USE_BOTH));
        if (!$changed) {
            bad('ไม่มีอะไรเปลี่ยน');
        }

        if ($p['order_id']) {
            /* ล็อกออเดอร์ก่อนอ่านยอด เหตุผลเดียวกับตอนรับเงิน · ยอดคงเหลือไม่นับตัวเอง
               แก้ 300 เป็น 400 บนออเดอร์ที่เหลือ 100 คือขยับได้อีก 100 ไม่ใช่ 400 */
            $order = $q->get('SELECT total_price, discount FROM custom_orders WHERE id = ? FOR UPDATE', $p['order_id']);
            if ($order) {
                $net     = round2((float) $order['total_price'] - (float) $order['discount']);
                $others  = round2($q->get(
                    'SELECT COALESCE(SUM(amount), 0) s FROM payments WHERE order_id = ? AND cancelled_at IS NULL AND id <> ?',
                    $p['order_id'], $id
                )['s']);
                $balance = round2(max(0, $net - $others));
                if ($net > 0 && $amount > $balance + 0.001) {
                    throw new HttpError(
                        400,
                        'แก้เกินยอดคงเหลือไม่ได้ — รายการนี้แก้ได้ไม่เกิน ' . number_format($balance, 2) . ' บาท',
                        ['reason' => 'over_balance', 'balance' => $balance]
                    );
                }
            }
            $delta = ($kind === 'deposit' ? $amount : 0) - ($p['kind'] === 'deposit' ? (float) $p['amount'] : 0);
            if (abs($delta) > 0.001) {
                $q->run('UPDATE custom_orders SET deposit = GREATEST(deposit + ?, 0) WHERE id = ?', $delta, $p['order_id']);
            }
        }

        $q->run(
            'UPDATE payments SET amount = ?, kind = ?, method = ?, reference = ?, received_by = ?, paid_at = ? WHERE id = ?',
            $amount, $kind, $method, $after['reference'], $receivedBy, $paidAt, $id
        );

        $oldReceiver = $q->get('SELECT employee_name FROM employees WHERE id = ?', $before['received_by'])['employee_name'] ?? '—';
        $show = [
            'amount'      => ['จำนวน', fn($v) => number_format((float) $v, 2)],
            'kind'        => ['ประเภท', fn($v) => PAYMENT_KIND_TH[$v] ?? (string) $v],
            'method'      => ['วิธีชำระ', fn($v) => (string) $v],
            'reference'   => ['อ้างอิง', fn($v) => $v ?? '—'],
            'received_by' => ['ผู้รับเงิน', fn($v) => $v === $before['received_by'] ? $oldReceiver : $receiver['employee_name']],
            'paid_at'     => ['รับเมื่อ', fn($v) => substr((string) $v, 0, 16)],
        ];
        $parts = array_map(
            fn($k) => $show[$k][0] . ' ' . $show[$k][1]($before[$k]) . ' → ' . $show[$k][1]($after[$k]),
            $changed
        );
        $by = (string) ($actor['displayName'] ?? $actor['username'] ?? '');
        logEvent($q, int_or($p['case_id']), [
            'action'      => 'payment_edited',
            'entity'      => 'payment',
            'entity_id'   => $id,
            'employee_id' => $actor['employeeId'] ?? null,
            'note'        => implode(' · ', $parts) . " — เหตุผล: $reason" . ($by !== '' ? " (แก้โดย $by)" : ''),
            'payload'     => ['before' => $before, 'after' => $after, 'reason' => $reason, 'by' => $by],
        ]);
        closeOrdersOfCompletedCase($q, int_or($p['case_id']), $receivedBy);

        return $id;
    });

    return Db::get(
        'SELECT p.*, e.employee_name AS received_by_name
           FROM payments p LEFT JOIN employees e ON e.id = p.received_by
          WHERE p.id = ?',
        $row
    );
});

DELETE('/api/payments/:id', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $p    = Db::get('SELECT * FROM payments WHERE id = ?', $id);
    if (!$p) {
        missing();
    }
    if ($p['cancelled_at']) {
        bad('รายการนี้ถูกยกเลิกไปแล้ว');
    }
    Db::tx(function (Tx $q) use ($id, $p, $body) {
        if ($p['order_id'] && $p['kind'] === 'deposit') {
            $q->run(
                'UPDATE custom_orders SET deposit = GREATEST(deposit - ?, 0) WHERE id = ?',
                (float) $p['amount'],
                (int) $p['order_id']
            );
        }
        $q->run(
            'UPDATE payments SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?',
            nowStamp(),
            int_or($body['employee_id'] ?? null),
            nul($body['reason'] ?? null),
            $id
        );
        logEvent($q, int_or($p['case_id']), [
            'action'    => 'payment_cancelled',
            'entity'    => 'payment',
            'entity_id' => $id,
            'note'      => (string) $p['amount'],
        ]);
    });
    return ['ok' => true];
});
