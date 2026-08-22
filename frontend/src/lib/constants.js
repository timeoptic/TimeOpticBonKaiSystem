/** Vocabulary that lives in the front-end rather than the database. */

export const STAGE_META = {
  reception: { label: 'รับลูกค้า', color: '#7a5cc4', icon: '🛎' },
  exam: { label: 'วัดสายตา', color: '#2f6fd0', icon: '👁' },
  sales: { label: 'ขาย/เลือกกรอบ', color: '#0f8f8f', icon: '🛍' },
  production: { label: 'ผลิต/เลนส์', color: '#c07000', icon: '🔧' },
  qc: { label: 'ตรวจ QC', color: '#b32020', icon: '🔍' },
  delivery: { label: 'ส่งมอบ', color: '#127a4a', icon: '📦' },
  done: { label: 'จบงาน', color: '#6b7a90', icon: '✅' },
};

export const stageInfo = (g) =>
  STAGE_META[g] || { label: g || '-', color: '#6b7a90', icon: '•' };

/** the board's columns, in workflow order */
export const STAGE_GROUPS = ['reception', 'exam', 'sales', 'production', 'qc', 'delivery'];

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
