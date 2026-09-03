-- ประวัติขายสินค้าทั่วไปต้องจำได้เองว่าขายอะไรไป
--
-- ตาราง `sales` (7,844 รายการจาก Access) ไม่มีคอลัมน์ชื่อสินค้าเลย มีแค่
-- `product_stock_id` แล้ว api/routes/sales.php ไปดึงชื่อมาด้วย
--     LEFT JOIN v_stock_lot st ON st.id = s.product_stock_id
-- ซึ่ง v_stock_lot คือ stock_lots + products · แปลว่าประวัติการขายไม่ได้เป็น
-- ของตัวเอง มันยืมชื่อจากคลังมาแสดงทุกครั้งที่เปิดหน้า
--
-- พอจะล้างข้อมูลสินค้ากับสต็อกทิ้ง ประวัติ 7,684 รายการจะเหลือแค่วันที่กับราคา
-- ไม่รู้ว่าขายอะไรไป · นี่คือคอลัมน์ที่ทำให้ลบคลังได้โดยประวัติลูกค้าไม่หาย
--
-- ทำแบบเดียวกับที่ pos_sale_items (product_name_snapshot) และ custom_orders
-- (frame_name / lens_name) ทำอยู่แล้ว: ใบขายเก็บสำเนาสิ่งที่ขาย ณ วันนั้นไว้เอง
-- ไม่ผูกชะตากับแคตตาล็อกที่เปลี่ยนหรือถูกลบทีหลังได้
--
-- 160 รายการที่ไม่มีล็อตผูกอยู่แต่แรกจะเป็น NULL ต่อไป — ตรงตามความจริง
-- ดีกว่าเดาชื่อให้

ALTER TABLE sales
  ADD COLUMN product_name_snapshot VARCHAR(200) NULL DEFAULT NULL
    COMMENT 'ชื่อสินค้า ณ วันที่ขาย — สำเนา ไม่ใช่การอ้างอิง'
    AFTER product_stock_id,
  ADD COLUMN product_type_snapshot VARCHAR(40) NULL DEFAULT NULL
    COMMENT 'ชนิดสินค้า ณ วันที่ขาย'
    AFTER product_name_snapshot,
  ADD COLUMN product_sku_snapshot VARCHAR(100) NULL DEFAULT NULL
    COMMENT 'SKU ณ วันที่ขาย'
    AFTER product_type_snapshot;

-- อ่านจากตารางจริง ไม่ใช่ผ่าน view — view พึ่ง DEFINER ที่อาจไม่มีสิทธิ์ตอนรัน
-- migration และ v_sale_history ในฐานนี้ก็พังอยู่จริง ๆ (mysqldump สะดุดตรงนั้น)
UPDATE sales s
  JOIN stock_lots l ON l.id = s.product_stock_id
  JOIN products  p ON p.id = l.product_id
   SET s.product_name_snapshot = p.name,
       s.product_type_snapshot = p.product_type,
       s.product_sku_snapshot  = p.sku
 WHERE s.product_stock_id IS NOT NULL;
