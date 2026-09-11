import test from 'node:test';
import assert from 'node:assert/strict';
import {
  iso, rangeFor, periodOf, readFilter, filterQuery, rangeLabel,
  bucketLabel, bucketFull, GROUPS,
} from '../reportRange.js';

/** วันพุธที่ 2 ก.ย. 2026 — วันเดียวกับที่หน้ารายงานถูกเขียนขึ้น */
const WED = new Date(2026, 8, 2, 14, 30);

test('iso ใช้เวลาท้องถิ่น ไม่ใช่ UTC', () => {
  /* เกือบเที่ยงคืนตามเวลาไทยคือ "เมื่อวาน" ถ้าเผลอไปใช้ toISOString() */
  assert.equal(iso(new Date(2026, 8, 2, 23, 59)), '2026-09-02');
  assert.equal(iso(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});

test('วันนี้ คือช่วงวันเดียว', () => {
  assert.deepEqual(rangeFor('today', WED), { from: '2026-09-02', to: '2026-09-02' });
});

test('สัปดาห์นี้ เริ่มวันจันทร์และจบที่วันนี้', () => {
  assert.deepEqual(rangeFor('week', WED), { from: '2026-08-31', to: '2026-09-02' });
});

test('วันจันทร์เอง สัปดาห์เริ่มที่ตัวเอง ไม่ใช่ถอยไปอีกเจ็ดวัน', () => {
  const mon = new Date(2026, 7, 31);
  assert.deepEqual(rangeFor('week', mon), { from: '2026-08-31', to: '2026-08-31' });
});

test('วันอาทิตย์ นับเป็นวันสุดท้ายของสัปดาห์ ไม่ใช่วันแรก', () => {
  /* getDay() ให้ 0 กับวันอาทิตย์ — สูตรที่ลืมข้อนี้จะถอยไปผิดหกวัน */
  const sun = new Date(2026, 8, 6);
  assert.deepEqual(rangeFor('week', sun), { from: '2026-08-31', to: '2026-09-06' });
});

test('เดือนนี้ เริ่มวันที่ 1 และจบที่วันนี้ ไม่ลากไปสิ้นเดือน', () => {
  assert.deepEqual(rangeFor('month', WED), { from: '2026-09-01', to: '2026-09-02' });
});

test('สัปดาห์ที่คร่อมสิ้นปี ไม่หลุดไปคนละปี', () => {
  const fri = new Date(2027, 0, 1);
  assert.deepEqual(rangeFor('week', fri), { from: '2026-12-28', to: '2027-01-01' });
});

test('วันแรกของเดือน เดือนนี้คือวันเดียว', () => {
  const first = new Date(2026, 8, 1);
  assert.deepEqual(rangeFor('month', first), { from: '2026-09-01', to: '2026-09-01' });
});

test('เดือนที่แล้ว จบที่วันสิ้นเดือนนั้น ไม่ใช่วันนี้', () => {
  assert.deepEqual(rangeFor('last_month', WED), { from: '2026-08-01', to: '2026-08-31' });
});

test('เดือนที่แล้วของเดือนมกราคม ข้ามไปธันวาคมปีก่อน', () => {
  const jan = new Date(2026, 0, 15);
  assert.deepEqual(rangeFor('last_month', jan), { from: '2025-12-01', to: '2025-12-31' });
});

test('เดือนที่แล้วรู้จักเดือนกุมภาพันธ์และปีอธิกสุรทิน', () => {
  assert.equal(rangeFor('last_month', new Date(2026, 2, 10)).to, '2026-02-28');
  assert.equal(rangeFor('last_month', new Date(2028, 2, 10)).to, '2028-02-29');
});

test('ปีนี้ เริ่ม 1 ม.ค. และจบที่วันนี้', () => {
  assert.deepEqual(rangeFor('year', WED), { from: '2026-01-01', to: '2026-09-02' });
});

test('periodOf จับคู่ช่วงกลับเป็นปุ่มที่กด', () => {
  assert.equal(periodOf('2026-09-02', '2026-09-02', WED), 'today');
  assert.equal(periodOf('2026-08-31', '2026-09-02', WED), 'week');
  assert.equal(periodOf('2026-09-01', '2026-09-02', WED), 'month');
  assert.equal(periodOf('2026-08-01', '2026-08-31', WED), 'last_month');
  assert.equal(periodOf('2026-01-01', '2026-09-02', WED), 'year');
  assert.equal(periodOf('2026-01-01', '2026-03-31', WED), 'custom');
});

test('readFilter ไม่มีอะไรใน URL = เดือนนี้ ทุกช่องทาง ทุกสถานะ ทุกประเภทลูกค้า', () => {
  const f = readFilter(new URLSearchParams(''), WED);
  assert.deepEqual(f, {
    from: '2026-09-01', to: '2026-09-02', channel: 'all', status: 'all', group: 'all',
  });
});

test('readFilter ประเภทลูกค้าที่ไม่รู้จัก ตกกลับเป็น all', () => {
  assert.equal(readFilter(new URLSearchParams('group=ลูกค้าVIP'), WED).group, 'all');
  assert.equal(readFilter(new URLSearchParams('group=sightfirst'), WED).group, 'sightfirst');
  assert.equal(readFilter(new URLSearchParams('group=shop'), WED).group, 'shop');
});

test('GROUPS มีสามตัวเลือก ใช้คีย์ชุดเดียวกับกระดานงาน', () => {
  assert.deepEqual(GROUPS.map(([k]) => k), ['all', 'shop', 'sightfirst']);
});

test('filterQuery ใส่ group ลง URL เฉพาะเมื่อไม่ใช่ all', () => {
  const base = { from: '2026-09-01', to: '2026-09-02', channel: 'all', status: 'all' };
  assert.equal(filterQuery({ ...base, group: 'all' }), 'from=2026-09-01&to=2026-09-02');
  assert.equal(filterQuery({ ...base, group: 'sightfirst' }), 'from=2026-09-01&to=2026-09-02&group=sightfirst');
});

test('readFilter ช่วงกลับหัวกลับหาง ถูกยืดให้ครอบคลุม ไม่ใช่คืนช่วงว่าง', () => {
  const f = readFilter(new URLSearchParams('from=2026-09-10&to=2026-09-01'), WED);
  assert.equal(f.from, '2026-09-10');
  assert.equal(f.to, '2026-09-10');
});

test('readFilter ช่องทางที่ไม่รู้จัก ตกกลับเป็น all', () => {
  assert.equal(readFilter(new URLSearchParams('channel=ห้างสรรพสินค้า'), WED).channel, 'all');
  assert.equal(readFilter(new URLSearchParams('channel=pos'), WED).channel, 'pos');
});

test('readFilter สถานะงานที่ไม่รู้จัก ตกกลับเป็น all', () => {
  assert.equal(readFilter(new URLSearchParams('status=เสร็จแล้วมั้ง'), WED).status, 'all');
  assert.equal(readFilter(new URLSearchParams('status=open'), WED).status, 'open');
  assert.equal(readFilter(new URLSearchParams('status=closed'), WED).status, 'closed');
});

test('filterQuery ไม่ใส่ค่า all ลง URL ทั้ง channel และ status', () => {
  assert.equal(
    filterQuery({ from: '2026-09-01', to: '2026-09-02', channel: 'all', status: 'all' }),
    'from=2026-09-01&to=2026-09-02',
  );
  assert.equal(
    filterQuery({ from: '2026-09-01', to: '2026-09-02', channel: 'pos', status: 'all' }),
    'from=2026-09-01&to=2026-09-02&channel=pos',
  );
  assert.equal(
    filterQuery({ from: '2026-09-01', to: '2026-09-02', channel: 'all', status: 'open' }),
    'from=2026-09-01&to=2026-09-02&status=open',
  );
});

test('ตัวกรองเดินทางไป-กลับ URL ได้ครบทุกช่อง', () => {
  /* แท็บทุกอันส่งตัวกรองต่อกันด้วย filterQuery แล้วอ่านกลับด้วย readFilter —
     ช่องที่หล่นหายระหว่างทางแปลว่ากดสลับแท็บแล้วตัวกรองรีเซ็ตเอง */
  const f = { from: '2026-01-01', to: '2026-12-31', channel: 'main', status: 'closed', group: 'sightfirst' };
  assert.deepEqual(readFilter(new URLSearchParams(filterQuery(f)), WED), f);
});

test('rangeLabel ยุบส่วนที่ซ้ำ และนับเป็น พ.ศ.', () => {
  assert.equal(rangeLabel('2026-09-02', '2026-09-02'), '2 ก.ย. 2569');
  assert.equal(rangeLabel('2026-09-01', '2026-09-30'), '1 – 30 ก.ย. 2569');
  assert.equal(rangeLabel('2026-08-01', '2026-09-30'), '1 ส.ค. – 30 ก.ย. 2569');
  assert.equal(rangeLabel('2025-12-01', '2026-01-31'), '1 ธ.ค. 2568 – 31 ม.ค. 2569');
});

test('bucketLabel รายวัน — สั้นที่สุดที่ยังบอกวันได้', () => {
  assert.equal(bucketLabel('day', '2026-09-02', '2026-09-02'), '2/9');
  assert.equal(bucketLabel('day', '2026-12-25', '2026-12-25'), '25/12');
});

test('bucketLabel รายเดือน — ชื่อเดือนอย่างเดียว ไม่ต้องมีวัน', () => {
  assert.equal(bucketLabel('month', '2026-09-01', '2026-09-30'), 'ก.ย.');
  assert.equal(bucketLabel('month', '2026-01-01', '2026-01-31'), 'ม.ค.');
});

test('bucketLabel รายสัปดาห์ — ในเดือนเดียวกันเขียนช่วงวัน คร่อมเดือนเขียนวันเริ่ม', () => {
  assert.equal(bucketLabel('week', '2026-09-07', '2026-09-13'), '7–13/9');
  assert.equal(bucketLabel('week', '2026-08-31', '2026-09-06'), '31/8');
});

test('bucketFull ใส่ปี พ.ศ. ให้กล่องลอย', () => {
  assert.equal(bucketFull('day', '2026-09-02', '2026-09-02'), '2 ก.ย. 2569');
  assert.equal(bucketFull('month', '2026-09-01', '2026-09-30'), 'ก.ย. 2569');
  assert.equal(bucketFull('week', '2026-09-07', '2026-09-13'), '7 – 13 ก.ย. 2569');
  assert.equal(bucketFull('week', '2026-08-31', '2026-09-06'), '31 ส.ค. – 6 ก.ย. 2569');
});
