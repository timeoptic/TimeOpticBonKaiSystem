-- รายการสินค้าหน้าร้าน (POS) แยกออกจากแคตตาล็อกของคลัง
--
-- สเปก: docs/superpowers/specs/2026-09-10-pos-items-own-catalog-design.md
--
-- 018/026 ลงรายการ 41 ตัวของหน้าร้านไว้ใน `products` หมวด `Pos*` ซึ่งเป็นตาราง
-- ของคลัง · ผลคือ (1) การล้างข้อมูลคลังวันที่ 9 ก.ย. ลบรายการหน้าร้านทิ้งไปด้วย
-- หน้า /pos ค้นอะไรไม่เจออีกเลย และ (2) กฎคลัง "คงเหลือ ≤ ขั้นต่ำ = เตือน" นับ
-- ค่าประกอบแว่นเป็นของที่ต้องสั่ง · เจ้าของร้าน: "มันไม่เกี่ยวกับคลังเลย"
--
-- ไฟล์นี้ย้ายรายการมาอยู่ `pos_items` ซึ่งโมดูลคลังไม่อ่าน แล้วเก็บกวาดของ POS
-- ที่ค้างอยู่ในตารางของคลัง · โค้ดโมดูลคลังไม่ถูกแก้
--
-- migrate.php `exec()` ไฟล์ทั้งก้อน — ทุกคำสั่งรันซ้ำได้โดยไม่พังและไม่ได้แถวซ้ำ
-- ไม่ใช้ `ADD COLUMN IF NOT EXISTS` เพราะ MySQL ไม่มี (มีแต่ MariaDB) และยังไม่รู้
-- ว่าโฮสต์เป็นตัวไหน · เช็กกับ information_schema แทน ใช้ได้ทั้งคู่


-- ---------------------------------------------------------------------------
-- 1. ตาราง
-- ---------------------------------------------------------------------------
--
-- กลุ่มเป็นคอลัมน์ ไม่ใช่ตารางแยก — มี 8 กลุ่มและไม่มีข้อมูลอื่นของกลุ่มให้เก็บ
-- ProductPicker จัดหัวกลุ่มด้วย group_name ตามลำดับ sort_order

