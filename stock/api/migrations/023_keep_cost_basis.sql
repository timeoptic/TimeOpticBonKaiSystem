-- ฐานต้นทุนของรายงานกำไรต้องอยู่รอดหลังล้างคลัง
--
-- `SalesReport` อ่านต้นทุนจาก `v_stock_lot.product_expense` ซึ่งคือ
-- `stock_lots.cost_per_unit` ทั้งฝั่งขายทั่วไป (sales.product_stock_id) และฝั่ง
-- ตัดแว่น (custom_orders.frame_product_id / lens_product_id / right_lens_product_id)
--
-- ลบล็อตทิ้งโดยไม่เก็บสำเนา = รายงานกำไรย้อนหลัง 3 ปีไม่มีฐานต้นทุนอีกเลย
-- ยอดขายไม่หาย (อยู่บน sales.price กับ custom_orders.total_price) แต่กำไรหาย
-- ซึ่งนับว่า "กระทบฝั่งขาย" เต็ม ๆ
--
-- เก็บเฉพาะที่ cost > 0 โดยตั้งใจ — ในข้อมูลจริง 86.5% ของล็อตมี ProductExpense
-- เป็น 0 ซึ่งแปลว่า "ร้านไม่ได้บันทึกต้นทุน" ไม่ใช่ "ต้นทุนศูนย์บาท" ถ้าเก็บ 0
-- มาเป็นต้นทุนจริง อัตรากำไรจะเพี้ยนจาก 88.3% เป็น 96.7% (บทเรียนเดิมของโปรเจกต์
-- ที่ทำให้ SalesReport::margin() ต้องบังคับ cost > 0 อยู่แล้ว) · NULL จึงถูกต้องกว่า

ALTER TABLE sales
  ADD COLUMN unit_cost_snapshot DECIMAL(12,2) NULL DEFAULT NULL
    COMMENT 'ต้นทุนต่อหน่วย ณ วันที่ขาย — สำเนาจากล็อต NULL = ไม่เคยบันทึกต้นทุน'
    AFTER product_sku_snapshot;

ALTER TABLE custom_orders
  ADD COLUMN frame_cost_snapshot  DECIMAL(12,2) NULL DEFAULT NULL COMMENT 'ต้นทุนกรอก ณ วันเปิดออเดอร์',
  ADD COLUMN lens_cost_snapshot   DECIMAL(12,2) NULL DEFAULT NULL COMMENT 'ต้นทุนเลนส์ซ้าย ณ วันเปิดออเดอร์',
  ADD COLUMN lens_r_cost_snapshot DECIMAL(12,2) NULL DEFAULT NULL COMMENT 'ต้นทุนเลนส์ขวา ณ วันเปิดออเดอร์';

UPDATE sales s
  JOIN stock_lots l ON l.id = s.product_stock_id
   SET s.unit_cost_snapshot = l.cost_per_unit
 WHERE l.cost_per_unit > 0;

UPDATE custom_orders o
  LEFT JOIN stock_lots fl ON fl.id = o.frame_product_id
  LEFT JOIN stock_lots ll ON ll.id = o.lens_product_id
  LEFT JOIN stock_lots lr ON lr.id = o.right_lens_product_id
   SET o.frame_cost_snapshot  = NULLIF(fl.cost_per_unit, 0),
       o.lens_cost_snapshot   = NULLIF(ll.cost_per_unit, 0),
       o.lens_r_cost_snapshot = NULLIF(lr.cost_per_unit, 0)
 WHERE fl.id IS NOT NULL OR ll.id IS NOT NULL OR lr.id IS NOT NULL;
