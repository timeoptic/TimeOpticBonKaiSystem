import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairDisplay } from '../pricing.js';

/* ช่อง "ราคาขายเลนส์คู่" ตอนที่ไม่ได้พิมพ์อยู่ แสดงผลบวกของสองข้าง
   ราคา 0 แสดงเป็นช่องว่าง (placeholder บอก 0 แทน) — เดิมโชว์ "0" จริง ๆ ในช่อง
   ลบก็ไม่หาย เพราะค่าว่างถูกอ่านเป็น 0 แล้ววาดกลับมาเป็น "0" ทันที */

test('pairDisplay: ราคา 0 แสดงเป็นช่องว่าง ไม่ใช่เลข 0 ค้างในช่อง', () => {
  assert.equal(pairDisplay(0), '');
});

test('pairDisplay: ราคาจริงแสดงเป็นตัวเลขตามปกติ', () => {
  assert.equal(pairDisplay(4000), '4000');
  assert.equal(pairDisplay(4001), '4001');
});

test('pairDisplay: ทศนิยมจากการแบ่งสองข้างแสดงครบ ไม่ถูกปัดทิ้ง', () => {
  assert.equal(pairDisplay(999.99), '999.99');
  assert.equal(pairDisplay(0.5), '0.5');
});

test('pairDisplay: ค่าที่ไม่ใช่ตัวเลขหรือติดลบ ถือเป็นยังไม่ตั้งราคา', () => {
  assert.equal(pairDisplay(null), '');
  assert.equal(pairDisplay(undefined), '');
  assert.equal(pairDisplay(Number.NaN), '');
  assert.equal(pairDisplay(-10), '');
});
