/**
 * ปุ่ม "เปลี่ยนลูกค้า" บนหัวหน้าเคส — ป้ายไทม์ไลน์ของเหตุการณ์ที่ปุ่มนี้ลง
 *
 * อยู่ที่นี่ ไม่ได้อยู่ใน ACTION_LABEL ของ lib/constants.js เพราะไฟล์นั้นอยู่ใน chunk
 * ที่แทบทุกหน้าโหลด เพิ่มบรรทัดที่นั่น = ต้องขึ้นหน้าเว็บใหม่ทุกหน้า (เหตุผลเดียวกับ
 * SEND_EVENT_LABEL ใน lib/centeringSend.js) · ผู้อ่าน: TimelinePanel, หน้าเคส
 */
export const CUSTOMER_EVENT_LABEL = {
  customer_changed: 'เปลี่ยนลูกค้า',
  /* ปุ่ม "เติมข้อมูลลูกค้า" ในขั้นรับลูกค้า (POST /api/customers/:id/fill) */
  customer_filled: 'เติมข้อมูลลูกค้า',
  /* ปุ่มดินสอข้างวันเปิดบิล ในรายงานงานตัดแว่น (PUT /api/orders/:id/order-date) */
  order_date_changed: 'แก้วันเปิดบิล',
};
