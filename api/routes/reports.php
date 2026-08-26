<?php
/** Day-end totals, monthly cash flow, and the printable/stock listings. */
declare(strict_types=1);

GET('/api/reports/daily-closed', function (array $req) {
    $q    = $req['query'];
    $from = str_or($q['from'] ?? null) ?: today();
    $to   = str_or($q['to'] ?? null) ?: $from;

    $sel     = Sql::ORDER_SELECT;
    $orderFm = Sql::ORDER_FROM;

    $orders = Db::all(
        "SELECT $sel $orderFm
          WHERE o.order_closed = 1 AND DATE(o.order_close_date) BETWEEN ? AND ?
          ORDER BY o.order_close_date",
        $from, $to
    );
    $sales = Db::all(
        'SELECT s.*, st.product_name, e.employee_name
           FROM sales s
           LEFT JOIN v_stock_lot st ON st.id = s.product_stock_id
           LEFT JOIN employees e    ON e.id  = s.employee_id
          WHERE DATE(s.sale_date) BETWEEN ? AND ? ORDER BY s.sale_date',
        $from, $to
    );
    $deposits = Db::all(
        "SELECT $sel $orderFm
          WHERE DATE(o.order_date) BETWEEN ? AND ? AND o.deposit > 0
          ORDER BY o.order_date",
        $from, $to
    );
    $payments = Db::all(
        'SELECT p.*, o.invoice_code, e.employee_name AS received_by_name
           FROM payments p
           LEFT JOIN custom_orders o ON o.id = p.order_id
           LEFT JOIN employees e     ON e.id = p.received_by
          WHERE DATE(p.paid_at) BETWEEN ? AND ? ORDER BY p.paid_at',
        $from, $to
    );

    $exp = Db::get('SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE cf_date BETWEEN ? AND ?', $from, $to);
    $inc = Db::get('SELECT COALESCE(SUM(amount),0) v FROM incomes  WHERE cf_date BETWEEN ? AND ?', $from, $to);

    return [
        'from'     => $from,
        'to'       => $to,
        'orders'   => $orders,
        'sales'    => $sales,
        'deposits' => $deposits,
        'payments' => $payments,
        'summary'  => [
            'payment_total'     => round2(sumCol($payments, 'amount')),
            'payment_by_method' => (object) sumBy($payments, 'method', fn($p) => $p['amount']),
            'payment_by_kind'   => (object) sumBy($payments, 'kind', fn($p) => $p['amount']),
            'close_income'      => round2(sumCol($orders, 'order_close_income')),
            'close_by_pay'      => (object) sumBy(
                $orders,
                'order_close_pay_type',
                fn($o) => $o['order_close_income'] ?? 0
            ),
            'deposit_total'     => round2(sumCol($deposits, 'deposit')),
            'deposit_by_pay'    => (object) sumBy($deposits, 'deposit_pay_type', fn($o) => $o['deposit']),
            'sale_total'        => round2(array_sum(array_map(
                fn($s) => (float) $s['price'] - (float) $s['discount'],
                $sales
            ))),
            'sale_by_pay'       => (object) sumBy(
                $sales,
                'pay_type',
                fn($s) => (float) $s['price'] - (float) $s['discount']
            ),
            'expense'           => (float) $exp['v'],
            'other_income'      => (float) $inc['v'],
        ],
    ];
});

GET('/api/reports/income-by-month', function () {
    $rows = Db::all(
        "SELECT ym,
                SUM(payment_income) payment_income, SUM(sale_income) sale_income,
                SUM(other_income) other_income, SUM(expense) expense
           FROM (
             SELECT DATE_FORMAT(paid_at,'%Y-%m') ym, SUM(amount) payment_income,
                    0 sale_income, 0 other_income, 0 expense
               FROM payments GROUP BY ym
             UNION ALL
             SELECT DATE_FORMAT(sale_date,'%Y-%m'), 0, SUM(price - discount), 0, 0
               FROM sales GROUP BY 1
             UNION ALL
             SELECT DATE_FORMAT(cf_date,'%Y-%m'), 0, 0, SUM(amount), 0
               FROM incomes GROUP BY 1
             UNION ALL
             SELECT DATE_FORMAT(cf_date,'%Y-%m'), 0, 0, 0, SUM(amount)
               FROM expenses GROUP BY 1
           ) t WHERE ym IS NOT NULL
          GROUP BY ym ORDER BY ym DESC"
    );

    return array_map(function (array $r) {
        // sales already produce a payment row, so don't count them twice
        $total = (float) $r['payment_income'] + (float) $r['other_income'];
        return [
            'ym'             => $r['ym'],
            'payment_income' => (float) $r['payment_income'],
            'sale_income'    => (float) $r['sale_income'],
            'other_income'   => (float) $r['other_income'],
            'expense'        => (float) $r['expense'],
            'total_income'   => round2($total),
            'net'            => round2($total - (float) $r['expense']),
        ];
    }, $rows);
});

GET('/api/reports/checklist', fn(array $r) => Db::all(
    'SELECT p.name AS product_name, SUM(sl.remaining_qty) qty,
            MAX(p.base_selling_price) price, MIN(sl.received_date) oldest
       FROM stock_lots sl JOIN products p ON p.id = sl.product_id
      WHERE sl.remaining_qty > 0 AND p.product_type = ?
      GROUP BY p.name ORDER BY p.name',
    str_or($r['query']['type'] ?? null, 'Lens') ?: 'Lens'
));

GET('/api/reports/stock-labels', function (array $req) {
    $q     = $req['query'];
    $where = [];
    $args  = [];

    if ($type = str_or($q['type'] ?? null)) {
        $where[] = 's.product_type = ?';
        $args[]  = $type;
    }
    if ($term = str_or($q['q'] ?? null)) {
        $where[] = 's.product_name LIKE ?';
        $args[]  = like($term);
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $lots = Db::all(
        "SELECT s.id, s.product_name, s.product_type, s.product_price,
                s.remaining_qty, s.initial_qty, l.location
           FROM v_stock_lot s LEFT JOIN product_locations l ON l.product_name = s.product_name
           $sqlWhere
          ORDER BY s.product_name, s.id",
        ...$args
    );
    $rows = array_values(array_filter(expandLots($lots), fn($r) => !$r['sold']));
    return array_slice($rows, 0, 500);
});

GET('/api/reports/unsold-stock', function (array $r) {
    $lots = Db::all(
        'SELECT s.*, l.location, DATEDIFF(NOW(), s.stock_date) age_days
           FROM v_stock_lot s LEFT JOIN product_locations l ON l.product_name = s.product_name
          WHERE DATEDIFF(NOW(), s.stock_date) >= ?
          ORDER BY s.stock_date',
        int_or($r['query']['days'] ?? null, 180)
    );
    $rows = array_values(array_filter(expandLots($lots), fn($x) => !$x['sold']));
    return array_slice($rows, 0, 500);
});

/* the two print views reuse the detail endpoints verbatim */
GET('/api/reports/order/:id', fn(array $r) => orderDetail(int_or($r['params']['id'])));

GET('/api/reports/prescription/:id', fn(array $r) => Router::dispatch(
    'GET',
    '/api/prescriptions/' . $r['params']['id']
));

GET('/api/reports/workload', fn() => Db::all(
    'SELECT stage_group, status, status_label_th AS label_th,
            COUNT(*) n, SUM(is_rush) rush, MIN(status_order) sort_order
       FROM v_case_board WHERE is_terminal = 0
      GROUP BY stage_group, status, status_label_th
      ORDER BY sort_order'
));
