/**
 * สิทธิ์ผู้ใช้ — ฝั่งหน้าเว็บ ใช้ร่วมกันทั้งสองฝั่งของแอป
 *
 * ของจริงอยู่ที่ `stock/api/src/Roles.php` และ API ตรวจซ้ำทุกคำขออยู่แล้ว
 * ไฟล์นี้มีไว้ตอบคำถามของหน้าจอเท่านั้น: จะวาดปุ่มนี้ไหม จะพาไปหน้าไหน
 * ซ่อนปุ่มที่ API จะปฏิเสธอยู่ดีเป็นมารยาท ไม่ใช่ด่านกัน
 *
 * ── ไม่มีสำเนาของกฎอยู่ในไฟล์นี้แล้ว ──────────────────────────────────────
 * เมื่อก่อนที่นี่ถือตาราง `RANK` คัดลอกมาจาก PHP แล้วคำนวณเองว่าใครทำอะไรได้
 * ซึ่งแปลว่าเพิ่มบทบาทหรือขยับสิทธิ์หนึ่งข้อ ต้องแก้สองที่ให้ตรงกัน และวันที่
 * แก้ไม่ครบ หน้าจอจะวาดปุ่มที่ API ปฏิเสธ หรือซ่อนปุ่มที่จริง ๆ กดได้
 *
 * ตอนนี้ API ส่งสิทธิ์ที่คำนวณแล้วมากับ actor (`actor.perms` — ยูเนียนของทุก
 * บทบาทที่ถือ) ทุกฟังก์ชันข้างล่างจึงเป็นแค่การถามว่าชื่อนี้อยู่ในรายการไหม
 * ชื่อสิทธิ์ทั้งหมดดูได้ที่ `Roles::PERMS` ฝั่ง PHP หรือที่ `/api/auth/policy`
 */

export const ROLE = {
  SUPERUSER: 'superuser',
  OWNER: 'owner',
  ADMIN: 'admin',
  SALES: 'sales',
  TRAINEE: 'trainee',
  STOCK: 'stock',
  ACCOUNTING: 'accounting',
};

/**
 * คนนี้มีสิทธิ์ชื่อนี้ไหม
 *
 * @param {{perms?: string[]} | null | undefined} actor
 * @param {string} perm ชื่อสิทธิ์ เช่น 'cost.view'
 */
export const can = (actor, perm) => Array.isArray(actor?.perms) && actor.perms.includes(perm);

/** เงินของร้าน — รายรับ รายจ่าย รายงาน ซัพพลายเออร์ */
export const inMoneyZone = (actor) => can(actor, 'money.zone');

/** ข้อมูลระบบ — พนักงาน ผู้ใช้ ตั้งค่า บันทึกการใช้งาน */
export const inSystemZone = (actor) => can(actor, 'system.zone');

/**
 * อยู่ในโซนแอดมินสักโซน — ใช้ตอบว่า "แถบข้างควรสลับเป็นเมนูโซนแอดมินไหม"
 *
 * เคยเป็นสิทธิ์เดียวชื่อ `admin.zone` · ตั้งแต่มีบทบาทบัญชี คำถามที่แท้จริงของแต่ละ
 * จุดเรียกไม่เหมือนกันอีกแล้ว — ปุ่มยกเลิกใบขายถาม `inSystemZone` หน้ารายรับถาม
 * `inMoneyZone` · ตัวนี้เหลือไว้ให้เฉพาะคำถามที่กว้างจริง ๆ คือเรื่องรูปร่างของเมนู
 */
export const isAdminUp = (actor) => inMoneyZone(actor) || inSystemZone(actor);

/**
 * ทำงานได้มากกว่าหนึ่งฝั่ง จึงต้องเลือกเองว่าจะเข้าฝั่งไหน
 *
 * "ฝั่งหน้าร้าน" ในที่นี้หมายถึงเว็บฝั่งนี้ทั้งใบ ไม่ใช่เฉพาะเมนูขายของ — โซน
 * แอดมิน (รายรับ รายจ่าย รายงาน ตั้งค่า) อยู่ในเว็บใบเดียวกัน · บัญชีเปิด POS
 * และเคสไม่ได้ แต่มีงานอยู่ในเว็บฝั่งนี้จริง และมีงานอยู่ฝั่งคลังด้วย ปุ่มข้ามฝั่ง
 * จึงต้องขึ้นให้เขา ไม่งั้นเข้าไปดูมูลค่าคลังไม่ได้เลยทั้งที่ถือสิทธิ์อยู่
 */
export const worksBothSides = (actor) =>
  (can(actor, 'frontdesk.use') || inMoneyZone(actor) || inSystemZone(actor))
  && can(actor, 'stock.use');

/** งานระบบ ไม่ใช่งานของร้าน */
export const isSuperuser = (actor) => can(actor, 'system.manage');

