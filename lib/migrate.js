// TimeOptic Web — additive migrations.
// These only CREATE TABLE IF NOT EXISTS. Nothing in the original 27-table
// schema is altered or dropped.
import { pool } from './db.js';

const CHARSET = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

const TABLES = {
  /* key/value settings (Telegram bot config, shop defaults) */
  app_settings: `CREATE TABLE IF NOT EXISTS app_settings (
    \`key\`     varchar(64) NOT NULL,
    \`value\`   text DEFAULT NULL,
    updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (\`key\`)
  ) ${CHARSET}`,

  /* advance queue bookings (จองคิวล่วงหน้า) */
  bookings: `CREATE TABLE IF NOT EXISTS bookings (
    id               int(10) unsigned NOT NULL AUTO_INCREMENT,
    booking_code     varchar(40) NOT NULL,
    customer_id      int(10) unsigned DEFAULT NULL,
    case_id          int(10) unsigned DEFAULT NULL,
    first_name       varchar(100) DEFAULT NULL,
    last_name        varchar(100) DEFAULT NULL,
    phone            varchar(40)  DEFAULT NULL,
    line_id          varchar(80)  DEFAULT NULL,
    booking_date     date NOT NULL,
    booking_time     time NOT NULL,
    duration_min     smallint(6) NOT NULL DEFAULT 30,
    service_type     varchar(60) NOT NULL DEFAULT 'eye_exam',
    channel          varchar(30) NOT NULL DEFAULT 'phone',
    status           varchar(20) NOT NULL DEFAULT 'booked',
    assigned_to      int(10) unsigned DEFAULT NULL,
    reminder_minutes smallint(6) NOT NULL DEFAULT 10,
    reminder_sent_at datetime DEFAULT NULL,
    confirmed_at     datetime DEFAULT NULL,
    arrived_at       datetime DEFAULT NULL,
    cancelled_reason varchar(255) DEFAULT NULL,
    intake_note      text DEFAULT NULL,
    notes            text DEFAULT NULL,
    created_by       int(10) unsigned DEFAULT NULL,
    created_at       datetime NOT NULL DEFAULT current_timestamp(),
    updated_at       datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_booking_code (booking_code),
    KEY idx_booking_day (booking_date, booking_time),
    KEY idx_booking_status (status, booking_date),
    KEY idx_booking_reminder (reminder_sent_at, booking_date),
    KEY fk_booking_customer (customer_id),
    KEY fk_booking_case (case_id),
    KEY fk_booking_emp (assigned_to),
    KEY fk_booking_creator (created_by),
    CONSTRAINT fk_booking_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
    CONSTRAINT fk_booking_case     FOREIGN KEY (case_id)     REFERENCES cases (id)     ON DELETE SET NULL,
    CONSTRAINT fk_booking_emp      FOREIGN KEY (assigned_to) REFERENCES employees (id) ON DELETE SET NULL,
    CONSTRAINT fk_booking_creator  FOREIGN KEY (created_by)  REFERENCES employees (id) ON DELETE SET NULL
  ) ${CHARSET}`,

  /* บันทึกเบื้องต้นทีละขั้นตอน — one row per question/answer captured */
  booking_notes: `CREATE TABLE IF NOT EXISTS booking_notes (
    id          int(10) unsigned NOT NULL AUTO_INCREMENT,
    booking_id  int(10) unsigned NOT NULL,
    case_id     int(10) unsigned DEFAULT NULL,
    step        varchar(40) NOT NULL DEFAULT 'intake',
    question    varchar(200) DEFAULT NULL,
    note        text NOT NULL,
    recorded_by int(10) unsigned DEFAULT NULL,
    created_at  datetime NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (id),
    KEY idx_bn_booking (booking_id, created_at),
    KEY fk_bn_case (case_id),
    KEY fk_bn_emp (recorded_by),
    CONSTRAINT fk_bn_booking FOREIGN KEY (booking_id)  REFERENCES bookings (id)  ON DELETE CASCADE,
    CONSTRAINT fk_bn_case    FOREIGN KEY (case_id)     REFERENCES cases (id)     ON DELETE SET NULL,
    CONSTRAINT fk_bn_emp     FOREIGN KEY (recorded_by) REFERENCES employees (id) ON DELETE SET NULL
  ) ${CHARSET}`,

  /* every Telegram (or other) message we tried to send */
  notification_log: `CREATE TABLE IF NOT EXISTS notification_log (
    id         int(10) unsigned NOT NULL AUTO_INCREMENT,
    channel    varchar(20) NOT NULL DEFAULT 'telegram',
    kind       varchar(40) NOT NULL DEFAULT 'booking_reminder',
    booking_id int(10) unsigned DEFAULT NULL,
    target     varchar(120) DEFAULT NULL,
    message    text DEFAULT NULL,
    ok         tinyint(1) NOT NULL DEFAULT 0,
    error      varchar(255) DEFAULT NULL,
    created_at datetime NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (id),
    KEY idx_nl_created (created_at),
    KEY fk_nl_booking (booking_id),
    CONSTRAINT fk_nl_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE SET NULL
  ) ${CHARSET}`,

  /* ============================ INVENTORY (v2) ========================
     แทนที่ตาราง `stock` เดิม (1 แถว = 1 ชิ้นจริง) ด้วยระบบ SKU + Lot
     categories ซ้ำซ้อนกับ list_product_type ที่มีอยู่แล้วโดยตั้งใจ —
     list_product_type เป็น enum ตายตัว 5 ค่า ส่วน categories เป็นตารางเปิด
     ให้เพิ่มหมวดหมู่เองได้ทีหลังโดยไม่ต้องแก้โค้ด seed จาก list_product_type
     ตอน migrate() ครั้งแรกเท่านั้น */
  categories: `CREATE TABLE IF NOT EXISTS categories (
    id         int(10) unsigned NOT NULL AUTO_INCREMENT,
    name       varchar(100) NOT NULL COMMENT 'ชื่อหมวดหมู่',
    code       varchar(20) NOT NULL COMMENT 'รหัสหมวดหมู่ เช่น Lens, Frame',
    created_at datetime NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_category_code (code)
  ) ${CHARSET}`,

  /* สินค้าระดับ SKU — ราคา/สเปกอยู่ที่นี่ที่เดียว ไม่ซ้ำต่อชิ้นเหมือนของเดิม
     product_type คัดลอกมาจาก categories.code ตอนบันทึก (denormalize)
     เพื่อให้โค้ดเดิมที่กรอง WHERE product_type = ? ทั่วทั้งระบบยังใช้ได้ตรง ๆ
     attributes เก็บสเปกที่ไม่ใช่ทุกหมวดจะมีเหมือนกัน (lens_index, coating, size ฯลฯ) */
  products: `CREATE TABLE IF NOT EXISTS products (
    id                 int(10) unsigned NOT NULL AUTO_INCREMENT,
    sku                varchar(100) NOT NULL COMMENT 'รหัสสินค้า',
    category_id        int(10) unsigned NOT NULL,
    product_type       varchar(30) NOT NULL COMMENT 'คัดลอกจาก categories.code',
    name               varchar(255) NOT NULL COMMENT 'ชื่อสินค้า',
    brand              varchar(120) DEFAULT NULL,
    base_selling_price decimal(12,2) NOT NULL DEFAULT 0 COMMENT 'ราคาขายมาตรฐาน',
    is_custom_made     tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 = RX สั่งตัด',
    attributes         longtext DEFAULT NULL COMMENT 'JSON: model/color/size/lens_design/lens_index/coating/tint/addons/product_line',
    created_at         datetime NOT NULL DEFAULT current_timestamp(),
    updated_at         datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_product_sku (sku),
    KEY fk_product_category (category_id),
    CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT
  ) ${CHARSET}`,

  /* Lot ที่รับเข้าแต่ละครั้ง — ต้นทุนกับจำนวนคงเหลือแยกตามล็อตเพื่อ FIFO
     remaining_qty ลดลงเมื่อขาย/จอง เพิ่มกลับเมื่อยกเลิก — แทน stock.sold เดิม
     (sold=0 เดิม = remaining_qty > 0, ไม่มี "ชิ้นไหนขายไปแล้ว" อีกต่อไป
     มีแต่ "ล็อตนี้เหลือกี่ชิ้น") */
  stock_lots: `CREATE TABLE IF NOT EXISTS stock_lots (
    id            int(10) unsigned NOT NULL AUTO_INCREMENT,
    lot_number    varchar(100) NOT NULL,
    product_id    int(10) unsigned NOT NULL,
    supplier_id   int(10) unsigned DEFAULT NULL,
    cost_per_unit decimal(12,2) DEFAULT NULL COMMENT 'ต้นทุนต่อชิ้น',
    initial_qty   int(10) unsigned NOT NULL DEFAULT 1,
    remaining_qty int(10) unsigned NOT NULL DEFAULT 1 COMMENT 'คงเหลือเพื่อตัดสต็อก',
    received_date date NOT NULL,
    expiry_date   date DEFAULT NULL,
    notes         text DEFAULT NULL,
    created_at    datetime NOT NULL DEFAULT current_timestamp(),
    updated_at    datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (id),
    KEY fk_lot_product (product_id),
    KEY fk_lot_supplier (supplier_id),
    KEY idx_lot_remaining (product_id, remaining_qty),
    CONSTRAINT fk_lot_product  FOREIGN KEY (product_id)  REFERENCES products (id)  ON DELETE RESTRICT,
    CONSTRAINT fk_lot_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL
  ) ${CHARSET}`,

  /* ประวัติความเคลื่อนไหวของสต็อก — audit trail ที่ของเดิมไม่เคยมี
     created_by ปล่อย NULL ได้ต่างจากไฟล์ต้นฉบับที่บังคับ NOT NULL
     เพราะงานหลายจุด (ปิดออเดอร์, ยกเลิก) ไม่ได้ผูกกับพนักงานคนเดียวเสมอไป */
  inventory_logs: `CREATE TABLE IF NOT EXISTS inventory_logs (
    id             int(10) unsigned NOT NULL AUTO_INCREMENT,
    product_id     int(10) unsigned NOT NULL,
    lot_id         int(10) unsigned DEFAULT NULL,
    action_type    enum('IN','OUT','ADJUST','RETURN') NOT NULL,
    quantity       int(11) NOT NULL COMMENT 'บวก=รับเข้า/คืน, ลบ=ขาย/จ่ายออก',
    reference_doc  varchar(100) DEFAULT NULL COMMENT 'เลขที่เอกสารอ้างอิง เช่น invoice_code',
    notes          text DEFAULT NULL,
    created_by     int(10) unsigned DEFAULT NULL,
    created_at     datetime NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (id),
    KEY idx_inv_product (product_id, created_at),
    KEY fk_inv_lot (lot_id),
    KEY fk_inv_emp (created_by),
    CONSTRAINT fk_inv_product FOREIGN KEY (product_id) REFERENCES products (id)  ON DELETE RESTRICT,
    CONSTRAINT fk_inv_lot     FOREIGN KEY (lot_id)     REFERENCES stock_lots (id) ON DELETE SET NULL,
    CONSTRAINT fk_inv_emp     FOREIGN KEY (created_by) REFERENCES employees (id) ON DELETE SET NULL
  ) ${CHARSET}`,
};

