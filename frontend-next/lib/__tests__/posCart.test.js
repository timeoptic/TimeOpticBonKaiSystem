// frontend-next/lib/__tests__/posCart.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addItem, removeItem, setQty, bumpQty, setPrice, setMeta, setCustomName,
  lineTotal, totals, changeFor, paymentStatus, validateCart, validatePayment,
  toItemsPayload, round2, isContactLens, hiddenFromOther,
} from '../pos/cart.js';

const spray = { id: 1, sku: 'CLN-0005', name: 'สเปรย์ Hitop 60 ml', base_selling_price: 120, pos_fields: [] };
const lens = {
  id: 2, sku: 'CTM-0004', name: 'Maxim color', base_selling_price: 900,
  pos_fields: [
    { key: 'power', label: 'ค่าสายตา', required: true },
    { key: 'color', label: 'สี', required: true },
  ],
};
const other = { id: 3, sku: 'CST-0001', name: 'อื่นๆ (พิมพ์เอง)', base_selling_price: 0, pos_custom: true, pos_fields: [] };

test('addItem: ใช้ราคาจากแคตตาล็อกเป็นค่าตั้งต้น', () => {
  const c = addItem([], spray);
  assert.equal(c.length, 1);
  assert.equal(c[0].unit_price, 120);
  assert.equal(c[0].quantity, 1);
  assert.equal(c[0].sku, 'CLN-0005');
});

test('addItem: สินค้าเดิม ราคาเดิม meta เดิม -> บวกจำนวนในแถวเดิม', () => {
  let c = addItem([], spray);
  c = addItem(c, spray);
  assert.equal(c.length, 1);
  assert.equal(c[0].quantity, 2);
});

test('addItem: ราคาต่างกัน -> แยกแถว (ลดราคาให้ชิ้นเดียว)', () => {
  let c = addItem([], spray);
  c = addItem(c, spray, { price: 100 });
  assert.equal(c.length, 2);
});

test('addItem: dynamic field ต่างกัน -> แยกแถว', () => {
  let c = addItem([], lens, { meta: { power: '-2.00', color: 'Gray' } });
  c = addItem(c, lens, { meta: { power: '-3.00', color: 'Gray' } });
  assert.equal(c.length, 2);
  c = addItem(c, lens, { meta: { power: '-2.00', color: 'Gray' } });
  assert.equal(c.length, 2, 'ชุดที่ซ้ำต้องรวมกลับแถวเดิม');
  assert.equal(c[0].quantity, 2);
});

test('addItem: สินค้า custom แยกแถวเสมอ', () => {
  let c = addItem([], other);
  c = addItem(c, other);
  assert.equal(c.length, 2);
});

test('setQty / bumpQty: ต่ำกว่า 1 ไม่ได้', () => {
  let c = addItem([], spray);
  const k = c[0].key;
  c = setQty(c, k, 5);
  assert.equal(c[0].quantity, 5);
  c = setQty(c, k, 0);
  assert.equal(c[0].quantity, 1);
  c = bumpQty(c, k, -3);
  assert.equal(c[0].quantity, 1);
  c = bumpQty(c, k, 2);
  assert.equal(c[0].quantity, 3);
});

test('setQty: ทศนิยมถูกตัดเป็นจำนวนเต็ม', () => {
  let c = addItem([], spray);
  c = setQty(c, c[0].key, 2.9);
  assert.equal(c[0].quantity, 2);
});

test('setPrice: 0 ได้ (ของแถม) แต่ติดลบไม่ได้', () => {
  let c = addItem([], spray);
  c = setPrice(c, c[0].key, 0);
  assert.equal(c[0].unit_price, 0);
  c = setPrice(c, c[0].key, -50);
  assert.equal(c[0].unit_price, 0);
});

test('removeItem: ลบเฉพาะแถวที่ระบุ', () => {
  let c = addItem(addItem([], spray), lens, { meta: { power: '-1' } });
  c = removeItem(c, c[0].key);
  assert.equal(c.length, 1);
  assert.equal(c[0].sku, 'CTM-0004');
});

