/** Vocabulary that lives in the front-end rather than the database. */
import { CASE_PROCESSES } from './caseProcesses.js';

/* The 9 processes are configured in one place — lib/caseProcesses.js. These
   two exports are the shape the board, StatusChip and the dashboard already
   read, derived from that config so there is only ever one list to edit. */
export const STAGE_META = Object.fromEntries(
  CASE_PROCESSES.map((p) => [p.id, { label: p.label, color: p.color, icon: p.icon }])
);

export const stageInfo = (g) =>
  STAGE_META[g] || { label: g || '-', color: '#6b7a90', icon: '•' };

/** the board's columns, in workflow order (จบงาน is added by the board itself) */
export const STAGE_GROUPS = CASE_PROCESSES.filter((p) => p.id !== 'done').map((p) => p.id);

export const ACTION_LABEL = {
  case_opened: 'เปิดเคส',
  status_change: 'เปลี่ยนสถานะ',
  note: 'บันทึก',
  prescription_added: 'บันทึกค่าสายตา',
  prescription_confirmed: 'ยืนยันค่าสายตา',
  order_created: 'เปิดออเดอร์',
  order_filled: 'เติมของเข้าออเดอร์',
  order_closed: 'ปิดการขาย',
  order_reopened: 'เปิดออเดอร์อีกครั้ง',
  payment: 'รับเงิน',
  payment_deleted: 'ลบรายการรับเงิน',
  lens_job_saved: 'บันทึกงานเลนส์',
  lens_followup: 'ติดตามเลนส์',
  lens_received: 'รับเลนส์เข้าร้าน',
  centering_saved: 'บันทึกจุดศูนย์กลาง',
  frame_fitting_saved: 'บันทึกการวัดกรอบ',
  production_saved: 'บันทึกงานผลิต',
  qc_pass: 'QC ผ่าน',
  qc_fail: 'QC ไม่ผ่าน',
  customer_notified: 'ติดต่อลูกค้า',
  production_started: 'เริ่มผลิต',
  production_withdraw_extra: 'เบิกสินค้าเพิ่ม',
  production_paused: 'หยุดผลิต / รอสินค้า',
  production_resumed: 'กลับมาผลิตต่อ',
  production_completed: 'ปิดงานผลิต',
  delivered: 'ส่งมอบสินค้า',
  payment_cancelled: 'ยกเลิกรายการรับเงิน',
  photo_uploaded: 'แนบรูป/ไฟล์',
  process_started: 'เริ่มขั้นตอน',
  process_completed: 'ยืนยันขั้นตอนเสร็จ',
  process_reopened: 'เปิดขั้นตอนกลับมาแก้ไข',
  process_status: 'เปลี่ยนสถานะขั้นตอน',
  photo_deleted: 'ลบรูป/ไฟล์',
  /* rows written by the old Node app, still in case_events */
  advance: 'เลื่อนขั้นตอน',
  edit: 'แก้ไขข้อมูลเคส',
  open: 'เปิดเคส',
};

export const RX_KIND_LABEL = { old: 'ค่าเดิม', measured: 'ที่วัดได้', final: 'ที่ใช้จริง' };

export const BOOKING_STATUS_CLASS = {
  booked: 'blue', confirmed: 'blue', arrived: 'warn', in_service: 'warn',
  done: 'ok', no_show: 'danger', cancelled: 'gray',
};

export const BOOKING_STEP_LABEL = {
  intake: 'รับจอง / สอบถาม', confirm: 'ยืนยันคิว', arrive: 'ลูกค้ามาถึง',
  handoff: 'ส่งต่อฝ่ายขาย', followup: 'ติดตามผล', other: 'อื่น ๆ',
};

export const BOOKING_STEPS = [
  ['intake', 'รับจอง / สอบถาม'], ['confirm', 'ยืนยันคิว'], ['arrive', 'ลูกค้ามาถึง'],
  ['handoff', 'ส่งต่อให้ฝ่ายขาย'], ['followup', 'ติดตามผล'], ['other', 'อื่น ๆ'],
];

export const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

export const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export const SHOP = {
  name: 'TIME OPTIC',
  tagline: 'ร้านแว่นตาไทม์ออพติก',
  line2: 'โทร. ___-___-____',
};

export const NATIONALITIES = ['Thai', 'NewZealand', 'Australian', 'British', 'American', 'Japanese'];

export const BRANDS = ['Hoya', 'Hitop', 'Tantawan', 'Coach', 'SP Optic', 'RayBan', 'Maxim', 'Acuvue', 'B&L'];
