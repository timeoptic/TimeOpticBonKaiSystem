/**
 * แหล่งข้อมูลเลนส์ของหน้าขาย
 *
 *   NEXT_PUBLIC_LENS_SOURCE=mock  Bewell — เลือกจากเลนส์จำลอง (mockLenses.js = รายชื่อเลนส์จากเว็บหลัก
 *                                 TimeOptic) ไม่แตะคลังของ Bewell
 *   ไม่ตั้ง                         TimeOptic — เลือกเลนส์จากคลังแบบเดิม (StockPicker)
 *
 * วันที่ Bewell มีฐานเลนส์จริง ให้เปลี่ยนแหล่งที่ searchMockLenses อ่าน แต่คืนรูปแถวเดิม
 * (toStockRow) หน้าขายก็ไม่ต้องแก้
 */
import { MOCK_LENSES } from './mockLenses.js';

export const LENS_SOURCE = process.env.NEXT_PUBLIC_LENS_SOURCE === 'mock' ? 'mock' : 'stock';

/** ค่าสายตาให้อยู่รูปเดียวกับที่ตัวกรองส่งมา ("-2.00" · "0.25" · "0.00") */
const powerKey = (v) => {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);
};

/** รุ่นของเลนส์ = ชื่อที่ตัดแบรนด์ข้างหน้าและ "(Index) ค่าสายตา" ข้างหลังออก — "Crystal FT Auto Bifocal (1.56) ..." → "FT Auto Bifocal" */
const modelOf = (l) => {
  let m = l.name.replace(/\s*\(\d\.\d{2}\).*$/, '').trim();
  if (l.brand && m.toLowerCase().startsWith(l.brand.toLowerCase() + ' ')) m = m.slice(l.brand.length + 1);
  return m;
};

/**
 * เลนส์จำลอง → รูปแถวที่ LensPicker และ OrderFormView อ่าน
 * id เป็น null เสมอ: ออเดอร์ไม่ผูกล็อต ขั้นขายจึงไม่ตัดสต็อกเลนส์
 * ไฟล์ต้นทางไม่มีราคาขาย product_price จึงเป็น 0 — พนักงานกรอกราคาเองในหน้าขาย
 */
export function toStockRow(l) {
  return {
    id: null,
    mock: true,
    mock_code: l.mock_code,
    sku: l.mock_code,
    product_name: l.name,
    brand: l.brand,
    model: modelOf(l),
    lens_type: l.lens_type,
    lens_design: l.lens_type,
    lens_index: l.lens_index,
    coating: l.coating,
    sph: l.sph,
    cyl: l.cyl,
    add: l.add,
    tint: '',
    product_price: 0,
  };
}

/** ค้นหลายคำแบบ AND ในชื่อ/รหัส · Coating / SPH / CYL เทียบตรงค่า เหมือนตัวกรองของคลัง */
export function searchMockLenses(term = '', { coating = '', sph = '', cyl = '' } = {}, list = MOCK_LENSES) {
  const words = String(term).toLowerCase().split(/\s+/).filter(Boolean);
  const wantSph = powerKey(sph);
  const wantCyl = powerKey(cyl);
  return list
    .filter((l) => !coating || l.coating === coating)
    .filter((l) => wantSph === '' || powerKey(l.sph) === wantSph)
    .filter((l) => wantCyl === '' || powerKey(l.cyl) === wantCyl)
    .filter((l) => {
      const hay = `${l.name} ${l.mock_code}`.toLowerCase();
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
      design: r.model,
      lens_index: r.lens_index,
      coating: r.coating,
      option_name: '',
      photochromic: '',
      color: '',
      quantity: 1,
      unit_price: Number(prices?.[priceKey]) || 0,
    });
  }
  return out;
}
