# TimeOptic Web — ระบบจัดการร้านแว่นตา

เว็บแอปสำหรับร้านแว่นตา TimeOptic ทำงานบนฐานข้อมูล **MariaDB `timeoptic`** ของ XAMPP
(schema เดิมที่ออกแบบไว้แล้ว 27 ตาราง + 7 views — แอปนี้ต่อเข้ากับของเดิม ไม่ได้สร้างใหม่)

**สแต็กปัจจุบัน: React (frontend) + PHP REST API (backend)**

---

## โครงสร้างโฟลเดอร์

```
timeoptic-web/
├── api/                      Backend — PHP REST API (85 endpoints)
│   ├── index.php               front controller: โหลด core → services → routes
│   ├── router.php              ทางเข้าเวลารันด้วย  php -S
│   ├── .htaccess               ทางเข้าเวลาให้ Apache เสิร์ฟ
│   ├── config.php              อ่านค่าจาก .env / environment
│   ├── core/                   Db(PDO) · Router · Http · Helpers · Sql · Lookups
│   ├── services/               Telegram · Migrate · Scheduler · Booking
│   ├── routes/                 18 ไฟล์ — หนึ่งไฟล์ต่อหนึ่งกลุ่มข้อมูล
│   └── cli/                    reminder.php (Task Scheduler) · serve.php (banner)
│
├── frontend/                 Frontend — React 19 + Vite + React Router
│   └── src/
│       ├── api/                client.js (fetch) · meta.jsx (context ของ dropdown)
│       ├── lib/                format.js · constants.js · hooks.js
│       ├── components/         Shell · Card/Table/Field · Picker · Toast · Confirm
│       ├── pages/              39 หน้าจอ แยกตามโดเมน
│       └── styles/app.css      สไตล์เดิม ยกมาทั้งไฟล์
│
├── lib/  public/  server.js   ⚠️ ของเดิม (Node + vanilla JS) — เก็บไว้เทียบผล
└── start-api.bat  start-web.bat
```

ที่แยก `api/routes/` เป็น 18 ไฟล์เพราะเดิม endpoint ทั้ง 85 ตัวอยู่ใน `lib/api.js`
ไฟล์เดียว 1,773 บรรทัด — จะแก้อะไรทีต้องไล่หาทั้งไฟล์ ตอนนี้แก้ `bookings`
ก็เปิดแค่ `api/routes/bookings.php`

---

## เริ่มใช้งาน

**ต้องเปิด MySQL ของ XAMPP ก่อน** (XAMPP Control Panel → MySQL → Start)

เปิดสองหน้าต่าง (หรือดับเบิลคลิกสองไฟล์นี้):

```bat
start-api.bat        REM  PHP API   → http://127.0.0.1:8080
start-web.bat        REM  React     → http://localhost:5173
```

ใช้งานจริงที่ **http://localhost:5173** — Vite จะส่งต่อ `/api/*` ไปที่ PHP ให้เอง

ตั้งค่าเชื่อมต่อในไฟล์ `.env` (ไม่เข้า git — ดู `.env.example`):

```
DB_HOST=127.0.0.1  DB_PORT=3306  DB_USER=root  DB_PASS=  DB_NAME=timeoptic
TELEGRAM_BOT_TOKEN=...   TELEGRAM_CHAT_ID=...
```

* PHP **8.0+** ต้องมี `pdo_mysql` (XAMPP มีให้อยู่แล้ว — เครื่องนี้ 8.0.30 ✔)
* Node **20+** ใช้เฉพาะตอน dev/build ฝั่ง React (เครื่องนี้ v24.18.0 ✔)
* ดูข้อมูลดิบผ่าน **phpMyAdmin**: http://localhost/phpmyadmin (ต้องเปิด Apache ด้วย)

### ขึ้นใช้งานจริงบน Apache

```bat
cd frontend && npm run build
```

แล้วชี้ Apache ไปที่โฟลเดอร์โปรเจกต์ โดยเสิร์ฟ `frontend/dist/` เป็น document root
และ `api/` เป็นโฟลเดอร์ย่อย — `.htaccess` ใน `api/` จัดการ routing ให้แล้ว
(ไม่ต้องรัน `php -S` และไม่ต้องรัน Node)

### ตัวเตือนคิว Telegram

เดิมเป็น `setInterval` อยู่ในโปรเซส Node — PHP ไม่มีโปรเซสค้างแบบนั้น
ให้ตั้ง **Task Scheduler** ของ Windows เรียกทุก 1 นาที:

