# แยกขั้น "เลนส์" ออกจากห้องผลิต + ระบบจองสต็อก

วันที่ 2026-08-27 · สถานะ: เฟส 1–4 เสร็จแล้ว

## ปัญหาเดิม

ขั้น "ผลิต/เลนส์" รวมสองงานที่คนละคนทำไว้ด้วยกัน — ฝ่ายขายเช็คของ/สั่งของ กับ
ช่างหน้าเครื่องฝนเลนส์ — และไม่มีความคิดเรื่อง "ของชิ้นนี้เป็นของเคสไหน" เลย
`stock_lots.remaining_qty` บอกแค่ว่ายังไม่มีใคร**ตัด** ไม่ได้บอกว่ายังไม่มีใคร**สัญญา**
สองเคสจึงเห็น "เหลือ 1 ชิ้น" พร้อมกัน นัดลูกค้าทั้งคู่ แล้วมีคนหนึ่งต้องเสียคำพูด

## หลักการ

```
available = stock_lots.remaining_qty − Σ qty ของการจองที่ยัง active
```

จอง ≠ ตัด · ขั้นเลนส์**จอง** (ของยังอยู่บนชั้น ไม่มีแถวใน `inventory_logs`)
ขั้นผลิต**ตัด** ตอน "เริ่มผลิต" แล้วการจองกลายเป็น `consumed`
ห้ามมีทางที่จองแล้วลืม — เริ่มผลิตแปลงการจองทุกชิ้นเป็นการเบิกในทรานแซกชันเดียว

## การตัดสินใจที่ค้างไว้ 4 ข้อ — สรุปที่ใช้จริง

| | ประเด็น | ที่ทำ |
|---|---|---|
| 1 | `custom_orders.*_product_id` เก็บ `stock_lots.id` ไม่ใช่ SKU | ยังไม่ย้าย — เก็บ `product_id` ไว้ในทั้ง `stock_reservations` และตอนอ่าน แล้วค่อยย้ายพร้อมงานเชื่อมคลัง (ฝั่งคลังจัดเป็นข้อ 4 ของลำดับงาน ไม่บล็อกอะไร) |
| 2 | กระดานเคสกลายเป็น 10 คอลัมน์ | ไม่ต้องแก้ — `.board` เลื่อนแนวนอนในตัวเองอยู่แล้ว ทดสอบ 1280px/810px ไม่มี overflow ที่ตัวหน้า |
| 3 | งานข้างเดียว | ให้ Sale ติ๊ก "งานนี้ไม่ใช้ชิ้นนี้" เก็บที่ `case_item_fulfillment.is_required` ไม่เดาจากค่าสายตา |
| 4 | ตารางใหม่ vs ใช้ `lens_jobs` | ตารางใหม่ `case_item_fulfillment` ถือสถานะรายชิ้น · `lens_jobs` ไม่ถูกแตะ ยังเป็นของแท็บ "ติดตามเลนส์" และถูกยุบมาแสดงเป็นการ์ดพับในขั้นเลนส์ |

## สิ่งที่เปลี่ยน

### ฐานข้อมูล (`api/services/Migrate.php` — additive ทั้งหมด)

- ตารางใหม่ `stock_reservations` (case, item_type, product_id, stock_lot_id, qty,
  status = active / released / consumed, ใครจอง/ปล่อย/เมื่อไหร่)
- ตารางใหม่ `case_item_fulfillment` (หนึ่งแถวต่อ case+ชิ้น: `is_required`,
  status, ซัพพลายเออร์, เลขใบสั่ง, ETA, วันรับของ)
- `production_withdrawals.idem_key` — กุญแจกันตัดซ้ำ `case-<id>-<item>-<n>`
  คงที่ต่อรายการ ไม่ใช่ uuid (ตามที่ฝั่งคลังกำหนด)
- `case_statuses`: 6 สถานะเรื่องเลนส์ (`lens_source`, `waiting_lens_picking`,
  `lens_ready`, `lens_ordered`, `waiting_lens_arrival`, `lens_received`)
  ย้ายจาก `stage_group='production'` มาเป็น `'lens'`
- `frame_fitting` ย้ายไป `stage_group='centering'` — เป็นการวัด ไม่ใช่งานหน้าเครื่อง
  และถ้าค้างอยู่กลุ่มผลิต สถานะแรกของกลุ่มผลิต (120) จะมาก่อนกลุ่มเลนส์ (130)
  ทำให้ "ส่งเข้าห้องผลิต" ถูกมองว่าถอยหลัง

ลำดับกลุ่มหลังย้าย: reception 10 · exam 30 · sales 60 · centering 80 ·
payment 100 · **lens 130** · production 190 · qc 230 · delivery 260 · done 310

### Backend

- **`api/routes/lens.php` (ใหม่)** — `lensFulfillment()` / `lensReservations()` /
  `lotReservedQty()` / `lensItems()` / `lensMissing()` / `lensProgress()` และ
  endpoint: `GET /api/cases/:id/lens`, `POST .../lens/items/:item_type`,
  `.../lens/reserve`, `.../lens/release`, `.../lens/order`, `.../lens/receive`,
  `.../lens/send-to-production`, และกระดาน `GET /api/lens`
