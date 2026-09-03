# TimeOptic Web — ระบบจัดการร้านแว่นตา

เว็บแอปสำหรับร้านแว่นตา TimeOptic ทำงานบนฐานข้อมูล **MariaDB `timeoptic`** ของ XAMPP
(schema เดิมที่ออกแบบไว้แล้ว 27 ตาราง + 7 views — แอปนี้ต่อเข้ากับของเดิม ไม่ได้สร้างใหม่)

**สแต็กปัจจุบัน: Next.js static export (frontend) + PHP REST API (backend) + MariaDB**

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
│   ├── routes/                 19 ไฟล์ — หนึ่งไฟล์ต่อหนึ่งกลุ่มข้อมูล
│   └── cli/                    reminder.php (Task Scheduler) · serve.php (banner)
│
├── frontend-next/            Frontend — Next.js 15 (App Router) + React 19 · static export
│   ├── app/                    30 หน้าจอ แยกตามโดเมน (file-based routing)
│   │   └── globals.css         สไตล์ทั้งระบบไฟล์เดียว (คอม / iPad / โทรศัพท์)
│   ├── components/             Shell · DataTable · Card/Field · Picker · Toast · Confirm
│   ├── contexts/               MetaContext — dropdown ที่โหลดจาก /api/meta
│   └── lib/                    apiClient · format · constants · hooks · caseProcesses
│
└── start-api.bat
```

ที่แยก `api/routes/` เป็น 19 ไฟล์เพราะรุ่นแรก (Node) รวม endpoint ทั้ง 85 ตัวไว้ในไฟล์
เดียว 1,773 บรรทัด — จะแก้อะไรทีต้องไล่หาทั้งไฟล์ ตอนนี้แก้ `bookings` ก็เปิดแค่
`api/routes/bookings.php`

---

## เริ่มใช้งาน

**ต้องเปิด MySQL ของ XAMPP ก่อน** (XAMPP Control Panel → MySQL → Start)

เปิดสองหน้าต่าง:

```bat
start-api.bat                       REM  PHP API  → http://127.0.0.1:8080
cd frontend-next && npm run dev     REM  Next.js  → http://localhost:3000
```

ใช้งานจริงที่ **http://localhost:3000** — static export ไม่มี dev proxy แบบ Vite
ฝั่งเว็บจึงยิงตรงไปที่ API ตามค่าใน `frontend-next/.env.development`
(`NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:8080` — แก้ให้ตรงกับพอร์ตที่รัน API จริง)

ตั้งค่าเชื่อมต่อในไฟล์ `.env` (ไม่เข้า git — ดู `.env.example`):

```
DB_HOST=127.0.0.1  DB_PORT=3306  DB_USER=root  DB_PASS=  DB_NAME=timeoptic
TELEGRAM_BOT_TOKEN=...   TELEGRAM_CHAT_ID=...
```

* PHP **8.0+** ต้องมี `pdo_mysql` (XAMPP มีให้อยู่แล้ว — เครื่องนี้ 8.0.30 ✔)
* Node **20+** ใช้เฉพาะตอน dev/build ฝั่ง Next.js (เครื่องนี้ v24.18.0 ✔)
* ดูข้อมูลดิบผ่าน **phpMyAdmin**: http://localhost/phpmyadmin (ต้องเปิด Apache ด้วย)

### ขึ้นใช้งานจริงบน Apache

```bat
cd frontend-next && npm run build
```

แล้วชี้ Apache ไปที่โฟลเดอร์โปรเจกต์ โดยเสิร์ฟ `frontend-next/out/` เป็น document root
และ `api/` เป็นโฟลเดอร์ย่อย — `.htaccess` ใน `api/` จัดการ routing ให้แล้ว
(`.env.production` ตั้ง `NEXT_PUBLIC_API_ORIGIN=` ว่างไว้ เพราะอยู่โดเมนเดียวกันแล้ว —
ไม่ต้องรัน `php -S` และไม่ต้องรัน Node)

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

Main Process มี **6 ขั้น**:

```
รับลูกค้า → วัดสายตา → ขาย/เลือกกรอบ → ชำระเงิน → วัด Center → ส่งมอบ
reception   exam       sales           payment    centering    delivery
```

รายชื่อหกขั้นนี้ประกาศไว้สองที่และต้องตรงกันเสมอ — `frontend-next/lib/caseProcesses.js`
กับ `api/routes/processes.php` ส่วน `case_statuses` (18 แถว) คือสถานะย่อยภายในแต่ละขั้น
จัดกลุ่มด้วยคอลัมน์ `stage_group` และประกาศไว้ที่ `Migrate::CASE_STATUS_ROWS`

**ขั้นตอนไม่เป็นเส้นตรง** — เปิดขั้นไหนก่อนก็ได้ (ขายก่อนวัดสายตาเป็นเรื่องปกติที่นี่)
สิ่งที่แต่ละขั้นต้องมีก่อนกดยืนยันตัดสินจากข้อมูลของขั้นนั้นเอง ฝั่งเซิร์ฟเวอร์
มีแค่ "ส่งมอบ" ที่ถูกล็อกไว้ และล็อกด้วยเงื่อนไขเดียวคือยังไม่มีออเดอร์

ยืนยัน "ส่งมอบ" = ปิดเคส (`cases.status = 'completed'`) ไม่มีขั้น "จบงาน" แยกอีกที

การกระทำทุกอย่างเขียนลง `case_events` เป็น audit log อัตโนมัติ และการยืนยันขั้นตอน
จะ **เลื่อนสถานะเคสให้เอง** ไปยังขั้นที่ยังไม่เสร็จถัดไป โดยไม่ดึงเคสถอยหลัง

> เดิมมี 10 ขั้น (เพิ่ม เลนส์ · ผลิต · QC · จบงาน) — สามขั้นกลางถูกตัดออกจากระบบ
> เมื่อ 29 ส.ค. 2026 พร้อมกับหน้า `/lens` `/production` `/qc` `/lens-tracker`
> ดู `docs/superpowers/specs/2026-08-29-main-process-6-steps-design.md`

---

## หน้าจอ

| หน้า | ทำอะไร |
|---|---|
| **เมนูหลัก** | KPI วันนี้ + งานค้างแต่ละขั้นตอน + **คิวจองวันนี้ (นับถอยหลัง)** + ออเดอร์ว่าง / ออเดอร์ที่ยังไม่ปิด |
| **📅 ปฏิทินจองคิว** | ปฏิทินรายเดือน + คิวรายวัน + จอง/แก้ไข/ยกเลิก + เปิดเคสจากคิว |
| **⚙️ ตั้งค่า/แจ้งเตือน** | ตั้งค่า Telegram · ทดสอบส่ง · รันตัวเตือนเอง · ประวัติการแจ้งเตือน |
| **กระดานงาน** (Case Board) | คิวงานแบบ kanban 6 คอลัมน์ตามขั้นตอน · แยกสมุด SightFirst / ลูกค้าร้าน · กรองงานด่วน/ค้างชำระ · ซ่อนขั้นที่ว่าง |
| **รายละเอียดเคส** | แถบ 6 ขั้น + แผงของขั้นที่เปิดอยู่ (รับลูกค้า · วัดสายตา · ขาย · ชำระเงิน · วัด Center · ส่งมอบ) + ภาพรวม · ติดต่อลูกค้า · ไทม์ไลน์ |
| **ส่งมอบ** | เคสที่พร้อมให้ลูกค้ามารับ · แยก พร้อมส่ง / รอลูกค้า / ยังไม่พร้อม · ยอดค้างชำระไม่ปิดกั้นการส่งมอบ |
| ลูกค้า / ค้นหาลูกค้า | ประวัติเคส + ค่าสายตา + ออเดอร์ ครบในหน้าเดียว |
| วัดสายตา | ค่าสายตาเต็มรูปแบบ — SPH/CYL/AXIS/ADD/PD/VA/PRISM/BASE + ประวัติสุขภาพ + ระยะทำงาน |
| ออเดอร์ตัดแว่น | สร้าง / แก้ไข / เติมของ / ปิดการขาย |
| ขายสินค้าทั่วไป | ตัดสต็อกทันที + บันทึกลง payments |
| สต็อก / ตำแหน่งสินค้า / ซัพพลายเออร์ / พนักงาน | ข้อมูลตั้งต้น |
| รายรับ / รายจ่าย | บันทึก + ประวัติ + สรุปยอด |
| **📊 รายงาน** | 7 หน้าวิเคราะห์ยอดขาย — ภาพรวม · งานตัดแว่น · ขายหน้าร้าน · ช่องทางลูกค้า · การรับเงิน · กำไร · พนักงาน · กรองวันที่/ช่องทาง · กราฟ SVG · ส่งออก Excel/PDF |
| เอกสารพิมพ์ | ใบสั่งตัดแว่น · ใบวัดสายตา |

### แผงของแต่ละขั้นในหน้าเคส

* **รับลูกค้า** — ใครรับเรื่อง, ช่องทางที่รู้จักร้าน, ประเภทงาน, งานด่วนหรือไม่
* **วัดสายตา** — ค่าเดิม / ค่าที่วัดได้ / ค่าที่ใช้จริง (SPH/CYL/AXIS/ADD/PD/VA/PRISM/BASE), กด "ใช้ค่านี้เป็นค่าจริง" เพื่อ confirm เข้า `custom_orders.final_prescription_id`
* **ขาย/เลือกกรอบ** — เปิดออเดอร์, เลือกกรอบและเลนส์จากคลัง, ราคา/ส่วนลด — **เลือกแล้วตัดสต็อกทันที** (เปลี่ยนใจเลือกชิ้นใหม่ ระบบคืนชิ้นเดิมเข้าคลังให้เอง)
* **ชำระเงิน** — รายการรับเงินทั้งหมด (มัดจำ/บางส่วน/ปิดยอด) + บันทึกรับเงินใหม่
* **วัด Center** — จุดศูนย์กลาง (PD/height/vertex/pantoscopic/wrap) และวัดกรอบ/ฟิตติ้ง (lens width/bridge/temple/ED/DBL)
* **ส่งมอบ** — อ่านอย่างเดียว: ส่งให้ใคร ส่งอะไร ยอดเงินเป็นยังไง แล้วกดยืนยัน — ยืนยันแล้วเคสปิด

นอกจากหกขั้นยังมี **ภาพรวม** · **ติดต่อลูกค้า** (log การโทร/LINE) · **ไทม์ไลน์** (`case_events` เรียงเวลา)

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
(สร้างอัตโนมัติตอน start ด้วย `CREATE TABLE IF NOT EXISTS` — ดู `api/services/Migrate.php`):

```
bookings          การจองคิว (วัน/เวลา/บริการ/ช่องทาง/ผู้ดูแล/นาทีที่จะเตือน/บันทึกเบื้องต้น)
booking_notes     บันทึกเบื้องต้นทีละขั้น (step + คำถาม + คำตอบ + ผู้บันทึก)
notification_log  ทุกข้อความ Telegram ที่ส่ง สำเร็จ/ไม่สำเร็จ พร้อมสาเหตุ
app_settings      key/value เก็บ Telegram token, chat id, ค่าปริยายต่าง ๆ
```

ตารางเดิมที่ใช้:

```
cases · case_statuses · case_events · case_photos · case_processes
customers · employees · suppliers
prescriptions · centerings · frame_fittings · case_deliveries
custom_orders · payments · sales · stock_lots · product_locations
incomes · expenses · customer_notifications
list_sex · list_marketing · list_pay_type · list_product_type · list_len_type
views: v_case_board · v_order_history · v_orders_unclosed
       v_orders_unfilled · v_sale_history · v_stock_available · v_stock_lot