/* Views ไม่ใช่ตาราง จึงแยกจาก TABLES — ใช้ CREATE OR REPLACE รันซ้ำได้ทุกครั้งที่บูต
   v_stock_lot ต่อ products + stock_lots ให้หน้าตาเหมือน stock ตัวเดิม (1 lot = 1 แถว)
   ไว้ให้ query แบบ JOIN อ่านอย่างเดียวใน lib/api.js เรียกสั้น ๆ ได้เหมือนเดิม
   ไม่ใช้กับที่ต้องการรายชิ้นจริง (เช่นรายการหน้าคลัง/พิมพ์ป้าย) ที่ต้องขยายเป็นรายชิ้นเอง */
const VIEWS = {
  v_stock_lot: `CREATE OR REPLACE VIEW v_stock_lot AS
    SELECT
      sl.id, p.id AS product_id, p.product_type, p.name AS product_name,
      p.brand, p.brand AS brand_name, p.sku,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.model')), 'null') AS model,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.color')), 'null') AS color,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.size')), 'null') AS size,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.lens_design')), 'null') AS lens_design,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.lens_index')), 'null') AS lens_index,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.coating')), 'null') AS coating,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.tint')), 'null') AS tint,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.addons')), 'null') AS addons,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.product_line')), 'null') AS product_line,
      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes,'$.vendor_name')), 'null'), sup.name) AS vendor_name,
      p.base_selling_price AS product_price, sl.cost_per_unit AS product_expense,
      sl.supplier_id, sl.received_date AS stock_date, sl.notes,
      sl.initial_qty, sl.remaining_qty,
      (sl.remaining_qty = 0) AS sold
    FROM stock_lots sl
    JOIN products p ON p.id = sl.product_id
    LEFT JOIN suppliers sup ON sup.id = sl.supplier_id`,
};

