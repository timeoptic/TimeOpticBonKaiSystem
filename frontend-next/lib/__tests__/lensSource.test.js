import test from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_LENSES } from '../lens/mockLenses.js';
import { searchMockLenses, toStockRow, requisitionItems } from '../lens/lensSource.js';

test('mock lenses: รหัสไม่ซ้ำ และทุกตัวมีราคาต่อคู่', () => {
  const codes = MOCK_LENSES.map((l) => l.mock_code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(MOCK_LENSES.every((l) => l.price_pair > 0));
});

test('toStockRow: ไม่ผูกล็อต และราคาข้างละครึ่งคู่', () => {
  const r = toStockRow(MOCK_LENSES[0]);
  assert.equal(r.id, null);
  assert.equal(r.mock, true);
  assert.equal(r.product_price * 2, MOCK_LENSES[0].price_pair);
  assert.equal(r.lens_design, MOCK_LENSES[0].design);
});

test('searchMockLenses: ค้นหลายคำแบบ AND', () => {
  const rows = searchMockLenses('hoya 1.60');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.brand === 'HOYA' && r.lens_index === '1.60'));
});

test('searchMockLenses: ตัวกรอง Coating ของหน้าเดิม — Auto = ปรับแสง, Blue = ตัดแสงฟ้า', () => {
  const auto = searchMockLenses('', { coating: 'Auto' });
  const blue = searchMockLenses('', { coating: 'Blue' });
  assert.ok(auto.length > 0 && auto.every((r) => r.photochromic));
  assert.ok(blue.length > 0 && blue.every((r) => /blue|guard|cut/i.test(r.option)));
});

test('requisitionItems: เฉพาะข้างที่เป็นเลนส์จำลอง พร้อมราคาของข้างนั้น', () => {
  const mock = toStockRow(MOCK_LENSES[0]);
  const items = requisitionItems(
    { lensOd: mock, lensOs: { id: 5, sku: 'LNS-1' } },
    { lens_od_price: 1500, lens_os_price: 900 },
  );
  assert.equal(items.length, 1);
  assert.deepEqual(
    [items[0].eye, items[0].unit_price, items[0].source, items[0].design],
    ['R', 1500, 'MOCK', MOCK_LENSES[0].design],
  );
  assert.deepEqual(requisitionItems(undefined, {}), []);
});
