import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vatBreakdown, orderReceipt, saleReceipt, linesTotal, hasRx, withoutRx, hasLensSides, splitLens,
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
    ['Lens', 1, 5100, 5100],
  ]);
  assert.equal(linesTotal(r.lines), 9000);
  assert.equal(r.total, 9000);
});

/* ค่าเลนส์อยู่ที่บรรทัดแม่บรรทัดเดียว สองข้างที่ห้อยอยู่ใต้มันเป็นแค่ชื่อรุ่น
   ถ้าข้างใดข้างหนึ่งมีราคาขึ้นมาด้วย ยอดของใบจะถูกนับซ้ำทันที */
test('orderReceipt: Lens R / Lens L ห้อยใต้บรรทัด Lens เป็นรายละเอียด ไม่มีราคาซ้ำ', () => {
  const r = orderReceipt(ORDER);
  const sides = r.lines.filter((l) => /^Lens [RL] :/.test(l.desc));
  assert.deepEqual(sides.map((l) => l.desc), [
    'Lens R : Hoya Nulux',
    'Lens L : Hoya Nulux',
  ]);
  for (const l of sides) {
    assert.equal(l.amount, null, l.desc);
    assert.equal(l.unit, null, l.desc);
    assert.equal(l.qty, null, l.desc);
    /* ย่อหน้าลึกกว่าบรรทัด Lens หนึ่งขั้น — ไม่งั้นอ่านเหมือนสินค้าที่ลืมใส่ราคา */
    assert.equal(l.indent, 2, l.desc);
  }
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

/* Index ไม่มีช่องราคาในฐาน ราคาส่วนเพิ่มไปรวมอยู่ที่ก้อนออพชั่นแล้ว — ช่องราคาจึงเว้นว่าง
   ไม่ใช่ 0.00 ที่ชวนเข้าใจผิด และไม่ใช่ขีดกลางที่กลายเป็นรอยเปื้อนบนตารางที่ตีเส้นอยู่แล้ว */
test('orderReceipt: Index ไม่มีช่องราคาในฐาน ช่องราคาจึงเว้นว่าง ไม่มีทั้ง 0.00 และขีดกลาง', () => {
  const idx = orderReceipt(ORDER).lines.find((l) => l.desc.startsWith('Index'));
  assert.equal(idx.desc, 'Index : 1.60');
  assert.equal(idx.amount, null);
  assert.equal(idx.unit, null);
  assert.equal(idx.qty, null);
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

/* สองข้างคนละรุ่นคนละราคาก็ยังเป็นบรรทัดเดียว จำนวน 1 ราคาต่อหน่วยเท่ากับราคารวม —
   "หนึ่งหน่วย" บนบรรทัดนี้คือค่าเลนส์ของแว่นคู่นี้ ไม่ใช่เลนส์หนึ่งชิ้น */
test('orderReceipt: เลนส์สองข้างคนละราคา รวมเป็นบรรทัดเดียว จำนวน 1 ราคาต่อหน่วย = ราคารวม', () => {
  const r = orderReceipt({
    ...ORDER, lens_name: null,
    lens_r_name: 'Hoya Nulux', lens_l_name: 'Essilor Varilux',
    lens_od_price: '2000.00', lens_os_price: '3100.00',
  });
  const priced = r.lines.filter((l) => typeof l.amount === 'number');
  assert.deepEqual(priced.map((l) => [l.desc, l.qty, l.unit, l.amount]), [
    ['Frame : Ray-Ban RB2140', 1, 3900, 3900],
    ['Lens', 1, 5100, 5100],
  ]);
  assert.deepEqual(
    r.lines.filter((l) => /^Lens [RL] :/.test(l.desc)).map((l) => l.desc),
    ['Lens R : Hoya Nulux', 'Lens L : Essilor Varilux'],
  );
  assert.equal(linesTotal(r.lines), 9000);
});

/* เลนส์ข้างเดียว — เกิดกับใบที่กรอกราคาไว้ข้างเดียวและไม่ได้กรอกชื่อรุ่น (ชื่อรุ่นชื่อเดียว
   ถือว่าเป็นของทั้งคู่ ดู lensLabels) ห้อยข้างเดียวตามข้อมูลที่มี ส่วนบรรทัดแม่ยังเป็น
   จำนวน 1 ราคาต่อหน่วยเท่ากับราคารวมเหมือนทุกใบ */
test('orderReceipt: มีราคาเลนส์ข้างเดียว บรรทัด Lens ถือราคาข้างเดียว และห้อยข้างเดียว', () => {
  const r = orderReceipt({
    ...ORDER, lens_name: null, lens_r_name: null, lens_l_name: null,
    lens_od_price: '2550.00', lens_os_price: '0.00', total_price: '6450.00',
  });
  const lens = r.lines.find((l) => l.desc === 'Lens');
  assert.deepEqual([lens.qty, lens.unit, lens.amount], [1, 2550, 2550]);
  assert.deepEqual(
    r.lines.filter((l) => /^Lens [RL] :/.test(l.desc)).map((l) => l.desc),
    ['Lens R : —'],
  );
  assert.equal(linesTotal(r.lines), 6450);
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
  /* กรอบ/เลนส์ยังต้องขึ้นเป็นสเปกให้อ่านได้ แค่ช่องราคาเว้นว่างเพราะแยกราคาไม่ได้ */
  assert.equal(r.lines.find((l) => l.desc.startsWith('Frame')).amount, null);
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

/* ปุ่ม "โชว์ค่าสายตา / ไม่โชว์" บนหน้าพิมพ์กรองด้วยธง rx ตัวนี้ ไม่ได้อ่านจากข้อความ —
   ถ้าธงหลุดจากบรรทัดไหน บรรทัดนั้นจะค้างอยู่บนใบที่พนักงานสั่งว่าไม่ให้โชว์ */
test('orderReceipt: บรรทัดค่าสายตาต้องติดธง rx และมีเฉพาะบรรทัดค่าสายตาเท่านั้น', () => {
  const lines = orderReceipt(ORDER).lines;
  const flagged = lines.filter((l) => l.rx).map((l) => l.desc);
  assert.deepEqual(flagged, ['Prescription', 'R : -1.25 / -0.50 x 180', 'L : -1.00', 'Add : +2.00 / +2.00']);
});

test('withoutRx: ซ่อนค่าสายตาแล้วบรรทัดอื่นและยอดต้องเหมือนเดิมเป๊ะ', () => {
  const full = orderReceipt(ORDER, 'Bill-1');
  const hidden = withoutRx(full);
  assert.equal(hidden.lines.some((l) => l.rx), false);
  assert.deepEqual(
    hidden.lines.map((l) => l.desc),
    full.lines.filter((l) => !l.rx).map((l) => l.desc),
  );
  assert.equal(hidden.total, full.total);
  assert.equal(linesTotal(hidden.lines), linesTotal(full.lines));
  assert.equal(hidden.billNo, full.billNo);
});

/* ปุ่มขึ้นเฉพาะใบที่มีอะไรให้ซ่อน — ใบขาย POS ไม่มีค่าสายตา กดแล้วต้องไม่มีอะไรเกิดขึ้น */
test('hasRx: ใบออเดอร์แว่นมีค่าสายตา ใบขาย POS ไม่มี', () => {
  assert.equal(hasRx(orderReceipt(ORDER)), true);
  assert.equal(hasRx(orderReceipt({ id: 7, total_price: '900.00', discount: '0.00' })), false);
  assert.equal(hasRx(saleReceipt(SALE)), false);
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

/* ────────────────────────────────────────────────────────────────────────────
   ใบนี้เป็นของลูกค้าคนไหน

   ชื่อบนบล็อกลูกค้าของใบเสร็จไม่ใช่ชื่อคนที่มาตัดแว่นเสมอไป — เคสเป็นของพ่อ
   แต่ลูกเป็นคนออกบิล หน้าใบเสร็จจึงต้องรู้ id ของ "ลูกค้าในเคส" เพื่อไปหยิบนาม
   ที่เคยออกใบให้คนนี้มาเติมให้ (GET /api/bill-parties?customer_id=)

   ค่านี้มากับ payload อยู่แล้วทั้งสองทาง (custom_orders.customer_id · pos_sales.customer_id)
   แต่เดิม orderReceipt/saleReceipt ตัดทิ้งไปเพราะใบพิมพ์ไม่ได้ใช้
   ──────────────────────────────────────────────────────────────────────────── */

test('orderReceipt: พา customer_id ของออเดอร์ติดมากับใบ', () => {
  assert.equal(orderReceipt({ ...ORDER, customer_id: 7 }).customerId, 7);
});

test('saleReceipt: พา customer_id ของใบขายติดมากับใบ', () => {
  assert.equal(saleReceipt({ ...SALE, customer_id: 12 }).customerId, 12);
});

/* ขายหน้าร้านให้คนเดินเข้ามาโดยไม่ได้เปิดใบลูกค้า — ต้องเป็น null ไม่ใช่ 0 หรือ
   undefined เพราะหน้าใบเสร็จใช้ค่านี้ตัดสินว่าจะยิงถามนามที่เคยใช้หรือไม่ */
test('saleReceipt: ใบขายที่ไม่ได้ผูกลูกค้า customerId เป็น null', () => {
  assert.equal(saleReceipt(SALE).customerId, null);
});

/* ปุ่ม "ราคาเลนส์รวม / แยกข้าง R / L" — แยกแล้วราคาต้องเป็นของจริงรายข้าง ไม่ใช่หารครึ่ง
   และยอดท้ายใบต้องเท่าเดิมเป๊ะ */
test('splitLens: ย้ายค่าเลนส์ลง Lens R / Lens L ตามราคาจริงแต่ละข้าง ยอดไม่ขยับ', () => {
  const full = orderReceipt({
    ...ORDER, lens_od_price: '2000.00', lens_os_price: '2550.00', total_price: '8450.00',
  }, 'Bill-1');
  const split = splitLens(full);
  const priced = split.lines.filter((l) => typeof l.amount === 'number');
  assert.deepEqual(priced.map((l) => [l.desc, l.qty, l.unit, l.amount]), [
    ['Frame : Ray-Ban RB2140', 1, 3900, 3900],
    ['Lens R : Hoya Nulux', 1, 2000, 2000],
    ['Lens L : Hoya Nulux', 1, 2550, 2550],
  ]);
  const lensHead = split.lines.find((l) => l.desc === 'Lens');
  assert.equal(lensHead.amount, null);
  assert.equal(lensHead.qty, null);
  assert.deepEqual(split.lines.map((l) => l.desc), full.lines.map((l) => l.desc));
  assert.equal(linesTotal(split.lines), linesTotal(full.lines));
  assert.equal(split.total, full.total);
});

test('splitLens: ใช้ร่วมกับ withoutRx ได้ ค่าสายตาหายแต่ราคารายข้างยังอยู่', () => {
  const r = withoutRx(splitLens(orderReceipt(ORDER)));
  assert.equal(r.lines.some((l) => l.rx), false);
  assert.equal(r.lines.find((l) => l.desc === 'Lens R : Hoya Nulux').amount, 2550);
});

test('hasLensSides: ขึ้นปุ่มเฉพาะใบที่มีเลนส์ครบสองข้าง', () => {
  assert.equal(hasLensSides(orderReceipt(ORDER)), true);
  assert.equal(hasLensSides(orderReceipt({
    ...ORDER, lens_name: '', lens_r_name: 'Hoya Nulux', lens_os_price: '0.00', total_price: '6450.00',
  })), false);
  assert.equal(hasLensSides(orderReceipt(OLD_ORDER)), false);
  assert.equal(hasLensSides(saleReceipt(SALE)), false);
});