/** Booking service types + statuses live in code, not the DB, so they stay easy to tweak */
export const SERVICE_TYPES = [
  ['eye_exam', 'วัดสายตา'],
  ['choose_frame', 'เลือกกรอบ/เลนส์'],
  ['pickup', 'รับแว่น'],
  ['adjust', 'ปรับ/ซ่อมแว่น'],
  ['contact_lens', 'คอนแทคเลนส์'],
  ['consult', 'ปรึกษา/สอบถาม'],
  ['other', 'อื่น ๆ'],
];
export const BOOKING_STATUSES = [
  ['booked', 'จองแล้ว'],
  ['confirmed', 'ยืนยันแล้ว'],
  ['arrived', 'ลูกค้ามาถึง'],
  ['in_service', 'กำลังให้บริการ'],
  ['done', 'เสร็จสิ้น'],
  ['no_show', 'ไม่มาตามนัด'],
  ['cancelled', 'ยกเลิก'],
];
export const BOOKING_CHANNELS = [
  ['phone', 'โทรศัพท์'], ['line', 'LINE'], ['facebook', 'Facebook'],
  ['walk_in', 'เดินเข้าร้าน'], ['web', 'เว็บไซต์'], ['other', 'อื่น ๆ'],
];
/** default intake questions asked when a booking is taken */
/* ช่องทางที่ลูกค้ารู้จักร้าน — เก็บเป็นรหัสไว้ ป้ายชื่อเปลี่ยนทีหลังได้ไม่กระทบข้อมูลเก่า */
/* ใบ "ค่าสายตาเดิม" ได้ค่ามาจากไหน — มีทางเดียว 3 ทางเท่านั้น
   history = ลูกค้าเคยวัดกับเราแล้ว ดึงใบเก่าในระบบมาใช้
   lensmeter = ลูกค้าเอาแว่นมาด้วย เราถอดค่าจากแว่นเอง
   external_rx = ลูกค้าถือใบค่าสายตาจากที่อื่นมา */
