# Multi Role Permission — สเปกออกแบบ

วันที่ 8 กันยายน 2026 · ต่อจาก `2026-09-08-employee-master-users.md` (พนักงานเป็นข้อมูลหลัก)

## โจทย์

ผู้ใช้หนึ่งคนถือได้หลายบทบาท และสิทธิ์ที่ได้คือ **ยูเนียน** ของทุกบทบาทที่ถือ
วันนี้ `admins.role` เป็นคอลัมน์เดียว หนึ่งคนหนึ่งบทบาท และการตัดสินสิทธิ์ทั้งหมด
ทำผ่านบันไดยศ (`Roles::rank($role) >= rank(ADMIN)`)

## ทำไมบันไดยศไปต่อไม่ได้

โจทย์ใหม่มีสองข้อที่บันไดตอบไม่ได้ ไม่ว่าจะรับบทบาทเป็นอาร์เรย์หรือไม่ก็ตาม:

1. **Admin เห็นต้นทุนได้ แต่กรอกไม่ได้** — `seeCost` กับ `enterRxCost` วันนี้เป็น
   `rank >= ADMIN` เหมือนกันทั้งคู่ ถ้าอันหลังต้องเป็น Owner เท่านั้น บันไดต้องมี
   เงื่อนไขเฉพาะกิจแทรก ซึ่งเป็นจุดเริ่มของกฎที่อ่านไม่ออก
2. **`case.view_all` ไม่ใช่เรื่องยศ** — Stock ยศเท่า Sales แต่ไม่มีสิทธิ์นี้

จึงเปลี่ยนไปตั้งชื่อสิทธิ์ แล้วให้บทบาทแม็ปเป็นชุดสิทธิ์ · `rank` ยังอยู่ แต่เหลือ
งานเดียวคือ "ใครตั้งบทบาทให้ใครได้" ซึ่งตรงกับที่ docblock เดิมของมันเขียนไว้อยู่แล้ว

## สิทธิ์ทั้งหมด

| คีย์ | ความหมาย |
|---|---|
| `frontdesk.use` | ระบบหน้าร้าน — รับลูกค้า วัดสายตา ขาย ชำระเงิน นัดรับ |
| `case.view_all` | ดู Case ลูกค้าทั้งหมดในระบบ |
| `stock.use` | ระบบคลัง |
| `stock.move` | เบิก · ตัดของเสีย · คืนของ · รับเข้า |
| `product.add` | เพิ่มสินค้าใหม่ที่ยังไม่มีในแคตตาล็อก |
| `catalog.edit` | แก้ · ลบสินค้า · ลบล็อต |
| `cost.view` | เห็นต้นทุน/ชิ้น มูลค่าคลัง ต้นทุนขาย |
| `cost.edit` | กรอก/แก้ต้นทุน (รับของ · ล็อต · RX) |
| `branch.money` | ยอดและกำไรจากสาขา หน้าค้างรับ |
| `branch.settle` | บันทึกรับเงินจากสาขา · ตัดหนี้สูญ |
| `branch.manage` | เพิ่ม · แก้สาขา |
| `scrap.blame` | ระบุว่าคนอื่นเป็นคนทำของเสีย |
| `admin.zone` | การเงินร้าน · ข้อมูลระบบ · รายงาน · บันทึกการใช้งาน |
| `users.manage` | จัดการผู้ใช้ · ตั้งรหัสผ่าน |
| `system.manage` | งานระบบ · migration |

## บทบาท → ชุดสิทธิ์

| | Sales | Trainee | Stock | Admin | Owner | Superuser |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `frontdesk.use` | ✅ | ✅ | | ✅ | ✅ | ✅ |
| `case.view_all` | ✅ | ✅ | | ✅ | ✅ | ✅ |
| `stock.use` | | | ✅ | ✅ | ✅ | ✅ |
| `stock.move` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `product.add` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `catalog.edit` | | | | ✅ | ✅ | ✅ |
| `cost.view` | | | | ✅ | ✅ | ✅ |
| `cost.edit` | | | | | ✅ | ✅ |
| `branch.money` | | | | ✅ | ✅ | ✅ |
| `branch.settle` | | | | ✅ | ✅ | ✅ |
| `branch.manage` | | | | | ✅ | ✅ |
| `scrap.blame` | | | | | ✅ | ✅ |
| `admin.zone` | | | | ✅ | ✅ | ✅ |
| `users.manage` | | | | ✅ | ✅ | ✅ |
| `system.manage` | | | | | | ✅ |

