<?php

declare(strict_types=1);

/**
 * ลบพนักงาน — FK เกือบทุกตัวที่ชี้มา employees เป็น ON DELETE SET NULL
 * ถ้าปล่อยลบตรง ๆ ประวัติเก่าจะเหลือช่อง "ใครทำ" ว่างเงียบ ๆ
 * DELETE จึงต้องลบได้เฉพาะคนที่ยังไม่มีใครอ้างถึง
 */

group('ลบพนักงาน');

test('คนที่ยังไม่มีประวัติ ลบได้', function () {
    rollback(function () {
        $id = Db::run("INSERT INTO employees (employee_name, active) VALUES ('__test_del', 1)")['insertId'];
        eq(Router::dispatch('DELETE', "/api/employees/$id"), ['ok' => true], 'ผลลบ');
        eq(Db::get('SELECT id FROM employees WHERE id = ?', $id), null, 'แถวที่เหลือ');
    });
});

test('คนที่มีประวัติแล้ว ลบไม่ได้ และแถวอ้างอิงไม่ถูกล้าง', function () {
    rollback(function () {
        $id  = Db::run("INSERT INTO employees (employee_name, active) VALUES ('__test_used', 1)")['insertId'];
        /* ผูกเป็นผู้สร้างคิวหนึ่งใบ — FK ตัวนี้เป็น SET NULL ถ้าลบหลุดไปช่องจะว่างเงียบ ๆ */
        $bk = Db::run(
            "INSERT INTO bookings (booking_code, booking_date, booking_time, created_by) VALUES ('__T-DEL', CURDATE(), '10:00', ?)",
            $id
        )['insertId'];
        $threw = false;
        try {
            Router::dispatch('DELETE', "/api/employees/$id");
        } catch (HttpError $e) {
            $threw = $e->status === 400;
        }
        ok($threw, 'ต้องตอบ 400');
        ok(Db::get('SELECT id FROM employees WHERE id = ?', $id) !== null, 'พนักงานยังอยู่');
        eq((int) Db::get('SELECT created_by FROM bookings WHERE id = ?', $bk)['created_by'], (int) $id, 'ผู้สร้างคิวไม่ถูกล้าง');
    });
});
