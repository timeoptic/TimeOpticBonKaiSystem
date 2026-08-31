# ยุบ Main Process ของเคสจาก 10 ขั้นเหลือ 6 ขั้น

วันที่ 29 สิงหาคม 2026 · branch `main`

---

## 1. เป้าหมาย

Flow หลักของเคสต้องเป็น

```
รับลูกค้า → วัดสายตา → ขาย/เลือกกรอบ → ชำระเงิน → วัด Center → ส่งมอบ
reception   exam        sales           payment    centering    delivery
```

เทียบกับของเดิม 10 ขั้น เปลี่ยนสองอย่าง

1. **ตัด 4 ขั้นออกจากระบบ** — `lens` (เลนส์) · `production` (ผลิต) · `qc` (ตรวจ QC) · `done` (จบงาน)
2. **สลับลำดับ** — ชำระเงินมาก่อนวัด Center (เดิม centering มาก่อน payment)

"ตัดออกจากระบบ" ในที่นี้แปลว่าลบโค้ดและหน้าจอออกจริง ไม่ใช่แค่ซ่อนจาก UI ส่วนตารางใน
ฐานข้อมูลเก็บไว้แต่ล้างข้อมูลทิ้ง

## 2. ข้อตัดสินใจที่ตกลงแล้ว

| เรื่อง | ตัดสิน |
|---|---|
| เลนส์ / ผลิต / QC | ตัดออกจากระบบทั้งหมด |
| ขั้น "จบงาน" (done) | ไม่มี — ส่งมอบเป็นขั้นสุดท้าย ยืนยันแล้วปิดเคสเลย |
| เคสเก่าที่ค้างอยู่ | ล้างข้อมูลเคสทิ้งทั้งหมด (dump ลง `backups/` ก่อน) |
| ตัดสต็อกตอนไหน | ตอนเลือกสินค้าเข้าออเดอร์ที่ขั้นขาย (`POST /api/orders/:id/fill`) |
| หน้า "ติดตามเลนส์" | ตัดออกด้วย |
| 7 ตารางที่ตายแล้ว | เก็บตารางไว้ ล้างเฉพาะข้อมูล ไม่ `DROP` |
| สต็อกที่เคสทดสอบเบิกไปแล้ว 29 รายการ | ปล่อยไว้อย่างนั้น ไม่คืนเข้าสต็อก |
| Branch | ทำบน `main` |

## 3. สถาปัตยกรรม — จุดที่ต้องแก้

### 3.1 แหล่งความจริงของรายชื่อขั้นตอน

รายชื่อขั้นตอนถูกประกาศไว้สองที่ และต้องตรงกันเสมอ

- `frontend-next/lib/caseProcesses.js` → `CASE_PROCESSES`
  ทุกอย่างฝั่งเว็บอ่านจากตัวนี้ — กระดานงาน, stepper ในหน้าเคส, sidebar, `StatusChip`,
  `lib/constants.js` (`STAGE_META` / `STAGE_GROUPS`)
- `api/routes/processes.php` → `const CASE_PROCESSES`

ทั้งสองที่เหลือ 6 id เรียงตาม Flow ใหม่

```
reception · exam · sales · payment · centering · delivery
```

### 3.2 ขั้น "จบงาน" หายไป

`done` ไม่ใช่ขั้นตอนอีกต่อไป แต่ `cases.status = 'completed'` / `'cancelled'` ยังอยู่
เป็นสถานะปิดเคส

- `POST /api/cases/:id/processes/delivery/complete` ตั้ง `cases.status = 'completed'`
  (ย้ายมาจากเดิมที่ `done` ทำหน้าที่นี้)
- `advanceCaseStatus()` และ `caseStageMap()` ที่กรอง `$p !== 'done'` ทิ้งได้ เพราะ
  `done` ไม่อยู่ใน array แล้ว
- กระดานงาน (`app/cases/page.jsx`) ที่เติมคอลัมน์ "จบงาน" เองต้องอ่านจาก
  `is_terminal` แทน

### 3.3 เงื่อนไขปลดล็อกของแต่ละขั้น

`GATED_PROCESSES` เดิม `['lens','production','qc','delivery','done']` เหลือ `['delivery']`

`processMissing()` / `processBlocking()` ใน `api/routes/processes.php` เหลือ 6 key

| ขั้น | ต้องมีอะไรถึงกด ✓ ได้ (`missing`) | อะไรปิดกั้นไม่ให้ทำ (`blocking`) |
|---|---|---|
| reception | ข้อมูลลูกค้า, พนักงานผู้รับเรื่อง | — |
| exam | ค่าสายตาที่ยืนยันแล้ว | — |
| sales | ออเดอร์, กรอบแว่น, เลนส์, ราคารวม | — |
| payment | การรับเงิน, ยอดคงเหลือเป็น 0 | — |
| centering | ค่า Center, PD, FH | — |
| delivery | บันทึกการส่งมอบ | ยังไม่มีออเดอร์ |

