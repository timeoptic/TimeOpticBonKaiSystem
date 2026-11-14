-- บิลรับเข้าทั้งใบ (receiveMany) — กันกดบันทึกซ้ำด้วย idem_key
--
-- ยกจากระบบหลัก (TimeOpticDigitalSystem 040_invoice_scan.sql) เฉพาะตาราง receipt_bills
-- ไม่เอา invoice_scans / supplier_item_codes เพราะสาขานี้ไม่ใช้ AI สแกนบิล
-- scan_id คงไว้ (ว่างเสมอ) ให้โครงตารางตรงกับระบบหลัก ถ้าวันหนึ่งยก AI สแกนมาจะไม่ต้องแก้ตารางนี้

CREATE TABLE IF NOT EXISTS receipt_bills (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  idem_key       VARCHAR(64)  NOT NULL,
  supplier_id    INT UNSIGNED NULL,
  reference_doc  VARCHAR(100) NULL COMMENT 'เลขที่บิล/ใบส่งของของผู้ขาย',
  received_date  DATE         NOT NULL,
  lot_ids_json   JSON         NOT NULL COMMENT 'stock_lots.id ที่บิลนี้สร้าง',
  result_json    JSON         NOT NULL COMMENT 'คำตอบของ receiveMany — ตอบซ้ำได้เมื่อ idem_key ซ้ำ',
  scan_id        INT UNSIGNED NULL COMMENT 'invoice_scans.id ถ้าบิลนี้มาจากการสแกน',
  created_by     INT UNSIGNED NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_receipt_bills_idem (idem_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='บิลรับเข้าทั้งใบ (receiveMany) — กันบันทึกซ้ำ';
