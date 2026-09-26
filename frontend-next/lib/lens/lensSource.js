/**
 * แหล่งข้อมูลเลนส์ของหน้าขาย
 *
 *   NEXT_PUBLIC_LENS_SOURCE=catalog  Bewell — เลือกจากรายการเลนส์ (lens_catalog ที่แอดมินแก้เองได้
 *                                    ที่หน้า /lens-catalog) ไม่ใช่คลัง: ไม่มีจำนวนคงเหลือ ไม่ตัดสต็อก
 *                                    ('mock' ค่าเดิมก่อนมีรายการในฐาน ถือเป็นค่าเดียวกัน)
 *   ไม่ตั้ง                            TimeOptic — เลือกเลนส์จากคลังแบบเดิม (StockPicker)
 *
 * แถวที่ส่งให้ OrderFormView อยู่รูปเดียวกับแถวสต็อก (toStockRow) หน้าขายจึงแก้น้อยที่สุด
 * ขายแล้วระบบบันทึกเป็น "ใช้เลนส์" ในใบเบิกเลนส์ (ดู api/services/LensRequisition.php)
 */

const SOURCE = process.env.NEXT_PUBLIC_LENS_SOURCE;
export const LENS_SOURCE = SOURCE === 'catalog' || SOURCE === 'mock' ? 'catalog' : 'stock';

/** แถวจาก GET /api/lens-catalog → รูปแถวที่ OrderFormView อ่าน
 *  id เป็น null เสมอ: ออเดอร์ไม่ผูกล็อต ขั้นขายจึงไม่ตัดสต็อกเลนส์
 *  product_price = ราคาข้างละครึ่ง เพราะหน้าขายแยกขวา/ซ้าย แถบราคาคู่รวมกลับเป็นราคาคู่พอดี */
export function toStockRow(c) {
  const pair = Number(c.selling_price) || 0;
  return {
    id: null,
    catalog: true,
    lens_catalog_id: c.id,
    sku: c.code,
    product_name: c.lens_name,
    brand: c.brand || '',
    model: c.lens_name,
    lens_type: c.lens_type,
    lens_design: c.lens_type,
    lens_index: c.lens_index || '',
    coating: c.coating || '',
    sph: c.sph || '',
    cyl: c.cyl || '',
    add: c.add_power || '',
    tint: '',
    pair_price: pair,
    product_price: Math.round((pair / 2) * 100) / 100,
  };
}

/* ตัวกรอง Coating ของ LensPicker ใช้ชื่อย่อของคลัง (Hard / MC / Auto / Blue / Auto-Blue)
   รายการเลนส์ใช้ชื่อเต็มที่แอดมินพิมพ์ — เทียบหลังตัดช่องว่าง/ขีด และแปลงชื่อย่อก่อน */
const COATING_ALIAS = { hard: 'hardcoat', mc: 'multicoat', auto: 'photochromic' };
const coatKey = (v) => {
  const k = String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return COATING_ALIAS[k] || k;
};
const sameCoating = (a, b) => {
  const x = coatKey(a);
  const y = coatKey(b);
  return x === y || (x === 'photochromic' && y === 'auto') || (y === 'photochromic' && x === 'auto')
    || (x === 'bluecut' && y === 'blue') || (y === 'bluecut' && x === 'blue');
};

/** ค่าสายตาให้อยู่รูปเดียวกับที่ตัวกรองส่งมา ("-2.00" · "0.25" · "0.00") */
const powerKey = (v) => {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);
};

/** รุ่นที่ไม่ได้ระบุค่าสายตา (ช่องว่าง) ใช้ได้ทุกค่า — ตัวกรองไม่ตัดออก */
const powerMatches = (have, want) => want === '' || have === null || have === undefined || have === ''
  || powerKey(have) === want;

/**
 * ค้นในรายการเลนส์ — หลายคำแบบ AND ในชื่อ รหัส ยี่ห้อ ชนิด Index
 * Coating / SPH / CYL เทียบตรงค่าแบบตัวกรองของคลัง (รายชื่อเดิมจากเว็บหลักแยกรุ่นตามค่าสายตา)
 */
export function searchCatalog(list, term = '', { coating = '', sph = '', cyl = '' } = {}) {
  const words = String(term).toLowerCase().split(/\s+/).filter(Boolean);
  const wantSph = powerKey(sph);
  const wantCyl = powerKey(cyl);
  return (list || [])
    .filter((c) => !coating || sameCoating(c.coating, coating))
    .filter((c) => powerMatches(c.sph, wantSph) && powerMatches(c.cyl, wantCyl))
    .filter((c) => {
      const hay = [c.lens_name, c.code, c.brand, c.lens_type, c.lens_index].filter(Boolean).join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
}

/**
 * รายการที่ส่งให้ POST /api/lens-requisitions/sync
 * สองข้างเป็นเลนส์รุ่นเดียวกัน = 1 คู่ (หน่วยที่ร้านเบิกจริง) · คนละรุ่น = ข้างละรายการ
 * ต้นทุน ชื่อ และชนิด ฝั่ง API อ่านจากรายการเลนส์เอง ที่นี่ส่งแค่ id กับราคาขายในออเดอร์
 * `items` คือ state ตัวเลือกของ OrderFormView (undefined = รอบนี้ยังไม่มีใครแตะ)
 */
export function requisitionItems(items, prices) {
  const od = items?.lensOd?.catalog ? items.lensOd : null;
  const os = items?.lensOs?.catalog ? items.lensOs : null;
  const price = (k) => Number(prices?.[k]) || 0;
  const row = (eye, r, unitPrice) => ({
    eye,
    source: 'CATALOG',
    lens_catalog_id: r.lens_catalog_id,
    brand: r.brand,
    lens_type: r.lens_type,
    design: r.product_name,
    lens_index: r.lens_index,
    coating: r.coating,
    quantity: 1,
    unit_price: unitPrice,
  });
  if (od && os && od.lens_catalog_id === os.lens_catalog_id) {
    return [row('pair', od, price('lens_od_price') + price('lens_os_price'))];
  }
  return [
    ...(od ? [row('R', od, price('lens_od_price'))] : []),
    ...(os ? [row('L', os, price('lens_os_price'))] : []),
  ];
}
