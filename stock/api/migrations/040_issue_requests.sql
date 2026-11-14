-- คำขอตัดเลนส์จากสาขา — ร้านขอไว้ 27 ต.ค. 2026
--
-- ทุกวันนี้สาขาโทร/ไลน์มาบอก แล้วแอดมินคนเดียวเป็นคนคีย์เบิกและเปิดใบสั่งตัด RX ให้ทั้งหมด ·
-- ไฟล์นี้ให้สาขามีบัญชีของตัวเองที่กรอกคำขอได้ แต่ตัดสต็อกเองไม่ได้ — แอดมินหรือเจ้าของร้าน
-- ตรวจ แก้ค่าได้ แล้วกดยืนยัน ระบบจึงตัดผ่านทางเดิม (`Stock::issueMany` หรือ `Rx::order`)
--
--   branch            บทบาทใหม่ ถือสิทธิ์ `issue.request` อย่างเดียว
--   admins.branch_id  บัญชีนี้เป็นของสาขาไหน — เซิร์ฟเวอร์ใส่สาขาให้คำขอจากตรงนี้ ผู้ใช้เลือกเองไม่ได้
--   issue_requests    คำขอหนึ่งใบ = ตะกร้าเบิกหนึ่งตะกร้า หรือใบสั่งตัด RX หนึ่งใบ
--
-- `body` คือบอดี้ที่จะส่งเข้าทางเดิมตอนยืนยัน (แอดมินแก้ได้) · `original` คือที่สาขากรอกมา
-- เก็บไว้เทียบว่าแอดมินแก้อะไรไป · ระหว่างรอตรวจไม่กันของ — ของไม่พอตอนยืนยัน ระบบปฏิเสธทั้งใบ

ALTER TABLE admin_roles
  MODIFY role ENUM('superuser','owner','admin','sales','trainee','stock','accounting','branch') NOT NULL;

ALTER TABLE admins
  ADD COLUMN branch_id INT UNSIGNED NULL DEFAULT NULL
    COMMENT 'บัญชีของสาขา (บทบาท branch) — คำขอตัดเลนส์ของบัญชีนี้ผูกสาขานี้',
  ADD CONSTRAINT fk_admins_branch FOREIGN KEY (branch_id) REFERENCES branches (id);

CREATE TABLE issue_requests (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind          ENUM('issue','rx') NOT NULL COMMENT 'issue = เบิกจากสต็อก · rx = ใบสั่งตัด RX',
  branch_id     INT UNSIGNED NOT NULL,
  requested_by  INT UNSIGNED NOT NULL,
  status        ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  body          LONGTEXT NOT NULL COMMENT 'JSON ที่จะส่งเข้าทางเดิมตอนยืนยัน',
  original      LONGTEXT NOT NULL COMMENT 'JSON ที่สาขากรอกมา ไม่ถูกแก้',
  result        LONGTEXT NULL COMMENT 'JSON ผลตอนยืนยัน — เลขใบ RX / รายการที่ตัด',
  reviewed_by   INT UNSIGNED NULL,
  reviewed_at   DATETIME NULL,
  reject_reason VARCHAR(400) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_issue_requests_status (status, created_at),
  KEY idx_issue_requests_by (requested_by, created_at),
  CONSTRAINT fk_issue_requests_branch FOREIGN KEY (branch_id)    REFERENCES branches (id),
  CONSTRAINT fk_issue_requests_by     FOREIGN KEY (requested_by) REFERENCES admins (id),
  CONSTRAINT fk_issue_requests_rev    FOREIGN KEY (reviewed_by)  REFERENCES admins (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='คำขอตัดเลนส์จากบัญชีสาขา รอแอดมินยืนยัน';

-- ── ย้อนกลับ (ถ้าจำเป็น รันด้วยมือ) ─────────────────────────────────────────
-- DROP TABLE issue_requests;
-- ALTER TABLE admins DROP FOREIGN KEY fk_admins_branch, DROP COLUMN branch_id;
-- DELETE FROM admin_roles WHERE role = 'branch';
-- ALTER TABLE admin_roles MODIFY role ENUM('superuser','owner','admin','sales','trainee','stock','accounting') NOT NULL;
