/**
 * โควตารูปของกล่องแนบไฟล์ แยกออกมาจาก PhotoUpload.jsx เพื่อให้เทสต์ได้
 * โดยไม่ต้อง mount React
 */

/** กล่อง "รูปภาพการวัด" ของขั้นวัด Center รับได้ 10 ใบต่อเคส — ฝั่ง API บังคับซ้ำอีกชั้น */
export const CENTERING_PHOTO_MAX = 10;

/**
 * เลือกไฟล์มา `picked` ใบ ในกล่องที่มีอยู่แล้ว `current` ใบ จะรับได้กี่ใบ
 *
 * รับเท่าที่โควตาเหลือแทนที่จะล้มทั้งชุด เพราะพนักงานเลือกรูปทีเดียวจากกล้อง
 * `max` ที่เป็น null/0 แปลว่ากล่องนั้นไม่จำกัด (สลิปโอนเงิน, ไฟล์ส่งมอบ)
 */
export function photoUploadPlan(picked, current, max) {
  if (!max) return { accept: picked, skipped: 0, full: false };
  const room = Math.max(0, max - current);
  const accept = Math.min(picked, room);
  return { accept, skipped: picked - accept, full: room === 0 };
}
