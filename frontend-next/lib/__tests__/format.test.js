import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  money, power, fmtDate, fmtDateTime, custName, hhmm, todayISO, dominantEyeLabel,
  normAxis, normSphere, normCyl, normAdd, normVa, rxPairMissing,
  sphPower, cylPower, addPower, glassesUseOf, roundGlassesUse,
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

test('normSphere: บวกก็ได้ ลบก็ได้ ทศนิยมสองตำแหน่งไม่เติมศูนย์หน้า', () => {
  assert.deepEqual(normSphere('-1.25'), { value: '-1.25', error: '' });
  assert.deepEqual(normSphere('2'), { value: '+2.00', error: '' });
  assert.deepEqual(normSphere('+2.5'), { value: '+2.50', error: '' });
  assert.deepEqual(normSphere('.75'), { value: '+0.75', error: '' });
  assert.deepEqual(normSphere('-12.25'), { value: '-12.25', error: '' });
  assert.deepEqual(normSphere(''), { value: '', error: '' });
});

/* เครื่องหมายเป็นแบบแผนของร้านที่ช่องกรอกรับผิดชอบเอง คนกรอกพิมพ์แต่ตัวเลข
   เหมือนกับที่ ADD เติม + ให้ */
test('normCyl: ค่าบวกถูกพลิกเป็นลบให้อัตโนมัติ', () => {
  assert.deepEqual(normCyl('-0.75'), { value: '-0.75', error: '' });
  assert.deepEqual(normCyl('0.75'), { value: '-0.75', error: '' });
  assert.deepEqual(normCyl('+1.25'), { value: '-1.25', error: '' });
  assert.deepEqual(normCyl('.5'), { value: '-0.50', error: '' });
  assert.deepEqual(normCyl(''), { value: '', error: '' });
});

test('normAdd: บวกเสมอ ลบถือเป็นพิมพ์พลาดจึงพลิกให้', () => {
  assert.deepEqual(normAdd('2'), { value: '+2.00', error: '' });
  assert.deepEqual(normAdd('2.5'), { value: '+2.50', error: '' });
  assert.deepEqual(normAdd('.75'), { value: '+0.75', error: '' });
  assert.deepEqual(normAdd('2.'), { value: '+2.00', error: '' });
  assert.equal(normAdd('-1.75').value, '+1.75');
  assert.deepEqual(normAdd(''), { value: '', error: '' });
});

/* ศูนย์ไม่ได้บวกหรือลบจริง จึงไม่ติดเครื่องหมาย */
test('ศูนย์ไม่มีเครื่องหมาย ทั้งสามช่อง', () => {
  assert.equal(normSphere('0').value, '0.00');
  assert.equal(normCyl('0').value, '0.00');
  assert.equal(normAdd('0').value, '0.00');
  assert.equal(normSphere('-0').value, '0.00');
  assert.equal(normSphere('0.00').value, '0.00');
});

/* รูปแบบเดียวของทั้งระบบหลังเลิกเติมศูนย์หน้า: ทศนิยมสองตำแหน่งเสมอ (ค่าเดียวกัน
   พิมพ์มาแบบไหนก็อ่านออกมาเหมือนกัน) แต่หลักหน้าจุดไม่มีศูนย์นำ — 4 คือ +4.00
   ไม่ใช่ +04.00 ยกเว้นค่าที่น้อยกว่าหนึ่ง ซึ่งศูนย์ตัวนั้นเป็นหลักจริงของมันเอง */
test('ทศนิยมสองตำแหน่งเสมอ และไม่มีศูนย์นำหน้า ทั้งสามช่อง', () => {
  const SHAPE = /^[+-]?(0|[1-9]\d?)\.\d{2}$/;
  for (const raw of ['.75', '2', '2.5', '9.99', '12.5', '99.75', '0']) {
    for (const [label, value] of [
      ['SPH', normSphere(raw).value],
      ['SPH', normSphere(`-${raw}`).value],
      ['CYL', normCyl(`-${raw}`).value],
      ['ADD', normAdd(raw).value],
    ]) {
      assert.match(value, SHAPE, `${label} ผิดรูปแบบ: ${raw} -> ${value}`);
    }
  }
});

