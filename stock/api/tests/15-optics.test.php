<?php

declare(strict_types=1);

use Optic\Optics;

group('ค่าสายตา — ช่วงและขั้นของ SPH CYL AXIS ADD');

test('ค่าที่อยู่บนบันไดผ่าน และถูกเขียนกลับมาแบบเดียวกันเสมอ', function () {
    eq(Optics::power('-2.25', 'sph', 'SPH'), '-2.25', 'ค่าลบสองตำแหน่ง');
    eq(Optics::power('2', 'sph', 'SPH'), '+2.00', 'เลขเปล่าได้เครื่องหมายและทศนิยมกลับมา');
    eq(Optics::power('+2.5', 'sph', 'SPH'), '+2.50', 'ทศนิยมตำแหน่งเดียวเติมให้ครบสอง');
    eq(Optics::power('0', 'sph', 'SPH'), '0.00', 'ศูนย์ไม่ติดเครื่องหมาย');
    eq(Optics::power('−1.75', 'cyl', 'CYL'), '-1.75', 'ขีดลบจากคีย์บอร์ด iPad อ่านเป็นลบ');
});

test('ปลายทั้งสองข้างของช่วงนับรวม', function () {
    eq(Optics::power('-12.00', 'sph', 'SPH'), '-12.00', 'SPH ต่ำสุด');
    eq(Optics::power('12.00', 'sph', 'SPH'), '+12.00', 'SPH สูงสุด');
    eq(Optics::power('-12.00', 'cyl', 'CYL'), '-12.00', 'CYL ต่ำสุด');
    eq(Optics::power('0.00', 'cyl', 'CYL'), '0.00', 'CYL สูงสุด — ไม่มีสายตาเอียง');
    eq(Optics::power('0.25', 'add', 'ADD'), '+0.25', 'ADD ต่ำสุด');
    eq(Optics::power('3.50', 'add', 'ADD'), '+3.50', 'ADD สูงสุด');
    // สองค่าที่ร้านขอเพิ่มเข้ามาทีหลัง เขียนไว้เป็นเคสของตัวเองกันหายตอนแก้ช่วง
    eq(Optics::power('0.50', 'add', 'ADD'), '+0.50', 'ADD +0.50');
    eq(Optics::power('-7.25', 'cyl', 'CYL'), '-7.25', 'CYL ที่ลึกกว่าเพดานเดิม -6.00');
});

test('ค่านอกช่วงถูกปฏิเสธ', function () {
    throwsReason('out_of_range', fn() => Optics::power('-12.25', 'sph', 'SPH'), 'SPH ต่ำกว่าช่วง');
    throwsReason('out_of_range', fn() => Optics::power('12.25', 'sph', 'SPH'), 'SPH เกินช่วง');
    throwsReason('out_of_range', fn() => Optics::power('0.25', 'cyl', 'CYL'), 'CYL เป็นบวก');
    throwsReason('out_of_range', fn() => Optics::power('-12.25', 'cyl', 'CYL'), 'CYL ต่ำกว่าช่วง');
    throwsReason('out_of_range', fn() => Optics::power('0.00', 'add', 'ADD'), 'ADD ต่ำกว่าช่วง');
    throwsReason('out_of_range', fn() => Optics::power('3.75', 'add', 'ADD'), 'ADD เกินช่วง');
});

test('ค่าที่ไม่ลงขั้นละ 0.25 ถูกปฏิเสธ ทั้งที่ยังอยู่ในช่วง', function () {
    // นี่คือเหตุผลที่ต้องนับเป็นขั้น ไม่ใช่ดูแค่ปลายช่วง — -2.30 อยู่ในช่วงทุกประการ
    // แต่ไม่มีเลนส์ค่านี้ให้ฝน
    throwsReason('out_of_range', fn() => Optics::power('-2.30', 'sph', 'SPH'), 'SPH ระหว่างขั้น');
    throwsReason('out_of_range', fn() => Optics::power('-2.10', 'cyl', 'CYL'), 'CYL ระหว่างขั้น');
    throwsReason('out_of_range', fn() => Optics::power('2.20', 'add', 'ADD'), 'ADD ระหว่างขั้น');
});

test('ค่าที่ลงขั้นพอดีทั้งบันไดผ่านหมด ไม่มีตัวไหนตกเพราะทศนิยมฐานสอง', function () {
    // 0.25 ไม่มีรูปฐานสองที่ลงตัว การเทียบด้วย fmod จึงพลาดเป็นบางค่า
    // ไล่ทั้งบันไดเพื่อกันไม่ให้พลาดค่าใดค่าหนึ่งเงียบ ๆ
    for ($i = -48; $i <= 48; $i++) {
        $n = $i * 0.25;
        eq(Optics::power(number_format($n, 2, '.', ''), 'sph', 'SPH'), Optics::write($n), "SPH ขั้นที่ {$i}");
    }
});

test('ช่องว่างคือ "ยังไม่ได้บันทึก" ไม่ใช่ค่าผิด', function () {
    eq(Optics::power(null, 'sph', 'SPH'), null, 'null');
    eq(Optics::power('', 'sph', 'SPH'), null, 'สตริงว่าง');
    eq(Optics::axis(null), null, 'AXIS null');
    eq(Optics::axis(''), null, 'AXIS สตริงว่าง');
});

test('ค่าที่ไม่ใช่ตัวเลขถูกปฏิเสธก่อนถึงเรื่องช่วง', function () {
    throwsReason('bad_rx', fn() => Optics::power('abc', 'sph', 'SPH'), 'ตัวอักษร');
    throwsReason('bad_rx', fn() => Optics::power('-2.255', 'sph', 'SPH'), 'ทศนิยมสามตำแหน่ง');
    throwsReason('bad_rx', fn() => Optics::power('- 2.25', 'sph', 'SPH'), 'มีช่องว่างคั่น');
});

test('AXIS เป็นจำนวนเต็ม 0–180 เท่านั้น', function () {
    eq(Optics::axis('0'), 0, 'ต่ำสุด');
    eq(Optics::axis('180'), 180, 'สูงสุด');
    eq(Optics::axis('007'), 7, 'เลขศูนย์นำอ่านเป็นองศาเดียวกัน');
    throwsReason('bad_axis', fn() => Optics::axis('181'), 'เกิน 180');
    throwsReason('bad_axis', fn() => Optics::axis('90.5'), 'มีทศนิยม');
    throwsReason('bad_axis', fn() => Optics::axis('-10'), 'ติดลบ');
});
