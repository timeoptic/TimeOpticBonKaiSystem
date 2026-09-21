/**
 * แหล่งข้อมูลเลนส์ของหน้าขาย
 *
 *   NEXT_PUBLIC_LENS_SOURCE=mock  Bewell — เลือกจากเลนส์จำลอง (mockLenses.js) ไม่แตะคลัง
 *   ไม่ตั้ง                         TimeOptic — เลือกเลนส์จากคลังแบบเดิม (StockPicker)
 *
 * วันที่ Bewell มีฐานเลนส์จริง ให้เปลี่ยนแหล่งที่ searchMockLenses อ่าน แต่คืนรูปแถวเดิม
 * (toStockRow) หน้าขายก็ไม่ต้องแก้
 */
import { MOCK_LENSES } from './mockLenses.js';

export const LENS_SOURCE = process.env.NEXT_PUBLIC_LENS_SOURCE === 'mock' ? 'mock' : 'stock';

const BLUE = /blue|guard|cut/i;

/* ตัวกรอง Coating ของ LensPicker ใช้คำของคลัง TimeOptic — แปลงเป็นคำถามต่อเลนส์จำลอง */
const COATING_MATCH = {
  Hard: (l) => /hard/i.test(l.coating),
  MC: (l) => !/hard/i.test(l.coating),
  Auto: (l) => Boolean(l.photochromic),
  Blue: (l) => BLUE.test(l.option),
  'Auto-Blue': (l) => Boolean(l.photochromic) && BLUE.test(l.option),
};

export function mockLabel(l) {
  return [l.brand, l.lens_type, l.design, l.lens_index, l.coating, l.option, l.photochromic, l.color]
    .filter(Boolean)
    .join(' ');
}

/**
 * เลนส์จำลอง → รูปแถวที่ LensPicker และ OrderFormView อ่าน
 * id เป็น null เสมอ: ออเดอร์ไม่ผูกล็อต ขั้นขายจึงไม่ตัดสต็อกเลนส์
 * product_price เป็นราคาครึ่งคู่ เพราะหน้าขายตั้งราคาแยกขวา/ซ้าย แถบราคาคู่จะรวมกลับเป็นราคาคู่
 */
export function toStockRow(l) {
  return {
    id: null,
    mock: true,
    mock_code: l.mock_code,
    sku: l.mock_code,
    product_name: mockLabel(l),
    brand: l.brand,
    lens_type: l.lens_type,
    lens_design: l.design,
    lens_index: l.lens_index,
    coating: l.coating,
    option: l.option,
    photochromic: l.photochromic,
    tint: l.color,
    price_pair: l.price_pair,
    product_price: l.price_pair / 2,
  };
}

/** ค้นหลายคำแบบ AND ทั้งชื่อและรหัส · ตัวกรอง SPH/CYL ไม่ใช้ — เลนส์สั่งตามค่าสายตาทำได้ทุกค่า */
export function searchMockLenses(term = '', { coating = '' } = {}, list = MOCK_LENSES) {
  const words = String(term).toLowerCase().split(/\s+/).filter(Boolean);
  const byCoating = COATING_MATCH[coating];
  return list
    .filter((l) => !byCoating || byCoating(l))
    .filter((l) => {
      const hay = `${mockLabel(l)} ${l.mock_code}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .map(toStockRow);
}

/**
 * รายการที่ส่งให้ POST /api/lens-requisitions/sync — หนึ่งแถวต่อข้างที่เลือกเลนส์จำลอง
 * `items` คือ state ตัวเลือกของ OrderFormView (undefined = รอบนี้ยังไม่มีใครแตะ)
 */
export function requisitionItems(items, prices) {
  const out = [];
  for (const [slot, eye, priceKey] of [['lensOd', 'R', 'lens_od_price'], ['lensOs', 'L', 'lens_os_price']]) {
    const r = items?.[slot];
    if (!r?.mock) continue;
    out.push({
      eye,
      source: 'MOCK',
      mock_code: r.mock_code,
      brand: r.brand,
      lens_type: r.lens_type,
      design: r.lens_design,
      lens_index: r.lens_index,
      coating: r.coating,
      option_name: r.option || '',
      photochromic: r.photochromic || '',
      color: r.tint || '',
      quantity: 1,
      unit_price: Number(prices?.[priceKey]) || 0,
    });
  }
  return out;
}
