import test from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_LENSES } from '../lens/mockLenses.js';
import { searchMockLenses, toStockRow, requisitionItems } from '../lens/lensSource.js';

test('mock lenses: มาจากรายชื่อเลนส์ของเว็บหลัก ชื่อไม่ซ้ำ และไม่มี NO LENS', () => {
  assert.ok(MOCK_LENSES.length > 1000);
  const names = MOCK_LENSES.map((l) => l.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(!names.includes('NO LENS'));
});

test('toStockRow: ไม่ผูกล็อต ชื่อตรงกับเว็บหลัก และแยกรุ่นออกจากชื่อ', () => {
  const l = MOCK_LENSES.find((x) => x.name.startsWith('Crystal FT Auto Bifocal'));
  const r = toStockRow(l);
  assert.equal(r.id, null);
  assert.equal(r.mock, true);
  assert.equal(r.product_name, l.name);
  assert.equal(r.model, 'FT Auto Bifocal');
  assert.equal(r.lens_design, 'Bifocal');
});

test('searchMockLenses: ค้นหลายคำแบบ AND', () => {
  const rows = searchMockLenses('hoya sl blue');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.product_name.startsWith('HOYA SL Blue')));
});

test('searchMockLenses: Coating / SPH / CYL เทียบตรงค่าแบบตัวกรองของคลัง', () => {
  const rows = searchMockLenses('', { coating: 'Blue', sph: '-2.00', cyl: '-0.50' });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.coating === 'Blue' && Number(r.sph) === -2 && Number(r.cyl) === -0.5));
  assert.ok(searchMockLenses('', { sph: '0.00', cyl: '0.00' }).every((r) => Number(r.sph) === 0 && Number(r.cyl) === 0));
});

test('requisitionItems: เฉพาะข้างที่เป็นเลนส์จำลอง พร้อมราคาของข้างนั้น', () => {
  const mock = toStockRow(MOCK_LENSES.find((x) => x.name.startsWith('HOYA SL Blue')));
  const items = requisitionItems(
    { lensOd: mock, lensOs: { id: 5, sku: 'LNS-1' } },
    { lens_od_price: 1500, lens_os_price: 900 },
  );
  assert.equal(items.length, 1);
  assert.deepEqual(
    [items[0].eye, items[0].unit_price, items[0].source, items[0].brand, items[0].design],
    ['R', 1500, 'MOCK', 'HOYA', 'SL Blue'],
  );
  assert.deepEqual(requisitionItems(undefined, {}), []);
});
