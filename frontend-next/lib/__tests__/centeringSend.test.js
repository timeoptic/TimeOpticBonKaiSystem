import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_NOTE,
  confirmText,
  noteUnsaved,
  photoCountText,
  sendFailure,
  sendButtonState,
  sendPayload,
  sentHistory,
  sentStamp,
  sentToast,
} from '../centeringSend.js';

const PHOTOS = [
  { id: 33, mime_type: 'image/jpeg' },
  { id: 31, mime_type: 'image/png' },
  { id: 30, mime_type: 'application/pdf' },
];

test('sendPayload: ส่งรูปทุกใบในกล่องตามลำดับบนจอ พร้อมรหัสเคสและหมายเหตุ', () => {
  assert.deepEqual(
    sendPayload({ caseId: 10459, caseCode: 'CASE-2026-00001', photos: PHOTOS, note: '  ปรับขาแว่นก่อนวัด \n' }),
    { case_id: 10459, case_code: 'CASE-2026-00001', photo_ids: [33, 31, 30], note: 'ปรับขาแว่นก่อนวัด' },
  );
});

test('sendPayload: หมายเหตุว่างหรือมีแต่ช่องว่าง ส่งเป็น null', () => {
  assert.equal(sendPayload({ caseId: 1, caseCode: 'C', photos: PHOTOS, note: '   ' }).note, null);
  assert.equal(sendPayload({ caseId: 1, caseCode: 'C', photos: PHOTOS, note: undefined }).note, null);
});

test('NO_NOTE: ข้อความตอนไม่มีหมายเหตุ', () => {
  assert.equal(NO_NOTE, 'ไม่มีหมายเหตุ');
});

test('photoCountText: บอกจำนวนรูปที่จะส่ง', () => {
  assert.equal(photoCountText(5), 'รูปภาพที่จะส่ง 5 รูป');
});

test('confirmText: มีหมายเหตุ บอกว่าส่งพร้อมหมายเหตุจากหน้า Center', () => {
  assert.equal(
    confirmText({ caseCode: 'CASE-2026-00001', count: 5, hasNote: true }),
    'รูปภาพจำนวน 5 รูปของเคส CASE-2026-00001 จะถูกส่งพร้อมหมายเหตุจากหน้า Center',
  );
});

test('confirmText: ไม่มีหมายเหตุ ไม่พูดว่าส่งพร้อมหมายเหตุ', () => {
  assert.equal(
    confirmText({ caseCode: 'CASE-2026-00001', count: 1, hasNote: false }),
    'รูปภาพจำนวน 1 รูปของเคส CASE-2026-00001 จะถูกส่ง (ไม่มีหมายเหตุ)',
  );
});

test('sentToast: หัวข้อกับรายละเอียดเคสและจำนวนรูป', () => {
  assert.deepEqual(sentToast({ caseCode: 'CASE-2026-00001', count: 5 }), {
    title: 'ส่งรูปเรียบร้อยแล้ว',
    detail: 'เคส CASE-2026-00001 • 5 รูป',
  });
});

test('noteUnsaved: ช่องหมายเหตุต่างจากที่บันทึกไว้', () => {
  assert.equal(noteUnsaved('ใหม่', 'เก่า'), true);
  assert.equal(noteUnsaved('', null), false);
  assert.equal(noteUnsaved(' เดิม ', 'เดิม'), false);
  assert.equal(noteUnsaved('มีข้อความ', undefined), true);
});

const apiError = (status, reason, message, data = {}) => Object.assign(new Error(message), {
  status, reason, data: { error: message, reason, ...data },
});

test('sendFailure: ด่านที่บอกเหตุผลได้ แสดงเหตุผลใต้ข้อความหลัก', () => {
  assert.deepEqual(
    sendFailure(apiError(400, 'not_configured', 'ยังไม่ได้ตั้งค่ากลุ่ม Telegram "รูปวัด Center"')),
    {
      title: 'ส่งรูปไม่สำเร็จ กรุณาลองอีกครั้ง',
      detail: 'ยังไม่ได้ตั้งค่ากลุ่ม Telegram "รูปวัด Center"',
      refresh: false,
    },
  );
});

