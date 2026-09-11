import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANUAL, manualLinks, manualStrings } from '../manual.js';
import { crumbFor } from '../crumb.js';

/* คู่มือเขียนเป็นข้อมูล ไม่ใช่ JSX — เทสต์นี้จึงเฝ้าสิ่งที่พังเงียบได้เมื่อหน้าจอเปลี่ยน:
   ลิงก์ "เปิดหน้านี้" ที่ชี้ไปหน้าที่ถูกย้าย/ลบ และหัวข้อที่เหลือแต่ชื่อ */

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');

/** มีหน้าจริงอยู่ไหม — ลิงก์ในคู่มือพาไปได้ทั้งฝั่งหน้าร้านและหน้าล็อกอิน */
const pageExists = (href) => {
  const clean = href.split(/[?#]/)[0].replace(/\/+$/, '');
  return ['(frontdesk)', '(gate)'].some((g) => fs.existsSync(path.join(APP, g, clean, 'page.jsx')));
};

test('manual: มีหัวข้อครบตามที่ตกลงกับร้าน', () => {
  const ids = MANUAL.map((s) => s.id);
  for (const id of [
    'start', 'flow', 'reception', 'exam', 'sales', 'payment', 'centering', 'delivery',
    'bookings', 'customers', 'prescriptions', 'orders', 'pos', 'locations', 'printing', 'faq',
  ]) {
    assert.ok(ids.includes(id), `ขาดหัวข้อ ${id}`);
  }
});

test('manual: anchor ของทุกหัวข้อไม่ซ้ำและใช้เป็น #id ได้', () => {
  const ids = MANUAL.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'มี id ซ้ำ');
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
});

test('manual: ทุกลิงก์ชี้ไปหน้าที่มีอยู่จริง', () => {
  const links = manualLinks(MANUAL);
  assert.ok(links.length >= 10, 'คู่มือควรพาไปหน้าจริงได้แทบทุกหัวข้อ');
  for (const href of links) {
    assert.ok(href.startsWith('/'), `ลิงก์ต้องเป็น path ในเว็บ: ${href}`);
    assert.ok(pageExists(href), `ไม่มีหน้า ${href}`);
  }
});

test('manual: ทุกหัวข้อมีเนื้อหา ไม่มีข้อความว่างหรือค้างเขียน', () => {
  for (const s of MANUAL) {
    assert.ok(s.title, `หัวข้อ ${s.id} ไม่มีชื่อ`);
    assert.ok(Array.isArray(s.blocks) && s.blocks.length > 0, `หัวข้อ ${s.id} ไม่มีเนื้อหา`);
  }
  for (const str of manualStrings(MANUAL)) {
    assert.ok(str.trim() !== '', 'มีข้อความว่าง');
    assert.doesNotMatch(str, /TODO|TBD|xxx/i, `ข้อความค้างเขียน: ${str}`);
  }
});

test('manual: ป้ายชื่อปุ่ม [[...]] เปิด-ปิดครบทุกคู่', () => {
  for (const str of manualStrings(MANUAL)) {
    const open = (str.match(/\[\[/g) || []).length;
    const close = (str.match(/\]\]/g) || []).length;
    assert.equal(open, close, `วงเล็บป้ายไม่ครบคู่: ${str}`);
  }
});

test('crumbFor: หน้าคู่มือ', () => {
  assert.equal(crumbFor('/manual'), 'คู่มือการใช้งาน');
});
