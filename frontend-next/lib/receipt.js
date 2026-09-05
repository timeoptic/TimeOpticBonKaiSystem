/**
 * ข้อมูลบนใบเสร็จ — แปลง "ออเดอร์แว่น" กับ "ใบขาย POS" ให้เป็นรูปร่างเดียวกัน
 *
 * หน้า /print/receipt วาดอย่างเดียว ไม่ตัดสินใจอะไรเอง ตรรกะทั้งหมดอยู่ที่นี่
 * เพราะเลข VAT กับผลรวมบรรทัดคือสิ่งที่ต้องมีเทสต์คุม ไม่ใช่สิ่งที่ตรวจด้วยตาบนกระดาษ
 *
 * กฎที่ยึด:
 *   1. ราคาทุกตัวในระบบเป็นราคา "รวม VAT แล้ว" — ใบถอดกลับ ไม่ใช่บวกเพิ่ม
 *      (ฟอร์มเดิมของร้านเรียง Excluding → VAT 7% → Including ซึ่งอ่านได้ทางเดียว)
 *   2. ผลรวมของบรรทัดที่มีราคา ต้องเท่ากับยอดท้ายใบเสมอ ไม่งั้นใบใช้ไม่ได้
 *      ส่วนลดจึงเป็น "บรรทัดติดลบ" ไม่ใช่ตัวเลขที่หายไปเงียบๆ
 *   3. กรอบ / เลนส์ / ออพชั่น ต้องแยกราคาให้ลูกค้าเห็นทีละรายการ ห้ามยุบเป็นก้อนเดียว
 *      และบรรทัด "แพ็กเกจ" (Progressive Glasses) ต้องไม่มีราคา ไม่งั้นนับซ้ำกับลูกของมัน
 *
 * ข้อ 3 มีข้อยกเว้นที่มาจากข้อมูลจริง ไม่ใช่ความชอบ:
 *   ออเดอร์ที่เปิดในระบบนี้กรอกราคาแยกครบ (frame_price / lens_od_price / lens_os_price /
 *   options_price บวกกันได้เท่ากับ total_price เป๊ะ — ฟอร์มขายคิดยอดรวมจากสี่ช่องนี้)
 *   แต่ออเดอร์ 8,020 ใบที่นำเข้ามาจาก Access (รหัส OLD-*) มีแต่ยอดรวม ช่องแยกเป็นศูนย์หมด
 *   ใบเก่าพวกนั้นถ้าแจกแจงจะได้ Frame 0.00 / Lens 0.00 แล้วยอดท้ายใบเป็น 0 ซึ่งผิด
 *   จึงตกไปใช้บรรทัดเดียวที่ถือยอดรวมไว้ — แยกไม่ได้เพราะไม่มีข้อมูลให้แยก
 *   ใบที่เปิดใหม่ตั้งแต่นี้ไปเข้าทางแจกแจงทั้งหมด
 */

const n = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const VAT_RATE = 0.07;

/**
 * ยอดรวม VAT → สามบรรทัดท้ายใบ
 * คำนวณ excl ก่อนแล้วหักออกเพื่อให้ excl + vat = incl เป๊ะเสมอ
 * (ถ้าปัดทีละตัวแยกกัน ยอดจะเพี้ยนไป 1 สตางค์ในบางจำนวน)
 */
export function vatBreakdown(totalIncl, rate = VAT_RATE) {
  const incl = round2(totalIncl);
  const excl = round2(incl / (1 + rate));
  return { excl, vat: round2(incl - excl), incl };
}

/** บรรทัดบรรยาย ไม่มีตัวเลขในสามคอลัมน์ขวา (หัวแพ็กเกจ / ค่าสายตา) */
const note = (desc, indent = false) => ({ desc, indent, qty: null, unit: null, amount: null });
/** บรรทัดที่มีราคา */
const line = (desc, qty, unit, amount, indent = false) => ({ desc, indent, qty, unit, amount });
/**
 * บรรทัดที่ "ควรมีราคาแต่ระบบไม่มีช่องเก็บ" — พิมพ์ขีดกลางในคอลัมน์ราคา
 * ต่างจาก note ตรงที่ note คือของที่ไม่ควรมีราคาอยู่แล้ว (ค่าสายตา)
 * ส่วน spec คือของที่ลูกค้าอาจคาดว่ามีราคา แต่ตอบไม่ได้ — ต้องบอกว่าไม่มี ไม่ใช่เว้นว่างเงียบ ๆ
 */
const spec = (desc, indent = true) => ({ desc, indent, qty: null, unit: DASH, amount: DASH });

const DASH = '—';

