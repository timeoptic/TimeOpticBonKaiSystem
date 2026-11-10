/**
 * สถานะใบเบิกเลนส์ — ต้องตรงกับ LensRequisition::transitionError ฝั่ง API
 * (api/services/LensRequisition.php) หน้าเว็บแค่ซ่อนปุ่มที่กดแล้วจะโดนปฏิเสธ
 */
export const FLOW = ['pending', 'issued', 'ordered', 'received', 'assembled'];

export const STATUS_LABEL = {
  pending: 'รอเบิก',
  issued: 'ส่งรายการเบิกแล้ว',
  ordered: 'กำลังตัด/ผลิต',
  received: 'ได้รับเลนส์แล้ว',
  assembled: 'ประกอบแล้ว',
  cancelled: 'ยกเลิก',
};

/** สีของ Badge (คลาสที่ globals.css มีอยู่แล้ว) */
export const STATUS_TONE = {
  pending: 'warn',
  issued: 'blue',
  ordered: 'blue',
  received: 'mint',
  assembled: 'ok',
  cancelled: 'danger',
};

/** รหัสสถานะที่ใช้คุยกับ TimeOptic และในไฟล์ Export — ตรงกับ LensRequisition::CODE */
export const STATUS_CODE = {
  pending: 'PENDING',
  issued: 'REQUESTED',
  ordered: 'PROCESSING',
  received: 'RECEIVED',
  assembled: 'ASSEMBLED',
  cancelled: 'CANCELLED',
};

export const EYE_LABEL = { R: 'ขวา (R)', L: 'ซ้าย (L)', pair: 'คู่' };

/** ปุ่มที่กดได้จากสถานะนี้ — เดินหน้าหรือข้ามขั้นได้ ย้อนไม่ได้ · ไม่มีค่าสายตาเหลือแค่ยกเลิก */
export function nextActions(status, hasRx) {
  if (status === 'cancelled' || status === 'assembled') return [];
  const ahead = hasRx ? FLOW.slice(FLOW.indexOf(status) + 1) : [];
  return [...ahead, 'cancelled'].map((to) => ({ to, label: STATUS_LABEL[to] }));
}

/** รายละเอียดเลนส์หนึ่งบรรทัด */
export const lensSpecText = (it) => [
  it.brand, it.lens_type, it.design, it.lens_index, it.coating, it.option_name, it.photochromic, it.color,
].filter(Boolean).join(' · ');

/** สถานะคำขอฝั่งคลัง TimeOptic ("คำขอจากสาขา") → สีของ Badge · ตรงกับ TimeOpticRequests::LABEL */
export const TIMEOPTIC_TONE = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
  cancelled: 'gray',
};
