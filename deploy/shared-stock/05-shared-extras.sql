-- หลังโหลดตารางสต็อกเข้า stock_shared แล้ว: บันทึกว่าแถวไหนมาจากสาขาไหน
USE stock_shared;

ALTER TABLE inventory_logs ADD COLUMN shop VARCHAR(30) NULL COMMENT 'สาขาที่ทำรายการ (มาจาก user ฐานข้อมูล)', ADD KEY idx_inv_shop (shop);
ALTER TABLE stock_lots     ADD COLUMN shop VARCHAR(30) NULL COMMENT 'สาขาที่รับล็อตนี้เข้า', ADD KEY idx_lot_shop (shop);

DELIMITER //
CREATE TRIGGER trg_inv_shop BEFORE INSERT ON inventory_logs FOR EACH ROW
BEGIN
  IF NEW.shop IS NULL THEN
    SET NEW.shop = SUBSTRING_INDEX(SUBSTRING_INDEX(USER(), '@', 1), '_app', 1);
  END IF;
END//
CREATE TRIGGER trg_lot_shop BEFORE INSERT ON stock_lots FOR EACH ROW
BEGIN
  IF NEW.shop IS NULL THEN
    SET NEW.shop = SUBSTRING_INDEX(SUBSTRING_INDEX(USER(), '@', 1), '_app', 1);
  END IF;
END//
DELIMITER ;
