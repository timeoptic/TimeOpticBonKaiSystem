import test from 'node:test';
import assert from 'node:assert/strict';
import { axisTicks, barLayout, donutArcs, niceMax, stackLayout } from '../chartGeom.js';

test('niceMax ปัดขึ้นเป็นเลขที่คนอ่านแกนได้', () => {
  assert.equal(niceMax(1), 1);
  assert.equal(niceMax(1.4), 2);
  assert.equal(niceMax(2.2), 2.5);
  assert.equal(niceMax(38), 50);
  assert.equal(niceMax(341901), 500000);
  assert.equal(niceMax(620), 1000);
});

test('niceMax ไม่คืน 0 ให้ค่าที่เป็นศูนย์หรือติดลบ — ตัวหารต้องไม่เป็นศูนย์', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(-5), 1);
  assert.equal(niceMax(NaN), 1);
});

test('axisTicks เริ่มที่ศูนย์เสมอ และแบ่งเท่ากัน', () => {
  const t = axisTicks(38, 4);
  assert.deepEqual(t, [0, 12.5, 25, 37.5, 50]);
  assert.equal(t[0], 0, 'แกนที่ถูกตัดหัวทำให้ผลต่างเล็ก ๆ ดูใหญ่เกินจริง');
});

test('barLayout ค่าทั้งชุดเป็นศูนย์ ยังวาดได้ ไม่หารด้วยศูนย์', () => {
  const { bars, top } = barLayout([0, 0, 0], { width: 300, height: 100 });
  assert.equal(top, 1);
  assert.equal(bars.length, 3);
  assert.ok(bars.every((b) => b.h === 0 && Number.isFinite(b.x)));
});

test('barLayout แท่งไม่หนาเกินเพดาน ต่อให้ช่องกว้างแค่ไหน', () => {
  const { bars } = barLayout([5], { width: 900, height: 100 });
  assert.equal(bars[0].w, 44);
});

test('barLayout แท่งหนาไม่เกิน 55% ของช่อง — ที่เหลือเป็นอากาศ', () => {
  const { bars, band } = barLayout([1, 1, 1, 1], { width: 200, height: 100 });
  assert.equal(band, 50);
  assert.ok(bars[0].w <= band * 0.55 + 1e-9);
});

test('barLayout แท่งมีความหนาขั้นต่ำ ไม่กลายเป็นเส้นผมเมื่อจุดเยอะ', () => {
  /* 245 วัน (ดูทั้งปีแบบรายวัน) เคยได้แท่งละ 0.7px จนมองไม่เห็น */
  const { bars } = barLayout(new Array(245).fill(1), { width: 1110, height: 100 });
  assert.ok(bars[0].w >= 3, `หนา ${bars[0].w}`);
});

test('barLayout ผู้เรียกกำหนดความหนาเองได้ ให้แท่งเดี่ยวกับแท่งซ้อนตรงกัน', () => {
  const { bars } = barLayout([1, 1], { width: 200, height: 100, thickness: 30 });
  assert.equal(bars[0].w, 30);
  assert.equal(bars[1].w, 30);
});

test('barLayout แท่งอยู่กลางช่องของตัวเอง', () => {
  const { bars, band } = barLayout([1, 1], { width: 200, height: 100 });
  assert.equal(band, 100);
  assert.equal(bars[0].cx, 50);
  assert.equal(bars[1].cx, 150);
});

test('barLayout ชุดว่างไม่พัง', () => {
  assert.deepEqual(barLayout([], { width: 100, height: 50 }).bars, []);
});

test('donutArcs ยอดรวมศูนย์ คืนอาเรย์ว่าง ไม่ใช่ path ที่มี NaN', () => {
  assert.deepEqual(donutArcs([0, 0]), []);
  assert.deepEqual(donutArcs([]), []);
});

test('donutArcs สัดส่วนบวกกันได้ 1 พอดี', () => {
  const arcs = donutArcs([720000, 130000]);
  assert.equal(arcs.length, 2);
  assert.ok(Math.abs(arcs.reduce((a, s) => a + s.pct, 0) - 1) < 1e-9);
});

test('donutArcs ชิ้นเดียว 100% ต้องวาดออกมา ไม่ใช่ arc ยาวศูนย์', () => {
  const arcs = donutArcs([500]);
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0].pct, 1);
  /* วงแหวนเต็มวงต้องใช้สอง arc ต่อขอบ — ขอบนอกกับขอบใน รวมสี่ตัว */
  assert.equal((arcs[0].d.match(/A/g) || []).length, 4);
  assert.ok(!/NaN/.test(arcs[0].d));
});

test('donutArcs ข้ามชิ้นที่เป็นศูนย์ แต่คงเลข i เดิมไว้', () => {
  const arcs = donutArcs([10, 0, 30]);
  assert.deepEqual(arcs.map((a) => a.i), [0, 2]);
});

test('donutArcs ชิ้นที่เล็กมากยังมี path ที่ใช้ได้ ไม่พลิกด้าน', () => {
  const arcs = donutArcs([9999, 1]);
  assert.equal(arcs.length, 2);
  assert.ok(!/NaN/.test(arcs[1].d));
});

test('donutArcs ไม่มีพิกัดไหนเป็น NaN', () => {
  for (const d of donutArcs([3, 5, 8, 13]).map((a) => a.d)) {
    assert.ok(!/NaN|Infinity/.test(d), d);
  }
});

test('stackLayout ชั้นเรียงจากฐานขึ้นบน และไม่ล้นออกนอกแกน', () => {
  const segs = stackLayout([30, 70], { height: 100, top: 100, gap: 2 });
  /* ชั้นล่างเริ่มที่ฐาน (y+h = 100) ชั้นบนวางต่อขึ้นไป */
  assert.equal(segs[0].y + 30, 100);
  assert.equal(segs[1].y, 0);
  assert.ok(segs.every((s) => s.y >= 0));
});

test('stackLayout ช่องไฟหักจากชั้นล่าง ชั้นบนสุดคงความสูงเต็ม', () => {
  const segs = stackLayout([50, 50], { height: 100, top: 100, gap: 2 });
  assert.equal(segs[0].h, 48);
  assert.equal(segs[1].h, 50);
});

test('stackLayout ชั้นที่บางกว่าช่องไฟ ไม่กลายเป็นความสูงติดลบ', () => {
  const segs = stackLayout([1, 99], { height: 100, top: 100, gap: 2 });
  assert.ok(segs[0].h >= 0);
});

test('stackLayout ชั้นที่เป็นศูนย์คืน null ไม่ใช่แท่งความสูงศูนย์', () => {
  const segs = stackLayout([0, 40], { height: 100, top: 100 });
  assert.equal(segs[0], null);
  assert.equal(segs[1].h, 40);
});
