-- สต็อกจากระบบเดิม (Access) แยกออกจากคลังจริง
--
-- ของใน tblStock ของ Access เคยถูกนำเข้าไปอยู่ใน products / stock_lots ปนกับคลังจริง
-- ระบบคลังจึงเห็นของเก่าสามปีเป็นของบนชั้น (ยอดคงเหลือหลักหมื่นชิ้น แจ้งเตือนของค้าง)
-- ทั้งที่ของพวกนั้นไม่ได้อยู่ในร้านแล้ว หรือไม่มีใครนับยืนยัน
--
-- แต่ประวัติยังต้องอ่านได้: ออเดอร์เก่า (custom_orders.frame_product_id / lens_product_id /
-- right_lens_product_id) กับการขายเก่า (sales.product_stock_id) ชี้มาที่เลขชิ้นของ Access
-- และรายงานกำไรเอาต้นทุนจากชิ้นนั้น
--
--   legacy_stock     หนึ่งแถว = ของหนึ่งชิ้นของ Access · id = tblStock.ID เดิม
--                    ระบบคลัง (stock/api) ไม่อ่านตารางนี้เลย
--   v_stock_lot      คลังจริงอย่างเดียว — ใช้กับทุกที่ที่ "เลือกของ" (งาน 6 ขั้น POS ค้นหา)
--   v_stock_lot_all  คลังจริง + ของเก่า — ใช้เฉพาะที่ "อ่านประวัติ" (รายละเอียดออเดอร์
--                    รายการขาย รายงานยอดขาย/กำไร) · คอลัมน์ source บอกว่ามาจากไหน
--
-- เลขไม่ชนกัน: ของเก่าเลขไม่เกินหกหมื่นกว่า ล็อตใหม่ในคลังเริ่มที่ 1,000,000
-- (InnoDB ไม่ยอมลด AUTO_INCREMENT ต่ำกว่าเลขที่มีอยู่ บรรทัดนั้นจึงรันซ้ำได้ไม่เสียหาย)
--
-- migration นี้สร้างที่เก็บอย่างเดียว ไม่ย้ายข้อมูล — การย้ายแถว OLD-% ที่นำเข้าไปแล้ว
-- ทำครั้งเดียวด้วยสคริปต์แยกที่ตรวจตัวเลขก่อน-หลังได้ (PDO::exec หลายคำสั่งในไฟล์เดียว
-- รายงาน error เฉพาะคำสั่งแรก การลบข้อมูลในนี้พลาดแล้วจะเงียบ)

CREATE TABLE IF NOT EXISTS legacy_stock (
  id              INT UNSIGNED NOT NULL COMMENT 'tblStock.ID ของ Access',
  product_type    VARCHAR(30)  DEFAULT NULL,
  product_name    VARCHAR(255) NOT NULL,
  vendor_name     VARCHAR(120) DEFAULT NULL,
  product_price   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'ราคาขายตั้งต้น',
  product_expense DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'ต้นทุน · 0 = ร้านไม่ได้บันทึก',
  stock_date      DATE         DEFAULT NULL COMMENT 'วันรับเข้า',
  sold            TINYINT(1)   NOT NULL DEFAULT 0,
  notes           TEXT         DEFAULT NULL,
  imported_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_legacy_stock_name (product_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='สต็อกจากระบบเดิม (Access) — ประวัติเท่านั้น ระบบคลังไม่อ่าน';

CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_stock_lot_all AS
SELECT v.id, v.product_id, v.product_type, v.product_name, v.brand, v.brand_name, v.sku,
       v.model, v.color, v.size, v.lens_design, v.lens_index, v.coating, v.tint, v.addons,
       v.product_line, v.vendor_name, v.product_price, v.product_expense, v.supplier_id,
       v.stock_date, v.notes, v.initial_qty, v.remaining_qty, v.sold,
       'stock' AS source
  FROM v_stock_lot v
UNION ALL
SELECT l.id, NULL, l.product_type, l.product_name, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, l.vendor_name, l.product_price, l.product_expense, NULL,
       l.stock_date, l.notes, 1, IF(l.sold, 0, 1), l.sold,
       'legacy'
  FROM legacy_stock l;

ALTER TABLE stock_lots AUTO_INCREMENT = 1000000;
