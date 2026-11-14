<?php
/** Shop staff. Normally deactivated, not deleted, so old records keep their name;
 *  DELETE only works for someone nothing references yet (e.g. added by mistake). */
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

/* ลบได้เฉพาะคนที่ยังไม่เคยถูกอ้างถึงที่ไหนเลย (เช่น เพิ่มผิด/พิมพ์ซ้ำ)
   foreign key ส่วนใหญ่ที่ชี้มาตารางนี้เป็น ON DELETE SET NULL — ถ้าปล่อยลบตรง ๆ
   ประวัติเก่าจะเหลือช่อง "ใครทำ" ว่างเงียบ ๆ ทุกใบ จึงนับการอ้างอิงจริงก่อน
   ถ้ามีแม้แต่รายการเดียวก็ปฏิเสธ และให้ใช้ "ปิดใช้งาน" แทน
   รายชื่อคอลัมน์อ่านจาก information_schema ทุกครั้ง ตารางใหม่ที่เพิ่ม FK ภายหลังก็ถูกนับด้วย */
DELETE('/api/employees/:id', function (array $req) {
    $id  = int_or($req['params']['id']);
    $emp = Db::get('SELECT id, employee_name FROM employees WHERE id = ?', $id);
    if (!$emp) {
        missing();
    }
    $refs = Db::all(
        "SELECT TABLE_NAME AS t, COLUMN_NAME AS c
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND REFERENCED_TABLE_NAME = 'employees'
            AND REFERENCED_COLUMN_NAME = 'id'"
    );
    $used = 0;
    foreach ($refs as $ref) {
        $t = str_replace('`', '', $ref['t']);
        $c = str_replace('`', '', $ref['c']);
        $row = Db::get("SELECT COUNT(*) AS n FROM `$t` WHERE `$c` = ?", $id);
        $used += (int) ($row['n'] ?? 0);
    }
    if ($used > 0) {
        bad("พนักงานคนนี้มีประวัติในระบบแล้ว {$used} รายการ จึงลบไม่ได้ — ใช้ \"ปิดใช้งาน\" แทน ประวัติเดิมจะยังอยู่ครบ");
    }
    Db::run('DELETE FROM employees WHERE id = ?', $id);
    return ['ok' => true];
});
