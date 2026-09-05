import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  money, power, fmtDate, fmtDateTime, custName, hhmm, todayISO, dominantEyeLabel,
  normAxis, normSphere, normCyl, normAdd, sphPower, cylPower, addPower,
} from '../format.js';

test('money: baht sign, Thai grouping, 2dp', () => {
  assert.equal(money(1234.5), '฿1,234.50');
  assert.equal(money(null), '฿0.00');
});

test('power: signed 2dp for numbers, dash for blank, passthrough for non-numeric', () => {
  assert.equal(power(''), '—');
  assert.equal(power(null), '—');
  assert.equal(power(-1.25), '-1.25');
  assert.equal(power(2), '+2.00');
  assert.equal(power('plano'), 'plano');
});

test('fmtDate: DD/MM/YYYY from a MySQL datetime string', () => {
  assert.equal(fmtDate('2026-08-25 14:30:00'), '25/08/2026');
});

test('fmtDateTime: adds HH:MM', () => {
  assert.equal(fmtDateTime('2026-08-25 14:05:00'), '25/08/2026 14:05');
});

test('custName: joins first+mid+last, falls back when all blank', () => {
  assert.equal(custName({ first_name: 'สม', last_name: 'ชาย' }), 'สม ชาย');
  assert.equal(custName({ first_name: 'สม', mid_name: 'ศรี', last_name: 'ชาย' }), 'สม ศรี ชาย');
  /* แถวที่ไม่มีคอลัมน์ mid_name เลย ต้องได้ชื่อเหมือนเดิม ไม่ใช่มีช่องว่างเกิน */
  assert.equal(custName({ first_name: 'สม', mid_name: null, last_name: 'ชาย' }), 'สม ชาย');
  assert.equal(custName({ first_name: 'สม', mid_name: '', last_name: 'ชาย' }), 'สม ชาย');
  assert.equal(custName({ mid_name: 'ศรี' }), 'ศรี');
  assert.equal(custName({}), '(ไม่มีชื่อ)');
});

test('dominantEyeLabel: ข้างที่ระบุเป็นตาหลัก อีกข้างเป็นตารอง', () => {
  assert.equal(dominantEyeLabel('r', 'r'), 'ตาหลัก');
  assert.equal(dominantEyeLabel('r', 'l'), 'ตารอง');
  assert.equal(dominantEyeLabel('l', 'l'), 'ตาหลัก');
  assert.equal(dominantEyeLabel('l', 'r'), 'ตารอง');
});

test('dominantEyeLabel: both = เด่นเท่ากัน ทั้งสองข้างเป็นตาหลัก ไม่มีตารอง', () => {
  assert.equal(dominantEyeLabel('both', 'r'), 'ตาหลัก');
  assert.equal(dominantEyeLabel('both', 'l'), 'ตาหลัก');
});

/* ยังไม่ได้ระบุ ต้องไม่ติดป้ายอะไรเลย — ป้ายผิดข้างบนใบสั่งตัดแพงกว่าป้ายที่หายไป
   และแถวเก่าทุกแถวในฐานข้อมูลเป็น null อยู่แล้ว */
test('dominantEyeLabel: ไม่ได้ระบุ / ค่าแปลกปลอม คืนค่าว่าง', () => {
  assert.equal(dominantEyeLabel('', 'r'), '');
  assert.equal(dominantEyeLabel(null, 'r'), '');
  assert.equal(dominantEyeLabel(undefined, 'l'), '');
  assert.equal(dominantEyeLabel('ขวา', 'r'), '');
});

test('dominantEyeLabel: รับค่าที่พิมพ์มาตัวใหญ่หรือมีช่องว่างติดมา', () => {
  assert.equal(dominantEyeLabel('R', 'r'), 'ตาหลัก');
  assert.equal(dominantEyeLabel(' Both ', 'l'), 'ตาหลัก');
});

