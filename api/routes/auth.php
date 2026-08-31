<?php
/**
 * เข้าสู่ระบบ.
 *
 * ไม่ได้เขียนขึ้นใหม่ที่นี่ — ใช้ของฝั่งคลังทั้งดุ้น (`Optic\Auth`) ซึ่งอ่าน
 * ตาราง `admins` เดิม เก็บ session ในคุกกี้ `optic_session` และรู้จักสามบทบาท
 * (`owner` `accountant` `staff`) อยู่แล้ว สองระบบจึงล็อกอินครั้งเดียวใช้ได้ทั้งคู่
 *
 * เหตุผลที่ไม่ทำ login ของตัวเอง: บัญชีสองชุดบนฐานข้อมูลเดียวแปลว่ามีสองที่ให้
 * ปิดสิทธิ์คนที่ลาออก แล้ววันหนึ่งจะปิดไม่ครบ
 */
declare(strict_types=1);

POST('/api/auth/login', function (array $req) {
    StockModule::boot();
    return \Optic\Auth::login(
        (string) ($req['body']['username'] ?? ''),
        (string) ($req['body']['password'] ?? '')
    );
});

POST('/api/auth/logout', function () {
    StockModule::boot();
    \Optic\Auth::logout();
    return ['ok' => true];
});

/* null = ยังไม่ได้ล็อกอิน ไม่ใช่ข้อผิดพลาด — หน้าเว็บใช้ตัวนี้ตัดสินใจว่าจะพาไปหน้า
   ล็อกอินไหม จึงต้องเรียกได้โดยไม่ต้องล็อกอินก่อน */
GET('/api/auth/me', function () {
    return StockModule::actor();
});

/* ตารางสิทธิ์ — หน้าเว็บเอาไปโชว์ว่าบทบาทไหนทำอะไรได้ */
GET('/api/auth/policy', function () {
    StockModule::boot();
    return \Optic\Roles::policy();
});
