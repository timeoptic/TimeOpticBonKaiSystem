/**
 * ตะกร้าของ POS — ฟังก์ชันบริสุทธิ์ล้วน ไม่มี React ไม่มี fetch
 *
 * ตรรกะยอดเงินทั้งหมดของ POS อยู่ในไฟล์นี้ไฟล์เดียว เพราะเป็นส่วนที่ผิดแล้วเจ็บที่สุด
 * (คิดเงินลูกค้าผิด) และเป็นส่วนที่เทสได้จริงโดยไม่ต้องเปิดเบราว์เซอร์ · คอมโพเนนต์
 * ฝั่ง React มีหน้าที่วาดผลลัพธ์ของที่นี่เท่านั้น ห้ามคำนวณเงินเองซ้ำ
 *
 * ยอดที่คำนวณที่นี่ใช้ "โชว์สด ๆ ตอนพนักงานพิมพ์" เท่านั้น — ยอดที่ถูกบันทึกจริง
 * เป็นของ `api/routes/pos.php` ที่คำนวณใหม่จาก items เสมอ สองที่ต้องได้เลขเดียวกัน
 * แต่ฝั่งที่เชื่อได้คือฝั่ง server
 */

/** ปัดสองตำแหน่งแบบเดียวกับ round2() ฝั่ง PHP ไม่ให้เศษทศนิยมลอยมาจากการคูณ */
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** คีย์ของแถวในตะกร้า — ไม่ใช้ product_id เพราะสินค้าตัวเดียวกันอยู่ได้หลายแถว */
let seq = 0;
export const nextKey = () => `line-${++seq}`;

/** เทียบว่า dynamic field สองชุดเหมือนกันไหม ใช้ตัดสินว่าจะรวมแถวหรือแยกแถว */
const sameMeta = (a, b) => {
  const ka = Object.keys(a || {}).sort();
  const kb = Object.keys(b || {}).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => kb[i] === k && String(a[k] ?? '') === String(b[k] ?? ''));
};

/**
 * เพิ่มสินค้าเข้าตะกร้า
 *
 * สินค้าเดิม ราคาเดิม และ dynamic field เหมือนกัน = บวกจำนวนในแถวเดิม
 * ถ้าต่างกันแม้แต่ช่องเดียวต้องแยกแถว — คอนแทคเลนส์สองกล่องคนละค่าสายตาเป็น
 * คนละรายการ รวมเป็น "2 กล่อง" แล้วช่างอ่านไม่ออกว่าต้องหยิบอะไร
 *
 * สินค้า Custom แยกแถวเสมอ เพราะชื่อที่พิมพ์เองยังว่างอยู่ตอนเพิ่ง add
 */
export function addItem(items, product, { quantity = 1, meta = {}, price } = {}) {
  const unitPrice = price === undefined ? round2(product.base_selling_price) : round2(price);
  const custom = !!product.pos_custom;

  if (!custom) {
    const hit = items.findIndex(
      (it) => it.product_id === product.id
        && round2(it.unit_price) === unitPrice
        && sameMeta(it.item_meta, meta),
    );
    if (hit !== -1) {
      return items.map((it, i) => (i === hit ? { ...it, quantity: it.quantity + quantity } : it));
    }
  }

  return [...items, {
    key: nextKey(),
    product_id: product.id,
    sku: product.sku,
    name: product.name,
    category_name: product.category_name,
    pos_fields: product.pos_fields || [],
    pos_custom: custom,
    custom_name: '',
    quantity,
    unit_price: unitPrice,
    item_meta: { ...meta },
  }];
}

export const removeItem = (items, key) => items.filter((it) => it.key !== key);

const patch = (items, key, fn) => items.map((it) => (it.key === key ? { ...it, ...fn(it) } : it));

/** จำนวนต่ำกว่า 1 ไม่มีความหมายในใบขาย — กดลบต่อจาก 1 ให้ใช้ปุ่มลบแถวแทน */
export const setQty = (items, key, qty) =>
  patch(items, key, () => ({ quantity: Math.max(1, Math.floor(num(qty))) }));

export const bumpQty = (items, key, by) =>
  patch(items, key, (it) => ({ quantity: Math.max(1, it.quantity + by) }));

/** ราคา 0 ใช้ได้จริง (ของแถม) แต่ติดลบใช้ไม่ได้ */
export const setPrice = (items, key, price) =>
  patch(items, key, () => ({ unit_price: Math.max(0, round2(price)) }));

export const setMeta = (items, key, field, value) =>
  patch(items, key, (it) => ({ item_meta: { ...it.item_meta, [field]: value } }));

export const setCustomName = (items, key, name) =>
  patch(items, key, () => ({ custom_name: name }));

export const lineTotal = (it) => round2(num(it.quantity) * num(it.unit_price));

