<?php
/** The landing screen: today's queue, orders needing attention, counters. */
declare(strict_types=1);

GET('/api/dashboard', function () {
    $d = today();

    try {
        $bookingsToday = Db::all(
            "SELECT b.*, e.employee_name AS assigned_name,
                    COALESCE(c.first_name, b.first_name) AS first_name,
                    COALESCE(c.last_name,  b.last_name)  AS last_name,
                    COALESCE(c.phone,      b.phone)      AS phone,
                    ca.case_code,
                    TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(b.booking_date, b.booking_time)) AS mins_away
               FROM bookings b
               LEFT JOIN customers c ON c.id = b.customer_id
               LEFT JOIN employees e ON e.id = b.assigned_to
               LEFT JOIN cases ca    ON ca.id = b.case_id
              WHERE b.booking_date = CURDATE() AND b.status <> 'cancelled'
              ORDER BY b.booking_time"
        );
    } catch (Throwable) {
        // the bookings table may not exist yet on a fresh database
        $bookingsToday = [];
    }

    $sel  = Sql::ORDER_SELECT;
    $from = Sql::ORDER_FROM;
    $unf  = Sql::UNFILLED;

    $unfilled = Db::all(
        "SELECT $sel $from WHERE o.order_closed = 0 AND $unf
          ORDER BY o.order_date DESC LIMIT 100"
    );
    $unclosed = Db::all(
        "SELECT $sel $from WHERE o.order_closed = 0 AND NOT $unf
          ORDER BY o.appointment_date IS NULL, o.appointment_date, o.order_date DESC
          LIMIT 200"
    );
    $board = Db::all(
        'SELECT stage_group, COUNT(*) n FROM v_case_board WHERE is_terminal = 0 GROUP BY stage_group'
    );
    $lens = Db::all('SELECT risk_level, COUNT(*) n FROM v_lens_tracker GROUP BY risk_level');

    $one = fn(string $sql, mixed ...$p) => Db::get($sql, ...$p) ?? [];
    $pairs = function (array $rows, string $k) {
        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r[$k]] = (int) $r['n'];
        }
        return (object) $out;
    };

    $pending = 0;
    foreach ($bookingsToday as $b) {
        if ($b['status'] === 'booked' || $b['status'] === 'confirmed') {
            $pending++;
        }
    }

    return [
        'unfilled'       => $unfilled,
        'unclosed'       => $unclosed,
        'bookings_today' => $bookingsToday,
        'board'          => $pairs($board, 'stage_group'),
        'lens_risk'      => $pairs($lens, 'risk_level'),
        'stats'          => [
            'customers'  => (int) ($one('SELECT COUNT(*) n FROM customers')['n'] ?? 0),
            'open_cases' => (int) ($one(
                'SELECT COUNT(*) n FROM cases c JOIN case_statuses s ON s.code = c.status
                  WHERE s.is_terminal = 0'
            )['n'] ?? 0),
            'rush_cases' => (int) ($one(
                'SELECT COUNT(*) n FROM cases c JOIN case_statuses s ON s.code = c.status
                  WHERE s.is_terminal = 0 AND c.is_rush = 1'
            )['n'] ?? 0),
            'open_orders' => (int) ($one(
                'SELECT COUNT(*) n FROM custom_orders WHERE order_closed = 0'
            )['n'] ?? 0),
            'stock_on_hand' => (int) ($one('SELECT COALESCE(SUM(remaining_qty),0) n FROM stock_lots')['n'] ?? 0),
            'lens_waiting'  => (int) ($one(
                "SELECT COUNT(*) n FROM lens_jobs WHERE status = 'waiting_arrival'"
            )['n'] ?? 0),
            'received_today' => $one(
                'SELECT COUNT(*) n, COALESCE(SUM(amount),0) amount FROM payments WHERE DATE(paid_at) = ?',
                $d
            ),
            'sales_today' => $one(
                'SELECT COUNT(*) n, COALESCE(SUM(price - discount),0) amount FROM sales WHERE DATE(sale_date) = ?',
                $d
            ),
            'expense_today' => $one(
                'SELECT COALESCE(SUM(amount),0) amount FROM expenses WHERE cf_date = ?',
                $d
            ),
            'appointments_today' => (int) ($one(
                'SELECT COUNT(*) n FROM custom_orders WHERE order_closed = 0 AND appointment_date = ?',
                $d
            )['n'] ?? 0),
            'bookings_today'   => count($bookingsToday),
            'bookings_pending' => $pending,
        ],
    ];
});