**Trainee Staff ถือชุดเดียวกับ Sales เป๊ะ** — ต่างกันแค่ป้าย เพื่อให้รายงานและ
บันทึกการใช้งานอ่านออกว่าใครยังเป็นเด็กฝึก · เขียนเป็นค่าคงที่ที่อ้างชุดของ Sales
ไม่ใช่คัดลอกรายการ จะได้ไม่มีวันที่สองชุดนี้หลุดจากกันโดยไม่มีใครตั้งใจ

**สิ่งที่เปลี่ยนจากวันนี้ มีข้อเดียว**: `cost.edit` เดิมเป็นของ Admin ขึ้นไป
ต่อไปเป็นของ Owner เท่านั้น · ที่เหลือคือกฎเดิมเขียนใหม่ให้เป็นชื่อ

`rank` (สำหรับ "ใครตั้งบทบาทให้ใครได้" อย่างเดียว): superuser 4 · owner 3 ·
admin 2 · sales/trainee/stock 1 · ยศของคนหนึ่งคน = ยศสูงสุดของบทบาทที่ถือ

## ฐานข้อมูล — `028_multi_role.sql`

```sql
CREATE TABLE admin_roles (
  admin_id   INT UNSIGNED NOT NULL,
  role       ENUM('superuser','owner','admin','sales','trainee','stock') NOT NULL,
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  granted_by INT UNSIGNED NULL,
  PRIMARY KEY (admin_id, role),
  CONSTRAINT fk_admin_roles_admin FOREIGN KEY (admin_id)   REFERENCES admins (id),
  CONSTRAINT fk_admin_roles_by    FOREIGN KEY (granted_by) REFERENCES admins (id)
);

-- ย้ายเฉพาะแถวที่ล็อกอินได้จริง
INSERT INTO admin_roles (admin_id, role)
SELECT id, role FROM admins WHERE username IS NOT NULL;

ALTER TABLE admins ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE admins DROP COLUMN role;
```

สามการตัดสินใจในไฟล์นี้:

**บทบาทเป็น ENUM ในตารางเชื่อม ไม่ใช่ตาราง `roles` แยก** — บทบาทเป็นค่าคงที่ในโค้ด
ไม่ใช่ของที่ร้านเพิ่มเองได้ ตารางชื่อบทบาทแยกจะเปิดช่องให้มีบทบาทในฐานที่โค้ดไม่รู้จัก
แล้วสิทธิ์ของมันคือ "ไม่มีอะไรเลย" โดยไม่มีอะไรเตือน

**`admins.role` ถูกลบทิ้ง ไม่เก็บเป็นสำเนา** — สำเนาที่ค้างคือสองที่ที่ตัดสินสิทธิ์
ซึ่งเป็นสิ่งเดียวที่โค้ดชุดนี้ห้ามไว้ชัดเจน · แลกกับต้องแก้ query ที่อ่านคอลัมน์นี้
ทุกจุด รวม CLI สามตัว

**แถวเงาไม่ได้บทบาทติดมา** — พนักงานที่ไม่เคยล็อกอิน (ไม่มี username) วันนี้ถือ
`role = 'sales'` ที่ไม่มีความหมาย ถ้ายกมาด้วยจะกลายเป็นสิทธิ์จริงในวันที่มีคนเปิด
บัญชีให้เขา · migration จึงข้ามแถวพวกนี้ และ `Users::ensureFor()` เลิกใส่บทบาท
ให้แถวที่มันสร้าง — การรับคนเข้าทำงานไม่ใช่การให้สิทธิ์