/**
 * ยอดของทั้งใบ
 *
 * discount รับไว้เป็นพารามิเตอร์ตั้งแต่ตอนนี้ทั้งที่ Phase แรกส่ง 0 เสมอ —
 * วันที่เปิดใช้ส่วนลด จะได้ไม่ต้องไล่แก้ทุกที่ที่เรียก
 */
export function totals(items, discount = 0) {
  const subtotal = round2(items.reduce((sum, it) => sum + lineTotal(it), 0));
  const d = Math.min(round2(discount), subtotal);
  return {
    itemCount: items.length,
    unitCount: items.reduce((sum, it) => sum + num(it.quantity), 0),
    subtotal,
    discount: d,
    total: round2(subtotal - d),
  };
}

/** เงินทอน — รับมาน้อยกว่าที่ต้องจ่ายคือ 0 ไม่ใช่ติดลบ (ติดลบแปลว่ายอดผิด) */
export const changeFor = (received, due) => round2(Math.max(0, num(received) - num(due)));

/** จ่ายครบหรือยัง — ใบยอด 0 บาทนับว่าครบ ไม่ใช่ค้างตลอดกาล */
export function paymentStatus(total, paid) {
  const balance = round2(num(total) - num(paid));
  if (balance <= 0) return 'paid';
  return num(paid) > 0 ? 'partial' : 'unpaid';
}

/**
 * ตรวจตะกร้าก่อนให้กดชำระเงิน
 *
 * คืนรายการข้อความ ว่างเปล่า = ผ่าน · ตรงกับกฎฝั่ง server ทุกข้อ (pos.php) แต่
 * ฝั่งนี้มีไว้บอกพนักงานทันทีว่าติดตรงไหน ไม่ใช่ให้รอ 400 กลับมา
 * ด่านจริงคือฝั่ง server เสมอ
 */
export function validateCart(items) {
  const errs = [];
  if (items.length === 0) {
    errs.push({ key: null, message: 'ยังไม่มีสินค้าในตะกร้า' });
    return errs;
  }
  items.forEach((it, i) => {
    const label = `รายการที่ ${i + 1}`;
    const name = it.pos_custom ? (it.custom_name || 'สินค้าพิมพ์เอง') : it.name;
    if (it.pos_custom && !String(it.custom_name || '').trim()) {
      errs.push({ key: it.key, message: `${label}: ต้องพิมพ์ชื่อสินค้า` });
    }
    if (num(it.quantity) < 1) {
      errs.push({ key: it.key, message: `${label} (${name}): จำนวนต้องอย่างน้อย 1` });
    }
    if (num(it.unit_price) < 0) {
      errs.push({ key: it.key, message: `${label} (${name}): ราคาติดลบไม่ได้` });
    }
    (it.pos_fields || []).forEach((f) => {
      if (f.required && !String(it.item_meta?.[f.key] ?? '').trim()) {
        errs.push({ key: it.key, message: `${label} (${name}): ต้องระบุ${f.label || f.key}` });
      }
    });
  });
  return errs;
}

/**
 * ตรวจฝั่งเงินและลูกค้า
 *
 * `delivered` เข้ามาเกี่ยวเพราะกฎ "ต้องตามลูกค้าได้" ผูกกับสองเรื่องพร้อมกัน:
 * ค้างเงิน หรือ ของยังไม่ออกจากร้าน · ไม่ได้แปลว่าสองสถานะนี้ผูกกันเอง
 */
export function validatePayment({ total, amount, method, received, delivered, customerName, customerPhone }) {
  const errs = [];
  const pay = round2(amount);
  if (pay < 0) errs.push('ยอดชำระติดลบไม่ได้');
  if (pay > round2(total)) errs.push('ยอดชำระเกินยอดขาย');
  if (pay > 0 && method === 'cash' && received !== null && received !== undefined && received !== ''
      && round2(received) < pay) {
    errs.push('เงินที่รับมาน้อยกว่ายอดที่ต้องชำระ');
  }
  const owing = pay < round2(total);
  if ((owing || !delivered)
      && !String(customerName || '').trim() && !String(customerPhone || '').trim()) {
    errs.push('มัดจำหรือยังไม่ส่งมอบ ต้องระบุชื่อหรือเบอร์โทรลูกค้าอย่างน้อยหนึ่งอย่าง');
  }
  return errs;
}

/** แปลงตะกร้าเป็น payload ที่ API รับ — ส่งเฉพาะสิ่งที่ server ต้องใช้ */
export const toItemsPayload = (items) => items.map((it) => ({
  product_id: it.product_id,
  custom_name: it.pos_custom ? it.custom_name : undefined,
  quantity: it.quantity,
  unit_price: it.unit_price,
  item_meta: it.pos_custom
    ? { ...it.item_meta, custom_name: it.custom_name }
    : it.item_meta,
}));
