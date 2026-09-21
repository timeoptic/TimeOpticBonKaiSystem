# Bewell: เลนส์จำลอง + ใบเบิกเลนส์

วันที่ 2026-09-21 · กิ่ง `bewell` · อนุมัติแนวทางในแชตแล้ว

## โจทย์

Bewell มีสต็อกเฉพาะกรอบแว่น ส่วนเลนส์ไม่มีสต็อกและไม่มีฐานข้อมูล เพราะเบิกหรือสั่งตามแต่ละเคส
ต้องการ:

- หน้าเลือกเลนส์หน้าตาเหมือนของ TimeOptic แต่ข้อมูลเป็นแบบจำลอง (ไม่อยู่ใน DB)
- ใบเบิกเลนส์ที่ผูกกับเคส ลูกค้า ค่าสายตาสุดท้าย รายละเอียดเลนส์ จำนวน ราคา วันที่ และผู้สร้าง
- สถานะใบเบิก: รอเบิก → เบิกแล้ว → ส่งผลิต/สั่งเลนส์ → ได้รับเลนส์ → ประกอบแล้ว · ยกเลิก

## ข้อบังคับ (จากผู้ใช้)

1. ฐานกรอบของ Bewell พักไว้ก่อน ส่วนกรอบใช้ของเดิมทั้งหมด
2. บันทึกใบเบิกตามปกติ ไม่ผูกกับการชำระเงิน
3. เก็บวิธีเลือกเลนส์แบบเดิมไว้ (เลือกจากคลัง / สั่งตัด RX)
4. **ไม่แก้ logic เดิม** เพิ่มได้อย่างเดียว

## การออกแบบ

### 1. แหล่งข้อมูลเลนส์ (frontend)

- `NEXT_PUBLIC_LENS_SOURCE` ใน `frontend-next/.env.local` มีค่า `mock` หรือไม่ตั้ง
  ไม่ตั้ง = พฤติกรรม TimeOptic เดิมทุกอย่าง
- `lib/lens/mockLenses.js` เป็นรายการเลนส์จำลอง ไม่มีจำนวนคงเหลือ แต่ละแถวมี
  `mock_code, brand, lens_type, design, lens_index, coating, option, photochromic, color, price_pair`
- `lib/lens/lensSource.js` เป็นฟังก์ชันบริสุทธิ์ ใช้ค้นและกรองรายการจำลองตามคำค้นและ coating
  แล้วแปลงแถวให้เป็นรูปเดียวกับแถวสต็อกที่ `LensPicker` และ `OrderFormView` อ่านได้
  (`product_name, brand, lens_design, lens_index, coating, tint, sku, product_price`)
  - `product_price` = ราคาคู่ ÷ 2 เพราะหน้าขายแยกขวาและซ้าย แถบราคาคู่จึงรวมกลับเป็นราคาคู่พอดี
  - ตัวกรอง SPH/CYL ไม่ใช้กับเลนส์จำลอง เพราะเป็นเลนส์สั่งตามค่าสายตา ทำได้ทุกค่า
- `components/MockLensPicker.jsx` ใช้ `LensPicker` ตัวเดิม ส่ง `fetcher` ที่อ่านจากรายการจำลอง
  - ตอนเลือก จะส่งแถวที่มี **`id: null`** กับ `mock_code` ออกไป ใบสั่งจึงไม่มีล็อตผูก
    และ `CaseStock` ไม่ตัดสต็อกเลนส์ ซึ่งเป็นทางเดียวกับที่ระบบเดิมใช้กับชื่อเลนส์ที่พิมพ์เอง
  - การ์ดที่เลือกแล้วแสดงป้าย "เลนส์จำลอง · สั่งตามเคส" แทนจำนวนคงเหลือ

### 2. จุดที่แตะ `OrderFormView.jsx` (เพิ่มอย่างเดียว)

- เมื่อ `LENS_SOURCE === 'mock'` แสดง `MockLensPicker` แทน `StockPicker type="Lens"`
  โดยใช้ props เดิม (`picked`, `onPick`, `onClear`)
- หลังบันทึกใบสั่งสำเร็จ ถ้าในรอบนี้มีการเลือกเลนส์จำลองอย่างน้อยหนึ่งข้าง
  ให้เรียก `POST /api/lens-requisitions/sync`
  - ถ้าเรียกพลาด ใบสั่งยังบันทึกอยู่ และขึ้นแจ้งเตือนให้ไปกดสร้างใหม่ในแท็บใบเบิก
  - ถ้าไม่ได้เลือกเลนส์จำลองในรอบนี้ (เช่น เปิดใบเก่ามาแก้เรื่องอื่น) จะไม่เรียก
    ใบเบิกเดิมจึงไม่ถูกล้าง
- โค้ดส่วน body ของใบสั่ง ราคา และการเรียก PUT/POST เดิม ไม่แก้

### 3. ตาราง (เพิ่มใน `api/services/Migrate.php::tables()`)