export const RX_SOURCES_OLD = [
  ['history', 'ดึงจากประวัติในระบบ'],
  ['lensmeter', 'วัดจากแว่นเดิม (lensmeter)'],
  ['external_rx', 'ใบ Prescription จากภายนอก'],
];

/* ใบ "ค่าที่วัดได้" วัดในร้านรอบนี้ จึงเป็นคนละชุดกับข้างบน */
export const RX_SOURCES_MEASURED = [
  ['refraction', 'ตรวจวัดด้วยนักทัศนมาตร (refraction)'],
  ['autorefractor', 'เครื่องวัดอัตโนมัติ (auto-refractor)'],
  ['contact_lens', 'ค่าจากคอนแทคเลนส์เดิม'],
  ['other', 'อื่น ๆ'],
];

/* หน้าบันทึกเต็มเลือกชนิดใบเองได้ จึงต้องเห็นทุกตัวเลือก */
export const RX_SOURCES = [...RX_SOURCES_OLD, ...RX_SOURCES_MEASURED];

/* ช่อง Old Glasses บนกระดาษมีให้ติ๊ก 3 แบบ */
export const OLD_GLASSES_TYPES = [
  ['single', 'Single Lens — ชั้นเดียว'],
  ['bifocal', 'Bi-Focal — สองชั้น'],
  ['progressive', 'Progressive — โปรเกรสซีฟ'],
];