test('lineTotal / totals: จำนวน x ราคา แล้วรวมทั้งใบ', () => {
  let c = addItem([], spray, { quantity: 2 });
  c = addItem(c, lens, { price: 900, meta: { power: '-2.00', color: 'Gray' } });
  assert.equal(lineTotal(c[0]), 240);
  const t = totals(c);
  assert.equal(t.subtotal, 1140);
  assert.equal(t.total, 1140);
  assert.equal(t.itemCount, 2);
  assert.equal(t.unitCount, 3);
});

test('totals: ส่วนลดหักได้ และหักเกินยอดสินค้าไม่ได้', () => {
  const c = addItem([], spray, { quantity: 2 });
  assert.equal(totals(c, 40).total, 200);
  assert.equal(totals(c, 9999).total, 0);
});

test('round2: เศษจากการคูณไม่ลอย', () => {
  assert.equal(round2(0.1 * 3), 0.3);
  const c = addItem([], { ...spray, base_selling_price: 33.33 }, { quantity: 3 });
  assert.equal(totals(c).subtotal, 99.99);
});

test('changeFor: ทอนตามจริง และไม่ติดลบ', () => {
  assert.equal(changeFor(1500, 1140), 360);
  assert.equal(changeFor(1000, 1140), 0);
  assert.equal(changeFor('', 100), 0);
});

test('paymentStatus: ครบ / บางส่วน / ยังไม่จ่าย และใบยอด 0', () => {
  assert.equal(paymentStatus(1000, 1000), 'paid');
  assert.equal(paymentStatus(1000, 500), 'partial');
  assert.equal(paymentStatus(1000, 0), 'unpaid');
  assert.equal(paymentStatus(0, 0), 'paid');
});

test('validateCart: ตะกร้าว่าง', () => {
  const e = validateCart([]);
  assert.equal(e.length, 1);
  assert.match(e[0].message, /ยังไม่มีสินค้า/);
});

test('validateCart: dynamic field ที่บังคับต้องครบ', () => {
  let c = addItem([], lens, { meta: { power: '-2.00' } });
  let e = validateCart(c);
  assert.equal(e.length, 1);
  assert.match(e[0].message, /สี/);
  c = setMeta(c, c[0].key, 'color', 'Gray');
  assert.deepEqual(validateCart(c), []);
});

test('validateCart: สินค้า custom ต้องมีชื่อ', () => {
  let c = addItem([], other);
  assert.match(validateCart(c)[0].message, /ต้องพิมพ์ชื่อสินค้า/);
  c = setCustomName(c, c[0].key, 'ค่าเปลี่ยนขาแว่น');
  assert.deepEqual(validateCart(c), []);
});

/* คอนแทคเลนส์ขายแยกข้างได้ ช่อง "ข้าง" จึงเป็นช่องแบบตัวเลือก ไม่ใช่ช่องพิมพ์อิสระ
   รูปแบบเดียวกับที่ pos_items.pos_fields เก็บจริงตั้งแต่ 16 ก.ย. 2026 */
const ctl = {
  id: 32,
  sku: 'CTA-0009',
  name: 'Acuvue 2',
  base_selling_price: 800,
  pos_fields: [
    {
      key: 'eye',
      label: 'ข้าง',
      type: 'choice',
      required: true,
      options: [['R', 'ขวา (R)'], ['L', 'ซ้าย (L)'], ['RL', 'ทั้งสองข้าง']],
    },
    { key: 'power', label: 'ค่าสายตา', required: true },
  ],
};

/**
 * ค่านอกรายการต้องไม่ผ่าน
 *
 * "ว่างหรือไม่ว่าง" ไม่พอสำหรับช่องแบบตัวเลือก — ค่าที่ไม่ใช่ R/L/RL แปลว่าไม่มีใคร
 * รู้ว่าลูกค้าได้กล่องข้างไหน ซึ่งเป็นสิ่งเดียวที่ช่องนี้มีไว้ตอบ · ด่านจริงอยู่ฝั่ง
 * server เสมอ ฝั่งนี้มีไว้บอกพนักงานทันทีโดยไม่ต้องรอ 400 กลับมา
 */
