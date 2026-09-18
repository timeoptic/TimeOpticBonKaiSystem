/**
 * ตาราง "รายละเอียดรายการรับเงิน" ของหน้า รายงาน > การรับเงิน — ส่วนที่ไม่ใช่หน้าตา
 *
 * แยกจากหน้าเว็บให้เทสต์ได้โดยไม่ต้อง render (lib/__tests__/paymentTx.test.js)
 */

/**
 * ป้ายของตัวกรอง "แหล่งที่มา" — ช่อง `channel` ตัวเดิมของทุกหน้ารายงาน เปลี่ยนแค่ป้าย
 *
 * หน้าการรับเงินพูดถึงเงินที่มาจากไหน ไม่ใช่ช่องทางขาย และคำว่า "ช่องทาง" ในหน้านี้
 * ถูกใช้กับช่องทางชำระเงินไปแล้ว (กราฟวงกลม) · คีย์ต้องตรงกับ CHANNELS ทุกตัว
 */
export const SOURCES = [
  ['all', 'ทั้งหมด'],
  ['main', 'งานตัดแว่น'],
  ['pos', 'POS หน้าร้าน'],
];

/**
 * เลขอ้างอิงของเงินก้อนหนึ่งกดแล้วไปไหน — `open` มาจาก PaymentExport ฝั่ง API
 *
 * ขายสินค้าระบบเดิมได้ `open = null` เพราะไม่มีหน้ารายละเอียด · คืน null ให้หน้าเว็บ
 * แสดงเป็นข้อความธรรมดา ดีกว่าลิงก์ที่พาไปหน้า "ไม่พบรายการ"
 */
export function openHref(open) {
  if (!open) return null;
  switch (open.kind) {
    case 'case': return `/cases/detail?id=${open.id}`;
    case 'order': return `/orders/detail?id=${open.id}`;
    case 'pos': return `/pos/detail?id=${open.id}`;
    default: return null;
  }
}
