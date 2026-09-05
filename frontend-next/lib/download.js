/**
 * งานท้ายทางของการส่งออกไฟล์ — ตั้งชื่อ แกะชื่อที่เซิร์ฟเวอร์ส่งมา แล้วสั่งบันทึก
 *
 * แยกจาก `exportCsv.js` เพราะไฟล์นั้นเป็นเรื่องของ "การประกอบ CSV" ส่วนที่นี่ใช้
 * ร่วมกับไฟล์ที่เซิร์ฟเวอร์สร้างให้ด้วย (รายงาน .xlsx) ซึ่งไม่ได้ประกอบในเบราว์เซอร์
 * เลยสักไบต์
 */

/** ชื่อไฟล์ที่ Windows ยอมรับ — อักขระต้องห้ามกลายเป็นขีด ไม่ใช่ถูกลบจนชื่อติดกัน */
export function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * ชื่อไฟล์จากหัว Content-Disposition
 *
 * อ่าน `filename*=` ก่อนเสมอ — เป็นรูปแบบเดียว (RFC 5987) ที่เก็บชื่อภาษาไทยได้
 * ส่วน `filename=` ธรรมดาที่ตามมาเป็นชื่อสำรองแบบ ASCII สำหรับตัวที่อ่านไม่เป็น
 *
 * คืน '' เมื่อไม่มีหัวนี้ ซึ่งเกิดได้จริงเวลาเรียกข้ามพอร์ตโดยเซิร์ฟเวอร์ไม่ได้
 * ประกาศ Access-Control-Expose-Headers — ผู้เรียกต้องมีชื่อสำรองของตัวเองเสมอ
 */
export function fileNameFromDisposition(header) {
  const h = String(header || '');
  const star = h.match(/filename\*=\s*UTF-8''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* ชื่อที่เข้ารหัสมาไม่ครบ — ตกไปใช้ filename= ธรรมดาแทน */
    }
  }
  const plain = h.match(/filename=\s*"([^"]+)"|filename=\s*([^;]+)/i);
  return (plain ? plain[1] || plain[2] : '').trim();
}

/**
 * สั่งเบราว์เซอร์บันทึก blob ลงเครื่อง — เรียกได้เฉพาะฝั่งเบราว์เซอร์
 *
 * ต้องคืนหน่วยความจำของ blob เอง ไม่งั้นไฟล์ทั้งก้อนค้างอยู่จนกว่าจะปิดแท็บ
 * ซึ่งกับรายงานทั้งปีคือหลายเมกะไบต์ต่อการกดหนึ่งครั้ง
 */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
