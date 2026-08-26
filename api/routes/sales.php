<?php
/**
 * Walk-in sales of a single stock item (no prescription, no case).
 * Selling marks the stock row sold and books a full payment in one go.
 */
declare(strict_types=1);

/** Sell 1 unit from the given lot (replaces the old `UPDATE stock SET sold=1`).
 *  Returns false if the lot has nothing left (guards a double-sell race) — does
 *  nothing and returns true if $lotId is falsy (a sale with no stock item attached). */
function pickLot(Tx $q, ?int $lotId, ?string $note): bool
{
    if (!$lotId) {
        return true;
    }
    $r = $q->run(
        'UPDATE stock_lots SET remaining_qty = remaining_qty - 1 WHERE id = ? AND remaining_qty > 0',
        $lotId
    );
    if (!$r['affected']) {
        return false;
    }
    $lot = $q->get('SELECT product_id FROM stock_lots WHERE id = ?', $lotId);
    $q->run(
        "INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
         VALUES (?,?,'OUT',-1,?)",
        (int) $lot['product_id'], $lotId, nul($note)
    );
    return true;
}

/** Return 1 unit to the given lot (replaces the old `UPDATE stock SET sold=0`). */
function releaseLot(Tx $q, ?int $lotId, ?string $note): void
{
    if (!$lotId) {
        return;
    }
    $r = $q->run('UPDATE stock_lots SET remaining_qty = remaining_qty + 1 WHERE id = ?', $lotId);
    if (!$r['affected']) {
        return;
    }
    $lot = $q->get('SELECT product_id FROM stock_lots WHERE id = ?', $lotId);
    $q->run(
        "INSERT INTO inventory_logs (product_id, lot_id, action_type, quantity, notes)
         VALUES (?,?,'RETURN',1,?)",
        (int) $lot['product_id'], $lotId, nul($note)
    );
}

GET('/api/sales', function (array $req) {
    $q     = $req['query'];
    $where = [];
    $args  = [];

    if ($term = str_or($q['q'] ?? null)) {
        $p = like($term);
        $where[] = '(s.invoice_code LIKE ? OR st.product_name LIKE ? OR s.notes LIKE ?)';
        array_push($args, $p, $p, $p);
    }
    if ($from = str_or($q['from'] ?? null)) {
        $where[] = 'DATE(s.sale_date) >= ?';
        $args[]  = $from;
    }
    if ($to = str_or($q['to'] ?? null)) {
        $where[] = 'DATE(s.sale_date) <= ?';
        $args[]  = $to;
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[]   = min(int_or($q['limit'] ?? null, 200), 2000);

    return Db::all(
        "SELECT s.*, st.product_name, st.product_type, e.employee_name,
                c.first_name, c.last_name
           FROM sales s
           LEFT JOIN v_stock_lot st ON st.id = s.product_stock_id
           LEFT JOIN employees e  ON e.id  = s.employee_id
           LEFT JOIN customers c  ON c.id  = s.customer_id
           $sqlWhere
          ORDER BY s.sale_date DESC, s.id DESC LIMIT ?",
        ...$args
    );
});

POST('/api/sales', function (array $req) {
    $body = $req['body'];
    $sid  = int_or($body['product_stock_id'] ?? null);
    if (!$sid) {
        bad('กรุณาเลือกสินค้าจากคลัง');
    }

    $id = Db::tx(function (Tx $q) use ($body, $sid) {
        $s = $q->get('SELECT * FROM v_stock_lot WHERE id = ?', $sid);
        if (!$s) {
            bad("ไม่พบสินค้ารหัส $sid");
        }
        if ((int) $s['sold']) {
            bad("สินค้ารหัส $sid ({$s['product_name']}) ถูกขายไปแล้ว");
        }

        $stamp   = str_or($body['sale_date'] ?? null) ?: nowStamp();
        $rawPrice = $body['price'] ?? null;
        $price   = ($rawPrice === null || $rawPrice === '')
            ? (float) $s['product_price']
            : num($rawPrice);
        $discount = num($body['discount'] ?? null);
        $payType  = str_or($body['pay_type'] ?? null, 'Cash') ?: 'Cash';
        $invoiceCode = str_or($body['invoice_code'] ?? null) ?: invoiceCode();

        $r = $q->run(
            'INSERT INTO sales (invoice_code, sale_date, product_stock_id, customer_id,
               employee_id, price, discount, pay_type, marketing, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?)',
            $invoiceCode, $stamp, $sid, int_or($body['customer_id'] ?? null),
            int_or($body['employee_id'] ?? null), $price, $discount, $payType,
            str_or($body['marketing'] ?? null, 'Walk-in') ?: 'Walk-in',
            nul($body['notes'] ?? null)
        );

        if (!pickLot($q, $sid, trim("ขายสินค้า $invoiceCode"))) {
            bad("สินค้ารหัส $sid ({$s['product_name']}) ถูกขายไปแล้ว");
        }

        $net = round2($price - $discount);
        if ($net > 0) {
            $q->run(
                'INSERT INTO payments (sale_id, kind, method, amount, received_by, paid_at, notes)
                 VALUES (?,?,?,?,?,?,?)',
                $r['insertId'], 'full', $payType, $net,
                int_or($body['employee_id'] ?? null), $stamp, 'ขายสินค้าทั่วไป'
            );
        }
        return $r['insertId'];
    });

    return Db::get('SELECT * FROM sales WHERE id = ?', $id);
});

DELETE('/api/sales/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $s  = Db::get('SELECT * FROM sales WHERE id = ?', $id);
    if (!$s) {
        missing();
    }
    Db::tx(function (Tx $q) use ($id, $s) {
        $sid = $s['product_stock_id'] ? (int) $s['product_stock_id'] : null;
        releaseLot($q, $sid, trim('ยกเลิกการขาย ' . ($s['invoice_code'] ?? '')));
        $q->run('DELETE FROM payments WHERE sale_id = ?', $id);
        $q->run('DELETE FROM sales WHERE id = ?', $id);
    });
    return ['ok' => true];
});
