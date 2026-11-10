-- Bewell: ใบเบิกเลนส์ส่งเข้า "คำขอจากสาขา" ของคลัง TimeOptic (10 พ.ย. 2026)
--
-- สำหรับเซิร์ฟเวอร์ที่ไม่ได้รัน api/services/Migrate.php (Hostinger) · รันซ้ำได้ (MariaDB)
-- **ต้องรันก่อนอัปโค้ด** — routes/lens.php อ่าน/เขียนคอลัมน์เหล่านี้ทุกครั้งที่เปิดใบเบิก
-- ต้องมีตาราง lens_requisitions (deploy/bewell-lens-usage.sql) อยู่ก่อน
--
--   mysql -u <user> -p --default-character-set=utf8mb4 <database> < deploy/bewell-timeoptic-requests.sql
--
-- แล้วตั้ง TIMEOPTIC_STOCK_API / _USER / _PASS / TIMEOPTIC_BRANCH_ID ใน .env (ดู env.production.example)

ALTER TABLE lens_requisitions
  ADD COLUMN IF NOT EXISTS timeoptic_req_id    int(10) unsigned DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS timeoptic_req_code  varchar(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS timeoptic_status    varchar(20) DEFAULT NULL COMMENT 'pending | approved | rejected | cancelled',
  ADD COLUMN IF NOT EXISTS timeoptic_note      varchar(400) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS timeoptic_synced_at datetime DEFAULT NULL;