```
C:\xampp\php\php.exe C:\test\timeoptic-web\api\cli\reminder.php
```

หรือกดปุ่ม "⏱ รันตัวเตือนเดี๋ยวนี้" ในหน้า ตั้งค่า

---

## ระบบจองคิว (Queue Booking)

ลูกค้าจองล่วงหน้าทางโทรศัพท์ / LINE / Facebook → บันทึกเป็น **booking** → ถึงวันจริงกด
"เปิดเคส" แล้วระบบจะสร้างลูกค้า (ถ้าเป็นลูกค้าใหม่) + เปิดเคส + ยกบันทึกเบื้องต้นทั้งหมด
เข้าไปใน `cases.reception_note` ให้อัตโนมัติ

* **ปฏิทินรายเดือน** — แต่ละวันมีป้ายนับคิว แยกสี: 🔵 รอมา · 🟠 มาถึง/กำลังบริการ · 🟢 เสร็จสิ้น · 🔴 ไม่มาตามนัด
  คลิกวันไหนก็ได้เพื่อดูคิวของวันนั้นเรียงตามเวลา
* **บันทึกเบื้องต้นทีละขั้น** — ตอนรับจองมีชุดคำถามตั้งต้น 6 ข้อ (มาด้วยเรื่องอะไร / เคยตัดกับเราไหม /
  แว่นเดิมแบบไหน / ใช้สายตาหนักด้านไหน / งบประมาณ / อยากได้เมื่อไหร่)
  หลังจากนั้นเพิ่มบันทึกได้เรื่อย ๆ แยกตามขั้นตอน (รับจอง → ยืนยันคิว → ลูกค้ามาถึง → ส่งต่อฝ่ายขาย → ติดตามผล)
* **สถานะคิว** — จองแล้ว → ยืนยันแล้ว → ลูกค้ามาถึง → กำลังให้บริการ → เสร็จสิ้น (+ ไม่มาตามนัด / ยกเลิก)

### แจ้งเตือน Telegram ก่อนถึงคิว

ตัวเตือนทำงานอยู่เบื้องหลัง **ทุก 30 วินาที** หาคิวที่ใกล้ถึงเวลาตามที่ตั้งไว้รายคิว
(ปริยาย 10 นาที ปรับได้ 0–1440) แล้วส่งเข้ากลุ่ม Telegram ของร้าน ข้อความจะมี
เวลา · ชื่อลูกค้า · เบอร์โทร · บริการที่จอง · ผู้ดูแล · ลูกค้าใหม่/เก่า · **บันทึกเบื้องต้นทั้งหมด**
เพื่อให้ Sale เตรียมตัวได้ทัน

ตั้งค่าที่หน้า **⚙️ ตั้งค่า/แจ้งเตือน**:

1. Telegram → ค้นหา `@BotFather` → `/newbot` → ได้ **Bot Token**
2. สร้างกลุ่มของร้าน แล้วเชิญบอทเข้ากลุ่ม
3. เชิญ `@getidsbot` เข้ากลุ่มเพื่อดู **Chat ID** (ของกลุ่มขึ้นต้นด้วย `-100`) แล้วเตะออกได้
4. วางทั้งสองค่า ติ๊ก "เปิดใช้งาน" → บันทึก → กด **🧪 ทดสอบส่งข้อความ**

เก็บ token ไว้นอกฐานข้อมูลก็ได้ด้วย env `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (env ชนะเสมอ)
ทุกข้อความที่ส่ง (สำเร็จหรือไม่) ถูกบันทึกใน `notification_log` ดูได้ท้ายหน้าตั้งค่า
ถ้าส่งไม่สำเร็จ ระบบ **จะไม่ mark ว่าส่งแล้ว** และลองใหม่ในรอบถัดไป

---

## Flow การทำงาน — งานหนึ่งชิ้น = หนึ่ง "เคส"

ระบบเดินตาม `case_statuses` 32 สถานะในฐานข้อมูล (stage 02 → 19):

```
รับลูกค้า → วัดสายตา → สรุปค่าสายตา → เลือกกรอบ/เลนส์ → วัดจุดศูนย์กลาง
→ ยืนยันออเดอร์ → ชำระเงิน → นัดหมาย → วัดกรอบ → หาแหล่งเลนส์
      ├─ มีในสต็อก ──────────────┐
      └─ สั่งซัพพลายเออร์ → รอเลนส์ ─┤