- **`production.php`** — `productionItems()` รู้จักการจองแล้ว: คืน `is_required`,
  `reserved_qty`, `available_qty`, `product_id` และสถานะใหม่ `reserved` /
  `not_required` · `productionReadiness()` เปลี่ยนเกณฑ์จาก "มีของบนชั้น" เป็น
  "ของถูกจองให้เคสนี้แล้ว" · กระดานผลิตแสดงเฉพาะเคสที่ขั้นเลนส์ส่งเข้ามาแล้ว
  (หรืองานที่เริ่มไปก่อนมีขั้นนี้)
- **`processes.php`** — เพิ่ม `lens` เข้า `CASE_PROCESSES`/`GATED_PROCESSES`
  ระหว่าง payment กับ production · เกตของ production เปลี่ยนจาก "มีสินค้าในออเดอร์"
  เป็น `lensMissing()` · `caseStageMap()` มี aggregate ของการจอง/การสั่งเพิ่ม
- **`workflow.php`** — "เริ่มผลิต" ปิดการจอง (`status='consumed'`) ในทรานแซกชัน
  เดียวกับที่ตัดสต็อก และเขียน `idem_key` ทั้งการเบิกครั้งแรกและการเบิกเพิ่ม

การกันแย่งของชิ้นสุดท้าย: `lensReserveItem()` `SELECT ... FOR UPDATE` ที่แถวล็อต
แล้วนับการจองที่ยัง active **ทั้งหมด** (รวมของเคสตัวเองอีกข้างหนึ่ง เพราะสองข้าง
อาจมาจากล็อตเดียวกัน) ก่อนแทรกแถว — คนที่สองได้ข้อความจริง ไม่ใช่ไปเจอตอนเริ่มผลิต

### Frontend

- `lib/caseProcesses.js` — เพิ่ม `lens` (ป้าย "เลนส์", ปุ่มยืนยัน "ส่งเข้าห้องผลิต")
  และเปลี่ยน `production` จาก "ผลิต/เลนส์" เป็น "ผลิต" · กระดาน/stepper/sidebar
  อ่านจากไฟล์นี้ไฟล์เดียวเหมือนเดิม
- `panels/LensPanel.jsx` (ใหม่) — การ์ดรายชิ้นพร้อมเลข 3 ตัว (คงเหลือ / จองไว้แล้ว /
  พร้อมให้เคสนี้), จองของ, ยกเลิกจอง, สั่งสินค้า (modal), ของมาถึงแล้ว,
  งานนี้ไม่ใช้ชิ้นนี้, และ "ส่งเข้าห้องผลิต" ผูกกับ `beforeComplete` ของ ProcessShell
- `panels/LensJobPanel.jsx` — ของเดิม (lens_jobs + follow-up) เปลี่ยนชื่อ
  ไม่แก้ตรรกะ ย้ายมาเป็นการ์ดพับในขั้นเลนส์ แทนที่จะเป็นแท็บแยก
- `app/lens/page.jsx` (ใหม่) — กระดานเลนส์ + เมนู `/lens` + crumb

## ทดสอบแล้ว

| สถานการณ์ | ผล |
|---|---|
| จองสองข้างจากล็อตเดียวกัน (เหลือ 4) | จองได้ 2 หน่วย · `available` ของเคสอื่นเหลือ 2 |
| ชิ้นสุดท้ายถูกจองไปแล้ว | HTTP 400 พร้อมข้อความ ไม่เกิดการจองซ้อน |
| จองครบ → ส่งเข้าห้องผลิต | เคสไป `matching` · `lens` = completed · สร้าง production job ให้ |
| เริ่มผลิต | สต็อกลดจริง (152: 6→5, 376: 4→2) · การจองเป็น `consumed` · idem_key `case-43-frame-1` ฯลฯ |
| สั่งสินค้า | ชิ้นเป็น `ordered` + ETA · process = waiting · เคสไป `lens_ordered` |
| งานข้างเดียว | ชิ้นเป็น `not_required` · หลุดจาก blocking |
| UI 1280px / 810px | ไม่มี console error · ไม่มี horizontal overflow (กระดานเคส 10 คอลัมน์เลื่อนในตัวเอง) |

## ที่ยังไม่ทำ

- ย้ายออเดอร์ให้เก็บ SKU แทน lot id (รอทำพร้อมงานเชื่อมคลัง)
- `pickLot()` / `releaseLot()` ยังเขียน `stock_lots` + `inventory_logs` ตรง —
  จะเปลี่ยนไปเรียก API ของคลังในคอมมิตเดียวกับที่ปิดการเขียนตรง (ไม่งั้นตัดสองรอบ)
- Auth ร่วม (`admins` + `session_name('optic_session')` + `session_save_path`)
  ตามที่ฝั่งคลังขอให้ทำก่อนข้ออื่น
- 51 แถวเก่าใน `inventory_logs` — ย้อน unit_cost ได้ 16/51, reference_doc 14/51,
  created_by 0/51 · ฝั่งคลังเขียน migration ให้ได้ รอตกลง
