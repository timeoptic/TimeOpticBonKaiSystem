/**
 * ตรรกะของหน้าดูรูปใหญ่ (components/Lightbox.jsx) ที่ไม่ต้องมี React
 *
 * แยกออกมาเพื่อเทสต์ด้วย node --test ได้โดยไม่ต้อง mount อะไร · ทุกตัวเป็นฟังก์ชัน
 * บริสุทธิ์ รับตัวเลขคืนตัวเลข — คอมโพเนนต์เป็นแค่คนต่อสายจากเหตุการณ์ของเมาส์
 * กับนิ้วมาหาฟังก์ชันพวกนี้
 */

/** ขนาดพอดีจอคือ 1 · ย่อเล็กกว่านั้นไม่มีประโยชน์ รูปก็อยู่ครบในกรอบอยู่แล้ว */
export const ZOOM_MIN = 1;

/** ห้าเท่าพอจะอ่านตัวเลขเล็กสุดบนสลิปธนาคารที่ถ่ายจากมือถือ เกินนั้นเห็นแต่พิกเซล */
export const ZOOM_MAX = 5;

/** ปุ่ม + / − หนึ่งครั้ง */
const ZOOM_STEP = 1.25;

/** ความไวของล้อเมาส์ — หนึ่งคลิกล้อ (deltaY ≈ 100) ขยายราว 22% */
const WHEEL_RATE = 0.002;

/** ระยะนิ้วที่นับว่าตั้งใจปัด ไม่ใช่นิ้วสั่นตอนแตะ */
export const SWIPE_MIN_PX = 50;

/** ลำดับรูปวนรอบ — ถัดจากใบสุดท้ายคือใบแรก · ไม่มีรูปเลยได้ 0 ไม่ใช่ NaN */
export function wrapIndex(i, n) {
  if (!(n > 0)) return 0;
  return ((i % n) + n) % n;
}

/** "3 / 10" — คนนับรูปจากหนึ่ง */
export const counterLabel = (i, n) => `${i + 1} / ${n}`;

export function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/**
 * ปุ่ม + (dir > 0) และ − (dir < 0)
 *
 * คูณแล้วหารด้วยทศนิยมกลับมาได้ 0.9999… ไม่ใช่ 1 แล้วรูปก็ยังเลื่อนได้นิดหนึ่งทั้งที่
 * ควรอยู่นิ่งกลางจอ จึงดีดกลับเป็นขนาดพอดีจอพอดีเมื่อเข้าใกล้
 */
export function stepZoom(z, dir) {
  const next = clampZoom(dir > 0 ? z * ZOOM_STEP : z / ZOOM_STEP);
  return next - ZOOM_MIN < 0.01 ? ZOOM_MIN : next;
}

/**
 * ล้อเมาส์กับ trackpad
 *
 * เป็นสัดส่วนของ deltaY ไม่ใช่ขั้นคงที่ — trackpad ส่ง deltaY ละเอียดเป็นสิบ ๆ ครั้ง
 * ต่อการปัดหนึ่งที ถ้าทุกครั้งกระโดดเท่าปุ่ม + รูปจะพุ่งไปเพดานในเสี้ยววินาที
 */
export function wheelZoom(z, deltaY) {
  const next = clampZoom(z * Math.exp(-deltaY * WHEEL_RATE));
  return next - ZOOM_MIN < 0.001 ? ZOOM_MIN : next;
}

/** สองนิ้ว — ขยายตามสัดส่วนระยะห่างนิ้วเทียบกับตอนเริ่มบีบ */
export function pinchZoom(startZoom, startDist, dist) {
  if (!(startDist > 0)) return startZoom;
  return clampZoom(startZoom * (dist / startDist));
}

/**
 * ปัดนิ้วตอนรูปขนาดพอดีจอ: ไปทางซ้าย = รูปถัดไป (1) · ไปทางขวา = ก่อนหน้า (-1) · อื่น ๆ 0
 *
 * แนวตั้งต้องน้อยกว่าแนวนอน — คนที่ไถลงเพราะจะปิด หรือนิ้วเฉียงโดยไม่ตั้งใจ ต้องไม่ถูก
 * พาไปรูปอื่น
 */
export function swipeStep(dx, dy, threshold = SWIPE_MIN_PX) {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * ขอบการเลื่อนรูปตอนขยาย
 *
 * `width`/`height` คือขนาดที่รูปแสดงอยู่ตอนพอดีจอ (ก่อน scale) · ขยาย `zoom` เท่าแล้ว
 * รูปล้นกรอบเดิมข้างละ `width·(zoom−1)/2` — เลื่อนเกินนั้นคือลากขอบรูปเข้ามาจนเห็น
 * พื้นหลังดำ · `|| 0` กัน -0 หลุดออกไป
 */
export function clampPan(x, y, zoom, width, height) {
  const maxX = Math.max(0, (width * (zoom - 1)) / 2);
  const maxY = Math.max(0, (height * (zoom - 1)) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)) || 0,
    y: Math.min(maxY, Math.max(-maxY, y)) || 0,
  };
}

/** เปิดใน lightbox ได้เฉพาะรูป · PDF ยังเปิดแท็บใหม่ให้เบราว์เซอร์แสดงเอง */
export function isPreviewable(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}
