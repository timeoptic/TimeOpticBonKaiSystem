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
    $amount = num($body['amount'] ?? null);
    if (!($amount > 0)) {
        bad('จำนวนเงินต้องมากกว่า 0');
    }
    /* ทุกก้อนที่รับเข้ามาต้องมีชื่อคนรับติดอยู่ — ตอนยอดไม่ตรงตอนปิดร้าน คำถามแรก
       คือ "ใครรับ" แถวที่ไม่มีคนรับตอบคำถามนั้นไม่ได้ และไปตามทีหลังก็ไม่มีใครจำ */
    $receivedBy = int_or($body['received_by'] ?? null);
    if (!$receivedBy) {
        bad('กรุณาเลือกผู้รับเงิน');
    }
    $kindIn = str_or($body['kind'] ?? null);
    $kind   = in_array($kindIn, ['deposit', 'partial', 'full', 'final'], true) ? $kindIn : 'partial';
    $method = str_or($body['method'] ?? null, 'Cash') ?: 'Cash';

    $orderId = int_or($body['order_id'] ?? null);
    $caseId  = int_or($body['case_id'] ?? null);

    $id = Db::tx(function (Tx $q) use ($body, $amount, $kind, $method, $receivedBy, $orderId, $caseId) {
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
        if (($orderId || $caseId) && !boolInt($body['confirm_duplicate'] ?? null)) {
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
            'note'        => "$kind $amount ($method)",
        ]);
        return $r['insertId'];
    });

    return Db::get('SELECT * FROM payments WHERE id = ?', $id);
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