**กติกาที่ฐานกับโค้ดช่วยกันถือ**: บัญชีที่ล็อกอินได้ต้องมีอย่างน้อยหนึ่งบทบาท
(โค้ดปฏิเสธ) และต้องเหลือ Owner ที่ล็อกอินได้อย่างน้อยหนึ่งคนเสมอ (กฎเดิม
`requireOwnerRemains` ย้ายมาถามตารางใหม่)

## `Roles.php` — รูปร่างใหม่

```php
public const TRAINEE = 'trainee';                    // เพิ่มมาใหม่
public const ALL  = [superuser, owner, admin, sales, trainee, stock];

/** ชื่อที่ใช้เป็นแท็กในตาราง — ตามที่สเปกหน้าจอเขียนไว้ */
public const NAME = ['owner' => 'Owner', 'trainee' => 'Trainee Staff', ...];
public const LABEL = [...];                          // ไทย เหมือนเดิม

public const PERM   = ['frontdesk.use' => 'ระบบหน้าร้าน — …', ...];
public const GRANTS = ['sales' => [...], 'trainee' => self::GRANTS_SALES, ...];

/** @param list<string> $roles */
public static function has(array $roles, string $perm): bool;
public static function permsOf(array $roles): array;   // ยูเนียน เรียงตาม PERM
public static function rank(array $roles): int;        // สูงสุดของที่ถือ
public static function canGrant(array $actorRoles, string $target): bool;
```

ฟังก์ชันความสามารถทั้ง 12 ตัวยังอยู่ครบ แต่กลายเป็นเปลือกบาง ๆ:

```php
public static function seeCost(array $roles): bool  { return self::has($roles, 'cost.view'); }
public static function enterRxCost(array $roles): bool { return self::has($roles, 'cost.edit'); }
```

เพิ่มอีกสี่ตัวสำหรับสิทธิ์ที่ยังไม่มีฟังก์ชันของตัวเอง: `useFrontdesk()` `useStock()`
`viewAllCases()` `adminZone()`

`policy()` สร้างจาก `GRANTS` โดยตรง แทนการเรียกฟังก์ชันทีละช่อง — แหล่งเดียวเหมือนเดิม
แต่ตอนนี้ตารางบอกชื่อสิทธิ์ได้ด้วย ซึ่งเป็นสิ่งที่หน้าจอต้องใช้ทำ Permission Preview

`home(array $roles)`: มีแต่หน้าร้าน → `/` · มีคลังด้วย → `/stock/dashboard/`
(พฤติกรรมเดิม ไม่เปลี่ยน)

## `Auth` — รูปร่างของ actor

```
roles        ['owner','admin']        เรียงยศมากไปน้อย
roleNames    ['Owner','Admin']        สำหรับแท็ก
roleText     'Owner + Admin'          สำหรับคอลัมน์ Role และ actor_role ในล็อก
perms        ['frontdesk.use', …]     ยูเนียน — หน้าเว็บใช้ตัดสินว่าจะวาดเมนูไหม
mustChangePassword  bool
```

`role` (เอกพจน์) หายไปจาก actor · `Auth::actor()` อ่านแถวจากฐานใหม่ทุกคำขออยู่แล้ว
session ที่ค้างรูปเก่าจึงหายเองภายในคำขอเดียว ไม่มีใครถูกเตะออก

## ด่านสิทธิ์

**`api/index.php`** — เพิ่มด่านที่สี่ก่อนด่านแอดมิน: คนที่ไม่มี `frontdesk.use`
(คือ Stock ล้วน) โดน 403 ทั้ง `/api/*` ยกเว้น `/api/auth/*` และ `/api/meta`
ทำได้เพราะ `/stock-api/*` ออกจากไฟล์นี้ไปตั้งแต่บรรทัดบนสุดแล้ว และหน้าจอฝั่งคลัง
คุยกับ `/stock-api` อย่างเดียว (`frontend-next/stockmod/lib/api.ts`) — นี่คือการ
บังคับ `case.view_all` จริง ตามที่ตกลงว่า Stock ไม่ต้องเห็นเคส