test('validateCart: ช่องตัวเลือก ค่าที่ไม่อยู่ในรายการไม่ผ่าน', () => {
  const c = addItem([], ctl, { meta: { eye: 'X', power: '-2.00' } });
  const e = validateCart(c);
  assert.equal(e.length, 1);
  assert.match(e[0].message, /ข้าง/);
});

test('validateCart: ช่องตัวเลือก ค่าที่อยู่ในรายการผ่าน', () => {
  const c = addItem([], ctl, { meta: { eye: 'RL', power: '-2.00' } });
  assert.deepEqual(validateCart(c), []);
});

/* ช่องตัวเลือกที่ไม่บังคับ เว้นว่างได้ แต่ถ้าเลือกแล้วก็ยังต้องเป็นค่าที่มีอยู่จริง */
test('validateCart: ช่องตัวเลือกที่ไม่บังคับ ว่างได้ แต่ค่ามั่วไม่ได้', () => {
  const tint = {
    id: 99,
    sku: 'CTX-0001',
    name: 'เลนส์ทดสอบ',
    base_selling_price: 100,
    pos_fields: [{
      key: 'tint',
      label: 'สีเลนส์',
      type: 'choice',
      options: [['clear', 'ใส'], ['gray', 'เทา']],
    }],
  };
  assert.deepEqual(validateCart(addItem([], tint)), []);
  const bad = validateCart(addItem([], tint, { meta: { tint: 'ม่วง' } }));
  assert.equal(bad.length, 1);
  assert.match(bad[0].message, /สีเลนส์/);
});

test('validatePayment: จ่ายเต็มด้วยเงินสด รับเงินพอ', () => {
  assert.deepEqual(validatePayment({
    total: 1140, amount: 1140, method: 'cash', received: 1500, delivered: true,
  }), []);
});

test('validatePayment: เงินสดรับมาน้อยกว่ายอด', () => {
  const e = validatePayment({
    total: 1000, amount: 1000, method: 'cash', received: 500, delivered: true,
  });
  assert.equal(e.length, 1);
  assert.match(e[0], /น้อยกว่ายอด/);
});

test('validatePayment: จ่ายเกินยอดขาย', () => {
  const e = validatePayment({ total: 100, amount: 200, method: 'cash', delivered: true });
  assert.match(e[0], /เกินยอดขาย/);
});

test('validatePayment: มัดจำต้องมีชื่อหรือเบอร์', () => {
  const base = { total: 2000, amount: 500, method: 'transfer', delivered: true };
  assert.equal(validatePayment(base).length, 1);
  assert.deepEqual(validatePayment({ ...base, customerPhone: '0812345678' }), []);
  assert.deepEqual(validatePayment({ ...base, customerName: 'คุณเอ' }), []);
});

test('validatePayment: จ่ายครบแต่ยังไม่ส่งมอบ ก็ต้องมีข้อมูลลูกค้า', () => {
  const e = validatePayment({
    total: 1000, amount: 1000, method: 'cash', received: 1000, delivered: false,
  });
  assert.equal(e.length, 1);
});

test('validatePayment: ส่งมอบทั้งที่ยังค้างเงินไม่ใช่ข้อผิดพลาด', () => {
  assert.deepEqual(validatePayment({
    total: 300, amount: 100, method: 'cash', received: 100,
    delivered: true, customerPhone: '0899999999',
  }), []);
});

test('toItemsPayload: ส่งเฉพาะสิ่งที่ API ใช้ และยัดชื่อ custom ลง meta', () => {
  let c = addItem([], spray, { quantity: 2 });
  c = addItem(c, other);
  c = setCustomName(c, c[1].key, 'ค่าประกอบพิเศษ');
  const p = toItemsPayload(c);
  assert.deepEqual(p[0], {
    product_id: 1, custom_name: undefined, quantity: 2, unit_price: 120, item_meta: {},
  });
  assert.equal(p[1].custom_name, 'ค่าประกอบพิเศษ');
  assert.equal(p[1].item_meta.custom_name, 'ค่าประกอบพิเศษ');
});