เดิม `delivery` ถูกปิดกั้นด้วย "QC ยังไม่ผ่าน" — เปลี่ยนเป็น "ยังไม่มีออเดอร์"
ยอดค้างชำระยังคง **ไม่** ปิดกั้นการส่งมอบ ตามกฎเดิมที่ `DeliveryPanel.jsx` เขียนไว้

`processDerived()` ตัดสาขาของ lens / production / qc ออก

### 3.4 ฐานข้อมูล — `case_statuses`

ตารางนี้เป็นตัวแปลระหว่าง `cases.status` (สถานะเดี่ยว) กับ `stage_group` (ขั้นตอน)
ยุบจาก 32 แถวเหลือ 18 แถว และเรียง `sort_order` ใหม่ให้ payment มาก่อน centering

| sort_order | code | stage_no | stage_group | label_th | is_waiting | is_terminal |
|---|---|---|---|---|---|---|
| 10 | `reception` | 1 | reception | รับลูกค้า / ลงข้อมูล | 0 | 0 |
| 20 | `old_rx` | 1 | reception | บันทึกค่าสายตาเดิม | 0 | 0 |
| 30 | `waiting_exam` | 2 | exam | รอวัดสายตา | 1 | 0 |
| 40 | `exam` | 2 | exam | กำลังวัดสายตา | 0 | 0 |
| 50 | `rx_decision` | 2 | exam | ตัดสินใจค่าสายตา | 0 | 0 |
| 60 | `waiting_sales` | 3 | sales | รอฝ่ายขาย | 1 | 0 |
| 70 | `sales` | 3 | sales | ขาย / เลือกกรอบ | 0 | 0 |
| 80 | `order_confirm` | 3 | sales | ยืนยันออเดอร์ | 0 | 0 |
| 90 | `payment` | 4 | payment | ชำระเงิน | 0 | 0 |
| 100 | `centering` | 5 | centering | วัดจุดศูนย์กลาง | 0 | 0 |
| 110 | `frame_fitting` | 5 | centering | วัดกรอบ / ฟิตติ้ง | 0 | 0 |
| 120 | `appointment` | 6 | delivery | นัดหมายรับของ | 0 | 0 |
| 130 | `ready_notify` | 6 | delivery | พร้อมแจ้งลูกค้า | 1 | 0 |
| 140 | `notified` | 6 | delivery | แจ้งลูกค้าแล้ว | 0 | 0 |
| 150 | `waiting_pickup` | 6 | delivery | รอลูกค้ามารับ | 1 | 0 |
| 160 | `pickup` | 6 | delivery | ส่งมอบ | 0 | 0 |
| 900 | `completed` | — | done | ปิดเคสแล้ว | 0 | 1 |
| 910 | `cancelled` | — | done | ยกเลิกเคส | 0 | 1 |

ลบ 14 แถว: `lens_source` `waiting_lens_picking` `lens_ready` `lens_ordered`
`waiting_lens_arrival` `lens_received` `matching` `waiting_edging` `edging`
`edging_done` `waiting_qc` `qc` `qc_failed` `packing`

**สองจุดที่ต้องระวัง**

- `appointment` ย้ายจากกลุ่ม `sales` → `delivery` ไม่งั้น `sort_order` จะกระโดดข้ามกลุ่ม
  ไปกลับ ซึ่ง `advanceCaseStatus()` ใช้เทียบเพื่อกันไม่ให้เคสถอยหลัง
- `entryStatusOfGroup('delivery')` เดิมคืน `packing` เมื่อลบแล้วจะคืน `appointment`

### 3.5 บันทึกการส่งมอบ — ตารางใหม่ `case_deliveries`

ปัจจุบันการส่งมอบเขียนลง `production_jobs.pickup_at` ผ่าน
`POST /api/production-jobs/:id/deliver` เมื่อ production หายไปต้องมีบ้านใหม่

```sql
CREATE TABLE IF NOT EXISTS case_deliveries (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  case_id                   INT NOT NULL UNIQUE,
  order_id                  INT NULL,
  delivered_at              DATETIME NULL,
  handed_over_by            INT NULL,
  received_by_customer_name VARCHAR(120) NULL,
  note                      TEXT NULL,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP
)
```

เพิ่มใน `api/services/Migrate.php` ซึ่งเป็น additive migration (`CREATE TABLE IF NOT EXISTS`)
อยู่แล้ว

