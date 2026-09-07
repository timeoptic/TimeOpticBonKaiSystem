-- แคตตาล็อก POS หายไปทั้งชุด หลังนำเข้าข้อมูลจาก Access
--
-- 018 ลงหมวดกับรายการสินค้าของ POS ไว้ที่ `categories`/`products` ซึ่งเป็น
-- แคตตาล็อกกลางของทั้งระบบ · ต่อมา `api/cli/import-access.php` สั่ง
-- `DELETE FROM products` และ `DELETE FROM categories` แล้วสร้างใหม่จาก Access
-- (ที่นั่นมีแต่เลนส์กับกรอบ ไม่มีคอนเซ็ปต์ของ POS เลย) รายการ 41 ตัวจึงหายเรียบ
-- ทั้งที่ schema_migrations ยังบอกว่า 018 รันไปแล้ว — migrate.php จึงไม่มีทาง
-- เอากลับมาให้เอง หน้า /pos เลยเหลือแต่เลนส์ตัดแว่นของฝั่งคลังให้เลือก
--
-- ไฟล์นี้เอาแคตตาล็อกกลับมาในสภาพหลัง 020 (CST-0001 เหลือธง pos_custom ธงเดียว)
-- ไม่ใช่สภาพดิบของ 018 · การลบชื่อ 018 ออกจาก schema_migrations แล้วรันใหม่
-- ได้ผลเท่ากัน แต่เป็นการแก้ตารางบันทึกด้วยมือ ซึ่งแพงกว่าและพลาดง่ายกว่า
--
-- ต้นเหตุถูกปิดที่ import-access.php ในคอมมิตเดียวกัน — ตั้งแต่นี้ตัวนำเข้าจะไม่
-- ลบหมวด `Pos*` กับสินค้าในหมวดนั้นอีก · ไฟล์นี้จึงเป็นการกู้ของที่หายไปแล้ว
-- ครั้งเดียว ไม่ใช่ยาที่ต้องกินทุกรอบนำเข้า


-- ---------------------------------------------------------------------------
-- 1. หมวด
-- ---------------------------------------------------------------------------
--
-- INSERT IGNORE บน code ที่เป็น UNIQUE — รันซ้ำไม่พังและไม่ได้แถวซ้ำ
-- ชื่อหมวดเป็นของเดิมทุกตัว ไม่แก้คำ เพราะ ProductPicker จัดกลุ่มด้วยชื่อนี้

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
-- 2. รายการสินค้า
-- ---------------------------------------------------------------------------
--
-- ON DUPLICATE KEY UPDATE ไม่ใช่ INSERT IGNORE: ถ้าแถวไหนยังอยู่แต่ถูกแก้จนเพี้ยน
-- (เช่นหมวดหลุด หรือ pos_fields หาย) IGNORE จะข้ามไปเงียบ ๆ แล้วปล่อยของเสียไว้
-- อย่างนั้น · ที่นี่จึงเขียนทับ "ตัวตนของสินค้า" คือหมวด ชนิด ชื่อ และนิยามช่องกรอก
--
-- แต่ไม่แตะ base_selling_price เด็ดขาด — ราคาเป็นของร้าน ไม่ใช่ของ migration
-- (018 ลงไว้ 0 เพราะยังไม่ได้ราคาจริง วันที่ร้านพิมพ์ราคาลงไปแล้ว การกู้แคตตาล็อก
-- ต้องไม่รีเซ็ตกลับเป็น 0) · แถวที่เพิ่งเกิดใหม่ได้ 0 ตามเดิม
--
-- attributes.pos_fields = นิยามช่องกรอกเพิ่มของสินค้าตัวนั้น (ค่าสายตา / สี /
-- รหัสแว่น) หน้าเว็บอ่านคีย์นี้แล้ววาดช่องให้ ไม่มีตารางแมปฝั่งหน้าเว็บ

INSERT INTO products (sku, category_id, product_type, name, base_selling_price, attributes) VALUES
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

  -- 4. Contact Lens Maxim — "Maxim color" ถามสีเพิ่มอีกช่อง
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
  --    ธง pos_custom ธงเดียวตาม 020 · ชื่อที่พิมพ์เองลง product_name_snapshot
  --    ไม่ใช่ item_meta จึงไม่มี pos_fields
  ('CST-0001', (SELECT id FROM categories WHERE code='PosCustom'), 'Accessory', 'อื่นๆ (พิมพ์เอง)', 0.00,
   '{"pos_custom":true}')
ON DUPLICATE KEY UPDATE
  category_id  = VALUES(category_id),
  product_type = VALUES(product_type),
  name         = VALUES(name),
  attributes   = VALUES(attributes);
