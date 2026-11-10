/**
 * ย้อมสีเลนส์ — เก็บใน custom_orders.lens_tint ช่องเดิม ไม่ต้องเพิ่มคอลัมน์
 *
 * ช่องนี้เดิมรับค่าคุณสมบัติจากเลนส์ในสต็อกด้วย (เช่น Photochromic) จึงแยกงานย้อมด้วย
 * คำนำหน้า "ย้อมสี " · ใบเสร็จกับประวัติแว่นที่อ่าน lens_tint อยู่แล้วจะได้คำนี้ไปเลย
 *
 * รูปแบบ: "ย้อมสี เทาเขียว ระดับ 2" · ออเดอร์ก่อนมีระดับความเข้มเป็น "ย้อมสี น้ำตาล"
 * และอาจเป็นสีที่เลิกใช้แล้ว (เขียว ม่วง ส้ม) ต้องอ่านได้และบันทึกซ้ำแล้วค่าไม่เปลี่ยน
 */
const DYE_PREFIX = 'ย้อมสี ';

export const TINT_LEVELS = [1, 2, 3, 4];

/** shades เรียงจากระดับ 1 (อ่อนสุด) ถึง 4 (เข้มสุด) */
export const TINT_COLORS = [
  { en: 'GreyGreen', th: 'เทาเขียว', head: '#D5EBD8', shades: ['#D9E8DD', '#AFC8B5', '#7F9C86', '#4C6A52'] },
  { en: 'Brown', th: 'น้ำตาล', head: '#F1E2D3', shades: ['#EBD9C6', '#D2AE8C', '#A97E58', '#6E4A2E'] },
  { en: 'Black', th: 'ดำ', head: '#E6E7EA', shades: ['#DCDDE0', '#B0B1B6', '#75767C', '#2F3034'] },
  { en: 'Grey', th: 'เทา', head: '#E2E6EC', shades: ['#E0E3E8', '#BEC3CB', '#8F959E', '#5C626B'] },
  { en: 'GreyBlue', th: 'เทาอมฟ้า', head: '#D6E5F1', shades: ['#DBE4EC', '#B5C5D3', '#8AA0B3', '#5B7388'] },
  { en: 'Yellow', th: 'เหลือง', head: '#FBF0C4', shades: ['#FBF4CF', '#F7E68F', '#F5D84E', '#F0C419'] },
  { en: 'Blue', th: 'ฟ้า', head: '#CFE6FA', shades: ['#CFE5FA', '#9CCBF5', '#5F9FE8', '#2D66C4'] },
  { en: 'Pink', th: 'ชมพู', head: '#FBD9E7', shades: ['#FBDCE8', '#F5A9C8', '#E571A3', '#BE4A85'] },
];

/**
 * สีตามตัวอย่าง — ลูกค้าเอาตัวอย่างสีมาให้ย้อมตาม ไม่มีระดับความเข้ม 1–4
 * เก็บเป็น "ย้อมสี ตามตัวอย่าง (Color Match)" ใบสั่งงานกับใบเสร็จพิมพ์คำนี้ตรง ๆ ·
 * ประเภทในโค้ดคือ COLOR_MATCH (ดู dyeTypeOf)
 */
export const COLOR_MATCH = { type: 'COLOR_MATCH', en: 'Color Match', th: 'ตามตัวอย่าง (Color Match)' };

const parseDye = (tint) => {
  const text = String(tint ?? '');
  if (!text.startsWith(DYE_PREFIX)) return { color: '', level: 0 };
  const match = text.slice(DYE_PREFIX.length).trim().match(/^(.*?)(?:\s+ระดับ\s*([1-4]))?$/);
  return { color: match[1], level: Number(match[2] || 0) };
};

/** ชื่อสีที่ย้อม — ค่าที่ไม่ได้มาจากงานย้อมคืนสตริงว่าง */
export const dyeColorOf = (tint) => parseDye(tint).color;

/** ระดับความเข้ม 1-4 — ออเดอร์เก่าที่ยังไม่มีระดับคืน 0 */
export const dyeLevelOf = (tint) => parseDye(tint).level;

/** ประเภทงานย้อม: 'COLOR_MATCH' · 'PRESET' (สีจากชุด 8 สีหรือสีเก่า) · '' ไม่ได้ย้อม */
export const dyeTypeOf = (tint) => {
  const color = dyeColorOf(tint);
  if (!color) return '';
  return color === COLOR_MATCH.th ? COLOR_MATCH.type : 'PRESET';
};

export const dyeValue = (color, level) => DYE_PREFIX + color + (level ? ` ระดับ ${level}` : '');

/**
 * ค่า lens_tint ที่จะส่งบันทึก — เลือกย้อมสีชนะเสมอ · ไม่ย้อมแล้วล้างเฉพาะค่าย้อมเดิม
 * ค่าที่มาจากเลนส์ในสต็อกต้องอยู่ต่อ ไม่งั้นกดบันทึกซ้ำแล้วคุณสมบัติเลนส์หาย
 */
export const lensTintForSave = (dyeColor, dyeLevel, current) => {
  if (dyeColor) return dyeValue(dyeColor, dyeLevel);
  return dyeColorOf(current) ? '' : current;
};