test('sendFailure: รูปในเคสเปลี่ยนไป ให้โหลดกล่องรูปใหม่', () => {
  const f = sendFailure(apiError(409, 'photos_changed', 'รูปภาพในเคสมีการเปลี่ยนแปลง'));
  assert.equal(f.refresh, true);
  assert.equal(f.detail, 'รูปภาพในเคสมีการเปลี่ยนแปลง');
});

test('sendFailure: Telegram ปฏิเสธ แสดงสาเหตุจาก Telegram', () => {
  const f = sendFailure(apiError(502, 'send_failed', 'ส่งรูปไม่สำเร็จ กรุณาลองอีกครั้ง', { detail: 'Bad Request: chat not found' }));
  assert.deepEqual(f, { title: 'ส่งรูปไม่สำเร็จ กรุณาลองอีกครั้ง', detail: 'Bad Request: chat not found', refresh: false });
});

test('sendFailure: เน็ตหลุด (ไม่มีคำตอบจาก API) ไม่มีรายละเอียดทางเทคนิค', () => {
  assert.deepEqual(sendFailure(new TypeError('Failed to fetch')), {
    title: 'ส่งรูปไม่สำเร็จ กรุณาลองอีกครั้ง', detail: null, refresh: false,
  });
});

const EV = (ids, sentAt, ok = true) => ({
  action: 'centering_photos_sent',
  created_at: sentAt,
  payload: JSON.stringify({ centerImages: ids, sentAt, ok }),
});

test('sentHistory: รวม id รูปจากทุกครั้งที่ส่งสำเร็จ และจำครั้งล่าสุด', () => {
  const h = sentHistory([
    EV([33, 31, 30], '2026-10-28 14:38:00'),
    { action: 'centering_photos_send_failed', payload: '{"centerImages":[99]}' },
    { action: 'status_changed', payload: null },
    EV([33], '2026-10-27 09:00:00'),
  ]);
  assert.deepEqual(h.ids.sort(), [30, 31, 33]);
  assert.deepEqual(h.last, { at: '2026-10-28 14:38:00', count: 3 });
  assert.deepEqual(sentHistory(null), { ids: [], last: null });
});

test('sentStamp: วันนี้โชว์แค่เวลา วันอื่นโชว์วัน/เดือนด้วย', () => {
  assert.equal(sentStamp('2026-10-28 14:38:05', '2026-10-28'), '14:38');
  assert.equal(sentStamp('2026-10-27 09:05:00', '2026-10-28'), '27/10 09:05');
});

test('sendButtonState: ยังไม่ส่ง / ส่งครบ / มีรูปใหม่', () => {
  const today = '2026-10-28';
  const none = { ids: [], last: null };
  assert.equal(sendButtonState({ photos: PHOTOS, sent: none, today }).tone, 'first');
  assert.equal(sendButtonState({ photos: [], sent: none, today }).hint, 'กรุณาเพิ่มรูปภาพก่อนส่ง');

  const all = sentHistory([EV([33, 31, 30], '2026-10-28 14:38:00')]);
  assert.deepEqual(sendButtonState({ photos: PHOTOS, sent: all, today }), {
    tone: 'sent', label: 'ส่งแล้ว 3 รูป · 14:38', hint: 'ส่งครบแล้ว — กดอีกครั้งได้ถ้าต้องการส่งซ้ำ',
  });

  const part = sentHistory([EV([33], '2026-10-27 09:00:00')]);
  assert.deepEqual(sendButtonState({ photos: PHOTOS, sent: part, today }), {
    tone: 'more', label: 'ส่งอีกครั้ง · มีรูปใหม่ 2 รูป', hint: 'ส่งล่าสุด 27/10 09:00 · กดแล้วจะส่งทั้งชุด 3 รูป',
  });
});