Endpoint ใหม่ใน `api/routes/workflow.php` ใช้ `upsertFactory()` แบบเดียวกับ `centerings`

- `POST /api/case-deliveries` — บันทึก/แก้บันทึกการส่งมอบ, ตั้ง `cases.status = 'pickup'`
- `GET /api/case-deliveries/:case_id`

`caseDetail()` เพิ่มคีย์ `delivery` แทนคีย์ `production`

**กระดานส่งมอบ `GET /api/delivery`** เดิมตัดสิน "พร้อมส่งไหม" จาก `qc_checks.result = 'pass'`
บวกกับมี `production_jobs` เขียนใหม่ให้ตัดสินจากขั้นตอนแทน — เคสพร้อมส่งเมื่อ
`stage_group = 'delivery'` และยังไม่มีแถวใน `case_deliveries` ส่วน `reason` ของเคสที่ยัง
ไม่พร้อมเหลือกรณีเดียวคือ "ยังไม่มีออเดอร์"

### 3.6 ตัดสต็อกย้ายมาที่ขั้นขาย

ปัจจุบันสต็อกถูกตัดสองที่

- `POST /api/orders/:id/close` (`api/routes/orders.php:346`) — ตอนปิดการขาย
- `POST /api/production-jobs/:id/start` (`api/routes/workflow.php:157`) — ตอนเริ่มผลิต

ของใหม่: ตัดที่ `POST /api/orders/:id/fill` ที่เดียว

- เลือกชิ้นไหนเข้าออเดอร์ → `pickLot()` ชิ้นนั้นทันทีในทรานแซกชันเดียวกับการ UPDATE
- **เปลี่ยนใจเลือกชิ้นใหม่ → ต้อง `releaseLot()` ชิ้นเดิมคืนก่อน** — `/fill` เรียกซ้ำได้
  ถ้าตัดโดยไม่คืนของเก่า สต็อกจะหายทีละชิ้นทุกครั้งที่แก้ออเดอร์
  (`releaseLot()` มีอยู่แล้วที่ `api/core/Helpers.php:180`)
- ล้าง `pickLot()` และ `wasWithdrawnByProduction()` ออกจาก `/close`

เทียบชิ้นเก่ากับชิ้นใหม่ทีละช่อง: `lens_product_id` · `right_lens_product_id` ·
`frame_product_id` ช่องไหนเลขเปลี่ยน คืนของเก่า ตัดของใหม่ ช่องไหนเลขเดิมไม่ต้องทำอะไร

### 3.7 ไฟล์ที่ลบ

**Frontend**

| ลบทั้งไฟล์ | แก้บางส่วน |
|---|---|
| `app/lens/` | `lib/caseProcesses.js` — เหลือ 6 process |
| `app/production/` | `lib/constants.js` — `ACTION_LABEL` ตัด ~12 ตัวของ lens/production/qc |
| `app/qc/` | `lib/crumb.js` — ลบ 4 บรรทัด |
| `app/lens-tracker/` | `components/Shell.jsx` — NAV |
| `app/cases/detail/panels/LensPanel.jsx` | `app/cases/detail/page.jsx` — `PROCESS_PANELS` |
| `app/cases/detail/panels/LensJobPanel.jsx` | `app/cases/page.jsx` — คอลัมน์กระดาน |
| `app/cases/detail/panels/ProductionPanel.jsx` | `app/delivery/page.jsx` — เลิกอ่าน QC/job |
| `app/cases/detail/panels/QcPanel.jsx` | `app/cases/detail/panels/DeliveryPanel.jsx` |
| `app/cases/detail/panels/ClosePanel.jsx` | `app/page.jsx` — การ์ดหน้าแรก |

`components/StockPicker.jsx` **เก็บไว้** — `app/orders/OrderFormView.jsx` ยังใช้

**API**

| ลบทั้งไฟล์ | แก้บางส่วน |
|---|---|
| `api/routes/lens.php` (566 บรรทัด) | `api/routes/processes.php` — 6 process |
| `api/routes/lens_jobs.php` (223 บรรทัด) | `api/routes/workflow.php` — เหลือ centerings, frame-fittings, case-deliveries, `/api/delivery` |
| `api/routes/production.php` (337 บรรทัด) | `api/routes/cases.php` — `caseDetail()` เลิก join 5 ตาราง |
| | `api/routes/orders.php` — ย้ายจุดตัดสต็อก |
| | `api/routes/dashboard.php` — ตัวเลขตามขั้น |
| | `api/index.php` — เลิก require ไฟล์ที่ลบ |