```

แอปอ่านจาก `v_case_board` โดยตรง (กระดานงาน)

ตารางของขั้นที่ถูกตัดออกยังอยู่ในฐานข้อมูลแต่ไม่มีโค้ดอ่าน/เขียนแล้ว —
`lens_jobs` · `lens_followups` · `production_jobs` · `production_withdrawals` ·
`qc_checks` · `stock_reservations` · `case_item_fulfillment` (view `v_lens_tracker` ด้วย)

**หมายเหตุ:** คอลัมน์ค่าสายตาใน `prescriptions` เป็น `VARCHAR(20)` ไม่ใช่ตัวเลข
หน้าเว็บจึงรับค่าอย่าง `-1.25`, `+2.00`, `plano` ได้ตามที่ schema ตั้งใจไว้

---

## API

```
GET    /api/meta                        lists + พนักงาน + สถานะเคส + ซัพพลายเออร์
GET    /api/dashboard                   KPI + คิวงาน + สรุปตาม stage

GET    /api/cases?q=&stage_group=&rush=&open=
POST   /api/cases                       · PUT /api/cases/:id
GET    /api/cases/:id                   เคสแบบเต็ม (rx, order, centering, delivery, payments, events…)
GET    /api/cases/:id/processes         สถานะทั้ง 6 ขั้น + สิ่งที่ยังขาด + สิ่งที่ปิดกั้นอยู่
POST   /api/cases/:id/processes/:p/start · /complete · /reopen · /state
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
POST   /api/orders/:id/fill             ผูกเลนส์ซ้าย/ขวา/กรอบจากคลัง + ตัดสต็อก (คืนชิ้นเดิมถ้าเปลี่ยน)
POST   /api/orders/:id/close            ปิดการขาย + สร้าง payment (ของถูกตัดไปแล้วที่ /fill)
POST   /api/orders/:id/reopen           ยกเลิกการปิด + ลบ payment ก้อนสุดท้าย

GET/POST/DELETE /api/payments           ledger การรับเงิน
POST   /api/centerings · /api/frame-fittings      · GET /:case_id
POST   /api/case-deliveries             บันทึกการส่งมอบ · GET /:case_id
GET    /api/delivery?bucket=&client=&q= กระดานส่งมอบ

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

# รายงานวิเคราะห์ยอดขาย — ทุกเส้นรับ ?from=&to=&channel=all|main|pos
GET    /api/reports/overview       KPI + เทียบสองช่องทาง + ยอดรายวัน
GET    /api/reports/main-process   งานตัดแว่น — ตามเลนส์ / ตามพนักงาน / รายเคส
GET    /api/reports/pos            ขายหน้าร้าน — ตามหมวดสินค้า / รายบิล
GET    /api/reports/payments       ช่องทางชำระ — นับด้วย paid_at ไม่ใช่วันที่เปิดบิล
GET    /api/reports/profit         ต้นทุนกรอบ/เลนส์จากล็อต · POS คืน has_cost=false
GET    /api/reports/employees      ผลงานรวมสองฝั่งของคนเดียวกัน
GET    /api/reports/channels      ลูกค้ารู้จักร้านจากไหน (cases.referral_source)
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