test('normAxis: ตัดศูนย์นำหน้า ปล่อยช่องว่างไว้เป็นช่องว่าง', () => {
  assert.deepEqual(normAxis('090'), { value: '90', error: '' });
  assert.deepEqual(normAxis(' 5 '), { value: '5', error: '' });
  assert.deepEqual(normAxis('0'), { value: '0', error: '' });
  assert.deepEqual(normAxis('180'), { value: '180', error: '' });
  assert.deepEqual(normAxis(''), { value: '', error: '' });
  assert.deepEqual(normAxis(null), { value: '', error: '' });
});

/* เกินช่วงต้องคืนค่าที่พิมพ์มาเหมือนเดิม ห้ามหั่นเป็น 180 ให้เอง — 200 บอกไม่ได้ว่า
   คนวัดตั้งใจพิมพ์อะไร การเดาแทนคือทางที่ค่าผิดหลุดไปถึงห้องผลิตแบบเงียบ ๆ */
test('normAxis: เกิน 180 หรือไม่ใช่จำนวนเต็ม = ผิด และไม่แก้ค่าให้', () => {
  assert.equal(normAxis('200').error, 'AXIS ต้องอยู่ระหว่าง 0–180');
  assert.equal(normAxis('200').value, '200');
  assert.equal(normAxis('181').error, 'AXIS ต้องอยู่ระหว่าง 0–180');
  assert.equal(normAxis('90.5').error, 'AXIS ต้องเป็นจำนวนเต็ม 0–180');
  assert.equal(normAxis('abc').error, 'AXIS ต้องเป็นจำนวนเต็ม 0–180');
  assert.equal(normAxis('-90').error, 'AXIS ต้องเป็นจำนวนเต็ม 0–180');
});

test('normSphere: บวกก็ได้ ลบก็ได้ เติมศูนย์ครบสองหลัก', () => {
  assert.deepEqual(normSphere('-1.25'), { value: '-01.25', error: '' });
  assert.deepEqual(normSphere('2'), { value: '+02.00', error: '' });
  assert.deepEqual(normSphere('+2.5'), { value: '+02.50', error: '' });
  assert.deepEqual(normSphere('.75'), { value: '+00.75', error: '' });
  assert.deepEqual(normSphere('-12.25'), { value: '-12.25', error: '' });
  assert.deepEqual(normSphere(''), { value: '', error: '' });
});

/* เครื่องหมายเป็นแบบแผนของร้านที่ช่องกรอกรับผิดชอบเอง คนกรอกพิมพ์แต่ตัวเลข
   เหมือนกับที่ ADD เติม + ให้ */
test('normCyl: ค่าบวกถูกพลิกเป็นลบให้อัตโนมัติ', () => {
  assert.deepEqual(normCyl('-0.75'), { value: '-00.75', error: '' });
  assert.deepEqual(normCyl('0.75'), { value: '-00.75', error: '' });
  assert.deepEqual(normCyl('+1.25'), { value: '-01.25', error: '' });
  assert.deepEqual(normCyl('.5'), { value: '-00.50', error: '' });
  assert.deepEqual(normCyl(''), { value: '', error: '' });
});

test('normAdd: บวกเสมอ ลบถือเป็นพิมพ์พลาดจึงพลิกให้', () => {
  assert.deepEqual(normAdd('2'), { value: '+02.00', error: '' });
  assert.deepEqual(normAdd('2.5'), { value: '+02.50', error: '' });
  assert.deepEqual(normAdd('.75'), { value: '+00.75', error: '' });
  assert.deepEqual(normAdd('2.'), { value: '+02.00', error: '' });
  assert.equal(normAdd('-1.75').value, '+01.75');
  assert.deepEqual(normAdd(''), { value: '', error: '' });
});

/* ศูนย์ไม่ได้บวกหรือลบจริง จึงไม่ติดเครื่องหมาย — เป็นข้อยกเว้นเดียวของกฎความยาวข้างล่าง */
test('ศูนย์ไม่มีเครื่องหมาย ทั้งสามช่อง', () => {
  assert.equal(normSphere('0').value, '00.00');
  assert.equal(normCyl('0').value, '00.00');
  assert.equal(normAdd('0').value, '00.00');
  assert.equal(normSphere('-0').value, '00.00');
  assert.equal(normSphere('0.00').value, '00.00');
});

