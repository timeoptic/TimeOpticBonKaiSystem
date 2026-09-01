-- ล็อตที่ติดลบ ต้องนับว่า "หมด" ไม่ใช่ "ยังมีของ"
--
-- `v_stock_lot.sold` เขียนไว้ว่า `remaining_qty = 0` ตั้งแต่สมัยที่ยอดติดลบไม่ได้
-- พอเปิดให้ขายเกินของที่มี (migration 015) ล็อตค้างส่งที่ยอด -2 จึงตอบว่า
-- `sold = 0` แปลว่า "ยังไม่ถูกขาย ยังหยิบได้" ซึ่งกลับหัวกับความจริง
--
-- ผลที่เห็นแล้ว: หน้าขายสินค้าหน้าร้าน (`POST /api/sales`) เลือกล็อตด้วย
-- `sold = 0` มันจึงหยิบล็อตค้างส่งขึ้นมาขาย แล้วไปพังตอนตัดจริงด้วยข้อความ
-- "ถูกขายไปแล้ว" ซึ่งไม่ได้อธิบายอะไรกับคนขายเลย
--
-- ล็อตของจริงติดลบไม่ได้อยู่แล้ว เงื่อนไขนี้จึงเปลี่ยนคำตอบเฉพาะกับล็อตค้างส่ง
-- ซึ่งไม่ใช่กล่องที่หยิบได้ตามนิยาม

CREATE OR REPLACE DEFINER = CURRENT_USER SQL SECURITY INVOKER VIEW v_stock_lot AS
SELECT sl.id AS id,
       p.id AS product_id,
       p.product_type,
       p.name AS product_name,
       p.brand,
       p.brand AS brand_name,
       p.sku,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.model')), 'null')        AS model,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.color')), 'null')        AS color,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.size')), 'null')         AS size,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.lens_design')), 'null')  AS lens_design,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.lens_index')), 'null')   AS lens_index,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.coating')), 'null')      AS coating,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.tint')), 'null')         AS tint,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.addons')), 'null')       AS addons,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.product_line')), 'null') AS product_line,
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.attributes, '$.vendor_name')), 'null'), sup.name) AS vendor_name,
       p.base_selling_price AS product_price,
       sl.cost_per_unit     AS product_expense,
       sl.supplier_id,
       sl.received_date     AS stock_date,
       sl.notes,
       sl.initial_qty,
       sl.remaining_qty,
       sl.remaining_qty <= 0 AS sold
  FROM stock_lots sl
  JOIN products p        ON p.id = sl.product_id
  LEFT JOIN suppliers sup ON sup.id = sl.supplier_id;
