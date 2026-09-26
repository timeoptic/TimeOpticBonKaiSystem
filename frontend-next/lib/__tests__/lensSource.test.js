import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogOptions, toStockRow, requisitionItems } from '../lens/lensSource.js';

const BLUE = {
  id: 3, code: 'LENS-SV156-BLUE', lens_name: 'Single Vision 1.56 Blue Cut', lens_type: 'Single Vision',
  lens_index: '1.56', coating: 'Blue', brand: null, selling_price: 1500, sort_order: 30,
};
const PG = {
  id: 8, code: 'LENS-PG-MC', lens_name: 'Progressive', lens_type: 'Progressive',
  lens_index: '1.56', coating: 'Multicoat', brand: null, selling_price: 3500, sort_order: 80,
};

test('toStockRow: ไม่ผูกล็อต ราคาข้างละครึ่งคู่ และจำ id ของรายการเลนส์', () => {
  const r = toStockRow(BLUE);
  assert.equal(r.id, null);
  assert.equal(r.catalog, true);
  assert.equal(r.lens_catalog_id, 3);
  assert.equal(r.sku, 'LENS-SV156-BLUE');
  assert.equal(r.product_name, 'Single Vision 1.56 Blue Cut');
  assert.equal(r.product_price, 750);
  assert.equal(r.pair_price, 1500);
  assert.equal(r.lens_index, '1.56');
  assert.equal(r.coating, 'Blue');
});

test('catalogOptions: จัดกลุ่มตามชนิด บรรทัดรองมี Index Coating และราคาคู่', () => {
  const opts = catalogOptions([BLUE, PG]);
  assert.deepEqual(opts.map((o) => o[2].group), ['Progressive', 'Single Vision']);
  const blue = opts.find((o) => o[0] === '3');
  assert.equal(blue[1], 'Single Vision 1.56 Blue Cut');
  assert.match(blue[2].hint, /1\.56 · Blue · 1,500 บาท\/คู่/);
  assert.match(blue[2].keywords, /LENS-SV156-BLUE/);
});

test('requisitionItems: สองข้างรุ่นเดียวกัน = 1 คู่ ราคารวมสองข้าง', () => {
  const r = toStockRow(BLUE);
  const out = requisitionItems({ lensOd: r, lensOs: r }, { lens_od_price: 750, lens_os_price: 800 });
  assert.equal(out.length, 1);
  assert.equal(out[0].eye, 'pair');
  assert.equal(out[0].lens_catalog_id, 3);
  assert.equal(out[0].unit_price, 1550);
  assert.equal(out[0].quantity, 1);
});

test('requisitionItems: คนละรุ่นแยกข้าง · ข้างที่ไม่ได้มาจากรายการเลนส์ไม่ส่ง', () => {
  const out = requisitionItems(
    { lensOd: toStockRow(BLUE), lensOs: toStockRow(PG) },
    { lens_od_price: 750, lens_os_price: 1750 },
  );
  assert.deepEqual(out.map((x) => [x.eye, x.lens_catalog_id, x.unit_price]), [['R', 3, 750], ['L', 8, 1750]]);
  const one = requisitionItems({ lensOd: { id: 12, sku: 'STOCK' }, lensOs: toStockRow(PG) }, { lens_os_price: 1750 });
  assert.deepEqual(one.map((x) => x.eye), ['L']);
});

test('requisitionItems: ยังไม่มีใครแตะตัวเลือก (undefined) ไม่ส่งอะไร', () => {
  assert.deepEqual(requisitionItems(undefined, {}), []);
});
