-- Bewell: รายการ "สินค้าอื่น / บริการ" ของหน้า POS (ตาราง pos_items)
--
-- ฐาน bewell ไม่ได้รับแถวชุดนี้มาตอนคัดลอก schema จาก timeoptic ตารางจึงว่าง และ
-- การ์ด "สินค้าอื่น / บริการ" หาอะไรไม่เจอ · รายการตามที่ร้านให้มา 21 ก.ย. 2026 —
-- ชุดเดียวกับ migration 033 แต่ไม่มีกลุ่มคอนแทคเลนส์ (Bewell ไม่ขายคอนแทคหน้าร้าน)
--
--   mysql -u root bewell < stock/api/bin/seed-bewell-pos-items.sql
--
-- INSERT IGNORE บน sku ที่เป็น UNIQUE — รันซ้ำได้ ไม่ได้แถวซ้ำ ไม่ทับราคาที่ร้านแก้ไว้
SET NAMES utf8mb4;
INSERT IGNORE INTO pos_items (sku, group_code, group_name, name, pos_fields, is_custom, sort_order) VALUES
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

  -- สี่ตัวหลังถามรหัสแว่นแต่ไม่บังคับ — แว่นสำเร็จหน้าร้านบางทีก็ไม่มีรหัส
  ('EYW-0001', 'PosEyewear', 'แว่นตา/กล่อง', 'กล่องแว่นตาพลาสติก', NULL, 0, 701),
  ('EYW-0002', 'PosEyewear', 'แว่นตา/กล่อง', 'กล่องแว่นตายีนส์',   NULL, 0, 702),
  ('EYW-0003', 'PosEyewear', 'แว่นตา/กล่อง', 'กรอบแว่น',          '[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]', 0, 703),
  ('EYW-0004', 'PosEyewear', 'แว่นตา/กล่อง', 'แว่นกันแดด',         '[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]', 0, 704),
  ('EYW-0005', 'PosEyewear', 'แว่นตา/กล่อง', 'แว่นสำเร็จ',          '[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]', 0, 705),
  ('EYW-0006', 'PosEyewear', 'แว่นตา/กล่อง', 'Clip on',            '[{"key":"frame_code","label":"รหัสแว่น / SKU","required":false}]', 0, 706),

  -- ชื่อที่พิมพ์เองลง product_name_snapshot ของใบ
  ('CST-0001', 'PosCustom', 'อื่นๆ', 'อื่นๆ (พิมพ์เอง)', NULL, 1, 801)
;
