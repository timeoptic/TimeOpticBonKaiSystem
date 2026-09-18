-- ลบล็อตแล้วต้องเหลือร่องรอยในสมุด — ร้านขอ 18 ก.ย. 2026
--
-- เดิมลบล็อต (ได้เฉพาะล็อตที่ยังไม่มีใครแตะ) ลบแถว IN ของมันทิ้งไปด้วย หน้าความเคลื่อนไหวจึง
-- ไม่เหลืออะไรบอกว่าเคยมีของเข้าแล้วมีคนลบ · วันนั้นล็อต L260915-01 หายไปแบบนี้แล้วตามหาไม่เจอ
--
-- ตอนนี้ลบล็อตแล้วลงแถว LOT_DELETE หนึ่งแถว: จำนวนศูนย์ ไม่ผูกล็อต (ล็อตไม่อยู่แล้ว) ยอดคงเหลือ
-- และรายงานเงินจึงไม่กระทบ · ข้อความในแถวบอกเลขล็อต วันรับเข้า จำนวน ต้นทุน และหมายเหตุเดิม
--
-- product_id ว่างได้ เฉพาะแถว LOT_DELETE — ลบสินค้าที่เหลือแต่ร่องรอยการลบล็อตได้ (ล้างสินค้า
-- ที่สร้างซ้ำ) โดยแถวร่องรอยยังอยู่ ชื่อกับรหัสสินค้าเขียนไว้ในข้อความของแถวแล้ว · แถวชนิดอื่น
-- ยังต้องผูกสินค้าเสมอ (CHECK) และ FK ยังเป็น RESTRICT ตามกฎของ 007

ALTER TABLE inventory_logs
  MODIFY COLUMN action_type
    ENUM('IN','OUT','ADJUST','RX_ORDER','RETURN','SCRAP','COST','SETTLE','PRICE','LOT_DELETE') NOT NULL;

ALTER TABLE inventory_logs
  MODIFY COLUMN product_id INT UNSIGNED NULL;

ALTER TABLE inventory_logs
  ADD CONSTRAINT chk_inv_product_or_trace CHECK (product_id IS NOT NULL OR action_type = 'LOT_DELETE');
