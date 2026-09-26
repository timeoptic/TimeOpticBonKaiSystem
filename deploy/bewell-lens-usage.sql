-- Bewell: รายการเลนส์ (lens_catalog) + การใช้เลนส์ (คอลัมน์ใหม่ของใบเบิกเลนส์)
--
-- สำหรับเซิร์ฟเวอร์ที่ไม่ได้รัน api/services/Migrate.php (เช่น Hostinger — ดู deploy/README.md
-- เรื่อง "ห้ามสั่ง Migrate::run() ทั้งตัวบนเครื่องจริง") · เครื่องในร้านที่เปิด API ด้วย
-- api/cli/serve.php ไม่ต้องใช้ไฟล์นี้ Migrate ทำให้เองแล้ว
--
-- รันซ้ำได้ (MariaDB): ตาราง/คอลัมน์ที่มีแล้วข้ามไป · รายการเลนส์ตั้งต้นใส่เฉพาะรหัสที่ยังไม่มี
-- ต้องมีตาราง lens_requisitions / lens_requisition_items (ใบเบิกเลนส์ รอบ 2026-09-21) อยู่ก่อน
-- **ต้องรันก่อนอัปโค้ด** — /api/lens-requisitions/sync เขียนคอลัมน์ใหม่เหล่านี้
--
--   mysql -u <user> -p <database> < deploy/bewell-lens-usage.sql

CREATE TABLE IF NOT EXISTS lens_catalog (
  id            int(10) unsigned NOT NULL AUTO_INCREMENT,
  code          varchar(40)  NOT NULL,
  lens_name     varchar(160) NOT NULL,
  lens_type     varchar(60)  NOT NULL,
  lens_index    varchar(10)  DEFAULT NULL,
  coating       varchar(80)  DEFAULT NULL,
  brand         varchar(80)  DEFAULT NULL,
  cost_price    decimal(12,2) DEFAULT NULL COMMENT 'ต่อคู่',
  selling_price decimal(12,2) NOT NULL DEFAULT 0 COMMENT 'ต่อคู่',
  active        tinyint(1) NOT NULL DEFAULT 1,
  sort_order    int(11) NOT NULL DEFAULT 0,
  created_by    int(10) unsigned DEFAULT NULL,
  updated_by    int(10) unsigned DEFAULT NULL,
  created_at    datetime NOT NULL DEFAULT current_timestamp(),
  updated_at    datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_lens_catalog_code (code),
  KEY idx_lens_catalog_active (active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE lens_requisition_items
  ADD COLUMN IF NOT EXISTS lens_catalog_id int(10) unsigned DEFAULT NULL COMMENT 'lens_catalog.id — ไม่ผูก FK โดยตั้งใจ',
  ADD COLUMN IF NOT EXISTS lens_code       varchar(40)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lens_name       varchar(160) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cost_price      decimal(12,2) DEFAULT NULL COMMENT 'ต้นทุนต่อหน่วย ณ วันที่ขาย';

ALTER TABLE lens_requisitions
  ADD COLUMN IF NOT EXISTS used_at       datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS used_by       int(10) unsigned DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by  int(10) unsigned DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancel_source varchar(30) DEFAULT NULL COMMENT 'manual | order_deleted | case_cancelled',
  ADD COLUMN IF NOT EXISTS order_ref     varchar(30) DEFAULT NULL;

UPDATE lens_requisitions lr JOIN custom_orders o ON o.id = lr.order_id
   SET lr.order_ref = o.invoice_code WHERE lr.order_ref IS NULL;

-- รายการเลนส์ตั้งต้น — ราคาเป็นตัวอย่าง แก้ได้ที่หน้า "รายการเลนส์" (ตรงกับ Migrate::seedLensCatalog)
INSERT IGNORE INTO lens_catalog (code, lens_name, lens_type, lens_index, coating, cost_price, selling_price, sort_order) VALUES
  ('LENS-SV156-HC',    'Single Vision 1.56 Hard Coat', 'Single Vision', '1.56', 'Hard Coat',    250,  800,  10),
  ('LENS-SV156-MC',    'Single Vision 1.56 Multicoat', 'Single Vision', '1.56', 'Multicoat',    300,  1000, 20),
  ('LENS-SV156-BLUE',  'Single Vision 1.56 Blue Cut',  'Single Vision', '1.56', 'Blue',         500,  1500, 30),
  ('LENS-SV156-AUTO',  'Single Vision 1.56 Auto',      'Single Vision', '1.56', 'Auto',         600,  1800, 40),
  ('LENS-SV156-ABLUE', 'Single Vision 1.56 Auto Blue', 'Single Vision', '1.56', 'Auto Blue',    750,  2200, 50),
  ('LENS-SV160-MC',    'Single Vision 1.60 Multicoat', 'Single Vision', '1.60', 'Multicoat',    550,  1600, 60),
  ('LENS-SV160-BLUE',  'Single Vision 1.60 Blue Cut',  'Single Vision', '1.60', 'Blue',         700,  2000, 70),
  ('LENS-PG-MC',       'Progressive',                  'Progressive',   '1.56', 'Multicoat',    1200, 3500, 80),
  ('LENS-PG-BLUE',     'Progressive Blue Cut',         'Progressive',   '1.56', 'Blue',         1500, 4500, 90),
  ('LENS-PG-AUTO',     'Progressive Photochromic',     'Progressive',   '1.56', 'Photochromic', 1900, 5500, 100);
