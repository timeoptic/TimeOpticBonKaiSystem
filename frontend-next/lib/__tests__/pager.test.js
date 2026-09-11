import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SIZES, fitsOnePage, pageWindow, sliceOf } from '../pager.js';

test('น้อยกว่าแปดหน้า โชว์ทุกเลข ไม่มีจุดไข่ปลา', () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(3, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test('อยู่ต้น ๆ จุดไข่ปลาโผล่ข้างขวาข้างเดียว', () => {
  assert.deepEqual(pageWindow(2, 12), [1, 2, 3, '…', 12]);
});

test('อยู่กลาง ๆ จุดไข่ปลาขนาบสองข้าง', () => {
  assert.deepEqual(pageWindow(6, 12), [1, '…', 5, 6, 7, '…', 12]);
});

test('อยู่ท้าย ๆ จุดไข่ปลาโผล่ข้างซ้ายข้างเดียว', () => {
  assert.deepEqual(pageWindow(11, 12), [1, '…', 10, 11, 12]);
});

/* เจ็ดปุ่มคือเพดาน — แถบที่กว้างขึ้นตามจำนวนหน้าจะดันตัวเลือก "กี่รายการต่อหน้า"
   ตกบรรทัดบนจอร้าน */
test('ไม่ว่าจะกี่หน้าหรืออยู่ตรงไหน ก็ไม่เกินเจ็ดช่อง', () => {
  for (const pages of [8, 12, 40, 999]) {
    for (const page of [1, 2, 3, Math.ceil(pages / 2), pages - 1, pages]) {
      assert.ok(pageWindow(page, pages).length <= 7, `page ${page}/${pages}`);
    }
  }
});

test('เลขหน้าปัจจุบันอยู่ในแถบเสมอ', () => {
  for (const page of [1, 2, 6, 7, 8, 39, 40]) {
    assert.ok(pageWindow(page, 40).includes(page), `page ${page}`);
  }
});

test('sliceOf ตัดแถวตามหน้า', () => {
  const rows = Array.from({ length: 25 }, (_, i) => i + 1);
  assert.deepEqual(sliceOf(rows, 1, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(sliceOf(rows, 3, 10), [21, 22, 23, 24, 25]);
});

/* หน้าค้าง — กรองจนแถวหาย แต่ state ยังชี้หน้า 7 อยู่ · ถ้าคืนอาเรย์ว่าง
   ตารางจะโล่งทั้งที่ badge บอกว่ามีข้อมูล ซึ่งอ่านเหมือนแอปพัง */
test('sliceOf หน้าที่เกินจำนวนจริง ถอยมาหน้าสุดท้าย ไม่ใช่คืนตารางว่าง', () => {
  const rows = Array.from({ length: 12 }, (_, i) => i + 1);
  assert.deepEqual(sliceOf(rows, 9, 10), [11, 12]);
});

test('sliceOf ไม่มีแถวเลย ก็ไม่พัง', () => {
  assert.deepEqual(sliceOf([], 1, 10), []);
  assert.deepEqual(sliceOf(null, 1, 10), []);
});

/* เกณฑ์ซ่อนแถบ — วัดกับตัวเลือกที่เล็กที่สุด ไม่ใช่กับค่าที่เลือกอยู่
   เกณฑ์แรกที่เขียนไว้คือ total <= perPage · ข้อมูล 19 แถวแล้วเลือก 50 แถบทั้งแถบ
   หายไปพร้อมช่องเลือก กลับมาเป็น 10 ไม่ได้จนกว่าจะรีโหลดหน้า */
test('fitsOnePage จริงเมื่อทุกตัวเลือกให้ผลเหมือนกันหมด', () => {
  assert.equal(fitsOnePage(0), true);
  /* อ้างจาก PAGE_SIZES[0] ไม่ใช่เลขดิบ — ตอนเขียนครั้งแรกค่าเริ่มต้นคือ 10 จึงเขียน
     ไว้ว่า 9 แถวต้องซ่อนแถบ พอร้านขอให้เหลือหน้าละ 5 เทสต์ก็ฟ้องทั้งที่แอปถูก
     (9 แถวหน้าละ 5 คือสองหน้า แถบต้องโผล่) */
  assert.equal(fitsOnePage(PAGE_SIZES[0] - 1), true);
  assert.equal(fitsOnePage(PAGE_SIZES[0]), true);
});

test('fitsOnePage เท็จเมื่อยังมีตัวเลือกที่เปลี่ยนผลได้ ถึงจะเลือกค่าใหญ่สุดอยู่', () => {
  assert.equal(fitsOnePage(19), false);
  assert.equal(fitsOnePage(PAGE_SIZES[0] + 1), false);
  assert.equal(fitsOnePage(200), false);
});
