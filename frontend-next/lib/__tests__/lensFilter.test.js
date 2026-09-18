import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_LENS, parsePower, formatPower, lensParams, toggleLens,
} from '../lensFilter.js';

/* ตัวกรองเลนส์หน้าขาย — ค่าที่พนักงานพิมพ์ต้องกลายเป็นค่าเดียวที่ฝั่ง API เทียบตรงตัว
   ฝั่ง API เทียบเป็นตัวเลข (api/tests/13-stock-lens-filter.test.php) ที่นี่แค่อ่านช่อง */

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

test('query ส่งเฉพาะช่องที่เลือก · หลายชิปในช่องเดียวคั่นด้วย |', () => {
  assert.deepEqual(lensParams(EMPTY_LENS), {});
  assert.deepEqual(
    lensParams({ ...EMPTY_LENS, index: ['1.56', '1.60'], coating: ['Auto-Blue'], sphFrom: '-2.00', cylTo: '0.00' }),
    { index: '1.56|1.60', coating: 'Auto-Blue', sph_from: '-2.00', cyl_to: '0.00' },
  );
});

test('กดชิปซ้ำ = เอาออก · ชิปอื่นในช่องเดียวกันยังอยู่', () => {
  const one = toggleLens(EMPTY_LENS, 'index', '1.56');
  const two = toggleLens(one, 'index', '1.60');
  assert.deepEqual(two.index, ['1.56', '1.60']);
  assert.deepEqual(toggleLens(two, 'index', '1.56').index, ['1.60']);
  assert.deepEqual(EMPTY_LENS.index, [], 'สถานะตั้งต้นไม่ถูกแก้');
});