/** ค่าสายตาหนึ่งข้างในบรรทัดเดียว เช่น "-1.25 / -0.50 x 180" */
function eyeLine(rx, k) {
  if (!rx) return '';
  const sph = rx[`${k}_sphere`];
  const cyl = rx[`${k}_cylinder`];
  const axis = rx[`${k}_axis`];
  const parts = [];
  if (String(sph ?? '').trim()) parts.push(String(sph).trim());
  if (String(cyl ?? '').trim()) parts.push(`/ ${String(cyl).trim()}`);
  if (String(axis ?? '').trim()) parts.push(`x ${String(axis).trim()}`);
  return parts.join(' ');
}

/** ชื่อกรอบที่จะพิมพ์ — ชื่อเต็มก่อน ไม่มีค่อยประกอบจากยี่ห้อ+รุ่น (เหมือน /print/order) */
const frameLabel = (o) => o?.frame_name
  || [o?.frame_brand, o?.frame_model].filter(Boolean).join(' ')
  || '';

/** ชื่อเลนส์ — สองข้างคนละรุ่นได้ ถ้าต่างกันต้องแยกบรรทัด ไม่ใช่ตัดทิ้ง */
function lensLabels(o) {
  const r = o?.lens_r_name || '';
  const l = o?.lens_l_name || '';
  if (r && l && r !== l) return [['Lens R', r], ['Lens L', l]];
  const one = o?.lens_name || r || l;
  return one ? [['Lens', one]] : [];
}

/**
 * บรรทัดสินค้าของออเดอร์แว่น แจกแจงตามช่องราคาจริงในตาราง custom_orders
 * คืน null เมื่อไม่มีช่องไหนถูกกรอกเลย = แจกแจงไม่ได้ ให้ผู้เรียกตกไปใช้ทางสำรอง
 */
function glassesLines(o) {
  const frameP = round2(o?.frame_price);
  const odP = round2(o?.lens_od_price);
  const osP = round2(o?.lens_os_price);
  const optP = round2(o?.options_price);
  if (frameP + odP + osP + optP <= 0) return null;

  const out = [];

  /* กรอบ — ราคา 0 ก็ยังต้องขึ้นบรรทัดถ้ามีชื่อกรอบ (ลูกค้าเอากรอบเดิมมาใส่เลนส์ใหม่) */
  const frame = frameLabel(o);
  if (frame || frameP > 0) out.push(line(`Frame : ${frame || DASH}`, 1, frameP, frameP, true));

  /* เลนส์ — ยุบเป็นบรรทัดเดียว "จำนวน 2" ได้เฉพาะตอนสองข้างเป็นรุ่นเดียวกันและราคาเท่ากัน
     ไม่งั้นจำนวน × ราคาต่อหน่วย จะไม่เท่ากับราคารวมของบรรทัดนั้น */
  const names = lensLabels(o);
  const oneName = names.length === 1 ? names[0][1] : null;
  if (oneName && odP === osP) {
    out.push(line(`Lens : ${oneName}`, 2, odP, round2(odP * 2), true));
  } else {
    const rName = o?.lens_r_name || oneName || '';
    const lName = o?.lens_l_name || oneName || '';
    if (rName || odP > 0) out.push(line(`Lens R : ${rName || DASH}`, 1, odP, odP, true));
    if (lName || osP > 0) out.push(line(`Lens L : ${lName || DASH}`, 1, osP, osP, true));
  }

  /* ดัชนีหักเหไม่มีช่องราคาของตัวเองในฐาน — ค่าใช้จ่ายส่วนเพิ่มทั้งหมดรวมอยู่ที่
     options_price ก้อนเดียว จึงพิมพ์ดัชนีเป็นสเปก (ขีดกลาง) แล้วให้ก้อนออพชั่นถือราคา */
  const index = String(o?.lens_index ?? '').trim();
  if (index) out.push(spec(`Index : ${index}`));

  if (optP > 0) {
    const addons = [o?.lens_coating, o?.lens_tint, o?.lens_addons]
      .map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ');
    out.push(line(`ออพชั่นเสริม (Options / Upgrade)${addons ? ` : ${addons}` : ''}`, 1, optP, optP, true));
  }
  return out;
}

/**
 * ออเดอร์แว่น → ใบเสร็จ
 * บรรทัดหัว "Progressive Glasses" เป็นชื่อประเภทงาน ไม่มีราคา — ราคาอยู่ที่ลูกของมัน
 * (กรอบ / เลนส์ / ออพชั่น) ถ้าใส่ราคาที่หัวด้วยจะกลายเป็นนับซ้ำ
 * ส่วนลดแยกเป็นบรรทัดติดลบ เพื่อให้ทั้งสองตัวเลขปรากฏบนใบ และผลรวมยังเท่ากับยอดสุทธิ
 */