→ จับคู่ + ตรวจ → ฝนเลนส์ → QC ─(ไม่ผ่าน)→ ซ่อม → QC ใหม่
→ แพ็ค → แจ้งลูกค้า → รอรับ → รับของ → เสร็จสิ้น
```

การกระทำทุกอย่างเขียนลง `case_events` เป็น audit log อัตโนมัติ
และหลายอย่างจะ **เลื่อนสถานะเคสให้เอง** เช่น
บันทึก QC ผ่าน → `packing`, QC ไม่ผ่าน → `qc_failed`, ปิดออเดอร์ → `completed`

---

## หน้าจอ

| หน้า | ทำอะไร |
|---|---|
| **เมนูหลัก** | KPI วันนี้ + งานค้างแต่ละขั้นตอน + **คิวจองวันนี้ (นับถอยหลัง)** + ออเดอร์ว่าง / ออเดอร์ที่ยังไม่ปิด |
| **📅 ปฏิทินจองคิว** | ปฏิทินรายเดือน + คิวรายวัน + จอง/แก้ไข/ยกเลิก + เปิดเคสจากคิว |
| **⚙️ ตั้งค่า/แจ้งเตือน** | ตั้งค่า Telegram · ทดสอบส่ง · รันตัวเตือนเอง · ประวัติการแจ้งเตือน |
| **กระดานงาน** (Case Board) | คิวงานแบบ kanban 6 คอลัมน์ตาม stage_group · กรองงานด่วน · การ์ดบอกวันนัด/ยอดค้าง/อายุงาน |
| **รายละเอียดเคส** | 6 แท็บ — ค่าสายตา · เลนส์ · ผลิต&QC · การเงิน · ติดต่อลูกค้า · ไทม์ไลน์ |
| **ติดตามเลนส์** (Lens Tracker) | เลนส์ที่สั่งซัพพลายเออร์ · ETA · ความเสี่ยง (late/soon/ok) · ตัวที่เสี่ยงกระทบวันนัด |
| ลูกค้า / ค้นหาลูกค้า | ประวัติเคส + ค่าสายตา + ออเดอร์ ครบในหน้าเดียว |
| วัดสายตา | ค่าสายตาเต็มรูปแบบ — SPH/CYL/AXIS/ADD/PD/VA/PRISM/BASE + ประวัติสุขภาพ + ระยะทำงาน |
| ออเดอร์ตัดแว่น | สร้าง / แก้ไข / เติมของ / ปิดการขาย |
| ขายสินค้าทั่วไป | ตัดสต็อกทันที + บันทึกลง payments |
| สต็อก / ตำแหน่งสินค้า / ซัพพลายเออร์ / พนักงาน | ข้อมูลตั้งต้น |
| รายรับ / รายจ่าย | บันทึก + ประวัติ + สรุปยอด |
| รายงาน | 5 รายงาน + เอกสารพิมพ์ 2 แบบ |

### แท็บในหน้าเคส

* **ค่าสายตา** — ดูค่าเดิม / ค่าที่วัดได้ / ค่าที่ใช้จริง, กด "ใช้ค่านี้เป็นค่าจริง" เพื่อ confirm เข้า `custom_orders.final_prescription_id`
* **เลนส์** — เลือกว่ามีในสต็อกหรือต้องสั่ง, บันทึกซัพพลายเออร์/ETA, บันทึกการโทรตาม (เก็บ ETA เดิม→ใหม่, กระทบวันนัดไหม, แจ้งลูกค้าหรือยัง), ปุ่ม "เลนส์มาถึงแล้ว"
* **ผลิต & QC** — วัดกรอบ (lens width/bridge/temple/ED/DBL), จุดศูนย์กลาง (PD/height/vertex/pantoscopic/wrap), งานฝน, checklist การแพ็ค 6 ข้อ, บันทึกผล QC เป็นรอบ ๆ
* **การเงิน** — รายการรับเงินทั้งหมด (มัดจำ/บางส่วน/ปิดยอด) + บันทึกรับเงินใหม่
* **ติดต่อลูกค้า** — log การโทร/LINE พร้อมผลการติดต่อ
* **ไทม์ไลน์** — `case_events` ทั้งหมดเรียงเวลา + เพิ่มบันทึกเองได้

---

## เรื่องเงิน — `payments` คือความจริง

ยอดที่รับจริงทั้งหมดอยู่ในตาราง `payments` (มัดจำ / จ่ายบางส่วน / ปิดยอด / ขายสินค้า)

```
paid    = SUM(payments.amount)  ของออเดอร์นั้น
balance = total_price − discount − paid
```

`custom_orders.deposit` ถูกเก็บไว้เป็นตัวสะท้อนของมัดจำก้อนแรก (view `v_case_board` ใช้ค่านี้)
ระบบจะเขียน `payments` ให้อัตโนมัติเมื่อ:

* เปิดออเดอร์พร้อมมัดจำ → `kind='deposit'`
* ปิดการขาย → `kind='final'`
* ขายสินค้าทั่วไป → `kind='full'` (ผูกกับ `sale_id`)

ถ้าแก้ยอด `deposit` ในฟอร์มแก้ไขออเดอร์ **จะไม่สร้างรายการรับเงิน** — ให้ใช้แท็บ "การเงิน" ในหน้าเคสแทน

---

## ตารางที่ใช้

ใช้ schema เดิมทั้ง 27 ตาราง **โดยไม่แก้ไขหรือลบอะไรเลย** และเพิ่มใหม่ 4 ตารางสำหรับระบบจองคิว
(สร้างอัตโนมัติตอน start ด้วย `CREATE TABLE IF NOT EXISTS` — ดู `lib/migrate.js`):

```
bookings          การจองคิว (วัน/เวลา/บริการ/ช่องทาง/ผู้ดูแล/นาทีที่จะเตือน/บันทึกเบื้องต้น)
booking_notes     บันทึกเบื้องต้นทีละขั้น (step + คำถาม + คำตอบ + ผู้บันทึก)
notification_log  ทุกข้อความ Telegram ที่ส่ง สำเร็จ/ไม่สำเร็จ พร้อมสาเหตุ
app_settings      key/value เก็บ Telegram token, chat id, ค่าปริยายต่าง ๆ
```

ตารางเดิมที่ใช้:

```
cases · case_statuses · case_events · case_photos
customers · employees · suppliers
prescriptions · centerings · frame_fittings
custom_orders · lens_jobs · lens_followups · production_jobs · qc_checks
payments · sales · stock · product_locations
incomes · expenses · customer_notifications
list_sex · list_marketing · list_pay_type · list_product_type · list_len_type
views: v_case_board · v_lens_tracker · v_order_history · v_orders_unclosed
       v_orders_unfilled · v_sale_history · v_stock_available
