<?php
/** Customer records, plus the roll-up shown on one customer's page. */
declare(strict_types=1);

GET('/api/customers', function (array $req) {
    $q     = $req['query'];
    $term  = str_or($q['q'] ?? null);
    $limit = min(int_or($q['limit'] ?? null, 200), 1000);

    if ($term === '') {
        return Db::all('SELECT * FROM customers ORDER BY id DESC LIMIT ?', $limit);
    }
    $p = like($term);
    return Db::all(
        'SELECT * FROM customers
          WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?
             OR email LIKE ? OR line_id LIKE ? OR notes LIKE ? OR CAST(id AS CHAR) = ?
          ORDER BY id DESC LIMIT ?',
        $p, $p, $p, $p, $p, $p, $term, $limit
    );
});

GET('/api/customers/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $c  = Db::get('SELECT * FROM customers WHERE id = ?', $id);
    if (!$c) {
        missing();
    }
    $sel  = Sql::ORDER_SELECT;
    $from = Sql::ORDER_FROM;

    $c['prescriptions'] = Db::all(
        'SELECT p.*, e.employee_name FROM prescriptions p
           LEFT JOIN employees e ON e.id = p.performed_by
          WHERE p.customer_id = ? ORDER BY p.test_date DESC, p.id DESC',
        $id
    );
    $c['orders'] = Db::all(
        "SELECT $sel $from WHERE o.customer_id = ? ORDER BY o.order_date DESC",
        $id
    );
    $c['cases'] = Db::all(
        'SELECT * FROM v_case_board WHERE customer_id = ? ORDER BY opened_at DESC',
        $id
    );
    return $c;
});

/** the writable columns, in insert order */
function customerCols(array $b): array
{
    return [
        str_or($b['first_name'] ?? null),
        nul($b['mid_name'] ?? null),
        nul($b['last_name'] ?? null),
        nul($b['sex'] ?? null),
        nul($b['nationality'] ?? null),
        nul($b['email'] ?? null),
        nul($b['phone'] ?? null),
        nul($b['line_id'] ?? null),
        nul($b['birth_date'] ?? null),
        nul($b['notes'] ?? null),
    ];
}

POST('/api/customers', function (array $req) {
    $body = $req['body'];
    if (str_or($body['first_name'] ?? null) === '' && str_or($body['last_name'] ?? null) === '') {
        bad('กรุณากรอกชื่อลูกค้า');
    }
    $r = Db::run(
        'INSERT INTO customers (first_name, mid_name, last_name, sex, nationality,
           email, phone, line_id, birth_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?)',
        ...customerCols($body)
    );
    return Db::get('SELECT * FROM customers WHERE id = ?', $r['insertId']);
});

PUT('/api/customers/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    if (!Db::get('SELECT id FROM customers WHERE id = ?', $id)) {
        missing();
    }
    Db::run(
        'UPDATE customers SET first_name=?, mid_name=?, last_name=?, sex=?, nationality=?,
           email=?, phone=?, line_id=?, birth_date=?, notes=? WHERE id=?',
        ...[...customerCols($req['body']), $id]
    );
    return Db::get('SELECT * FROM customers WHERE id = ?', $id);
});

DELETE('/api/customers/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $n  = (int) (Db::get('SELECT COUNT(*) n FROM custom_orders WHERE customer_id = ?', $id)['n'] ?? 0);
    if ($n) {
        bad("ลบไม่ได้ — ลูกค้ารายนี้มีออเดอร์ $n รายการ");
    }
    $k = (int) (Db::get('SELECT COUNT(*) n FROM cases WHERE customer_id = ?', $id)['n'] ?? 0);
    if ($k) {
        bad("ลบไม่ได้ — ลูกค้ารายนี้มีเคส $k รายการ");
    }
    Db::run('DELETE FROM customers WHERE id = ?', $id);
    return ['ok' => true];
});
