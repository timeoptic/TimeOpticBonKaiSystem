import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LENS_COATINGS, parsePower, formatPower, lensQuery, lensChips,
} from '../lensFilter.js';

/* ตัวกรองเลนส์หน้าขาย — ค่าที่พนักงานพิมพ์ต้องกลายเป็นค่าเดียวที่ฝั่ง API เทียบตรงตัว
   ฝั่ง API เทียบเป็นตัวเลข (api/tests/13-stock-lens-filter.test.php) ที่นี่แค่อ่านช่อง */

test('ตัวเลือก Coating ตรงกับค่าที่มีในคลังจริง', () => {
  assert.deepEqual(LENS_COATINGS, ['Hard', 'MC', 'Auto', 'Blue', 'Auto-Blue']);
});

test('ค่าสายตา: บวก ลบ ทศนิยม · -2 = -2.00 · 0.25 = +0.25', () => {
  assert.deepEqual(parsePower('+0.25'), { value: '0.25', error: false });
  assert.deepEqual(parsePower('0.25'), { value: '0.25', error: false });
  assert.deepEqual(parsePower('-0.25'), { value: '-0.25', error: false });
  assert.deepEqual(parsePower('-1.00'), { value: '-1.00', error: false });
  assert.deepEqual(parsePower('-2'), { value: '-2.00', error: false });
  assert.deepEqual(parsePower('-2.5'), { value: '-2.50', error: false });
  assert.deepEqual(parsePower('.75'), { value: '0.75', error: false });
  assert.deepEqual(parsePower('0'), { value: '0.00', error: false });
  assert.deepEqual(parsePower('-0'), { value: '0.00', error: false });
});

test('ลบแบบ iPad (−) กับจุลภาคทศนิยม อ่านได้', () => {
  assert.deepEqual(parsePower('−0.75'), { value: '-0.75', error: false });
  assert.deepEqual(parsePower('-0,75'), { value: '-0.75', error: false });
});

test('ช่องว่าง = ไม่ใช้เป็นเงื่อนไข · พิมพ์ไม่ใช่ตัวเลข = ผิด ไม่ถูกมองข้าม', () => {
  assert.deepEqual(parsePower(''), { value: null, error: false });
  assert.deepEqual(parsePower('   '), { value: null, error: false });
  assert.deepEqual(parsePower(null), { value: null, error: false });
  for (const bad of ['-', '+', '.', 'abc', '1.2.3', '-0.255', '123', '--1']) {
    assert.equal(parsePower(bad).error, true, bad);
    assert.equal(parsePower(bad).value, null, bad);
  }
});

test('แสดงค่าสายตาแบบใบสั่ง: มีเครื่องหมาย ทศนิยมสองตำแหน่ง ศูนย์ไม่มีเครื่องหมาย', () => {
  assert.equal(formatPower('0.25'), '+0.25');
  assert.equal(formatPower('-2.00'), '-2.00');
  assert.equal(formatPower('0.00'), '0.00');
});

test('query ส่งเฉพาะช่องที่กรอก · ทั้งหมด = ไม่ส่ง coating', () => {
  assert.deepEqual(
    lensQuery({ coating: 'Auto', sph: '+0.25', cyl: '-0.75' }),
    { params: { coating: 'Auto', sph: '0.25', cyl: '-0.75' }, invalid: [], active: true },
  );
  assert.deepEqual(
    lensQuery({ coating: 'Auto', sph: '+0.25', cyl: '' }),
    { params: { coating: 'Auto', sph: '0.25' }, invalid: [], active: true },
  );
  assert.deepEqual(
    lensQuery({ coating: '', sph: '', cyl: '' }),
    { params: {}, invalid: [], active: false },
  );
});

test('ช่องที่ผิดถูกบอกออกมา — หน้าจอต้องไม่ค้นด้วยเงื่อนไขครึ่งเดียว', () => {
  const r = lensQuery({ coating: 'Auto', sph: '-', cyl: '-0.75' });
  assert.deepEqual(r.invalid, ['sph']);
});

test('ชิปตัวกรอง เรียง Coating → SPH → CYL', () => {
  assert.deepEqual(
    lensChips({ coating: 'Auto-Blue', sph: '-2', cyl: '-0.75' }),
    [
      { key: 'coating', label: 'Coating: Auto-Blue' },
      { key: 'sph', label: 'SPH: -2.00' },
      { key: 'cyl', label: 'CYL: -0.75' },
    ],
  );
  assert.deepEqual(lensChips({ coating: '', sph: 'x', cyl: '' }), []);
});
