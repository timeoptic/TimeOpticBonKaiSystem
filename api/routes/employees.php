<?php
/** Shop staff. Never deleted — deactivated, so old records keep their name. */
declare(strict_types=1);

GET('/api/employees', fn() => Db::all('SELECT * FROM employees ORDER BY active DESC, employee_name'));

POST('/api/employees', function (array $req) {
    $body = $req['body'];
    if (str_or($body['employee_name'] ?? null) === '') {
        bad('กรุณากรอกชื่อเล่นพนักงาน');
    }
    $r = Db::run(
        'INSERT INTO employees (employee_name, first_name, last_name, sex, birth_date, roles, active)
         VALUES (?,?,?,?,?,?,1)',
        str_or($body['employee_name']),
        nul($body['first_name'] ?? null),
        nul($body['last_name'] ?? null),
        nul($body['sex'] ?? null),
        nul($body['birth_date'] ?? null),
        nul($body['roles'] ?? null)
    );
    return Db::get('SELECT * FROM employees WHERE id = ?', $r['insertId']);
});

PUT('/api/employees/:id', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    if (!Db::get('SELECT id FROM employees WHERE id = ?', $id)) {
        missing();
    }
    Db::run(
        'UPDATE employees SET employee_name=?, first_name=?, last_name=?, sex=?,
           birth_date=?, roles=?, active=? WHERE id=?',
        str_or($body['employee_name'] ?? null),
        nul($body['first_name'] ?? null),
        nul($body['last_name'] ?? null),
        nul($body['sex'] ?? null),
        nul($body['birth_date'] ?? null),
        nul($body['roles'] ?? null),
        boolInt($body['active'] ?? null),
        $id
    );
    return Db::get('SELECT * FROM employees WHERE id = ?', $id);
});