export function orderReceipt(o, receiptNo) {
  const gross = round2(o?.total_price);
  const discount = round2(o?.discount);
  const rx = o?.prescription || null;
  const heading = `${o?.lens_type ? `${o.lens_type} ` : ''}Glasses`;

  const items = glassesLines(o);
  let lines;
  if (items) {
    lines = [note(heading), ...items];
    /* ช่องแยกกับยอดรวมควรตรงกันเสมอ (ฟอร์มขายคิดยอดรวมจากสี่ช่องนั้น) แต่ถ้าวันหนึ่ง
       ไม่ตรง — แก้ยอดรวมมือทีหลัง หรือข้อมูลนำเข้าครึ่ง ๆ กลาง ๆ — ผลต่างต้องโผล่เป็น
       บรรทัดของตัวเอง ห้ามซ่อน ไม่งั้นใบจะบวกไม่ลงกับยอดที่ลูกค้าจ่าย */
    const diff = round2(gross - linesTotal(lines));
    if (diff !== 0) lines.push(line('อื่น ๆ (Other)', 1, diff, diff, true));
  } else {
    /* ใบเก่าจาก Access — มีแต่ยอดรวม ไม่มีอะไรให้แยก */
    lines = [line(heading, 1, gross, gross)];
    const frame = frameLabel(o);
    if (frame) lines.push(spec(`Frame : ${frame}`));
    for (const [label, name] of lensLabels(o)) lines.push(spec(`${label} : ${name}`));
    const index = String(o?.lens_index ?? '').trim();
    if (index) lines.push(spec(`Index : ${index}`));
  }

  if (rx) {
    const r = eyeLine(rx, 'r');
    const l = eyeLine(rx, 'l');
    const add = [rx.r_add, rx.l_add].map((v) => String(v ?? '').trim()).filter(Boolean);
    if (r || l || add.length) {
      lines.push(note('Prescription', true));
      if (r) lines.push(note(`R : ${r}`, true));
      if (l) lines.push(note(`L : ${l}`, true));
      if (add.length) lines.push(note(`Add : ${add.join(' / ')}`, true));
    }
  }

  if (discount > 0) lines.push(line('ส่วนลด (Discount)', null, null, -discount));

  return {
    /* เลขบนใบมาจากชุดเลขใบเสร็จ (ตาราง receipts) ไม่ใช่ invoice_code ของออเดอร์ —
       ออเดอร์ได้เลขตั้งแต่ตอนสร้าง แต่ใบเสร็จออกเฉพาะตอนลูกค้าขอ ถ้ายืมเลขออเดอร์มาใช้
       ชุดเลขบนใบที่ออกจริงจะกระโดดเป็นหลุม ซึ่งเอกสารภาษีเป็นแบบนั้นไม่ได้
       ตามกลับไปหาเคส/ออเดอร์ได้จากคอลัมน์ order_id ในตาราง receipts */
    billNo: receiptNo || '',
    date: o?.order_date || null,
    customerName: [o?.first_name, o?.mid_name, o?.last_name].filter(Boolean).join(' ').trim(),
    customerPhone: o?.phone || '',
    cashier: o?.employee_name || '',
    lines,
    total: round2(gross - discount),
  };
}

/**
 * ใบขาย POS → ใบเสร็จ
 * ที่นี่ราคาต่อชิ้นเป็นของจริงทุกแถว (pos_sale_items) จึงแจกแจงได้เต็มรูปแบบ
 */
export function saleReceipt(s, receiptNo) {
  const items = s?.items || [];
  const discount = round2(s?.discount_amount);

  const lines = items.map((it) => {
    const desc = [it.product_name_snapshot, it.sku_snapshot ? `(${it.sku_snapshot})` : '']
      .filter(Boolean).join(' ');
    return line(desc, n(it.quantity), round2(it.unit_price), round2(it.line_total));
  });
  if (discount > 0) lines.push(line('ส่วนลด (Discount)', null, null, -discount));

  return {
    billNo: receiptNo || '',
    date: s?.sale_date || null,
    customerName: s?.customer_name_snapshot
      || [s?.first_name, s?.mid_name, s?.last_name].filter(Boolean).join(' ').trim(),
    customerPhone: s?.customer_phone_snapshot || '',
    cashier: s?.created_by_name || '',
    lines,
    total: round2(s?.total_amount),
  };
}

/**
 * ผลรวมของบรรทัดที่มี "ตัวเลข" จริง — ต้องเท่ากับ total ของใบ ใช้ยืนยันในเทสต์
 * บรรทัดที่ amount เป็น null (บรรยาย) หรือเป็นขีดกลาง (สเปกที่ไม่มีราคา) ไม่ถูกนับ
 */
export const linesTotal = (lines) =>
  round2((lines || []).reduce(
    (a, r) => a + (typeof r.amount === 'number' ? r.amount : 0),
    0,
  ));

export { DASH, round2 };
