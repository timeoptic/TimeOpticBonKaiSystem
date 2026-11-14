# คลังกรอบกลาง (stock_shared) — บ่อนไก่ + แพไม้ ใช้สต็อกเดียวกัน

ตารางคลัง 5 ตาราง (`categories` `suppliers` `products` `stock_lots` `inventory_logs`) และ `receipt_bills`
อยู่ในฐาน `stock_shared` · ในฐานของแต่ละสาขาเป็น **view ชื่อเดิม** ชี้ไปที่นั่น โค้ดจึงไม่ต้องรู้
ข้อมูลลูกค้า เคส เงิน ยังแยกสาขาตามเดิม · ต้องอยู่บน MySQL/MariaDB เซิร์ฟเวอร์เดียวกัน

ตั้งครั้งแรก (root):

1. `CREATE DATABASE stock_shared CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
2. โหลดตารางคลังจากฐานสาขาหนึ่ง:
   `mysqldump --skip-triggers bonkai categories suppliers products stock_lots inventory_logs | mysql stock_shared`
3. `mysql < 05-shared-extras.sql` — คอลัมน์ `shop` (สาขาที่ทำรายการ) + trigger เติมจาก user ฐานข้อมูล
4. ต่อสาขา: แทน `__DB__` / `__USER__` ใน `10-per-branch.sql.tpl` แล้วรัน — ลบตารางคลังในฐานสาขา
   สร้าง view · ย้าย FK ไปชี้ `stock_shared` · ให้สิทธิ์ user สาขา
5. `stock/api/migrations/040_receipt_bills.sql` รันที่ `stock_shared` แล้วสร้าง view `receipt_bills` ในแต่ละสาขา
6. migration ที่แตะตารางคลังในอนาคต (เช่น FK ไป `inventory_logs`) ต้องชี้ `stock_shared.<ตาราง>`

ข้อจำกัด: user ฐานข้อมูลของสาขาต้องเข้าได้ทั้งฐานตัวเองและ `stock_shared`
(Hostinger แพ็กเกจ Web/Cloud ให้หนึ่ง user ต่อหนึ่งฐาน — ต้องเช็คก่อนขึ้นจริง)
