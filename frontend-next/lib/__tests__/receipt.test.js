import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vatBreakdown, orderReceipt, saleReceipt, linesTotal,
} from '../receipt.js';

test('vatBreakdown: ถอด VAT ออกจากราคาที่รวมแล้ว ไม่ใช่บวกเพิ่ม', () => {
  const b = vatBreakdown(3800);
  assert.equal(b.incl, 3800);
  assert.equal(b.excl, 3551.4);
  assert.equal(b.vat, 248.6);
});

/* สองบรรทัดที่พิมพ์ออกมา (excl, vat) ต้องบวกกันได้ยอดที่สาม (incl) พอดี ไม่ขาดไม่เกิน
   หนึ่งสตางค์ — เทียบเป็นจำนวนสตางค์เต็มเพราะผลบวก float ดิบของเลขที่ปัดแล้ว
   ยังลากหางได้ (93.45 + 6.54 = 99.99000000000001) ซึ่งไม่ใช่สิ่งที่อยู่บนกระดาษ */
test('vatBreakdown: excl + vat ต้องเท่ากับ incl เป๊ะทุกจำนวน ไม่เพี้ยนสตางค์', () => {
  const satang = (v) => Math.round(v * 100);
  for (const total of [1, 99.99, 100, 333.33, 1234.56, 3800, 15250, 999999.99]) {
    const b = vatBreakdown(total);
    assert.equal(satang(b.excl) + satang(b.vat), satang(b.incl), `ยอด ${total} แตก`);
  }
});

/* ออเดอร์แว่นตัวอย่าง — รูปร่างเดียวกับที่ GET /api/orders/:id ส่งกลับมา
   ตัวเลขคัดจาก CASE-2026-00006 ของจริง: กรอบ 3,900 + เลนส์ 2,550 × 2 = 9,000 */
const ORDER = {
  id: 42,
  invoice_code: 'INV-2026-00042',
  case_code: 'CASE-2026-00006',
  order_date: '2026-09-03 11:17:00',
  first_name: 'ธนกร',
  last_name: 'ใจงาม',
  phone: '089-000-2003',
  employee_name: 'Bow',
  lens_type: 'Progressive',
  frame_name: 'Ray-Ban RB2140',
  lens_name: 'Hoya Nulux',
  lens_index: '1.60',
  frame_price: '3900.00',
  lens_od_price: '2550.00',
  lens_os_price: '2550.00',
  options_price: '0.00',
  total_price: '9000.00',
  discount: '0.00',
  prescription: {
    r_sphere: '-1.25', r_cylinder: '-0.50', r_axis: '180', r_add: '+2.00',
    l_sphere: '-1.00', l_cylinder: '', l_axis: '', l_add: '+2.00',
  },
};

/* ใบเก่าที่นำเข้ามาจาก Access — มีแต่ยอดรวม ช่องราคาแยกเป็นศูนย์ทั้งหมด */
const OLD_ORDER = {
  ...ORDER,
  invoice_code: null, case_code: 'OLD-010357',
  frame_price: '0.00', lens_od_price: '0.00', lens_os_price: '0.00', options_price: '0.00',
  total_price: '16000.00',
};

test('orderReceipt: แจกแจงราคากรอบและเลนส์คนละบรรทัด ไม่ยุบเป็นก้อนเดียว', () => {
  const r = orderReceipt(ORDER);
  const priced = r.lines.filter((l) => typeof l.amount === 'number');
  assert.deepEqual(priced.map((l) => [l.desc, l.qty, l.unit, l.amount]), [
    ['Frame : Ray-Ban RB2140', 1, 3900, 3900],
    ['Lens : Hoya Nulux', 2, 2550, 5100],
  ]);
  assert.equal(linesTotal(r.lines), 9000);
  assert.equal(r.total, 9000);
});

test('orderReceipt: บรรทัดหัวแพ็กเกจไม่มีราคา — กันนับซ้ำกับกรอบ/เลนส์ที่อยู่ใต้มัน', () => {
  const head = orderReceipt(ORDER).lines[0];
  assert.equal(head.desc, 'Progressive Glasses');
  assert.equal(head.amount, null);
  assert.equal(head.unit, null);
});

