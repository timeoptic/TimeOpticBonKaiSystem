import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCatalog, toStockRow, requisitionItems, savedLens } from '../lens/lensSource.js';

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

test('searchCatalog: ค้นหลายคำแบบ AND · Coating ตรงค่า · รุ่นที่ไม่ระบุค่าสายตาผ่านตัวกรอง SPH/CYL', () => {
  assert.deepEqual(searchCatalog([BLUE, PG], 'single blue').map((c) => c.id), [3]);
  assert.deepEqual(searchCatalog([BLUE, PG], 'lens-pg').map((c) => c.id), [8]);
  assert.deepEqual(searchCatalog([BLUE, PG], '', { coating: 'Multicoat' }).map((c) => c.id), [8]);
  assert.equal(searchCatalog([BLUE, PG], '', { sph: '-2.00', cyl: '-0.50' }).length, 2);
});

test('searchCatalog: รายชื่อเดิมที่แยกตามค่าสายตา — SPH/CYL เทียบตรงค่า (-2 = -2.00)', () => {
  const rows = [
    { id: 1, lens_name: 'G Auto (1.50) -2.00/-0.50', coating: 'Auto', sph: '-2.00', cyl: '-0.50' },
    { id: 2, lens_name: 'G Auto (1.50) -2.00/0.00', coating: 'Auto', sph: '-2.00', cyl: '0.00' },
    { id: 3, lens_name: 'G Auto (1.50) +0.50/0.00', coating: 'Auto', sph: '0.50', cyl: '0.00' },
  ];
  assert.deepEqual(searchCatalog(rows, '', { sph: '-2', cyl: '-0.50' }).map((r) => r.id), [1]);
  assert.deepEqual(searchCatalog(rows, '', { sph: '-2.00' }).map((r) => r.id), [1, 2]);
  assert.deepEqual(searchCatalog(rows, '', { cyl: '0' }).map((r) => r.id), [2, 3]);
  const r = toStockRow({ ...rows[0], code: 'LNS-1', add_power: '+2.00', selling_price: 0 });
  assert.deepEqual([r.sph, r.cyl, r.add, r.product_price], ['-2.00', '-0.50', '+2.00', 0]);
});

test('searchCatalog: ชื่อย่อ Coating ของตัวกรองเดิม (MC / Hard / Auto / Auto-Blue) ตรงกับชื่อเต็มในรายการ', () => {
  const rows = [
    { id: 1, lens_name: 'a', coating: 'Hard Coat' },
    { id: 2, lens_name: 'b', coating: 'Multicoat' },
    { id: 3, lens_name: 'c', coating: 'Photochromic' },
    { id: 4, lens_name: 'd', coating: 'Auto Blue' },
    { id: 5, lens_name: 'e', coating: 'Blue' },
  ];
  const ids = (c) => searchCatalog(rows, '', { coating: c }).map((r) => r.id);
  assert.deepEqual(ids('Hard'), [1]);
  assert.deepEqual(ids('MC'), [2]);
  assert.deepEqual(ids('Auto'), [3]);
  assert.deepEqual(ids('Auto-Blue'), [4]);
  assert.deepEqual(ids('Blue'), [5]);
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

/* เปิดออเดอร์เก่ามาแก้แล้วช่องเลนส์ว่างทั้งที่เลือกไว้แล้ว (ร้านเจอ 26 ก.ย. 2026 เคส 002–004) */
test('savedLens: ออเดอร์ที่เลือกจากรายการ เปิดกลับมาได้แถวเดิมพร้อมใช้กับการ์ดเลนส์', () => {
  const r = savedLens(null, BLUE, 'catalog');
  assert.equal(r.catalog, true);
  assert.equal(r.lens_catalog_id, 3);
  assert.equal(r.product_name, 'Single Vision 1.56 Blue Cut');
});

test('savedLens: ล็อตจากคลังชนะเสมอ · ไม่มีอะไรเลยได้ null', () => {
  const lot = { id: 99, sku: 'STOCK' };
  assert.equal(savedLens(lot, BLUE, 'catalog'), lot);
  assert.equal(savedLens(null, null, 'catalog'), null);
});

test('savedLens: ฝั่งสต็อก (TimeOptic) ไม่หยิบรายการเลนส์มาใช้', () => {
  assert.equal(savedLens(null, BLUE, 'stock'), null);
});
