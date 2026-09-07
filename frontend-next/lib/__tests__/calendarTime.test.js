import test from 'node:test';
import assert from 'node:assert/strict';
import {
  joinLocal, minutesOf, parseTypedTime, splitLocal, timeOptions,
} from '../calendar.js';

/* คนกรอกเวลาที่ร้านพิมพ์รวดเดียวแล้ว Tab ต่อ — ตัวคั่นจะเป็นอะไรก็ได้หรือไม่มีเลย
   เหตุผลเดียวกับ parseTypedDate ที่รับ 04092026 */
test('พิมพ์เวลาแบบไหนก็อ่านออก', () => {
  assert.equal(parseTypedTime('9'), '09:00');
  assert.equal(parseTypedTime('09'), '09:00');
  assert.equal(parseTypedTime('930'), '09:30');
  assert.equal(parseTypedTime('0930'), '09:30');
  assert.equal(parseTypedTime('9:30'), '09:30');
  assert.equal(parseTypedTime('9.30'), '09:30');
  assert.equal(parseTypedTime('9 30'), '09:30');
  assert.equal(parseTypedTime('21:05'), '21:05');
  assert.equal(parseTypedTime('2105'), '21:05');
  assert.equal(parseTypedTime('13:5'), '13:05');
});

/* '10:30 น.' คือสิ่งที่คนวางทับมาจากข้อความจอง — ตัวหนังสือท้ายไม่ควรทำให้อ่านไม่ออก */
test('ตัวหนังสือที่ไม่ใช่ตัวเลขไม่ทำให้อ่านไม่ออก', () => {
  assert.equal(parseTypedTime('10:30 น.'), '10:30');
  assert.equal(parseTypedTime(' 08:00 '), '08:00');
});

test('เวลาที่ไม่มีอยู่จริงคืน null ไม่ใช่ปัดให้เอง', () => {
  assert.equal(parseTypedTime('24:00'), null);
  assert.equal(parseTypedTime('9:60'), null);
  assert.equal(parseTypedTime('99'), null);
  assert.equal(parseTypedTime(''), null);
  assert.equal(parseTypedTime('   '), null);
  assert.equal(parseTypedTime('abc'), null);
  assert.equal(parseTypedTime('12345'), null);
  assert.equal(parseTypedTime(null), null);
  assert.equal(parseTypedTime(undefined), null);
});

/* เที่ยงคืนเป็นเวลาที่มีจริง ไม่ใช่ค่าว่าง — ถ้าคืน null ช่องจะล้างตัวเองทุกครั้งที่พิมพ์ 0:00 */
test('เที่ยงคืนอ่านออกและไม่ใช่ค่าว่าง', () => {
  assert.equal(parseTypedTime('0'), '00:00');
  assert.equal(parseTypedTime('00:00'), '00:00');
  assert.equal(parseTypedTime('0000'), '00:00');
});

test('timeOptions เดินครบวันตามช่วงที่สั่ง', () => {
  const q = timeOptions(15);
  assert.equal(q.length, 96);
  assert.equal(q[0], '00:00');
  assert.equal(q[1], '00:15');
  assert.equal(q.at(-1), '23:45');

  const h = timeOptions(60);
  assert.equal(h.length, 24);
  assert.deepEqual(h.slice(0, 3), ['00:00', '01:00', '02:00']);
});

test('minutesOf นับจากเที่ยงคืน อ่านไม่ออกคืน null', () => {
  assert.equal(minutesOf('00:00'), 0);
  assert.equal(minutesOf('09:30'), 570);
  assert.equal(minutesOf('23:45'), 1425);
  assert.equal(minutesOf(''), null);
  assert.equal(minutesOf('เลข'), null);
});

/* ค่าที่ <input type="datetime-local"> เคยส่งออกคือ 'YYYY-MM-DDTHH:MM' เป๊ะ ๆ
   ตัวใหม่ต้องส่งรูปแบบเดิม ไม่งั้น API ที่รออยู่ปลายทางต้องแก้ตาม */
test('แยกและประกอบค่า datetime-local ได้รูปแบบเดิม', () => {
  assert.deepEqual(splitLocal('2026-09-05T14:30'), ['2026-09-05', '14:30']);
  assert.deepEqual(splitLocal('2026-09-05T14:30:00'), ['2026-09-05', '14:30']);
  assert.deepEqual(splitLocal('2026-09-05 14:30:00'), ['2026-09-05', '14:30']);
  assert.deepEqual(splitLocal('2026-09-05'), ['2026-09-05', '']);
  assert.deepEqual(splitLocal(''), ['', '']);
  assert.deepEqual(splitLocal(null), ['', '']);

  assert.equal(joinLocal('2026-09-05', '14:30'), '2026-09-05T14:30');
  assert.equal(joinLocal('2026-09-05', ''), '2026-09-05T00:00');
  assert.equal(joinLocal('', '14:30'), '');
  assert.equal(joinLocal('', ''), '');
});

/* ไป-กลับแล้วต้องได้ของเดิม ไม่งั้นแค่เปิดฟอร์มดูเฉย ๆ ค่าก็เพี้ยนไปแล้ว */
test('แยกแล้วประกอบกลับได้ค่าเดิม', () => {
  for (const v of ['2026-09-05T14:30', '2026-01-01T00:00', '2026-12-31T23:45']) {
    const [d, t] = splitLocal(v);
    assert.equal(joinLocal(d, t), v);
  }
});