ด่านแอดมินเดิมเปลี่ยนจาก `rank >= ADMIN` เป็น `Roles::adminZone($actor['roles'])`

**`must_change_password`** — คนที่ธงนี้ขึ้นล็อกอินได้ (มี session) แต่ทุกเส้นทาง
ตอบ 403 `password_change_required` ยกเว้น `/api/auth/*` และเส้นเปลี่ยนรหัสของตัวเอง
กันที่ประตูเดียวกัน ไม่ใช่ไปเติมในทุก handler

## API ที่เปลี่ยน

| เส้น | เดิม | ใหม่ |
|---|---|---|
| `GET /stock-api/users` | list | + `roles` `roleNames` `employeeActive` `mustChangePassword` |
| `POST /stock-api/users` | `Users::create()` **(ตายอยู่)** | `grantAccount()` รับ `employee_id` + `roles[]` |
| `POST /stock-api/users/{id}/update` | `role` เดี่ยว | `roles[]` |
| `POST /stock-api/users/{id}/password` | ตั้งรหัส | + ตั้งธงบังคับเปลี่ยน |
| `POST /stock-api/users/{id}/reset-password` | — | **ใหม่** สุ่มรหัส คืนครั้งเดียว + ตั้งธง |
| `POST /stock-api/users/{id}/revoke` | `/delete` → `Users::delete()` **(ตายอยู่)** | `revokeAccount()` |
| `POST /stock-api/auth/change-password` | — | **ใหม่** เปลี่ยนรหัสตัวเอง ล้างธง |

รหัสที่สุ่ม: `TO` + ปี + `@` + สี่ตัวจากชุดที่ไม่มีตัวอักษรกำกวม (`0O1lI`) เช่น
`TO2026@k7rt` — ยาว 11 ตัว ผ่านขั้นต่ำ 10 ตัวเดิม

## หน้าจอ

**ตารางผู้ใช้** — คอลัมน์ตามสเปก: ชื่อพนักงาน · Username · Role (แท็กหลายอัน) ·
ตำแหน่ง · สถานะ · Last Login · Action (แก้ไข · รีเซ็ตรหัส)

**เพิ่มผู้ใช้** — ช่องแรกเป็น dropdown เลือกพนักงานที่ยังไม่มีบัญชี พร้อมตัวเลือก
"+ เพิ่มพนักงานใหม่…" ที่กางช่องชื่อ/ตำแหน่งในฟอร์มเดียวกัน แล้วยิง `POST /api/employees`
ก่อนแล้วค่อยยิง grant · ต่อด้วย Username · Password + ยืนยัน · เช็กบ็อกซ์บทบาท ·
สถานะ · และ **Permission Preview** ที่คำนวณยูเนียนสด ๆ จาก `/api/auth/policy`

**แก้ไขผู้ใช้** — ชื่อกับตำแหน่งแสดงแบบอ่านอย่างเดียว พร้อมลิงก์ไปหน้าพนักงาน
(ทั้งสองช่องเป็นของ `employees` ที่เดียว ตามที่ตัดสินไว้เมื่อวาน — รับแก้ที่นี่ด้วย
แปลว่ามีสองที่ที่ตั้งชื่อคนคนเดียวกัน แล้ววันหนึ่งใบเสร็จกับรายงานจะพิมพ์คนละชื่อ)
· แก้ได้: Username · บทบาท · สถานะ · ตั้งรหัสผ่านใหม่ · ยกเลิกบัญชีเข้าใช้งาน
ปุ่ม "ลบผู้ใช้" หายไปทั้งปุ่ม — ปลายทางที่ถูกคือ Deactivate กับ Revoke ซึ่งมีอยู่แล้ว

**หน้าตั้งรหัสผ่านใหม่** — เต็มจอ ขวางไว้หน้าแอปเมื่อ `mustChangePassword`

**`frontend-next/lib/roles.js`** — ตาราง `RANK` ที่คัดลอกจาก PHP หายไป แทนที่ด้วย
`can(actor, 'cost.view')` ที่อ่าน `actor.perms` ซึ่ง API ส่งมา · กฎชุดเดียวจริง ๆ
เสียที ไม่ต้องแก้สองที่ตอนเพิ่มบทบาท

