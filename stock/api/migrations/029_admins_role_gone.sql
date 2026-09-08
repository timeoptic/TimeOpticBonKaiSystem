-- ตัดคอลัมน์ `admins.role` ทิ้ง · บทบาทอยู่ที่ `admin_roles` ที่เดียวแล้ว
--
-- แยกจาก 028 เพราะระหว่างที่โค้ดยังอ่านคอลัมน์เก่าอยู่ ทั้งสองรูปแบบต้องอ่านได้
-- พร้อมกัน · ตอนนี้ไม่มีที่ไหนอ่านมันแล้ว (ตรวจด้วย `grep -rn "admins.*role"`
-- ทั้ง api/ และ stock/ · ไล่แก้ไปแล้วรวม CLI สามตัวกับสคริปต์ seed สองตัว)
--
-- ทำไมไม่เก็บไว้เป็นสำเนาของ "บทบาทหลัก" — สำเนาที่ค้างคือสองที่ที่ตอบคำถามเดียวกัน
-- ว่าคนนี้เป็นเจ้าของร้านไหม และวันที่สองที่ตอบไม่ตรงกัน จะไม่มีอะไรบอกว่าที่ไหนถูก
-- นั่นคือสิ่งเดียวที่โค้ดชุดนี้ห้ามไว้ชัดเจนตั้งแต่หัวไฟล์ Roles.php
--
-- ย้อนกลับ (ถ้าจำเป็น รันด้วยมือ) — คืนคอลัมน์แล้วเติมด้วยบทบาทที่ยศสูงสุด:
--   ALTER TABLE admins ADD COLUMN role
--     ENUM('superuser','owner','admin','sales','stock') NOT NULL DEFAULT 'sales';
--   UPDATE admins a SET role = (
--     SELECT r.role FROM admin_roles r WHERE r.admin_id = a.id
--      ORDER BY FIELD(r.role,'superuser','owner','admin','sales','trainee','stock') LIMIT 1
--   ) WHERE EXISTS (SELECT 1 FROM admin_roles r WHERE r.admin_id = a.id);
--   (แถวที่ไม่มีบทบาทจะได้ค่าปริยาย 'sales' กลับมา ซึ่งคือสภาพก่อน 028 พอดี)

ALTER TABLE admins DROP COLUMN role;
