-- Bewell: ใบสั่งตัด RX ส่งเข้า "คำขอจากสาขา" ของคลัง TimeOptic แบบ kind = rx (10 พ.ย. 2026)
--
-- สำหรับเซิร์ฟเวอร์ที่ไม่ได้รัน api/services/Migrate.php (Hostinger) · รันซ้ำได้
-- **ต้องรันก่อนอัปโค้ด** — services/TimeOpticRx.php อ่าน/เขียนตารางนี้ตอนยืนยันขายและบันทึกออเดอร์
--
--   mysql -u <user> -p --default-character-set=utf8mb4 <database> < deploy/bewell-timeoptic-rx-requests.sql

CREATE TABLE IF NOT EXISTS timeoptic_rx_requests (
  id         int(10) unsigned NOT NULL AUTO_INCREMENT,
  case_id    int(10) unsigned DEFAULT NULL,
  order_id   int(10) unsigned DEFAULT NULL,
  side       enum('r','l') NOT NULL,
  rx_log_id  int(10) unsigned NOT NULL COMMENT 'inventory_logs.id ของใบสั่งตัดใน Bewell',
  rx_doc     varchar(100) DEFAULT NULL,
  req_id     int(10) unsigned NOT NULL,
  req_code   varchar(20) NOT NULL,
  status     varchar(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | approved | rejected | cancelled',
  note       varchar(400) DEFAULT NULL,
  active     tinyint(1) NOT NULL DEFAULT 1,
  synced_at  datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_trx_order (order_id, side, active),
  KEY idx_trx_case (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
