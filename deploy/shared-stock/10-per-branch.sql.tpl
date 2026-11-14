-- ใช้กับฐานสาขา __DB__ (แทน __DB__ / __USER__ ก่อนรัน) — รันด้วย root
USE `__DB__`;
SET FOREIGN_KEY_CHECKS = 0;

-- 1) ถอด FK ที่ชี้ไปตารางสต็อกในฐานสาขา
ALTER TABLE case_item_fulfillment  DROP FOREIGN KEY fk_cif_supplier;
ALTER TABLE pos_sale_items         DROP FOREIGN KEY fk_pos_items_product;
ALTER TABLE production_withdrawals DROP FOREIGN KEY fk_pw_lot;
ALTER TABLE rx_orders              DROP FOREIGN KEY fk_rx_log;
ALTER TABLE stock_reservations     DROP FOREIGN KEY fk_sr_lot;

-- 2) ตารางสต็อกของสาขาออก (ข้อมูลย้ายไป stock_shared แล้ว)
DROP TABLE inventory_logs, stock_lots, products, suppliers, categories;

-- 3) ชื่อเดิม → view ชี้ไปคลังกลาง (โค้ดไม่ต้องแก้)
CREATE SQL SECURITY INVOKER VIEW categories     AS SELECT * FROM stock_shared.categories;
CREATE SQL SECURITY INVOKER VIEW suppliers      AS SELECT * FROM stock_shared.suppliers;
CREATE SQL SECURITY INVOKER VIEW products       AS SELECT * FROM stock_shared.products;
CREATE SQL SECURITY INVOKER VIEW stock_lots     AS SELECT * FROM stock_shared.stock_lots;
CREATE SQL SECURITY INVOKER VIEW inventory_logs AS SELECT * FROM stock_shared.inventory_logs;

-- 4) FK เดิม ชี้ข้ามฐานไปตารางจริงใน stock_shared (กฎลบ/แก้เหมือนเดิม)
ALTER TABLE case_item_fulfillment  ADD CONSTRAINT fk_cif_supplier      FOREIGN KEY (supplier_id)  REFERENCES stock_shared.suppliers (id)      ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE pos_sale_items         ADD CONSTRAINT fk_pos_items_product FOREIGN KEY (product_id)   REFERENCES stock_shared.products (id)       ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE production_withdrawals ADD CONSTRAINT fk_pw_lot            FOREIGN KEY (stock_lot_id) REFERENCES stock_shared.stock_lots (id)     ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE rx_orders              ADD CONSTRAINT fk_rx_log            FOREIGN KEY (log_id)       REFERENCES stock_shared.inventory_logs (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE stock_reservations     ADD CONSTRAINT fk_sr_lot            FOREIGN KEY (stock_lot_id) REFERENCES stock_shared.stock_lots (id)     ON DELETE RESTRICT ON UPDATE RESTRICT;

SET FOREIGN_KEY_CHECKS = 1;

-- 5) สิทธิ์ของ user สาขาบนคลังกลาง
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_shared.* TO '__USER__'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_shared.* TO '__USER__'@'127.0.0.1';
