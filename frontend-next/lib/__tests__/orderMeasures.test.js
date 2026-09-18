import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureCells } from '../orderMeasures.js';

const EMPTY = { PD: '', FH: '', A: '', B: '', ED: '', DBL: '' };

test('measureCells: PD และ FH พิมพ์ขวา / ซ้าย', () => {
  const cells = measureCells({ r_pd: '31', l_pd: '30.5', r_height: '18.5', l_height: '19' }, null);
  assert.equal(cells.PD, '31 / 30.5');
  assert.equal(cells.FH, '18.5 / 19');
});

test('measureCells: มีข้างเดียว อีกข้างเป็นขีด', () => {
  const cells = measureCells({ r_pd: '31', l_pd: null, r_height: '', l_height: '18' }, null);
  assert.equal(cells.PD, '31 / —');
  assert.equal(cells.FH, '— / 18');
});

test('measureCells: ไม่มีทั้งสองข้าง ช่องว่างไว้ให้เขียนมือ', () => {
  const cells = measureCells({ r_pd: '', l_pd: null, r_height: null, l_height: undefined }, null);
  assert.equal(cells.PD, '');
  assert.equal(cells.FH, '');
});

test('measureCells: A / B / ED / DBL มาจากขนาดกรอบที่วัดในขั้น Center', () => {
  const cells = measureCells(null, { frame_box_a: '52.0', frame_box_b: '18.0', ed: '60', dbl: '18' });
  assert.deepEqual(cells, { PD: '', FH: '', A: '52.0', B: '18.0', ED: '60', DBL: '18' });
});

test('measureCells: ขนาดกรอบที่ยังไม่ได้วัด ช่องว่าง', () => {
  const cells = measureCells(null, { frame_box_a: null, frame_box_b: '', ed: undefined, dbl: '18' });
  assert.deepEqual(cells, { ...EMPTY, DBL: '18' });
});

test('measureCells: เคสที่ยังไม่มีการวัดเลย ทุกช่องว่าง', () => {
  assert.deepEqual(measureCells(null, null), EMPTY);
  assert.deepEqual(measureCells(undefined, {}), EMPTY);
});

test('measureCells: ค่า 0 ไม่ถือว่าว่าง', () => {
  assert.equal(measureCells({ r_height: 0, l_height: '0' }, null).FH, '0 / 0');
});
