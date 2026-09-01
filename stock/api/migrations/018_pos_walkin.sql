-- POS ขายหน้าร้าน — ตารางของโมดูล และรายการสินค้าที่เจ้าของร้านสั่งลงไว้
--
-- โมดูลนี้แยกจาก Main Process 6 ขั้นโดยสิ้นเชิง: ขายของเบ็ดเตล็ดหน้าร้าน
-- (อะไหล่แว่น น้ำยา คอนแทคเลนส์ กล่องแว่น) ที่ไม่มีเคส ไม่มีใบสายตา ไม่มีวันนัดรับ
-- จึงไม่แตะ cases / custom_orders / prescriptions และไม่เขียนลง payments ของเคส
--
-- ทำไมไม่ต่อยอดตาราง `sales` เดิม: ที่นั่นหนึ่งแถวคือหนึ่งชิ้นจากคลัง ผูกกับ
-- stock_lots ตายตัว (ต้องมี product_stock_id เสมอ) ซึ่งขายบริการอย่าง "ค่าประกอบแว่น"
-- ที่ไม่มีของในคลังไม่ได้เลย และขายหลายรายการต่อใบก็ไม่ได้ · `sales` ยังอยู่ครบ
-- ไม่ถูกแตะ ไม่ถูกย้ายข้อมูล ของเดิมที่เรียกอยู่ยังเรียกได้เหมือนเดิม
--
-- ทำไมมี pos_payments แยกจาก payments ที่มีอยู่แล้ว: `payments` เป็นรางเงินของ
-- Main Process — รายงานเงินของเคสและออเดอร์อ่านจากที่นั่น ถ้าเงิน POS ไหลเข้าไป
-- ยอดของเคสจะเพี้ยนทันที ทั้งที่ POS ไม่ใช่ส่วนหนึ่งของกระบวนการนั้น · อีกอย่าง
-- POS ต้องเก็บ "รับเงินมาเท่าไหร่" กับ "ทอนเท่าไหร่" ซึ่ง payments ไม่มีที่เก็บ


-- ---------------------------------------------------------------------------
-- 1. ใบขาย
-- ---------------------------------------------------------------------------
--
-- payment_status กับ fulfillment_status เป็นคนละคอลัมน์ และไม่มีตรรกะไหนผูกกัน
-- ร้านนี้ปล่อยของให้ลูกค้าถือกลับทั้งที่ยังค้างเงินได้ และรับเงินครบแล้วแต่ของยัง
-- ไม่มาส่งก็ได้ · การยุบสองเรื่องนี้เป็นสถานะเดียวคือสิ่งที่ทำให้ระบบเดิมตอบ
-- คำถามหน้าร้านไม่ได้
--
-- ยอดเงินทุกช่องเป็นค่าที่ server คำนวณเอง ไม่ใช่ค่าที่หน้าเว็บส่งมา — เก็บไว้เป็น
-- คอลัมน์แทนที่จะ SUM ทุกครั้ง เพราะหน้า History ต้องเรียงและกรองด้วยยอดค้าง
--
-- ยกเลิกใบใช้ status='void' ไม่ลบแถว: ใบขายที่หายไปเฉย ๆ คือเงินที่อธิบายไม่ได้
-- ตอนปิดยอดสิ้นวัน

