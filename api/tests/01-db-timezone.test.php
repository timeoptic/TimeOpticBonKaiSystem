<?php

declare(strict_types=1);

/**
 * ฐานข้อมูลเก็บเวลาไทย — คอนเนกชันต้องตั้ง time_zone เป็น +07:00 เอง
 *
 * เหตุการณ์จริง 12 ก.ย. 2026: MariaDB บน Hostinger ตั้งเวลาเป็น UTC · ระบบคลังตั้ง
 * +07:00 ในคอนเนกชันของตัวเองก็จริง แต่บนเว็บจริงมันยืมคอนเนกชันของหน้าร้าน
 * (`StockModule::boot` → `setConnFactory`) คำสั่งนั้นจึงไม่เคยได้ทำงาน · ทุกค่าที่
 * `NOW()` / `DEFAULT CURRENT_TIMESTAMP` เขียนลงไปช้า 7 ชั่วโมง (หน้าความเคลื่อนไหว
 * ขึ้น 06:07 ทั้งที่จริงคือ 13:07) ขณะที่ค่าที่ PHP เขียนเอง (Asia/Bangkok) ถูก —
 * ข้อมูลสองแบบปนกันอยู่ในตารางเดียวกัน
 *
 * เครื่องพัฒนาไม่เห็นปัญหานี้ เพราะ MySQL ของ XAMPP ใช้เวลาของ Windows ที่เป็นเวลา
 * ไทยอยู่แล้ว · เทสต์จึงถามค่าของ session ตรง ๆ ไม่ใช่ดูว่า NOW() "ดูเหมือน" เวลาไทย
 */

group('เวลาของฐานข้อมูล');

test('คอนเนกชันตั้ง time_zone เป็น +07:00 เอง — ไม่พึ่งเวลาของเครื่องที่รันฐานข้อมูล', function () {
    eq(Db::get('SELECT @@session.time_zone AS tz')['tz'], '+07:00', 'session time_zone');
});

test('NOW() ของฐานข้อมูลเป็นเวลาไทย ตรงกับนาฬิกา Asia/Bangkok ของ PHP', function () {
    eq((int) Db::get('SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS m')['m'], 420, 'NOW() ห่างจาก UTC (นาที)');

    $bangkok = new DateTimeZone('Asia/Bangkok');
    $db      = new DateTimeImmutable((string) Db::get('SELECT NOW() AS n')['n'], $bangkok);
    $php     = new DateTimeImmutable('now', $bangkok);
    $gap     = abs($php->getTimestamp() - $db->getTimestamp());
    ok($gap < 120, "NOW() ของฐานข้อมูลต้องตรงกับนาฬิกา PHP — ต่างกัน $gap วินาที");
});