export const REFERRAL_SOURCES = [
  ['friend', 'เพื่อนแนะนำ / Friend'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['tiktok', 'TikTok'],
  ['google', 'Google'],
  ['walk_in', 'เดินผ่านหน้าร้าน / Walk in'],
  ['old_customer', 'ลูกค้าเก่า / Old customer'],
];

export const INTAKE_QUESTIONS = [
  'มาด้วยเรื่องอะไร / อาการที่พบ',
  'เคยตัดแว่นกับเราหรือยัง',
  'ใช้แว่น/คอนแทคเลนส์เดิมแบบไหน',
  'ใช้สายตาหนักด้านไหน (จอ/ขับรถ/อ่านหนังสือ)',
  'งบประมาณคร่าว ๆ',
  'ต้องการรับแว่นเมื่อไหร่',
];

const DEFAULT_SETTINGS = {
  telegram_enabled: '0',
  telegram_bot_token: '',
  telegram_chat_id: '',
  reminder_default_minutes: '10',
  shop_name: 'TIME OPTIC',
  shop_open_time: '10:00',
  shop_close_time: '20:00',
  slot_minutes: '30',
};

/* คอลัมน์ที่เพิ่มทีหลังกับตารางที่มีข้อมูลอยู่แล้ว ลบตารางทิ้งไม่ได้ */
const ADD_COLUMNS = [
  ['cases', 'referral_source', "VARCHAR(20) DEFAULT NULL COMMENT 'รู้จักร้านจากช่องทางไหน'"],
  /* ฟอร์มกระดาษมีช่อง "ตาเปล่า" แยกจาก VA ที่ใส่แว่น ของเดิมไม่มีที่เก็บ */
  ['prescriptions', 'va_naked_r', "VARCHAR(20) DEFAULT NULL COMMENT 'VA ตาเปล่า ขวา'"],
  ['prescriptions', 'va_naked_l', "VARCHAR(20) DEFAULT NULL COMMENT 'VA ตาเปล่า ซ้าย'"],
  /* บล็อก Old Glasses บนใบกระดาษ — ค่าที่อ่านได้จากแว่นที่ลูกค้าใส่มา
     คนละชุดกับค่า r_ และ l_ ซึ่งเป็นค่าที่วัดรอบนี้ */
  ['prescriptions', 'old_r_sphere', "VARCHAR(20) DEFAULT NULL COMMENT 'แว่นเดิม R SPHERE'"],
  ['prescriptions', 'old_l_sphere', "VARCHAR(20) DEFAULT NULL COMMENT 'แว่นเดิม L SPHERE'"],
  ['prescriptions', 'old_r_add', "VARCHAR(20) DEFAULT NULL COMMENT 'แว่นเดิม R ADD'"],
  ['prescriptions', 'old_l_add', "VARCHAR(20) DEFAULT NULL COMMENT 'แว่นเดิม L ADD'"],
  ['prescriptions', 'old_r_va', "VARCHAR(20) DEFAULT NULL COMMENT 'แว่นเดิม R VA'"],
  ['prescriptions', 'old_l_va', "VARCHAR(20) DEFAULT NULL COMMENT 'แว่นเดิม L VA'"],
  ['prescriptions', 'old_r_pd', "VARCHAR(20) DEFAULT NULL COMMENT 'แว่นเดิม R PD'"],
  ['prescriptions', 'old_l_pd', "VARCHAR(20) DEFAULT NULL COMMENT 'แว่นเดิม L PD'"],
];

export async function migrate() {
  const created = [];
  const conn = await pool.getConnection();
  try {
    for (const [name, sql] of Object.entries(TABLES)) {
      const [[existing]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`, [name]);
      if (!existing.n) {
        await conn.query(sql);
        created.push(name);
      }
    }
    for (const [table, column, def] of ADD_COLUMNS) {
      const [[has]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, column]);
      if (!has.n) {
        await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`);
        created.push(`${table}.${column}`);
      }
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await conn.query(
        'INSERT IGNORE INTO app_settings (`key`, `value`) VALUES (?, ?)', [key, value]);
    }
    for (const sql of Object.values(VIEWS)) {
      await conn.query(sql);
    }
  } finally {
    conn.release();
  }
  return created;
}