test('orderReceipt: ทุกบรรทัดที่มีราคา ต้องมี จำนวน × ราคาต่อหน่วย = ราคารวม', () => {
  for (const l of orderReceipt(ORDER).lines.filter((x) => typeof x.amount === 'number')) {
    assert.equal(Math.round(l.qty * l.unit * 100), Math.round(l.amount * 100), l.desc);
  }
});

test('orderReceipt: Index ไม่มีช่องราคาในฐาน จึงพิมพ์ขีดกลาง ไม่ใช่ 0.00 ที่ชวนเข้าใจผิด', () => {
  const idx = orderReceipt(ORDER).lines.find((l) => l.desc.startsWith('Index'));
  assert.equal(idx.desc, 'Index : 1.60');
  assert.equal(idx.amount, '—');
  assert.equal(idx.unit, '—');
});

test('orderReceipt: ออพชั่นเสริมขึ้นเป็นบรรทัดของตัวเองพร้อมราคา และพ่วงชื่อที่เลือกไว้', () => {
  const r = orderReceipt({
    ...ORDER, options_price: '1200.00', total_price: '10200.00',
    lens_coating: 'BlueControl', lens_tint: 'Photochromic',
  });
  const opt = r.lines.find((l) => l.desc.startsWith('ออพชั่นเสริม'));
  assert.equal(opt.desc, 'ออพชั่นเสริม (Options / Upgrade) : BlueControl · Photochromic');
  assert.equal(opt.amount, 1200);
  assert.equal(linesTotal(r.lines), 10200);
});

test('orderReceipt: เลนส์สองข้างคนละราคา แยกเป็นสองบรรทัด จำนวนข้างละ 1', () => {
  const r = orderReceipt({
    ...ORDER, lens_name: null,
    lens_r_name: 'Hoya Nulux', lens_l_name: 'Essilor Varilux',
    lens_od_price: '2000.00', lens_os_price: '3100.00',
  });
  const priced = r.lines.filter((l) => typeof l.amount === 'number');
  assert.deepEqual(priced.map((l) => [l.desc, l.qty, l.amount]), [
    ['Frame : Ray-Ban RB2140', 1, 3900],
    ['Lens R : Hoya Nulux', 1, 2000],
    ['Lens L : Essilor Varilux', 1, 3100],
  ]);
  assert.equal(linesTotal(r.lines), 9000);
});

test('orderReceipt: ช่องแยกบวกไม่ถึงยอดรวม ผลต่างต้องโผล่เป็นบรรทัด ไม่ใช่หายไปเงียบ ๆ', () => {
  const r = orderReceipt({ ...ORDER, total_price: '9500.00' });
  const other = r.lines.find((l) => l.desc.startsWith('อื่น ๆ'));
  assert.equal(other.amount, 500);
  assert.equal(linesTotal(r.lines), 9500);
});

test('orderReceipt: ใบเก่าจาก Access ที่ไม่มีราคาแยก ตกไปใช้บรรทัดเดียว ยอดต้องไม่กลายเป็น 0', () => {
  const r = orderReceipt(OLD_ORDER);
  const priced = r.lines.filter((l) => typeof l.amount === 'number');
  assert.equal(priced.length, 1);
  assert.equal(priced[0].desc, 'Progressive Glasses');
  assert.equal(priced[0].amount, 16000);
  assert.equal(linesTotal(r.lines), 16000);
  /* กรอบ/เลนส์ยังต้องขึ้นเป็นสเปกให้อ่านได้ แค่ไม่มีราคาให้แสดง */
  assert.equal(r.lines.find((l) => l.desc.startsWith('Frame')).amount, '—');
});

test('orderReceipt: ค่าสายตาไม่มีราคาและต้องไม่มีขีดกลาง — ไม่ใช่สินค้า', () => {
  const rxRows = orderReceipt(ORDER).lines
    .filter((l) => /^(Prescription|R :|L :|Add :)/.test(l.desc));
  assert.equal(rxRows.length, 4);
  for (const l of rxRows) {
    assert.equal(l.amount, null, l.desc);
    assert.equal(l.unit, null, l.desc);
  }
});