```

แอปอ่านจาก `v_case_board` และ `v_lens_tracker` โดยตรง (กระดานงาน + ตัวติดตามเลนส์)

**หมายเหตุ:** คอลัมน์ค่าสายตาใน `prescriptions` เป็น `VARCHAR(20)` ไม่ใช่ตัวเลข
หน้าเว็บจึงรับค่าอย่าง `-1.25`, `+2.00`, `plano` ได้ตามที่ schema ตั้งใจไว้

---

## โครงสร้างโปรเจกต์

```
timeoptic-web/
├── server.js              HTTP server + ตรวจการเชื่อมต่อ DB ตอน start
├── lib/
│   ├── db.js              mysql2 pool, transaction helper, lookup lists
│   └── api.js             JSON API + business logic + case state machine
├── public/
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── app.js         router + เมนู
│       ├── core.js        API client + DOM helper + formatting
│       └── views/
│           ├── cases.js        กระดานงาน, รายละเอียดเคส 6 แท็บ, lens tracker
│           ├── core-views.js   เมนูหลัก, ลูกค้า, ค่าสายตา, พนักงาน
│           ├── orders.js       ออเดอร์: list / form / fill / close
│           ├── shop.js         สต็อก, ตำแหน่งสินค้า, การขาย, ซัพพลายเออร์
│           ├── finance.js      รายรับ / รายจ่าย
│           └── reports.js      รายงาน + เอกสารพิมพ์
└── .env.example
```

---

## API

```
GET    /api/meta                        lists + พนักงาน + สถานะเคส + ซัพพลายเออร์
GET    /api/dashboard                   KPI + คิวงาน + สรุปตาม stage

GET    /api/cases?q=&stage_group=&rush=&open=
POST   /api/cases                       · PUT /api/cases/:id
GET    /api/cases/:id                   เคสแบบเต็ม (rx, order, lens, qc, payments, events…)
POST   /api/cases/:id/status            เปลี่ยนสถานะ + เขียน case_event
POST   /api/cases/:id/note              เพิ่มบันทึกลงไทม์ไลน์
POST   /api/cases/:id/notify            บันทึกการติดต่อลูกค้า

