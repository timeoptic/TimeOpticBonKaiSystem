-- พนักงานคือข้อมูลหลัก · บัญชีทุกใบต้องมีพนักงานรองรับ
--
-- `admins` กับ `employees` เก็บ "คน" ไว้คนละที่มาตลอด และคอลัมน์ที่มีไว้เชื่อมกลับ
-- (`admins.employee_id`, UNIQUE ตั้งแต่แรก) ว่างทั้งตาราง — รายงานผลงานพนักงานจึงเท
-- งานฝั่ง POS ลงแถว "ไม่ระบุพนักงาน" ทั้งหมด และการรับหรือปิดคนหนึ่งคนต้องทำสองที่
--
-- ไฟล์นี้เติมการผูกให้ครบทุกแถวแล้วปิดกฎด้วย NOT NULL + FOREIGN KEY เพื่อให้ฐาน
-- เป็นผู้ปฏิเสธ ไม่ใช่โค้ดที่ลืมเช็คได้

-- ── 0 · แถวที่หลุดมาจากการทดลอง ─────────────────────────────────────────────
-- id 163 · username 'employees' · display_name 'employees' · job_title 'employees'
-- role 'sales' · is_active 1 · มี password_hash (เข้าระบบได้จริง) · created_at
-- 2026-08-26 14:58:20 · created_by NULL · ไม่มีร่องรอยในตารางไหนเลย
-- ปล่อยไว้จะกลายเป็นพนักงานชื่อ "employees" ในขั้นถัดไป และมันคือช่องทางเข้าที่ไม่มีเจ้าของ
-- เงื่อนไขครบทั้งสี่ช่องเพื่อไม่ให้ไปโดนบัญชีจริงในฐานอื่นที่บังเอิญมี id ตรงกัน
DELETE FROM admins
 WHERE id = 163 AND username = 'employees' AND display_name = 'employees' AND created_by IS NULL;

-- ── 1 · บัญชีที่ยังไม่มีพนักงาน — สร้างพนักงานให้ ───────────────────────────
-- ผูกกลับด้วยคอลัมน์ชั่วคราว ไม่ใช่ด้วยชื่อ: ชื่อซ้ำกันได้ และ INSERT…SELECT
-- ไม่คืน id ของแต่ละแถวออกมาให้จับคู่
ALTER TABLE employees ADD COLUMN _from_admin INT UNSIGNED NULL;

INSERT INTO employees (employee_name, roles, active, _from_admin)
SELECT LEFT(a.display_name, 120), LEFT(a.job_title, 200), a.is_active, a.id
  FROM admins a
 WHERE a.employee_id IS NULL;

UPDATE admins a JOIN employees e ON e._from_admin = a.id
   SET a.employee_id = e.id;

ALTER TABLE employees DROP COLUMN _from_admin;

-- ── 2 · พนักงานที่ยังไม่มีแถวในบัญชี — สร้างแถวเงาให้ ───────────────────────
-- role 'sales' ไม่มีความหมายจนกว่าจะมีการสร้างบัญชี: แถวที่ไม่มี username เข้าระบบ
-- ไม่ได้ไม่ว่าจะถือ role อะไร (Auth::login ปฏิเสธทั้ง password_hash NULL และ is_active 0)
-- หน้าจอจึงไม่แสดงคอลัมน์สิทธิ์ของแถวพวกนี้
INSERT INTO admins (employee_id, display_name, job_title, role, is_active)
SELECT e.id, e.employee_name, LEFT(e.roles, 120), 'sales', e.active
  FROM employees e
  LEFT JOIN admins a ON a.employee_id = e.id
 WHERE a.id IS NULL;

-- ── 3 · ปิดกฎ ───────────────────────────────────────────────────────────────
ALTER TABLE admins
  MODIFY employee_id INT UNSIGNED NOT NULL
    COMMENT 'employees.id — บัญชีทุกใบต้องมีพนักงานรองรับ ห้าม NULL';

ALTER TABLE admins
  ADD CONSTRAINT fk_admins_employee FOREIGN KEY (employee_id) REFERENCES employees (id);

-- ── ย้อนกลับ (ถ้าจำเป็น รันด้วยมือ) ─────────────────────────────────────────
-- ALTER TABLE admins DROP FOREIGN KEY fk_admins_employee;
-- ALTER TABLE admins MODIFY employee_id INT UNSIGNED NULL;
-- แล้วกู้จาก backups/backup-before-027-employee-master-20260908-122042.sql
-- ถ้าผลไม่ตรงกับที่คาด (admins 24 · employees 24 · แถวกำพร้า 0 · เข้าระบบได้ 6)