test('orderReceipt: ส่วนลดเป็นบรรทัดติดลบ ผลรวมบรรทัดยังเท่ากับยอดสุทธิ', () => {
  const r = orderReceipt({ ...ORDER, discount: '300.00' });
  const disc = r.lines.find((l) => l.desc.startsWith('ส่วนลด'));
  assert.equal(disc.amount, -300);
  assert.equal(r.total, 8700);
  assert.equal(linesTotal(r.lines), 8700);
});

/* เลขบนใบเป็นของชุด receipts ล้วน ๆ ห้ามหล่นกลับไปหยิบ invoice_code ของออเดอร์มาใช้
   ต่อให้ออเดอร์มีเลขนั้นอยู่ — ไม่งั้นใบที่ออกเลขไม่สำเร็จจะพิมพ์เลขที่ไม่มีในทะเบียน */
test('orderReceipt: เลขที่ใบมาจากชุดเลขใบเสร็จ ไม่ใช่ invoice_code ของออเดอร์', () => {
  assert.equal(orderReceipt(ORDER, 'Bill-2026-09-00042').billNo, 'Bill-2026-09-00042');
  assert.equal(orderReceipt(ORDER).billNo, '');
});


test('orderReceipt: ออเดอร์ที่ยังไม่มีใบสายตา / ไม่มีชื่อกรอบ ก็ยังออกใบได้', () => {
  const r = orderReceipt({ id: 7, total_price: '900.00', discount: '0.00' });
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].desc, 'Glasses');
  assert.equal(r.total, 900);
});

/* ใบขาย POS ตัวอย่าง — รูปร่างเดียวกับ GET /api/pos/sales/:id */
const SALE = {
  id: 9,
  pos_no: 'POS-2026-00009',
  sale_date: '2026-09-04 15:39:00',
  customer_name_snapshot: 'ลูกค้าทั่วไป',
  customer_phone_snapshot: '',
  created_by_name: 'Bow',
  subtotal: '760.00',
  discount_amount: '60.00',
  total_amount: '700.00',
  items: [
    { product_name_snapshot: 'น้ำยาล้างเลนส์', sku_snapshot: 'CL-100', quantity: 2, unit_price: '80.00', line_total: '160.00' },
    { product_name_snapshot: 'กรอบแว่นสำเร็จ', sku_snapshot: null, quantity: 1, unit_price: '600.00', line_total: '600.00' },
  ],
};

test('saleReceipt: แจกแจงทุกแถวสินค้าพร้อมราคาต่อชิ้น', () => {
  const r = saleReceipt(SALE, 'BillP-2026-09-00007');
  assert.equal(r.billNo, 'BillP-2026-09-00007');
  assert.equal(r.lines[0].desc, 'น้ำยาล้างเลนส์ (CL-100)');
  assert.equal(r.lines[0].qty, 2);
  assert.equal(r.lines[0].unit, 80);
  assert.equal(r.lines[0].amount, 160);
  assert.equal(r.lines[1].desc, 'กรอบแว่นสำเร็จ');
});

test('saleReceipt: ส่วนลดทำให้ผลรวมบรรทัดเท่ากับ total_amount ที่ฐานเก็บไว้', () => {
  const r = saleReceipt(SALE);
  assert.equal(r.total, 700);
  assert.equal(linesTotal(r.lines), 700);
});

test('saleReceipt: ใบที่ไม่มีสินค้าเลยก็ไม่พัง', () => {
  const r = saleReceipt({ id: 1, pos_no: 'POS-1', items: [], total_amount: '0.00', discount_amount: '0.00' });
  assert.deepEqual(r.lines, []);
  assert.equal(r.total, 0);
});

test('saleReceipt: เลขที่ใบมาจากชุดเลขใบเสร็จ ไม่ใช่ pos_no', () => {
  assert.equal(saleReceipt(SALE, 'BillP-2026-09-00007').billNo, 'BillP-2026-09-00007');
  assert.equal(saleReceipt(SALE).billNo, '');
});