/* ---- ของจากคลัง (กรอบ / คอนแทคเลนส์) — สเปก 2026-09-18-pos-sell-from-stock ---- */
const eyeField = {
  key: 'eye', label: 'ข้าง', type: 'choice', required: true,
  options: [['R', 'ขวา (R)'], ['L', 'ซ้าย (L)'], ['RL', 'ทั้งสองข้าง']],
};
const frame = {
  id: 1, sku: 'FRM-0001', name: 'กรอบ Rayban RX5154', base_selling_price: 4500,
  product_type: 'Frame', on_hand: 2, stock: true, pos_fields: [],
};
const stockCtl = {
  id: 7, sku: 'CTL-0001', name: 'Acuvue Oasys -2.50', base_selling_price: 900,
  product_type: 'ContactLen', on_hand: 5, stock: true, pos_fields: [eyeField],
};

test('addItem: แถวจากคลังจำว่าเป็นของคลัง และคงเหลือเท่าไร', () => {
  const [it] = addItem([], frame);
  assert.equal(it.stock, true);
  assert.equal(it.stock_product_id, 1);
  assert.equal(it.on_hand, 2);
  assert.equal(it.product_type, 'Frame');
});

test('addItem: ของจากคลังไม่มีราคาตั้งต้น — พนักงานตั้งราคาเองเหมือนสินค้า Gadget', () => {
  assert.equal(addItem([], frame)[0].unit_price, 0);
  assert.equal(addItem([], frame, { price: 3990 })[0].unit_price, 3990, 'ส่งราคามาเองยังใช้ได้');
});

test('addItem: ของคลัง id ชนกับ pos_items id — ไม่รวมเป็นแถวเดียว', () => {
  let c = addItem([], { ...spray, id: 1, base_selling_price: 4500 });
  c = addItem(c, frame);
  assert.equal(c.length, 2);
});

test('addItem: กรอบตัวเดิมซ้ำ บวกจำนวนในแถวเดิม', () => {
  let c = addItem([], frame);
  c = addItem(c, frame);
  assert.equal(c.length, 1);
  assert.equal(c[0].quantity, 2);
});

test('validateCart: จำนวนเกินของในคลัง ขึ้นเตือน', () => {
  const one = addItem([], frame);
  assert.equal(validateCart(setQty(one, one[0].key, 2)).length, 0, 'เท่าคงเหลือพอดี ผ่าน');
  const e = validateCart(setQty(one, one[0].key, 3));
  assert.equal(e.length, 1);
  assert.match(e[0].message, /เกินจำนวนในคลัง \(เหลือ 2\)/);
});

test('validateCart: คอนแทคเลนส์จากคลังต้องเลือกข้าง', () => {
  const e = validateCart(addItem([], stockCtl));
  assert.equal(e.length, 1);
  assert.match(e[0].message, /ต้องระบุข้าง/);
});

test('toItemsPayload: แถวคลังส่ง stock_product_id ไม่ส่ง product_id', () => {
  const [line] = toItemsPayload(addItem([], stockCtl, { meta: { eye: 'R' } }));
  assert.equal(line.stock_product_id, 7);
  assert.equal(line.product_id, undefined);
  assert.deepEqual(line.item_meta, { eye: 'R' });
});

test('isContactLens: ของคลังประเภทคอนแทคเลนส์ และของ pos_items ที่ถามค่าสายตา', () => {
  assert.equal(isContactLens(addItem([], stockCtl)[0]), true);
  assert.equal(isContactLens(addItem([], lens)[0]), true);
  assert.equal(isContactLens(addItem([], frame)[0]), false);
  assert.equal(isContactLens(addItem([], spray)[0]), false);
});

test('hiddenFromOther: ซ่อนคอนแทคเลนส์ PosCtl* กับ "กรอบแว่น" EYW-0003 จากการ์ดสินค้าอื่น', () => {
  assert.equal(hiddenFromOther({ sku: 'CTA-0001', category_code: 'PosCtlAcuvue' }), true);
  assert.equal(hiddenFromOther({ sku: 'EYW-0003', category_code: 'PosEyewear' }), true);
  assert.equal(hiddenFromOther({ sku: 'EYW-0004', category_code: 'PosEyewear' }), false);
  assert.equal(hiddenFromOther({ sku: 'SRV-0001', category_code: 'PosService' }), false);
});