test('จัดซ้ำแล้วได้ค่าเดิม ไม่งอกเครื่องหมายเพิ่มทุกรอบที่เปิดหน้า', () => {
  assert.equal(normSphere(normSphere('-1.25').value).value, '-1.25');
  assert.equal(normCyl(normCyl('-0.75').value).value, '-0.75');
  assert.equal(normAdd(normAdd('2.5').value).value, '+2.50');
  assert.equal(normSphere(normSphere('0').value).value, '0.00');
});

/* ใบที่บันทึกไว้สมัยเติมศูนย์หน้ายังอยู่ในฐานอีกหลายพันใบ เปิดขึ้นมาต้องอ่านออก
   และถูกจัดเป็นรูปแบบใหม่ให้ ไม่ใช่ติดขอบแดงว่าผิดรูปแบบ */
test('ค่าเก่าที่เติมศูนย์ไว้ ถูกจัดเป็นรูปแบบใหม่ให้', () => {
  assert.deepEqual(normSphere('-01.25'), { value: '-1.25', error: '' });
  assert.deepEqual(normCyl('-00.75'), { value: '-0.75', error: '' });
  assert.deepEqual(normAdd('+02.00'), { value: '+2.00', error: '' });
  assert.deepEqual(normSphere('00.00'), { value: '0.00', error: '' });
});

test('ไม่ใช่ตัวเลข หรือถึงสามหลัก = ผิด และไม่แก้ค่าให้', () => {
  assert.equal(normSphere('plano').error, 'SPH ต้องเป็นตัวเลข เช่น -1.25');
  assert.equal(normSphere('plano').value, 'plano');
  assert.equal(normCyl('abc').error, 'CYL ต้องเป็นตัวเลข เช่น -0.75');
  assert.equal(normAdd('plano').error, 'ADD ต้องเป็นตัวเลข เช่น +2.00');
  assert.equal(normSphere('-100').error, 'SPH ต้องน้อยกว่า 100.00');
  assert.equal(normAdd('123.5').value, '123.5');
  /* ปัดเศษแล้วเพิ่งล้น — ต้องจับได้ ไม่ใช่ปล่อยออกมาเป็น 100.00 ซึ่งเกินเพดาน */
  assert.equal(normSphere('99.999').error, 'SPH ต้องน้อยกว่า 100.00');
});

/* ค่าที่แสดงบนใบพิมพ์ต้องหน้าตาเดียวกับที่กรอกในหน้าวัดสายตา — ใบเก่าที่เก็บเป็น
   '-1.25' หรือ '-01.25' ก็ต้องอ่านออกมาเหมือนกัน ค่าเดียวกันมีหน้าตาเดียว */
test('sphPower / cylPower / addPower: ใบเก่ากับใบใหม่แสดงผลเหมือนกัน', () => {
  assert.equal(sphPower('-1.25'), '-1.25');
  assert.equal(sphPower('-01.25'), '-1.25');
  assert.equal(cylPower('-0.75'), '-0.75');
  assert.equal(cylPower('-00.75'), '-0.75');
  /* ใบเก่าที่บันทึก CYL เป็นบวกไว้ ถูกอ่านเป็นลบตามแบบแผนของร้าน เหมือนที่ช่องกรอกทำ */
  assert.equal(cylPower('0.75'), '-0.75');
  assert.equal(addPower('2.00'), '+2.00');
  assert.equal(addPower(2), '+2.00');
  assert.equal(addPower('+02.00'), '+2.00');
});

test('sphPower / cylPower / addPower: ว่างเป็นขีด ค่าที่จัดไม่ได้ยังอ่านออก', () => {
  assert.equal(sphPower(''), '—');
  assert.equal(addPower(null), '—');
  assert.equal(addPower('plano'), 'plano');
});