## บันทึกการใช้งาน

`ActivityLog` ดักที่ประตูเดียวและแม็ป `/stock-api/users` → ตาราง `admins` อยู่แล้ว
แต่บทบาทย้ายไปตารางลูก diff จึงจะมองไม่เห็น · แก้ที่ `snapshot()` จุดเดียว: เมื่อ
ตารางคือ `admins` ให้ต่อคอลัมน์สังเคราะห์ `roles` เข้าไปในแถวที่อ่าน

ผลคือทุกเส้นทางที่เปลี่ยนบทบาท — รวมเส้นที่ยังไม่ได้เขียน — ได้บรรทัด
`roles: sales → sales+admin` มาฟรี โดยไม่ต้องมีใครจำได้ว่าต้องเรียกอะไร
(หลักเดียวกับที่หัวไฟล์นั้นอธิบายไว้ว่าทำไมถึงไม่ไปเติม `log()` ในทุก handler)

หน้า Users ได้การ์ด "ประวัติการเปลี่ยนสิทธิ์" ท้ายหน้า ดึงจาก `/api/logs?entity=admins`
ที่มีอยู่แล้ว ไม่มีตารางใหม่

## ของที่ซ่อมไปด้วย

`stock/api/public/index.php:593,609` เรียก `Users::create()` กับ `Users::delete()`
ซึ่งถูกลบไปตั้งแต่คอมมิต `00fe623` — ปุ่ม "เพิ่มผู้ใช้" และ "ลบผู้ใช้" ในหน้าจอวันนี้
ตอบ 500 ทั้งคู่ · งานนี้เขียนสองเส้นนั้นใหม่ทั้งเส้นอยู่แล้ว

## ทดสอบ

`stock/api/tests/50-users.test.php` เขียนต่อ — ชุดใหม่ที่ต้องมี:

- ยูเนียน: คนถือ sales+admin ได้สิทธิ์ครบทั้งสองชุด
- Trainee ได้ชุดเดียวกับ Sales ทุกช่อง (วนทุกคีย์ใน `PERM` เทียบกัน)
- `cost.view` ✅ แต่ `cost.edit` ❌ สำหรับ Admin — และ ✅ ทั้งคู่สำหรับ Owner
- Stock ล้วนไม่มี `frontdesk.use` และไม่มี `case.view_all`
- ตั้งบทบาทสูงกว่ายศตัวเองไม่ได้ · ลดยศตัวเองไม่ได้ · ปิดบัญชีตัวเองไม่ได้
- ถอด Owner คนสุดท้ายไม่ได้ ทั้งทางปิดบัญชี ทางยกเลิกบัญชี และทางถอดบทบาท
- บัญชีที่ล็อกอินได้ต้องเหลืออย่างน้อยหนึ่งบทบาท
- reset-password คืนรหัสครั้งเดียวและตั้งธงบังคับเปลี่ยน · เปลี่ยนแล้วธงลง

ฐานที่ใช้ทดสอบคือฐานจริง (harness เขียนแล้วลบ) — เกณฑ์ผ่านคือ **332/332**
ตอนเริ่มงานมี 3 ตัวที่ตกอยู่ก่อนแล้ว (คืนของ 2 · แก้ไขล็อต 1) ไม่เกี่ยวกับงานนี้
และต้องไม่เพิ่มจำนวนนั้น

## ลำดับงาน

1. migration + `Roles.php` + `Auth.php` (ยูเนียน ชื่อสิทธิ์ actor รูปใหม่)
2. `Users.php` (roles[] · reset · ธงบังคับเปลี่ยน) + เส้นทาง `/stock-api/users`
3. ด่านใน `api/index.php` + call site ที่อ่าน `$actor['role']` ทั้ง 65 จุด + CLI
4. `ActivityLog::snapshot()`
5. หน้า Users + `lib/roles.js` + หน้าบังคับเปลี่ยนรหัส
6. เทสต์ตลอดทาง แล้วรันทั้งชุดปิดท้าย
