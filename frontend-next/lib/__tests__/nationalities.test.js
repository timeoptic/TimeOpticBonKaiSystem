// frontend-next/lib/__tests__/nationalities.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIONALITIES,
  NATIONALITY_BY_VALUE,
  NATIONALITY_COMMON,
  NATIONALITY_ROWS,
} from '../nationalities.js';

test('ทุกแถวมีครบสามช่อง และไม่มีช่องไหนว่าง', () => {
  for (const row of NATIONALITY_ROWS) {
    assert.equal(row.length, 3, `แถวนี้ไม่ครบสามช่อง: ${JSON.stringify(row)}`);
    for (const cell of row) assert.ok(cell.trim(), `มีช่องว่างในแถว ${JSON.stringify(row)}`);
  }
});

test('ค่าที่บันทึกลงฐานห้ามซ้ำ — ซ้ำแล้ว key ของ React ชนกันและตัวเลือกจะหายไปหนึ่งตัว', () => {
  assert.equal(new Set(NATIONALITIES).size, NATIONALITIES.length);
});

/* ลิสต์ "ใช้บ่อย" เขียนด้วยมือแยกจากตารางหลัก — พิมพ์ผิดหนึ่งตัวแล้วมันจะหายไป
   จากหัวรายการเงียบ ๆ โดยที่หน้าจอยังทำงานได้ปกติ ไม่มีอะไรฟ้อง */
test('ทุกตัวในกลุ่มใช้บ่อยต้องมีอยู่จริงในตารางหลัก', () => {
  for (const en of NATIONALITY_COMMON) {
    assert.ok(NATIONALITY_BY_VALUE[en], `'${en}' ไม่มีใน NATIONALITY_ROWS`);
  }
});

/* คำที่ "เคยพิมพ์กันมาแล้วจริง ๆ" ในฐาน 4,100 ใบ ต้องค้นเจอตัวที่ถูกต้อง ไม่งั้น
   คนที่ชินกับคำเดิมจะพิมพ์แล้วไม่เจออะไรเลย แล้วกลับไปเว้นช่องนี้ว่างเหมือนเดิม */
test('ชื่อประเทศและคำที่เคยสะกดผิดในฐาน ค้นแล้วต้องเจอสัญชาติที่ถูก', () => {
  const find = (q) => NATIONALITY_ROWS
    .filter(([en, th, aka]) => `${en} ${th} ${aka}`.toLowerCase().includes(q.toLowerCase()))
    .map(([en]) => en);

  const cases = [
    ['England', 'British'], ['UK', 'British'], ['Scottland', 'British'],
    ['Switzerland', 'Swiss'], ['Germany', 'German'], ['Holland', 'Dutch'],
    ['Netherland', 'Dutch'], ['USA', 'American'], ['Denmark', 'Danish'],
    ['Denish', 'Danish'], ['Isreal', 'Israeli'], ['Newzeland', 'New Zealander'],
    ['Veitnam', 'Vietnamese'], ['Ukain', 'Ukrainian'], ['Korea', 'South Korean'],
    ['Dubai', 'Emirati'], ['Myanmar', 'Burmese'], ['Thailand', 'Thai'],
    ['เยอรมัน', 'German'], ['ไทย', 'Thai'], ['ญี่ปุ่น', 'Japanese'],
  ];

  for (const [typed, want] of cases) {
    assert.ok(find(typed).includes(want), `พิมพ์ '${typed}' แล้วไม่เจอ '${want}'`);
  }
});