GET    /api/customers?q=                · POST · GET/PUT/DELETE /:id
GET    /api/prescriptions?q=&customer_id=   · POST · PUT /:id
POST   /api/prescriptions/:id/confirm   ตั้งเป็นค่าสายตาที่ใช้จริง
GET    /api/employees · /api/suppliers  · POST · PUT /:id

GET    /api/stock?q=&type=&sold=        · POST (มี amount) · GET/PUT/DELETE /:id
GET    /api/stock/names                 · GET/POST/PUT/DELETE /api/locations

GET    /api/orders?status=&q=&from=&to= status: all|unfilled|unclosed|open|closed
POST   /api/orders                      · GET/PUT/DELETE /:id
POST   /api/orders/:id/fill             ผูกเลนส์ซ้าย/ขวา/กรอบจากคลัง
POST   /api/orders/:id/close            ปิดการขาย + ตัดสต็อก + สร้าง payment
POST   /api/orders/:id/reopen           ยกเลิกการปิด + คืนสต็อก + ลบ payment ก้อนสุดท้าย

GET/POST/DELETE /api/payments           ledger การรับเงิน
GET    /api/lens-tracker?risk=&threatens=
GET    /api/lens-jobs/:id  ·  POST /api/lens-jobs
POST   /api/lens-jobs/:id/followup      บันทึกการตามเลนส์ (อัปเดต ETA + วันนัด)
POST   /api/lens-jobs/:id/receive       เลนส์มาถึงร้าน
POST   /api/centerings · /api/frame-fittings · /api/production-jobs · /api/qc-checks

GET/POST/DELETE  /api/sales
GET/POST/PUT/DELETE  /api/income · /api/expense

GET    /api/bookings?date=&from=&to=&status=&q=&upcoming=
GET    /api/bookings/calendar?month=YYYY-MM   นับคิวรายวันสำหรับปฏิทิน
GET    /api/bookings/today
POST   /api/bookings                    · GET/PUT/DELETE /:id
POST   /api/bookings/:id/status         จองแล้ว/ยืนยัน/มาถึง/เสร็จ/ไม่มา/ยกเลิก
POST   /api/bookings/:id/notes          · DELETE /:id/notes/:note_id
POST   /api/bookings/:id/open-case      สร้างลูกค้า(ถ้าใหม่) + เปิดเคส + ยกบันทึกเข้าเคส
POST   /api/bookings/:id/remind         ส่งแจ้งเตือนเดี๋ยวนี้
GET/PUT /api/settings  ·  POST /api/settings/telegram/test
GET    /api/notifications  ·  POST /api/reminders/run

GET    /api/reports/daily-closed?from=&to=
GET    /api/reports/income-by-month · /checklist?type= · /stock-labels · /unsold-stock?days=
GET    /api/reports/order/:id · /api/reports/prescription/:id · /api/reports/workload
```

---

## ที่ยังไม่ได้ทำ

* **ระบบล็อกอิน / สิทธิ์ผู้ใช้** — ยังไม่มี ตอนนี้เปิดที่ `127.0.0.1` เท่านั้น
  ถ้าจะใช้หลายเครื่องในร้าน ต้องเพิ่ม login ก่อนตั้ง `HOST=0.0.0.0`
  (schema มีคอลัมน์ `employees.roles` รออยู่แล้ว)
* **นำเข้าข้อมูลจริงจาก Access** (`TimeOptic5.23FE_3.9BE.accdb` — ลูกค้า ~6,800 / ออเดอร์ ~8,800 / สต็อก ~53,000)
  ยังไม่มีตัว import — ถ้าส่งไฟล์ `.accdb` หรือ export CSV มา เขียนสคริปต์ย้ายให้ได้
* **`case_photos`** — ตารางมีแล้ว แต่ยังไม่มีหน้าอัปโหลดรูป
* **หน้าจองคิวสำหรับลูกค้าเอง (public booking page)** — ตอนนี้พนักงานเป็นคนคีย์จองให้
* **กันจองซ้ำช่วงเวลาเดียวกัน** — ยังจองเวลาทับกันได้ ถ้าต้องการให้เตือน/ห้าม บอกได้
* **แจ้งเตือนช่องทางอื่น** (LINE Notify / SMS) — โครงสร้าง `notification_log` รองรับแล้ว
* **`v_order_history` / `v_sale_history` / `v_stock_available`** — ยังไม่ได้ใช้ (แอป query ตารางตรงเพื่อความยืดหยุ่นในการกรอง)
* รายงานรวมหลายชั้นแบบ `superrptOrder` / `superrptSales` ของ Access เดิม