/**
 * ฝั่งไหนที่คนนี้เข้าได้บ้าง — ใช้เด้งคนที่เดินมาผิดฝั่ง
 *
 * พนักงานคลังเปิดหน้าร้านแล้วไม่มีอะไรให้ทำ · ต่างจากเมื่อก่อนตรงที่ตอนนี้
 * API ปฏิเสธ `/api/*` ทั้งกลุ่มให้ด้วย (ดูประตูที่สองใน `api/index.php`)
 * ตรงนี้จึงเป็นแค่การไม่ปล่อยให้คนยืนอยู่หน้าจอที่ทุกคำขอตอบ 403
 */
export const mayUseFrontdesk = (actor) => can(actor, 'frontdesk.use');
export const mayUseStock = (actor) => can(actor, 'stock.use');

/** ดูเคสลูกค้าได้ทุกใบ — ทุกคนที่ทำงานหน้าร้านมีสิทธิ์นี้ */
export const mayViewAllCases = (actor) => can(actor, 'case.view_all');

/** รหัสถูกตั้งโดยคนอื่น — ต้องตั้งใหม่ก่อนใช้งานต่อ */
export const mustChangePassword = (actor) => actor?.mustChangePassword === true;

/** "Owner + Admin" — ข้อความบทบาทที่ API ประกอบมาให้แล้ว */
export const roleTextOf = (actor) => actor?.roleText || '—';

/**
 * หน้าแรกของคนคนนี้ ตามที่ API บอกมา
 *
 * เผื่อ actor รุ่นเก่าที่ยังไม่มี `home` ติดมา (คุกกี้ค้างจากก่อนอัปเดต) จึงมี
 * ค่าสำรองให้ แต่ค่าที่ถูกต้องคือค่าที่มาจาก API เสมอ
 */
export function homeFor(actor) {
  if (actor?.home) return actor.home;
  /* รูปเดียวกับ `Roles::home` ฝั่ง PHP เป๊ะ — ไม่ได้เรียก worksBothSides ตรงนี้
     เพราะตัวนั้นนับโซนแอดมินเป็นฝั่งด้วย ซึ่งจะพาบัญชีไปหน้าเลือกระบบ ทั้งที่
     งานแรกของวันเขาคือรายรับ · สองไฟล์นี้ต้องตอบเหมือนกัน ไม่งั้นคุกกี้เก่า
     กับคำตอบจาก API จะพาไปคนละหน้า */
  if (mayUseFrontdesk(actor) && mayUseStock(actor)) return '/hub/';
  if (!mayUseFrontdesk(actor) && inMoneyZone(actor)) return '/income/';
  return mayUseStock(actor) ? '/stock/dashboard/' : '/';
}

/**
 * งานของแอดมิน — เงินของร้าน และข้อมูลระบบ
 *
 * เป็นแค่คำตอบสำหรับหน้าจอว่า "จะวาดเมนูนี้ไหม" · ด่านจริงอยู่ที่ `api/index.php`
 * ซึ่งกันด้วยคำนำหน้าเส้นทางชุดเดียวกับลิสต์ข้างล่างนี้ · สองที่ต้องตรงกัน
 * เพิ่มหน้าใหม่ในกลุ่มนี้เมื่อไหร่ ต้องเติมทั้งสองที่
 *
 * ข้อยกเว้นเดียวคือ `/users` ที่ไม่มีคู่ของมันใน `ADMIN_PREFIXES` ฝั่ง PHP —
 * ข้อมูลบัญชีอยู่ในตาราง `admins` ซึ่งเป็นของ API ฝั่งคลัง (`/stock-api/users`)
 * และถูกกันด้วย `Roles::require()` ที่นั่นทุกคำขออยู่แล้ว · ที่ต้องมีในลิสต์นี้
 * เพราะ `Shell.jsx` ใช้ลิสต์เดียวกันตัดสินว่ากำลังอยู่ "โซนแอดมิน" ไหม ถ้าไม่มี
 * แถบข้างจะสลับกลับไปเป็นเมนูหน้าร้านทันทีที่เปิดหน้านี้ — เมนูที่พาไปกระโดด
 * ออกจากกลุ่มของตัวเอง
 */
export const MONEY_PATHS = ['/income', '/expense', '/reports', '/suppliers'];
export const SYSTEM_PATHS = ['/employees', '/users', '/settings', '/logs', '/lens-catalog'];

/* สองกลุ่มรวมกัน — ใช้ตอบว่ากำลังยืนอยู่ในโซนแอดมินไหม ไม่ได้ใช้ตัดสินสิทธิ์
   คำตอบเรื่องสิทธิ์อยู่ที่ `inMoneyZone` / `inSystemZone` ทีละหน้า */
export const ADMIN_PATHS = [...MONEY_PATHS, ...SYSTEM_PATHS];

export const isAdminPath = (path) => ADMIN_PATHS.some(
  (p) => path === p || path.startsWith(`${p}/`),
);