/* เหตุผลทั้งหมดของการเติมศูนย์: ค่าที่ไม่ใช่ศูนย์ต้องยาวเท่ากันเป๊ะทุกตัว
   ถ้ามีตัวไหนยาวไม่เท่าเพื่อน จุดทศนิยมในตารางจะเหลื่อม */
test('ค่าที่ไม่ใช่ศูนย์ยาว 6 ตัวอักษรเท่ากันหมด ทั้งสามช่อง', () => {
  for (const raw of ['.75', '2', '2.5', '9.99', '12.5', '99.75']) {
    assert.equal(normSphere(raw).value.length, 6, `SPH ยาวไม่เท่าเพื่อน: ${raw}`);
    assert.equal(normSphere(`-${raw}`).value.length, 6, `SPH ยาวไม่เท่าเพื่อน: -${raw}`);
    assert.equal(normCyl(`-${raw}`).value.length, 6, `CYL ยาวไม่เท่าเพื่อน: -${raw}`);
    assert.equal(normAdd(raw).value.length, 6, `ADD ยาวไม่เท่าเพื่อน: ${raw}`);
  }
});

test('จัดซ้ำแล้วได้ค่าเดิม ไม่งอกเครื่องหมายเพิ่มทุกรอบที่เปิดหน้า', () => {
  assert.equal(normSphere(normSphere('-1.25').value).value, '-01.25');
  assert.equal(normCyl(normCyl('-0.75').value).value, '-00.75');
  assert.equal(normAdd(normAdd('2.5').value).value, '+02.50');
  assert.equal(normSphere(normSphere('0').value).value, '00.00');
});

test('ไม่ใช่ตัวเลข หรือถึงสามหลัก = ผิด และไม่แก้ค่าให้', () => {
  assert.equal(normSphere('plano').error, 'SPH ต้องเป็นตัวเลข เช่น -01.25');
  assert.equal(normSphere('plano').value, 'plano');
  assert.equal(normCyl('abc').error, 'CYL ต้องเป็นตัวเลข เช่น -00.75');
  assert.equal(normAdd('plano').error, 'ADD ต้องเป็นตัวเลข เช่น +02.00');
  assert.equal(normSphere('-100').error, 'SPH ต้องน้อยกว่า 100.00');
  assert.equal(normAdd('123.5').value, '123.5');
  /* ปัดเศษแล้วเพิ่งล้น — ต้องจับได้ ไม่ใช่ปล่อยออกมาเป็น 100.00 ซึ่งยาวเกินรูปแบบ */
  assert.equal(normSphere('99.999').error, 'SPH ต้องน้อยกว่า 100.00');
});

/* ค่าที่แสดงบนใบพิมพ์ต้องหน้าตาเดียวกับที่กรอกในหน้าวัดสายตา — ใบเก่าที่เก็บเป็น
   '-1.25' ก็ต้องอ่านออกมาเหมือนใบใหม่ที่เก็บเป็น '-01.25' ค่าเดียวกันมีหน้าตาเดียว */
test('sphPower / cylPower / addPower: ใบเก่ากับใบใหม่แสดงผลเหมือนกัน', () => {
  assert.equal(sphPower('-1.25'), '-01.25');
  assert.equal(sphPower('-01.25'), '-01.25');
  assert.equal(cylPower('-0.75'), '-00.75');
  /* ใบเก่าที่บันทึก CYL เป็นบวกไว้ ถูกอ่านเป็นลบตามแบบแผนของร้าน เหมือนที่ช่องกรอกทำ */
  assert.equal(cylPower('0.75'), '-00.75');
  assert.equal(addPower('2.00'), '+02.00');
  assert.equal(addPower(2), '+02.00');
});

test('sphPower / cylPower / addPower: ว่างเป็นขีด ค่าที่จัดไม่ได้ยังอ่านออก', () => {
  assert.equal(sphPower(''), '—');
  assert.equal(addPower(null), '—');
  assert.equal(addPower('plano'), 'plano');
});

test('hhmm: truncates a HH:MM:SS time column', () => {
  assert.equal(hhmm('09:30:00'), '09:30');
  assert.equal(hhmm(null), '');
});

test('todayISO: offsets by days', () => {
  const iso = todayISO(0);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
});