/* VA เป็นค่า "เห็นได้เท่าไหร่" ไม่ใช่กำลังเลนส์ — 1.0 คือเห็นเต็ม ต่ำกว่านั้นลงมาถึง 0.0
   ค่าอย่าง 12 หรือ 1212 ที่เคยพิมพ์หลุดเข้าไปได้ ไม่ได้แปลว่าอะไรเลยในหน่วยนี้ */
test('normVa: 0.0–1.0 ทศนิยมหนึ่งตำแหน่ง เติมให้ครบรูปแบบเดียว', () => {
  assert.deepEqual(normVa('1'), { value: '1.0', error: '' });
  assert.deepEqual(normVa('.8'), { value: '0.8', error: '' });
  assert.deepEqual(normVa('0.60'), { value: '0.6', error: '' });
  assert.deepEqual(normVa(' 0.5 '), { value: '0.5', error: '' });
  assert.deepEqual(normVa('0'), { value: '0.0', error: '' });
  assert.deepEqual(normVa('1.0'), { value: '1.0', error: '' });
  assert.deepEqual(normVa(''), { value: '', error: '' });
  assert.deepEqual(normVa(null), { value: '', error: '' });
});

/* เกินช่วงหรือละเอียดเกินไป ต้องคืนค่าที่พิมพ์มาเหมือนเดิม ห้ามปัดให้ — เหมือน AXIS
   0.75 ปัดเป็น 0.8 ให้เอง คือค่าที่ไม่มีใครวัดได้จริงโผล่ในใบตรวจโดยไม่มีใครรู้ */
test('normVa: นอกช่วง 0.0–1.0 หรือทศนิยมเกินหนึ่งตำแหน่ง = ผิด และไม่แก้ค่าให้', () => {
  assert.equal(normVa('12').error, 'VA ต้องอยู่ระหว่าง 0.0–1.0');
  assert.equal(normVa('12').value, '12');
  assert.equal(normVa('1212').error, 'VA ต้องอยู่ระหว่าง 0.0–1.0');
  assert.equal(normVa('1.2').error, 'VA ต้องอยู่ระหว่าง 0.0–1.0');
  assert.equal(normVa('0.75').error, 'VA ละเอียดได้ถึงทศนิยม 1 ตำแหน่ง เช่น 0.8');
  assert.equal(normVa('0.75').value, '0.75');
  assert.equal(normVa('0.05').error, 'VA ละเอียดได้ถึงทศนิยม 1 ตำแหน่ง เช่น 0.8');
  assert.equal(normVa('-0.5').error, 'VA ต้องเป็นตัวเลข 0.0–1.0 เช่น 0.8');
  assert.equal(normVa('abc').error, 'VA ต้องเป็นตัวเลข 0.0–1.0 เช่น 0.8');
  assert.equal(normVa('6/6').error, 'VA ต้องเป็นตัวเลข 0.0–1.0 เช่น 0.8');
});

test('normVa: จัดซ้ำแล้วได้ค่าเดิม ไม่งอกทศนิยมเพิ่มทุกรอบที่เปิดหน้า', () => {
  for (const raw of ['0', '.3', '0.7', '1']) {
    const once = normVa(raw).value;
    assert.equal(normVa(once).value, once, `จัดซ้ำแล้วเปลี่ยน: ${raw}`);
  }
});

/* ค่าเอียงที่ไม่มีองศา สั่งตัดไม่ได้ และองศาที่ไม่มีค่าเอียงก็ไม่ได้บอกอะไร — สองช่องนี้
   ไม่บังคับกรอก แต่ถ้ากรอกต้องมาด้วยกัน */
test('rxPairMissing: CYL กับ AXIS ต้องมาด้วยกัน', () => {
  assert.deepEqual(rxPairMissing({ cylinder: '-0.75', axis: '' }), {
    field: 'axis', error: 'กรอก CYL แล้วต้องกรอก AXIS ด้วย',
  });
  assert.deepEqual(rxPairMissing({ cylinder: '', axis: '90' }), {
    field: 'cylinder', error: 'กรอก AXIS แล้วต้องกรอก CYL ด้วย',
  });
});