`lens_requisitions`
- `id`, `req_no` UNIQUE (LR-YYYY-NNNNN)
- `case_id` FK cases CASCADE, `customer_id` FK customers, `order_id` FK custom_orders SET NULL
- `prescription_id` FK prescriptions SET NULL, `rx_snapshot` JSON (NULL = ยังไม่มีค่าสายตาสุดท้าย)
- `status` ENUM(`pending, issued, ordered, received, assembled, cancelled`) DEFAULT `pending`
- `total`, `note`, `cancel_reason`
- `created_by` (employees.id), `created_at`, `updated_at`
- เวลาแต่ละขั้น: `issued_at, ordered_at, received_at, assembled_at, cancelled_at`

`lens_requisition_items`
- `id`, `requisition_id` FK CASCADE
- `eye` ENUM(`R, L, pair`), `source` VARCHAR (`MOCK` / `DATABASE`), `mock_code`
- ค่าที่คัดลอกเก็บไว้: `brand, lens_type, design, lens_index, coating, option_name, photochromic, color`
- `quantity`, `unit_price`, `line_total`

### 4. API (`api/routes/lens.php` ใหม่ + ลงทะเบียน 1 บรรทัดใน `api/index.php`)

- `GET /api/lens-requisitions?status=&q=` รายการสำหรับหน้ารวม (join ลูกค้า + case_code)
- `GET /api/lens-requisitions/:id` หัวใบ + รายการ + rx_snapshot
- `GET /api/cases/:id/lens-requisitions` ใบของเคส
- `POST /api/lens-requisitions/sync` รับ `{order_id, items[]}` แล้วดึง case_id และ customer_id จากใบสั่ง
  - ค่าสายตาสุดท้าย: ใช้ `custom_orders.final_prescription_id` ก่อน
    ถ้าไม่มี ใช้ใบ `prescriptions` ที่ `case_id` ตรงกันและ `kind='final'` ใบล่าสุด แล้วคัดลอกเป็น snapshot
  - ถ้ามีใบ `pending` ของใบสั่งนี้อยู่ ให้แทนที่รายการ ถ้าไม่มีใบที่ยังใช้งาน ให้สร้างใหม่
  - ถ้าใบที่ยังใช้งานเลย `pending` ไปแล้ว ตอบ 409 "ใบเบิกนี้เบิกไปแล้ว แก้ไม่ได้"
- `POST /api/lens-requisitions/:id/status` รับ `{status, reason?}`
  - เดินหน้าได้และข้ามขั้นได้ ย้อนกลับไม่ได้
  - `cancelled` ได้จากทุกสถานะยกเว้น `assembled` และต้องมีเหตุผล
  - ไป `issued` ขึ้นไปไม่ได้ถ้า `rx_snapshot` ว่าง ถ้าเพิ่งยืนยันค่าสายตาทีหลัง ให้ดึงค่าสายตาใหม่ก่อนตรวจ
  - ทุกการเปลี่ยนสถานะเขียน `logEvent` ลงไทม์ไลน์เคส
- `api/services/LensRequisition.php` เก็บกติกา (ลำดับสถานะ, การหาค่าสายตา, การคำนวณยอด)
  เป็นฟังก์ชันที่เทสต์ได้โดยไม่ต้องผ่าน HTTP

### 5. หน้าเว็บใหม่

- แท็บ "ใบเบิกเลนส์" ในหน้าเคส (`EXTRA_PANELS.lens`) แสดงใบของเคส
  รายการเลนส์ ค่าสายตาที่คัดลอกไว้ และปุ่มเปลี่ยนสถานะ / ยกเลิก / พิมพ์
- หน้า `/lens-requisitions` รวมทุกใบ กรองตามสถานะ ค้นด้วยเลขใบ รหัสเคส หรือชื่อลูกค้า
- หน้า `/print/lens-requisition?id=` ใบเบิกสำหรับพิมพ์
- เมนูด้านซ้ายเพิ่ม "ใบเบิกเลนส์"

## นอกขอบเขต

- ตัวนำเข้ากรอบของ Bewell (ข้อ 1)
- ตาราง `lens_master` / แหล่ง `DATABASE` จริง ตอนนี้แค่เตรียมช่อง `source` ไว้ในรายการใบเบิก
- การผูกสถานะ "ประกอบแล้ว" เข้ากับขั้นตอนเซ็นเตอร์หรือส่งมอบเดิม

## การทดสอบ

- `frontend-next/lib/__tests__/lensSource.test.js` ทดสอบการกรองและการแปลงรูปแถว (`id` ต้องเป็น null และราคาต้องเป็นครึ่งคู่)
- `api/tests/98-lens-requisition.test.php` ทดสอบ sync (สร้าง / แทนที่ / 409), การดึงค่าสายตาสุดท้าย,
  ลำดับสถานะ (เดินหน้า / ข้ามขั้น / ห้ามย้อน / ยกเลิก), และห้ามเบิกเมื่อไม่มีค่าสายตา
- เทสต์เดิมทั้งสองฝั่งต้องผ่านเท่าเดิม
- ลองทำ flow จริงในเบราว์เซอร์บน :3020
