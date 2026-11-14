-- เลนส์สั่งตัด RX ที่เจียร์เสีย — ร้านขอไว้ 30 ก.ย. 2026
--
-- เลนส์สั่งตัดมาถึงร้านแล้วยังต้องเจียร์เข้ากรอบ และการเจียร์พลาดได้ · จนถึงตอนนี้ไม่มีทางบอก
-- ระบบเรื่องนี้: ตัดของเสีย (SCRAP) ตัดจากล็อต แต่เลนส์สั่งตัดไม่เคยมีล็อต ส่วน "ยกเลิกใบสั่ง"
-- ทำให้ใบหายจากสมุดเฉย ๆ — ต้นทุนเลนส์ที่ร้านยังต้องจ่ายผู้ขายไม่ถูกนับเป็นของเสีย และไม่มี
-- ชื่อคนทำเสีย
--
-- ใบที่เจียร์เสียคือใบที่ปิดไปแล้ว จึงปั๊ม `cancelled_at` เหมือนใบที่ยกเลิก — ทุกที่ที่ถามว่า
-- "ใบนี้ยังเดินอยู่ไหม" (ยอดขาย กระดานงานหน้าร้าน ข้อความเลนส์มาครบ) ตอบถูกเองโดยไม่ต้องแก้
-- คอลัมน์ข้างล่างบอกว่าปิดเพราะอะไร:
--
--   scrapped_at      เจียร์เสียเมื่อไร — NULL = ไม่ได้เสีย (ใบที่ยกเลิกธรรมดาก็ NULL)
--   scrap_by         ชื่อคนที่ทำเสีย พิมพ์เอง กติกาเดียวกับ `inventory_logs.scrap_by` (034)
--   scrap_log_id     แถว SCRAP ในสมุดของเลนส์ชิ้นนี้ — ต้นทุนที่บัญชีลงทีหลังต้องตามไปถึงแถวนั้น
--   replaces_log_id  ใบนี้เปิดแทนใบไหน (ใบที่เจียร์เสีย) — NULL = ใบสั่งปกติ
--
-- ใบที่เสียหนึ่งใบมีใบแทนได้ใบเดียว (UNIQUE) — สองคนกด "เปิดใบใหม่แทน" พร้อมกัน คนที่สองถูก
-- ปฏิเสธ ไม่ใช่ได้เลนส์สองชิ้น

ALTER TABLE rx_orders
  ADD COLUMN scrapped_at DATETIME NULL DEFAULT NULL
    COMMENT 'เจียร์เสียเมื่อไร — NULL = ไม่ได้เสีย',
  ADD COLUMN scrap_by VARCHAR(120) NULL DEFAULT NULL
    COMMENT 'ชื่อคนที่ทำเสีย (พิมพ์เอง)',
  ADD COLUMN scrap_log_id INT UNSIGNED NULL DEFAULT NULL
    COMMENT 'แถว SCRAP ในสมุดของเลนส์ชิ้นนี้',
  ADD COLUMN replaces_log_id INT UNSIGNED NULL DEFAULT NULL
    COMMENT 'ใบนี้เปิดแทนใบสั่งตัดใบไหน (ใบที่เจียร์เสีย)';

-- RESTRICT เหมือน foreign key อื่นของตารางนี้ (ดู 012)
ALTER TABLE rx_orders
  ADD UNIQUE KEY uq_rx_replaces (replaces_log_id),
  ADD CONSTRAINT fk_rx_scrap_log FOREIGN KEY (scrap_log_id) REFERENCES inventory_logs (id),
  ADD CONSTRAINT fk_rx_replaces FOREIGN KEY (replaces_log_id) REFERENCES inventory_logs (id);

CREATE INDEX idx_rx_scrapped ON rx_orders (scrapped_at);