**View `v_case_board`** — เลิก join `lens_jobs`, ตัดคอลัมน์ `lens_source` `lens_status`
`expected_arrival` `follow_up_count` (แก้ใน `api/services/Migrate.php` ส่วน `views()`)

**เมนู (`components/Shell.jsx`)**

- กลุ่ม `ขั้นตอนงาน 10 ขั้น` → `ขั้นตอนงาน 6 ขั้น` เหลือ วัดสายตา · ขาย-เลือกกรอบ ·
  ชำระเงิน · วัด Center · ส่งมอบ (รับลูกค้าไม่มีหน้าแยก — ใช้ "เปิดเคสใหม่")
- กลุ่ม `งานในร้าน` ตัด "ติดตามเลนส์"

### 3.8 ล้างข้อมูลเคส

`mysqldump` ลง `backups/timeoptic-before-6-step-flow-20260829.sql` ก่อน แล้ว

```
TRUNCATE: cases · case_processes · case_events · case_photos · prescriptions
          custom_orders · payments · centerings · frame_fittings
          customer_notifications
          production_jobs · production_withdrawals · qc_checks
          lens_jobs · lens_followups · stock_reservations · case_item_fulfillment
```

**ไม่แตะ**: `customers` · `employees` · `stock_lots` · `products` · `suppliers` ·
`bookings` · `sales` · `incomes` · `expenses` · `inventory_logs`

`stock_lots` ที่ถูกเบิกไปแล้วจากเคสทดสอบปล่อยไว้ตามเดิม ไม่คืนยอด

## 4. การทดสอบ

1. `cd frontend-next && npm test` — unit test เดิม 4 ไฟล์ต้องผ่าน (`crumbFor.test.js`
   ต้องอัปเดตเพราะลบ 4 path)
2. เพิ่ม unit test ให้ `caseProcesses.js` — ยืนยันว่ามี 6 ขั้นเรียงตาม Flow
3. `curl` สโม้กทุก endpoint ที่แก้: `/api/meta` `/api/cases` `/api/cases/:id/processes`
   `/api/orders/:id/fill` `/api/case-deliveries` `/api/delivery`
4. เดินเคสจริง 1 ใบผ่านครบ 6 ขั้นด้วย Chrome headless — เปิดเคส → วัดสายตา → เลือกกรอบ
   (เช็คว่าสต็อกลด 1) → รับเงิน → วัด Center → ส่งมอบ → เคสปิด
5. เช็คสต็อก: แก้ออเดอร์เปลี่ยนกรอบ ต้องคืนชิ้นเดิมและตัดชิ้นใหม่ ยอดรวมไม่รั่ว
6. เช็คจอ 1440 · 1024 · 390 ตามที่ตกลงไว้

## 5. ลำดับการทำ

1. commit งานค้างบน `main` ก่อน (มี 1,595 บรรทัดค้างอยู่ รวมงาน rework หน้า
   `/delivery` และ `/production` — ต้องเช็คกับ session อื่นที่รันอยู่ก่อน)
2. backup ฐานข้อมูล
3. DB: `case_statuses` ชุดใหม่ + `case_deliveries` + `v_case_board`
4. API: `processes.php` → `workflow.php` → `cases.php` → `orders.php` → ลบ 3 ไฟล์ →
   `dashboard.php` → `index.php`
5. Frontend: `caseProcesses.js` → `constants.js` `crumb.js` `Shell.jsx` → ลบหน้า/แผง →
   `cases/detail/page.jsx` `cases/page.jsx` `delivery/page.jsx` `page.jsx`
6. ล้างข้อมูลเคส
7. ทดสอบตามข้อ 4

## 6. ความเสี่ยงที่รู้ตัว

- **มี session อื่นทำงานบน repo เดียวกันอยู่** (`Searchable dropdown สำหรับชนิดสินค้า`,
  `Recent changes review`) — งานค้าง 1,595 บรรทัดบน `main` อาจเป็นของ session อื่น
  ต้องเคลียร์ก่อน commit
- ตัด production ออกแล้ว **ไม่มีที่ไหนบันทึกว่าใครฝนเลนส์ / ฝนเมื่อไหร่** อีกต่อไป
  ถ้าภายหลังต้องการข้อมูลนี้ต้องออกแบบใหม่
- ตัดสต็อกที่ขั้นขายแปลว่า **ของถูกตัดออกจากคลังก่อนลูกค้าจ่ายเงิน** ถ้าลูกค้ายกเลิก
  ต้องคืนของด้วยมือ (ยกเลิกออเดอร์ยังไม่มี flow คืนของ)
- `case_deliveries` เป็นตารางใหม่นอก schema เดิม 27 ตารางที่ออกแบบไว้