CREATE TABLE IF NOT EXISTS pos_sales (
  id                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pos_no                  VARCHAR(30)  NOT NULL,
  sale_date               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- ลูกค้าไม่บังคับ · เก็บ snapshot ชื่อ/เบอร์ไว้ด้วยเสมอ เพราะลูกค้าขาจรไม่มีแถว
  -- ใน customers และใบเก่าต้องอ่านออกแม้ลูกค้าจะถูกแก้ชื่อทีหลัง
  customer_id             INT UNSIGNED NULL,
  customer_name_snapshot  VARCHAR(255) NULL,
  customer_phone_snapshot VARCHAR(50)  NULL,

  subtotal                DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_amount            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  paid_amount             DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  balance_amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  payment_status          ENUM('unpaid','partial','paid') NOT NULL DEFAULT 'unpaid',
  fulfillment_status      ENUM('waiting','delivered')     NOT NULL DEFAULT 'waiting',
  delivered_at            DATETIME NULL,

  status                  ENUM('active','void') NOT NULL DEFAULT 'active',
  void_reason             VARCHAR(255) NULL,
  void_by                 INT UNSIGNED NULL,
  void_at                 DATETIME NULL,

  note                    TEXT NULL,
  created_by              INT UNSIGNED NULL,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_pos_sales_no (pos_no),
  KEY idx_pos_sales_date (sale_date),
  KEY idx_pos_sales_customer (customer_id),
  KEY idx_pos_sales_created_by (created_by),
  -- หน้า History กรองด้วยสองสถานะนี้เป็นหลัก
  KEY idx_pos_sales_status (status, payment_status, fulfillment_status),

  -- RESTRICT ทั้งคู่: ลูกค้าหรือพนักงานที่มีใบขายค้างอยู่ ลบทิ้งไม่ได้
  CONSTRAINT fk_pos_sales_customer FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pos_sales_created_by FOREIGN KEY (created_by)
    REFERENCES admins (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pos_sales_void_by FOREIGN KEY (void_by)
    REFERENCES admins (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- 2. รายการสินค้าในใบ
-- ---------------------------------------------------------------------------
--
-- ทุกแถว snapshot ชื่อ · SKU · ราคาที่ขายจริง ไม่ใช่อ่านจาก products ตอนแสดงผล
-- ร้านขึ้นราคาน้ำยาเดือนหน้า ใบที่ขายไปแล้วต้องยังบอกราคาที่ลูกค้าจ่ายจริงวันนั้น
--
-- product_id เป็น NULL ได้ = สินค้า Custom ที่พนักงานพิมพ์ชื่อเอง ("อื่นๆ")
-- ซึ่งเป็นครึ่งหนึ่งของเหตุผลที่ POS มีอยู่ — ของที่ยังไม่ทันได้ลงแคตตาล็อก
--
-- item_meta เป็น LONGTEXT เก็บ JSON เพราะ MariaDB 10.4 ไม่มีชนิด JSON จริง
-- (ตาราง products ก็ใช้วิธีเดียวกันที่คอลัมน์ attributes) เก็บ dynamic field
-- ของสินค้าชิ้นนั้น เช่น {"power":"-2.00","color":"Gray","frame_code":"RB1234"}
-- อยู่ที่ item ไม่ใช่ที่ใบ เพราะซื้อคอนแทคเลนส์สองกล่องคนละค่าสายตาในใบเดียวได้

CREATE TABLE IF NOT EXISTS pos_sale_items (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id               INT UNSIGNED NOT NULL,
  product_id            INT UNSIGNED NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  sku_snapshot          VARCHAR(100) NULL,
  quantity              INT UNSIGNED NOT NULL DEFAULT 1,
  unit_price            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  line_total            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  item_meta             LONGTEXT NULL,
  sort_order            INT NOT NULL DEFAULT 0,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_pos_items_sale (sale_id, sort_order),
  KEY idx_pos_items_product (product_id),

  -- CASCADE ตรงนี้ตัวเดียวในไฟล์: รายการเป็นส่วนหนึ่งของใบ ไม่มีชีวิตของตัวเอง
  -- (ยกเลิกใบใช้ status='void' อยู่แล้ว การลบจริงเกิดเฉพาะตอนล้างข้อมูลทดสอบ)
  CONSTRAINT fk_pos_items_sale FOREIGN KEY (sale_id)
    REFERENCES pos_sales (id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- RESTRICT: สินค้าที่เคยถูกขายไปแล้ว ลบออกจากแคตตาล็อกไม่ได้
  CONSTRAINT fk_pos_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- 3. ประวัติการรับเงินของใบ
-- ---------------------------------------------------------------------------
--
-- หนึ่งใบมีได้หลายงวด · รับเพิ่มทีหลัง = INSERT แถวใหม่เสมอ ห้าม UPDATE แถวเดิม
-- เพราะการเขียนทับทำให้ตอบไม่ได้ว่าเงินก้อนไหนรับวันไหนด้วยวิธีไหนโดยใคร
-- ซึ่งเป็นคำถามแรกที่ถูกถามเวลายอดไม่ตรง
--
-- amount        = เงินที่เข้าใบขายจริง (ตัวที่เอาไปคิดยอดค้าง)
-- amount_received = เงินสดที่รับมาจากมือลูกค้า มากกว่า amount ได้
-- change_amount = ทอน · เก็บไว้ทั้งสองค่าแทนที่จะคำนวณย้อนหลัง เพราะปิดยอดสิ้นวัน
--                 ต้องกระทบกับเงินในลิ้นชักจริง ไม่ใช่ยอดที่ควรจะเป็น
--
-- ยกเลิกงวดใช้ cancelled_at ไม่ลบแถว ด้วยเหตุผลเดียวกับใบขาย

CREATE TABLE IF NOT EXISTS pos_payments (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id         INT UNSIGNED NOT NULL,
  payment_method  VARCHAR(30)  NOT NULL DEFAULT 'cash',
  amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  amount_received DECIMAL(12,2) NULL,
  change_amount   DECIMAL(12,2) NULL,
  paid_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT UNSIGNED NULL,
  note            VARCHAR(255) NULL,
  cancelled_at    DATETIME NULL,
  cancelled_by    INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_pos_payments_sale (sale_id, paid_at),
  KEY idx_pos_payments_method (payment_method),

  CONSTRAINT fk_pos_payments_sale FOREIGN KEY (sale_id)
    REFERENCES pos_sales (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pos_payments_created_by FOREIGN KEY (created_by)
    REFERENCES admins (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pos_payments_cancelled_by FOREIGN KEY (cancelled_by)
    REFERENCES admins (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- 4. หมวดสินค้าของ POS
-- ---------------------------------------------------------------------------
--
-- แปดหมวดนี้มาจากรายการที่เจ้าของร้านสั่งลงมาโดยตรง ไม่ได้คิดเอง
--
-- ลงที่ตาราง categories กลาง ไม่ใช่ตารางของ POS เอง เพราะ POS ต้องอ่านสินค้าจาก
-- แคตตาล็อกเดียวกับทั้งระบบ (ห้าม hardcode ที่หน้าเว็บ) · ผลข้างเคียงที่ยอมรับแล้ว
-- คือหมวดพวกนี้จะไปโผล่ในหน้าคลังด้วย เพราะสองฝั่งใช้ตารางเดียวกัน
--
-- INSERT IGNORE บน code ที่เป็น UNIQUE — รันไฟล์ซ้ำแล้วไม่พังและไม่ได้แถวซ้ำ

INSERT IGNORE INTO categories (code, name) VALUES
  ('PosService',  'บริการ / อะไหล่แว่น'),
  ('PosCare',     'อุปกรณ์ทำความสะอาด / ดูแล'),
  ('PosCtlBL',    'Contact Lens B&L'),
  ('PosCtlMaxim', 'Contact Lens Maxim'),
  ('PosCtlAcuvue','Contact Lens Acuvue'),
  ('PosCtlAlcon', 'Contact Lens Alcon'),
  ('PosEyewear',  'แว่นตา / Accessories'),
  ('PosCustom',   'Custom');


-- ---------------------------------------------------------------------------
-- 5. รายการสินค้า
-- ---------------------------------------------------------------------------
--
-- ราคา base_selling_price = 0 ทุกตัว เพราะยังไม่ได้รับราคาจริงมา · POS ให้พนักงาน
-- พิมพ์ราคาขายเองได้ทุกรายการอยู่แล้ว (ราคาในแคตตาล็อกเป็นแค่ค่าตั้งต้น) ระบบจึง
-- ใช้งานได้ทันทีและเก็บราคาที่ขายจริงเป็น snapshot ไว้ในใบ · เมื่อได้ราคาจริงมา
-- ค่อยอัปเดตด้วย migration ถัดไป ไม่ต้องแก้ไฟล์นี้
--
-- product_type ใช้เฉพาะค่าที่ระบบมีอยู่แล้ว (Accessory / ContactLen / Frame /
-- Sunglass) ไม่คิดชนิดใหม่ขึ้นมา เพราะ list_product_type เป็นลุกอัปที่หน้าคลังใช้
-- กรอง การเพิ่มชนิดใหม่จึงเป็นการแก้ของโมดูลอื่น · การจัดกลุ่มของ POS ใช้ categories
--
-- attributes.pos_fields = นิยาม dynamic field ของสินค้าตัวนั้น (สเปกข้อ 5)
-- หน้าเว็บอ่านคีย์นี้แล้ววาดช่องกรอกให้ตรงกับสินค้า ไม่ต้องมีตารางแมปแยก และ
-- ฝั่งคลังไม่สนใจคีย์นี้ (Inventory.php อ่านเฉพาะคีย์ของเลนส์) จึงไม่กระทบกัน

INSERT IGNORE INTO products (sku, category_id, product_type, name, base_selling_price, attributes) VALUES
  -- 1. บริการ / อะไหล่แว่น — ไม่มีของในคลัง ไม่มี dynamic field
  ('SRV-0001', (SELECT id FROM categories WHERE code='PosService'), 'Accessory', 'ค่าประกอบแว่น', 0.00, '{}'),
  ('SRV-0002', (SELECT id FROM categories WHERE code='PosService'), 'Accessory', 'ซ่อมแว่น', 0.00, '{}'),
  ('SRV-0003', (SELECT id FROM categories WHERE code='PosService'), 'Accessory', 'ซื้อแป้นจมูก', 0.00, '{}'),
  ('SRV-0004', (SELECT id FROM categories WHERE code='PosService'), 'Accessory', 'สายคล้องแว่น', 0.00, '{}'),
  ('SRV-0005', (SELECT id FROM categories WHERE code='PosService'), 'Accessory', 'ที่ล็อคหลังหู', 0.00, '{}'),
  ('SRV-0006', (SELECT id FROM categories WHERE code='PosService'), 'Accessory', 'ปลอกขาแว่น', 0.00, '{}'),

  -- 2. อุปกรณ์ทำความสะอาด / ดูแล
  ('CLN-0001', (SELECT id FROM categories WHERE code='PosCare'), 'Accessory', 'ผ้าเช็ดแว่น', 0.00, '{}'),
  ('CLN-0002', (SELECT id FROM categories WHERE code='PosCare'), 'Accessory', 'ตลับคอนแทคเลนส์', 0.00, '{}'),
  ('CLN-0003', (SELECT id FROM categories WHERE code='PosCare'), 'Accessory', 'น้ำยา Anti fog', 0.00, '{}'),
  ('CLN-0004', (SELECT id FROM categories WHERE code='PosCare'), 'Accessory', 'สเปรย์ Hitop 30 ml', 0.00, '{}'),
  ('CLN-0005', (SELECT id FROM categories WHERE code='PosCare'), 'Accessory', 'สเปรย์ Hitop 60 ml', 0.00, '{}'),
  ('CLN-0006', (SELECT id FROM categories WHERE code='PosCare'), 'Accessory', 'สเปรย์ Hitop 250 ml', 0.00, '{}'),
  ('CLN-0007', (SELECT id FROM categories WHERE code='PosCare'), 'Accessory', 'น้ำยาคอนแทคเลนส์ B&L 60 ml', 0.00, '{}'),
  ('CLN-0008', (SELECT id FROM categories WHERE code='PosCare'), 'Accessory', 'น้ำยาคอนแทคเลนส์ Maxim 120 ml', 0.00, '{}'),
  ('CLN-0009', (SELECT id FROM categories WHERE code='PosCare'), 'Accessory', 'Comfort drop', 0.00, '{}'),

  -- 3. Contact Lens B&L — คอนแทคเลนส์ทุกตัวถามค่าสายตา
  ('CTB-0001', (SELECT id FROM categories WHERE code='PosCtlBL'), 'ContactLen', 'B&L Daily', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTB-0002', (SELECT id FROM categories WHERE code='PosCtlBL'), 'ContactLen', 'B&L Monthly 2P', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTB-0003', (SELECT id FROM categories WHERE code='PosCtlBL'), 'ContactLen', 'B&L Monthly 6P', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),

  -- 4. Contact Lens Maxim — "Maxim color" ถามสีเพิ่มอีกช่อง ตามสเปกข้อ 5
  ('CTM-0001', (SELECT id FROM categories WHERE code='PosCtlMaxim'), 'ContactLen', 'Maxim Mutifocal Daily', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTM-0002', (SELECT id FROM categories WHERE code='PosCtlMaxim'), 'ContactLen', 'Maxim CooperVision Daily', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTM-0003', (SELECT id FROM categories WHERE code='PosCtlMaxim'), 'ContactLen', 'Maxim Air monthly', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTM-0004', (SELECT id FROM categories WHERE code='PosCtlMaxim'), 'ContactLen', 'Maxim color', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true},{"key":"color","label":"สี","required":true}]}'),
  ('CTM-0005', (SELECT id FROM categories WHERE code='PosCtlMaxim'), 'ContactLen', 'Maxim Litetoric', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),

  -- 5. Contact Lens Acuvue
  ('CTA-0001', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue Oasys 2 weeks', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTA-0002', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue Oasys 2 weeks Astig', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTA-0003', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue Oasys Daily', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTA-0004', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue Oasys Daily Astig', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTA-0005', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue Moist Daily', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTA-0006', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue Moist Daily Astig', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTA-0007', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue Vita', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTA-0008', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue Vita Astig', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTA-0009', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue 2', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),
  ('CTA-0010', (SELECT id FROM categories WHERE code='PosCtlAcuvue'), 'ContactLen', 'Acuvue Mutifocal 1D', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),

  -- 6. Contact Lens Alcon
  ('CTN-0001', (SELECT id FROM categories WHERE code='PosCtlAlcon'), 'ContactLen', 'Alcon Aqua Daily', 0.00,
   '{"pos_fields":[{"key":"power","label":"ค่าสายตา","required":true}]}'),

  -- 7. แว่นตา / Accessories — สี่ตัวหลังถามรหัสแว่น เพราะเป็นของที่ต้องระบุตัวสินค้า
  --    ตอนสั่ง/ตอนเคลม แต่ไม่บังคับ ลูกค้าซื้อแว่นสำเร็จหน้าร้านบางทีก็ไม่มีรหัส
  ('EYW-0001', (SELECT id FROM categories WHERE code='PosEyewear'), 'Accessory', 'กล่องแว่นตาพลาสติก', 0.00, '{}'),
  ('EYW-0002', (SELECT id FROM categories WHERE code='PosEyewear'), 'Accessory', 'กล่องแว่นตายีนส์', 0.00, '{}'),
  ('EYW-0003', (SELECT id FROM categories WHERE code='PosEyewear'), 'Frame', 'กรอบแว่น', 0.00,
   '{"pos_fields":[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]}'),
  ('EYW-0004', (SELECT id FROM categories WHERE code='PosEyewear'), 'Sunglass', 'แว่นกันแดด', 0.00,
   '{"pos_fields":[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]}'),
  ('EYW-0005', (SELECT id FROM categories WHERE code='PosEyewear'), 'Frame', 'แว่นสำเร็จ', 0.00,
   '{"pos_fields":[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]}'),
  ('EYW-0006', (SELECT id FROM categories WHERE code='PosEyewear'), 'Frame', 'Clip on', 0.00,
   '{"pos_fields":[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]}'),

  -- 8. Custom — ของที่ยังไม่ได้ลงแคตตาล็อก พนักงานพิมพ์ชื่อเอง
  --    pos_custom บอกหน้าเว็บให้เปิดช่อง "ชื่อสินค้า" แบบบังคับกรอกแทนชื่อจากแคตตาล็อก
  ('CST-0001', (SELECT id FROM categories WHERE code='PosCustom'), 'Accessory', 'อื่นๆ (พิมพ์เอง)', 0.00,
   '{"pos_custom":true,"pos_fields":[{"key":"custom_name","label":"ชื่อสินค้า","required":true}]}');
