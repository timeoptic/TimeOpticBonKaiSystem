import test from 'node:test';
import assert from 'node:assert/strict';
import { boardColumns, boardQuery, dateFieldOptions, stageOptions } from '../caseBoard.js';
import { STAGE_GROUPS } from '../constants.js';

/* ยอดจริงจากฐานตอนเขียนเทสต์นี้ — คอลัมน์บนกระดานรวมได้ 1,173 เคสที่ยังทำไม่จบ */
const REAL = { reception: 0, exam: 2, sales: 231, payment: 918, centering: 20, delivery: 2 };

test('ค่าเริ่มต้น: ทุกขั้นเป็นคอลัมน์ ยอดรวมตรงกับที่ API นับมา', () => {
  const { stages, columns, total } = boardColumns({ byStage: REAL, hideEmpty: false });
  assert.deepEqual(stages, STAGE_GROUPS);
  assert.deepEqual(columns, STAGE_GROUPS);
  assert.equal(total, 1173);
});

/* หัวใจของงานรอบนี้ — "ซ่อนขั้นที่ว่าง" ซ่อนคอลัมน์ ไม่ได้กรองเคสออก
   ยอดรวมจึงต้องไม่ขยับ ไม่ว่าสวิตช์จะเปิดหรือปิด */
test('ซ่อนขั้นที่ว่าง ตัดเฉพาะคอลัมน์ที่ไม่มีเคส ยอดรวมไม่เปลี่ยน', () => {
  const on = boardColumns({ byStage: REAL, hideEmpty: true });
  const off = boardColumns({ byStage: REAL, hideEmpty: false });

  assert.deepEqual(on.columns, ['exam', 'sales', 'payment', 'centering', 'delivery']);
  assert.ok(!on.columns.includes('reception'), 'ขั้นที่ว่างต้องหายไปจากคอลัมน์');
  assert.equal(on.total, off.total);
  assert.deepEqual(on.stages, off.stages, 'ขั้นที่กระดานพูดถึงไม่ขึ้นกับสวิตช์แสดงผล');
});

test('เลือกขั้นตอนเดียว เหลือคอลัมน์เดียวและยอดของขั้นนั้น', () => {
  const { stages, columns, total } = boardColumns({ byStage: REAL, stage: 'payment' });
  assert.deepEqual(stages, ['payment']);
  assert.deepEqual(columns, ['payment']);
  assert.equal(total, 918);
});

/* เลือกขั้นที่ไม่มีเคสเลย ต้องได้ total 0 เพื่อให้หน้าเว็บขึ้น "ไม่พบเคสที่ตรงกับ
   ตัวกรองที่เลือก" ไม่ใช่กระดานว่างที่ไม่มีคำอธิบาย */
test('เลือกขั้นที่ว่าง ได้ยอด 0 ให้หน้าเว็บรู้ว่าต้องขึ้นข้อความไม่พบเคส', () => {
  const { columns, total } = boardColumns({ byStage: REAL, stage: 'reception' });
  assert.equal(total, 0);
  assert.deepEqual(columns, [], 'ไม่วาดคอลัมน์เปล่าทิ้งไว้');
});

test('เคสที่จบแล้วเป็นกองเดียว ชื่อขั้น "จบงาน"', () => {
  const { stages, columns, total } = boardColumns({
    byStage: { done: 7752 }, caseFilter: 'done',
  });
  assert.deepEqual(stages, ['done']);
  assert.deepEqual(columns, ['done']);
  assert.equal(total, 7752);
});

/* ขั้นที่ค้างอยู่ตอนสลับไปดูเคสที่จบแล้วต้องไม่พากระดานไปกองที่ไม่มีอยู่จริง —
   หน้าเว็บล้าง stage ให้ตอนกด แต่ตรรกะตรงนี้ต้องไม่พังถึงจะหลุดมาก็ตาม */
test('เคสที่จบแล้วชนะขั้นตอนที่ค้างอยู่ ไม่ใช่เอามาและกัน', () => {
  const { stages } = boardColumns({ byStage: { done: 7752 }, stage: 'payment', caseFilter: 'done' });
  assert.deepEqual(stages, ['done']);
});

test('ไม่มี by_stage มาเลย (ยังโหลดไม่เสร็จ) ก็ไม่พัง', () => {
  const { columns, total } = boardColumns({});
  assert.deepEqual(columns, []);
  assert.equal(total, 0);
});

/* ─────────────────────────────────────────────────────────────────────────
   boardQuery — ตัวกรองเคสเลือกได้ทีละอัน
   ───────────────────────────────────────────────────────────────────────── */

test('ไม่เลือกอะไร ไม่ส่งเงื่อนไขอะไรไปเลย', () => {
  const q = boardQuery({});
  assert.equal(q.rush, '');
  assert.equal(q.unpaid, '');
  assert.equal(q.closed, '');
  assert.equal(q.paged, 1);
});

/* เหตุผลทั้งหมดที่รื้อชิป: เดิมสามอันนี้กดพร้อมกันได้ = ขอเคสที่ปิดแล้ว + ด่วน +
   ค้างชำระ ซึ่งไม่มีอยู่จริง แล้วกระดานก็ว่างโดยไม่บอกอะไร */
