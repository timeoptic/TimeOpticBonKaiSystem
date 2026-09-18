import test from 'node:test';
import assert from 'node:assert/strict';
import { lensModelName } from '../format.js';

/* ใบวัดสายตาพิมพ์แค่รุ่นเลนส์ (ร้านขอ 12 ก.ย. 2026) — ค่าสายตาอยู่ในตารางซ้ายอยู่แล้ว
   ชื่อสินค้าในร้านต่อท้ายด้วย "SPH/CYL" เสมอ (ดูจากข้อมูลจริง: -9.99/-9.99, +9.99/9.99, -99.99/-9.99) */
test('ตัดค่าสายตา SPH/CYL ท้ายชื่อออก เหลือรุ่นกับ index', () => {
  assert.equal(lensModelName('G Blue Single Vision (1.60) -6.00/-1.25'), 'G Blue Single Vision (1.60)');
  assert.equal(lensModelName('G Blue Single Vision (1.50) +2.75/-1.00'), 'G Blue Single Vision (1.50)');
  assert.equal(lensModelName('G Blue Single Vision (1.50) -0.75/0.00'), 'G Blue Single Vision (1.50)');
  assert.equal(lensModelName('Hitop MC Single Vision (1.60) 0.25/-0.50'), 'Hitop MC Single Vision (1.60)');
  assert.equal(lensModelName('G Auto-Blue Single Vision (1.67) -12.50/-2.00'), 'G Auto-Blue Single Vision (1.67)');
});

test('ชื่อที่ไม่มีค่าสายตาท้ายชื่อไม่ถูกแตะ', () => {
  assert.equal(lensModelName('Hitop FTphotogrey1.5 Bifocal'), 'Hitop FTphotogrey1.5 Bifocal');
  assert.equal(lensModelName('G Blue Single Vision (1.60)'), 'G Blue Single Vision (1.60)');
  assert.equal(lensModelName(''), '');
  assert.equal(lensModelName(null), '');
});
