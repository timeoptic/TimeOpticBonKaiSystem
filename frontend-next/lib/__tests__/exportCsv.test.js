import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../exportCsv.js';

test('csvCell ปล่อยค่าธรรมดาไว้อย่างนั้น', () => {
  assert.equal(csvCell('เงินสด'), 'เงินสด');
  assert.equal(csvCell(1234.5), '1234.5');
  assert.equal(csvCell(0), '0', 'ศูนย์เป็นค่าจริง ไม่ใช่ค่าว่าง');
});

test('csvCell ค่าว่างและ null เป็นช่องว่าง', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(''), '');
});

test('csvCell ครอบเมื่อมีจุลภาค — ไม่งั้นหนึ่งช่องกลายเป็นสองช่อง', () => {
  assert.equal(csvCell('น้ำยา, ผ้าเช็ดแว่น'), '"น้ำยา, ผ้าเช็ดแว่น"');
});

test('csvCell อัญประกาศข้างในกลายเป็นคู่ ตาม RFC 4180', () => {
  assert.equal(csvCell('กรอบ "Ray-Ban"'), '"กรอบ ""Ray-Ban"""');
});

test('csvCell ขึ้นบรรทัดในค่าถูกครอบ ไม่ทำให้แถวแตก', () => {
  assert.equal(csvCell('บรรทัดหนึ่ง\nบรรทัดสอง'), '"บรรทัดหนึ่ง\nบรรทัดสอง"');
});

test('csvCell ช่องว่างหัวท้ายถูกครอบไว้ ไม่ให้โปรแกรมอ่านตัดทิ้ง', () => {
  assert.equal(csvCell(' 001 '), '" 001 "');
});

test('toCsv ใช้ CRLF และมีหัวตารางบรรทัดแรก', () => {
  const csv = toCsv(
    [{ label: 'ชื่อ', value: (r) => r.name }, { label: 'ยอด', value: (r) => r.amount }],
    [{ name: 'แนน', amount: 185500 }, { name: 'พี่หนู', amount: 42000 }],
  );
  assert.equal(csv, 'ชื่อ,ยอด\r\nแนน,185500\r\nพี่หนู,42000');
});

test('toCsv ไม่มีแถวเลย ยังได้หัวตาราง', () => {
  const csv = toCsv([{ label: 'ชื่อ', value: (r) => r.name }], []);
  assert.equal(csv, 'ชื่อ');
});

test('toCsv ส่งออกตัวเลขดิบ ไม่ใช่ข้อความที่จัดรูปแล้ว', () => {
  /* '฿185,500.00' ใน Excel เป็นข้อความ บวกลบไม่ได้ ซึ่งทำให้ไฟล์ไร้ประโยชน์ */
  const csv = toCsv([{ label: 'ยอด', value: (r) => r.amount }], [{ amount: 185500 }]);
  assert.equal(csv.split('\r\n')[1], '185500');
});
