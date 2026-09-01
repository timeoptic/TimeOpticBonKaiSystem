/**
 * บทบาทผู้ใช้ — ฝั่งหน้าเว็บ ใช้ร่วมกันทั้งสองฝั่งของแอป
 *
 * ของจริงอยู่ที่ `stock/api/src/Roles.php` และ API ตรวจซ้ำทุกคำขออยู่แล้ว
 * ไฟล์นี้มีไว้ตอบคำถามของหน้าจอเท่านั้น: จะวาดปุ่มนี้ไหม จะพาไปหน้าไหน
 * ซ่อนปุ่มที่ API จะปฏิเสธอยู่ดีเป็นมารยาท ไม่ใช่ด่านกัน
 *
 * `home` ไม่ได้คำนวณที่นี่ — มันมากับ actor จาก API (`actor.home`) จะได้ไม่มี
 * กฎสองชุดที่ต้องคอยแก้ให้ตรงกัน ตัวที่อยู่ตรงนี้คือ `RANK` ซึ่งสะท้อน
 * `Roles::RANK` ฝั่ง PHP · เพิ่มบทบาทใหม่เมื่อไหร่ ต้องแก้สองที่
 */

export const ROLE = {
  SUPERUSER: 'superuser',
  OWNER: 'owner',
  ADMIN: 'admin',
  SALES: 'sales',
  STOCK: 'stock',
};

/** พนักงานขายกับพนักงานคลังอยู่ระดับเดียวกัน — คนละงาน ไม่ใช่คนละชั้น */
const RANK = {
  [ROLE.SUPERUSER]: 4,
  [ROLE.OWNER]: 3,
  [ROLE.ADMIN]: 2,
  [ROLE.SALES]: 1,
  [ROLE.STOCK]: 1,
};

/** @param {{role?: string} | null | undefined} actor */
export const rank = (actor) => RANK[actor?.role ?? ''] ?? 0;

/** ตั้งแต่แอดมินขึ้นไป — ต้นทุน แคตตาล็อก เงินของสาขา จัดการผู้ใช้ */
export const isAdminUp = (actor) => rank(actor) >= RANK[ROLE.ADMIN];

/** ทำงานได้ทั้งสองฝั่ง จึงต้องเลือกเองว่าจะเข้าฝั่งไหน */
export const worksBothSides = isAdminUp;

/** งานระบบ ไม่ใช่งานของร้าน */
export const isSuperuser = (actor) => actor?.role === ROLE.SUPERUSER;

/**
 * หน้าแรกของคนคนนี้ ตามที่ API บอกมา
 *
 * เผื่อ actor รุ่นเก่าที่ยังไม่มี `home` ติดมา (คุกกี้ค้างจากก่อนอัปเดต) จึงมี
 * ค่าสำรองให้ แต่ค่าที่ถูกต้องคือค่าที่มาจาก API เสมอ
 */
export function homeFor(actor) {
  if (actor?.home) return actor.home;
  if (actor?.role === ROLE.SALES) return '/';
  if (actor?.role === ROLE.STOCK) return '/stock/';
  return '/hub/';
}

/**
 * ฝั่งไหนที่บทบาทนี้เข้าได้บ้าง — ใช้เด้งคนที่เดินมาผิดฝั่ง
 *
 * พนักงานขายเปิด /stock ไม่มีอะไรให้ทำ และพนักงานคลังเปิดหน้าร้านก็เหมือนกัน
 * ไม่ใช่เรื่องความปลอดภัย (API กันของจริงอยู่แล้ว) แต่เป็นเรื่องไม่ปล่อยให้คน
 * ยืนอยู่หน้าจอที่ทุกปุ่มตอบว่าไม่มีสิทธิ์
 */
export const mayUseFrontdesk = (actor) => rank(actor) > 0 && actor.role !== ROLE.STOCK;
export const mayUseStock = (actor) => rank(actor) > 0 && actor.role !== ROLE.SALES;
