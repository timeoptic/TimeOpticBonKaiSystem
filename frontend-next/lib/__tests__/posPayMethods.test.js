import test from 'node:test';
import assert from 'node:assert/strict';
import { PAY_METHODS, payMethodLabel } from '../pos/posApi.js';

/* ร้านรับโอนเข้าบัญชีกรุงเทพบัญชีเดียว เจ้าของร้านจึงให้เรียกช่องทางนี้ว่า BBL
   (2026-09-12) · เปลี่ยนแค่ป้าย ค่าที่ส่งไป API ยังเป็น transfer บิลเก่าจึงขึ้น BBL ด้วย */
test('ช่องทางโอนแสดงเป็น BBL แต่ส่งค่า transfer เหมือนเดิม', () => {
  assert.equal(payMethodLabel('transfer'), 'BBL');
  assert.deepEqual(PAY_METHODS.find(([, label]) => label === 'BBL'), ['transfer', 'BBL']);
});

test('ช่องทางอื่นไม่เปลี่ยน', () => {
  assert.equal(payMethodLabel('cash'), 'เงินสด');
  assert.equal(payMethodLabel('credit'), 'บัตรเครดิต');
  assert.equal(payMethodLabel('thungngern'), 'ถุงเงิน');
});