test('rxPairMissing: ครบทั้งคู่ หรือว่างทั้งคู่ = ผ่าน', () => {
  assert.equal(rxPairMissing({ cylinder: '-0.75', axis: '90' }), null);
  assert.equal(rxPairMissing({ cylinder: '', axis: '' }), null);
  assert.equal(rxPairMissing({}), null);
  assert.equal(rxPairMissing(null), null);
  assert.equal(rxPairMissing({ cylinder: '  ', axis: '  ' }), null);
});

/* ศูนย์เป็นค่าจริงทั้งสองช่อง — AXIS 0 องศา และ CYL 0.00 ต้องไม่ถูกอ่านว่า "ว่าง"
   ไม่งั้นแถวที่กรอกครบแล้วจะโดนเตือนว่ายังไม่ได้กรอก */
test('rxPairMissing: ศูนย์คือค่าที่กรอกแล้ว ไม่ใช่ช่องว่าง', () => {
  assert.equal(rxPairMissing({ cylinder: '0.00', axis: '0' }), null);
  assert.equal(rxPairMissing({ cylinder: '0.00', axis: '' }).field, 'axis');
  assert.equal(rxPairMissing({ cylinder: '', axis: '0' }).field, 'cylinder');
});

/* แบบของแว่นอยู่คนละคอลัมน์ตามชนิดใบ: ใบแว่นเดิมเก็บใน old_glasses_type ส่วนใบที่วัด/ใช้จริง
   เก็บใน test_for — รายการเดียวกัน ถามคำถามเดียวกันคนละเวลา */
test('glassesUseOf: ใบแว่นเดิมอ่าน old_glasses_type ใบอื่นอ่าน test_for', () => {
  assert.equal(glassesUseOf({ kind: 'old', old_glasses_type: 'Reading', test_for: 'Distance' }), 'Reading');
  assert.equal(glassesUseOf({ kind: 'final', old_glasses_type: 'Reading', test_for: 'Progressive' }), 'Progressive');
  assert.equal(glassesUseOf({ kind: 'measured', test_for: ' Computer ' }), 'Computer');
});

test('glassesUseOf: ไม่ได้ระบุ / ไม่มีใบ คืนค่าว่าง', () => {
  assert.equal(glassesUseOf({ kind: 'final', test_for: null }), '');
  assert.equal(glassesUseOf({ kind: 'old', old_glasses_type: '' }), '');
  assert.equal(glassesUseOf(null), '');
});

/* รอบเก่าที่ถูกดึงมาเป็นแว่นเดิม — แว่นที่ลูกค้าใส่มาวันนี้คือคู่ที่ "สั่งตัด" ในรอบนั้น
   จึงเป็น test_for ของใบ final ไม่ใช่แบบแว่นเดิมของรอบนั้น ซึ่งเป็นคู่ที่เก่ากว่าอีก */
test('roundGlassesUse: ใช้ test_for ของ final ก่อน แล้วค่อย measured ไม่อ่านแว่นเดิมของรอบนั้น', () => {
  assert.equal(roundGlassesUse({
    old: { kind: 'old', old_glasses_type: 'Distance' },
    measured: { kind: 'measured', test_for: 'Reading' },
    final: { kind: 'final', test_for: 'Progressive' },
  }), 'Progressive');
  assert.equal(roundGlassesUse({ measured: { kind: 'measured', test_for: 'Reading' }, final: null }), 'Reading');
  assert.equal(roundGlassesUse({ old: { kind: 'old', old_glasses_type: 'Distance' }, measured: null, final: null }), '');
  assert.equal(roundGlassesUse(null), '');
});

test('hhmm: truncates a HH:MM:SS time column', () => {
  assert.equal(hhmm('09:30:00'), '09:30');
  assert.equal(hhmm(null), '');
});

test('todayISO: offsets by days', () => {
  const iso = todayISO(0);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
});