CREATE TABLE IF NOT EXISTS pos_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sku         VARCHAR(40)  NOT NULL,
  group_code  VARCHAR(30)  NOT NULL,
  group_name  VARCHAR(100) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  base_price  DECIMAL(12,2) NOT NULL DEFAULT 0.00,   -- 0 = ยังไม่ตั้งราคา พิมพ์ตอนขาย
  pos_fields  LONGTEXT NULL,                          -- JSON ช่องกรอกเพิ่ม (ค่าสายตา / สี / รหัสแว่น)
  is_custom   TINYINT(1) NOT NULL DEFAULT 0,          -- "อื่นๆ (พิมพ์เอง)"
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,          -- เลิกขาย = 0 ไม่ลบ ใบเก่ายังชี้ถึง
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_pos_items_sku (sku),
  KEY idx_pos_items_active (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
-- 2. รายการตั้งต้น 41 ตัว
-- ---------------------------------------------------------------------------
--
-- ชื่อกลุ่มและชื่อสินค้าตาม <select> ที่ร้านใช้ · SKU กับช่องกรอกเพิ่มตาม 026
-- สะกด "น้ำยา Anti fog" (HTML เดิมเขียน "Anit fog")
--
-- ON DUPLICATE KEY UPDATE เขียนทับตัวตนของรายการ (กลุ่ม ชื่อ ช่องกรอก ลำดับ)
-- แต่ไม่แตะ base_price กับ is_active — ราคาและการเลิกขายเป็นของร้าน ไม่ใช่ของ migration

INSERT INTO pos_items (sku, group_code, group_name, name, pos_fields, is_custom, sort_order) VALUES
  ('SRV-0001', 'PosService', 'บริการ/อะไหล่แว่น', 'ค่าประกอบแว่น',  NULL, 0, 101),
  ('SRV-0002', 'PosService', 'บริการ/อะไหล่แว่น', 'ซ่อมแว่น',       NULL, 0, 102),
  ('SRV-0003', 'PosService', 'บริการ/อะไหล่แว่น', 'ซื้อแป้นจมูก',    NULL, 0, 103),
  ('SRV-0004', 'PosService', 'บริการ/อะไหล่แว่น', 'สายคล้องแว่น',   NULL, 0, 104),
  ('SRV-0005', 'PosService', 'บริการ/อะไหล่แว่น', 'ที่ล็อคหลังหู',    NULL, 0, 105),
  ('SRV-0006', 'PosService', 'บริการ/อะไหล่แว่น', 'ปลอกขาแว่น',     NULL, 0, 106),

  ('CLN-0001', 'PosCare', 'อุปกรณ์ทำความสะอาด/ดูแล', 'ผ้าเช็ดแว่น',                   NULL, 0, 201),
  ('CLN-0002', 'PosCare', 'อุปกรณ์ทำความสะอาด/ดูแล', 'ตลับคอนแทคเลนส์',               NULL, 0, 202),
  ('CLN-0003', 'PosCare', 'อุปกรณ์ทำความสะอาด/ดูแล', 'น้ำยา Anti fog',                 NULL, 0, 203),
  ('CLN-0004', 'PosCare', 'อุปกรณ์ทำความสะอาด/ดูแล', 'สเปรย์ Hitop 30 ml',             NULL, 0, 204),
  ('CLN-0005', 'PosCare', 'อุปกรณ์ทำความสะอาด/ดูแล', 'สเปรย์ Hitop 60 ml',             NULL, 0, 205),
  ('CLN-0006', 'PosCare', 'อุปกรณ์ทำความสะอาด/ดูแล', 'สเปรย์ Hitop 250 ml',            NULL, 0, 206),
  ('CLN-0007', 'PosCare', 'อุปกรณ์ทำความสะอาด/ดูแล', 'น้ำยาคอนแทคเลนส์ B&L 60 ml',     NULL, 0, 207),
  ('CLN-0008', 'PosCare', 'อุปกรณ์ทำความสะอาด/ดูแล', 'น้ำยาคอนแทคเลนส์ Maxim 120 ml',  NULL, 0, 208),
  ('CLN-0009', 'PosCare', 'อุปกรณ์ทำความสะอาด/ดูแล', 'Comfort drop',                   NULL, 0, 209),

  -- คอนแทคเลนส์ทุกตัวถามค่าสายตา
  ('CTB-0001', 'PosCtlBL', 'คอนแทคเลนส์ Bausch & Lomb', 'B&L Daily',      '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 301),
  ('CTB-0002', 'PosCtlBL', 'คอนแทคเลนส์ Bausch & Lomb', 'B&L Monthly 2P', '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 302),
  ('CTB-0003', 'PosCtlBL', 'คอนแทคเลนส์ Bausch & Lomb', 'B&L Monthly 6P', '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 303),

  -- "Maxim color" ถามสีเพิ่มอีกช่อง
  ('CTM-0001', 'PosCtlMaxim', 'คอนแทคเลนส์ Maxim', 'Maxim Mutifocal Daily',    '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 401),
  ('CTM-0002', 'PosCtlMaxim', 'คอนแทคเลนส์ Maxim', 'Maxim CooperVision Daily', '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 402),
  ('CTM-0003', 'PosCtlMaxim', 'คอนแทคเลนส์ Maxim', 'Maxim Air monthly',        '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 403),
  ('CTM-0004', 'PosCtlMaxim', 'คอนแทคเลนส์ Maxim', 'Maxim color',              '[{"key":"power","label":"ค่าสายตา","required":true},{"key":"color","label":"สี","required":true}]', 0, 404),
  ('CTM-0005', 'PosCtlMaxim', 'คอนแทคเลนส์ Maxim', 'Maxim Litetoric',          '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 405),

  ('CTA-0001', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue Oasys 2 weeks',       '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 501),
  ('CTA-0002', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue Oasys 2 weeks Astig', '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 502),
  ('CTA-0003', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue Oasys Daily',         '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 503),
  ('CTA-0004', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue Oasys Daily Astig',   '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 504),
  ('CTA-0005', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue Moist Daily',         '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 505),
  ('CTA-0006', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue Moist Daily Astig',   '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 506),
  ('CTA-0007', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue Vita',                '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 507),
  ('CTA-0008', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue Vita Astig',          '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 508),
  ('CTA-0009', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue 2',                   '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 509),
  ('CTA-0010', 'PosCtlAcuvue', 'คอนแทคเลนส์ Acuvue', 'Acuvue Mutifocal 1D',        '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 510),

  ('CTN-0001', 'PosCtlAlcon', 'คอนแทคเลนส์ Alcon', 'Alcon Aqua Daily', '[{"key":"power","label":"ค่าสายตา","required":true}]', 0, 601),

  -- สี่ตัวหลังถามรหัสแว่นแต่ไม่บังคับ — แว่นสำเร็จหน้าร้านบางทีก็ไม่มีรหัส
  ('EYW-0001', 'PosEyewear', 'แว่นตา/กล่อง', 'กล่องแว่นตาพลาสติก', NULL, 0, 701),
  ('EYW-0002', 'PosEyewear', 'แว่นตา/กล่อง', 'กล่องแว่นตายีนส์',   NULL, 0, 702),
  ('EYW-0003', 'PosEyewear', 'แว่นตา/กล่อง', 'กรอบแว่น',          '[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]', 0, 703),
  ('EYW-0004', 'PosEyewear', 'แว่นตา/กล่อง', 'แว่นกันแดด',         '[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]', 0, 704),
  ('EYW-0005', 'PosEyewear', 'แว่นตา/กล่อง', 'แว่นสำเร็จ',          '[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]', 0, 705),
  ('EYW-0006', 'PosEyewear', 'แว่นตา/กล่อง', 'Clip on',            '[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]', 0, 706),

  -- ชื่อที่พิมพ์เองลง product_name_snapshot ของใบ
  ('CST-0001', 'PosCustom', 'อื่นๆ', 'อื่นๆ (พิมพ์เอง)', NULL, 1, 801)
ON DUPLICATE KEY UPDATE
  group_code = VALUES(group_code),
  group_name = VALUES(group_name),
  name       = VALUES(name),
  pos_fields = VALUES(pos_fields),
  is_custom  = VALUES(is_custom),
  sort_order = VALUES(sort_order);


-- ---------------------------------------------------------------------------
-- 3. pos_sale_items.pos_item_id
-- ---------------------------------------------------------------------------
--
-- ใบใหม่เขียน pos_item_id และ product_id = NULL · product_id คงไว้ให้ใบเก่าที่ชี้
-- products ยังอ่านหมวดได้ · RESTRICT: รายการที่เคยขายแล้วลบไม่ได้ (ใช้ is_active = 0)
-- `DO 0` แทน `SELECT 1` — exec() หลายคำสั่งที่มีผล SELECT ค้าง ทำให้คำสั่งถัดไปของ
-- migrate.php ล้มด้วย "unbuffered queries are active"

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_sale_items'
                    AND COLUMN_NAME = 'pos_item_id');
SET @ddl := IF(@has_col = 0,
  'ALTER TABLE pos_sale_items
     ADD COLUMN pos_item_id INT UNSIGNED NULL AFTER product_id,
     ADD KEY idx_pos_sale_items_pos_item (pos_item_id),
     ADD CONSTRAINT fk_pos_sale_items_pos_item FOREIGN KEY (pos_item_id)
       REFERENCES pos_items (id) ON DELETE RESTRICT ON UPDATE CASCADE',
  'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ---------------------------------------------------------------------------
-- 4. เก็บกวาดของ POS ที่ค้างในตารางของคลัง
-- ---------------------------------------------------------------------------
--
-- สินค้าหมวด Pos* ที่ไม่เคยขายและไม่มีล็อต/สมุดสต็อก — สามตารางนี้คือทุกตารางที่มี
-- FK ชี้ products · ฐานที่ถูกล้างแล้วมี 0 ตัว แต่ฐานที่รัน migration ครบจากศูนย์มี 41
-- ถ้าฐานไหนเคยขายผ่าน product_id แถวนั้นกับหมวดของมันอยู่ต่อ

DELETE p FROM products p
  JOIN categories c ON c.id = p.category_id
 WHERE c.code LIKE 'Pos%'
   AND NOT EXISTS (SELECT 1 FROM pos_sale_items i WHERE i.product_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM stock_lots l     WHERE l.product_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM inventory_logs g WHERE g.product_id = p.id);

-- หมวด Pos* ที่ว่างแล้ว — ไม่งั้นทั้ง 8 หมวดยังขึ้นในช่องเลือกหมวดของหน้าคลัง

DELETE c FROM categories c
 WHERE c.code LIKE 'Pos%'
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id);
