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

    $id = Db::tx(function (Tx $q) use ($body, $amount, $kind, $method, $receivedBy) {
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