test('เลือกอันหนึ่งแล้วอีกสองอันต้องเป็นค่าว่างเสมอ', () => {
  for (const [key, field] of [['rush', 'rush'], ['unpaid', 'unpaid'], ['done', 'closed']]) {
    const q = boardQuery({ caseFilter: key });
    assert.equal(q[field], 1, `${key} ต้องเปิด`);
    const others = ['rush', 'unpaid', 'closed'].filter((f) => f !== field);
    for (const o of others) assert.equal(q[o], '', `${key}: ${o} ต้องปิด`);
  }
});

test('เคสที่จบแล้วล้างตัวกรองขั้นตอนออก — กองนั้นไม่มีขั้นให้กรอง', () => {
  assert.equal(boardQuery({ caseFilter: 'done', stage: 'payment' }).stage, '');
  assert.equal(boardQuery({ caseFilter: 'rush', stage: 'payment' }).stage, 'payment');
});

test('ประเภทลูกค้ากับตัวกรองเคสใช้ร่วมกันได้ ไม่ได้แทนที่กัน', () => {
  const q = boardQuery({ client: 'sightfirst', caseFilter: 'rush', stage: 'sales', q: '  ใจดี  ' });
  assert.equal(q.client, 'sightfirst');
  assert.equal(q.rush, 1);
  assert.equal(q.stage, 'sales');
  assert.equal(q.q, 'ใจดี', 'ช่องว่างหัวท้ายต้องถูกตัด ไม่งั้นค้นหาไม่เจอ');
});

/* ─────────────────────────────────────────────────────────────────────────
   ช่วงวันที่
   ───────────────────────────────────────────────────────────────────────── */

test('ไม่เลือกช่วงวันที่ ไม่ส่งเงื่อนไขวันที่ไปเลย', () => {
  const q = boardQuery({ dateField: 'appointment' });
  assert.equal(q.from, '');
  assert.equal(q.to, '');
  assert.equal(q.date_field, '', 'ไม่มีช่วงก็ไม่ต้องบอกว่ากรองด้วยวันไหน');
});

test('ช่วงวันที่ส่งไปพร้อมชนิดวันที่เลือก ใช้ร่วมกับตัวกรองอื่นได้', () => {
  const q = boardQuery({
    caseFilter: 'unpaid', dateField: 'appointment', from: '2026-09-01', to: '2026-09-14',
  });
  assert.deepEqual([q.date_field, q.from, q.to], ['appointment', '2026-09-01', '2026-09-14']);
  assert.equal(q.unpaid, 1);
});

test('ใส่แค่ขอบเดียวก็กรองได้', () => {
  assert.deepEqual(
    [boardQuery({ from: '2026-09-01' }).from, boardQuery({ from: '2026-09-01' }).to],
    ['2026-09-01', ''],
  );
  assert.equal(boardQuery({ to: '2026-09-14' }).date_field, 'opened');
});

test('ช่วงหัวกลับหางถูกสลับ ไม่ใช่คืนกระดานว่าง', () => {
  const q = boardQuery({ from: '2026-09-14', to: '2026-09-01' });
  assert.deepEqual([q.from, q.to], ['2026-09-01', '2026-09-14']);
});

/* "วันปิดเคส" ค้างอยู่หลังกดออกจากกองเคสที่จบแล้ว = เทียบกับ closed_at ที่เป็น NULL
   ทุกใบ กระดานว่างเปล่า — ต้องตกกลับเป็นวันเปิดเคส */
test('วันปิดเคสใช้ได้เฉพาะกองเคสที่จบแล้ว', () => {
  assert.equal(boardQuery({ caseFilter: 'done', dateField: 'closed', from: '2026-09-01' }).date_field, 'closed');
  assert.equal(boardQuery({ dateField: 'closed', from: '2026-09-01' }).date_field, 'opened');
  assert.ok(!dateFieldOptions({}).some(([k]) => k === 'closed'));
  assert.ok(dateFieldOptions({ caseFilter: 'done' }).some(([k]) => k === 'closed'));
});

/* ─────────────────────────────────────────────────────────────────────────
   stageOptions
   ───────────────────────────────────────────────────────────────────────── */

test('ช่องเลือกขั้นตอนตรงกับคอลัมน์ที่กระดานใช้จริง', () => {
  assert.deepEqual(stageOptions({}), STAGE_GROUPS);
  assert.deepEqual(stageOptions({ caseFilter: 'done' }), ['done']);
});

/* ชิป "งานค้างแต่ละขั้นตอน" ในหน้าเมนูหลักลิงก์มาที่ /cases?stage=done ได้ —
   เคสที่เดินครบทุกขั้นแต่สถานะยังไม่ปิด · ถ้าไม่เผื่อไว้ กระดานจะกรองถูกแต่
   ช่องเลือกโชว์ค่าว่าง ซึ่งอ่านเหมือนตัวกรองไม่ทำงาน */
test('ขั้นที่มาจาก URL แต่ไม่อยู่ในหกขั้น ถูกเติมเข้าไปในตัวเลือก', () => {
  assert.deepEqual(stageOptions({ stage: 'done' }), [...STAGE_GROUPS, 'done']);
  assert.deepEqual(stageOptions({ stage: 'payment' }), STAGE_GROUPS, 'ขั้นปกติไม่ถูกเติมซ้ำ');
});
