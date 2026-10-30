/**
 * ย้อมสีเลนส์ — เก็บใน custom_orders.lens_tint ช่องเดิม ไม่ต้องเพิ่มคอลัมน์
 *
 * ช่องนี้เดิมรับค่าคุณสมบัติจากเลนส์ในสต็อกด้วย (เช่น Photochromic) จึงแยกงานย้อมด้วย
 * คำนำหน้า "ย้อมสี " · ใบเสร็จกับประวัติแว่นที่อ่าน lens_tint อยู่แล้วจะได้คำนี้ไปเลย
 */
const DYE_PREFIX = 'ย้อมสี ';

export const TINT_COLORS = [
  ['น้ำตาล', '#8B5E3C'],
  ['เทา', '#6B7280'],
  ['เขียว', '#4D7C5A'],
  ['ฟ้า', '#4F8FCB'],
  ['ชมพู', '#E58FA8'],
  ['ม่วง', '#8B6FBF'],
  ['เหลือง', '#E5B93C'],
  ['ส้ม', '#E58A4E'],
];

/** ชื่อสีที่ย้อม — ค่าที่ไม่ได้มาจากงานย้อมคืนสตริงว่าง */
export const dyeColorOf = (tint) => {
  const text = String(tint ?? '');
  return text.startsWith(DYE_PREFIX) ? text.slice(DYE_PREFIX.length).trim() : '';
};

export const dyeValue = (color) => DYE_PREFIX + color;

/**
 * ค่า lens_tint ที่จะส่งบันทึก — เลือกย้อมสีชนะเสมอ · ไม่ย้อมแล้วล้างเฉพาะค่าย้อมเดิม
 * ค่าที่มาจากเลนส์ในสต็อกต้องอยู่ต่อ ไม่งั้นกดบันทึกซ้ำแล้วคุณสมบัติเลนส์หาย
 */
export const lensTintForSave = (dyeColor, current) => {
  if (dyeColor) return dyeValue(dyeColor);
  return dyeColorOf(current) ? '' : current;
};
