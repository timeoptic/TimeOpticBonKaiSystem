# POS ขายหน้าร้าน / POS ด่วน — Design

วันที่ 1 กันยายน 2026 · โมดูลใหม่ แยกจาก Main Process 6 ขั้น

---

## 1. วิเคราะห์ของเดิม

### หน้าจอ POS เดิม **ไม่มีอยู่ในโปรเจกต์นี้**

เมนู "ขายสินค้า" (`frontend-next/components/Shell.jsx:50`) ชี้ไป `/sales` แต่ไม่มีโฟลเดอร์
`app/(frontdesk)/sales/` และ git history ก็ไม่เคยมี — กดแล้วได้ 404
ภาพหน้าจอ "ระบบ POS ด่วน" ที่ใช้อ้างอิงมาจากระบบเดิมนอก repo นี้

### ของเดิมที่มีจริง

| ส่วน | สภาพ |
|---|---|
| `api/routes/sales.php` (109 บรรทัด) | `GET /api/sales` · `POST /api/sales` · `DELETE /api/sales/:id` |
| ตาราง `sales` | **1 ใบ = 1 ชิ้น** — `product_stock_id` `price` `discount` `pay_type` เดี่ยว ๆ ไม่มี items |
| ตาราง `payments` | มี `sale_id` `kind(deposit/partial/full/final)` `method` `paid_at` `received_by` `cancelled_at` |
| การตัดสต็อก | `POST /api/sales` บังคับเลือก **lot** จาก `v_stock_lot` แล้ว `pickLot()` มาร์กว่าขายแล้ว |
| Product master | `products` 36 แถว · `categories` 5 หมวด (เลนส์ 20 · กรอบ 6 · แว่นกันแดด 3 · คอนแทคเลนส์ 3 · อุปกรณ์เสริม 4) |

ข้อจำกัดที่ทำให้ต้องรื้อ: หนึ่งใบขายผูกกับ `stock_lots` หนึ่งแถวเสมอ จึงขายหลายรายการต่อใบไม่ได้
และขาย "บริการ" ที่ไม่มีของในคลัง (ค่าประกอบแว่น ซ่อมแว่น) ไม่ได้เลย

---

## 2. ขอบเขต

**สร้างใหม่:** ตาราง POS 3 ตาราง · route group `pos` · หน้าจอ 3 หน้า (`/pos`, `/pos/history`, `/pos/detail`)

**แตะของเดิมเท่าที่จำเป็น (3 จุด):**
1. `api/index.php` — เพิ่ม `'pos'` ในลิสต์ route group
2. `frontend-next/components/Shell.jsx:50` — เปลี่ยน href ของ "ขายสินค้า" จาก `/sales` (404) เป็น `/pos`
3. `stock/api/migrations/016_pos_walkin.sql` — ไฟล์ migration ใหม่ (เพิ่มไฟล์ ไม่แก้ของเดิม)

**ไม่แตะ:** Main Process 6 ขั้น · `cases` `custom_orders` `prescriptions` `centerings` · โมดูลคลัง
`stock/` ทั้งหมด · ตาราง `sales` และ `api/routes/sales.php` เดิม (คงไว้ ไม่ลบ ไม่ย้ายข้อมูล)

---

## 3. ข้อตัดสินใจและข้อสมมติ

สเปกกับสภาพจริงของฐานข้อมูลขัดกันอยู่ 4 จุด ตัดสินไว้ดังนี้ — **ถ้าข้อไหนไม่ตรงใจ บอกก่อนเริ่ม Phase นั้น**

### 3.1 Product Master — seed รายการที่สั่งมาเข้าตารางกลาง

Product List ที่สั่งมา (8 หมวด ~40 รายการ) **ไม่มีในฐานเลยสักรายการ** — ของในฐานเป็นเลนส์ตัดแว่น
กับกรอบ ส่วนที่สั่งมาเป็นบริการ/อะไหล่/น้ำยา/คอนแทคเลนส์แบรนด์ B&L·Maxim·Acuvue·Alcon

ข้อ 23 ห้าม "สร้าง Product List ใหม่เอง" — ตีความว่าห้าม**คิดรายการขึ้นเอง** ไม่ใช่ห้ามลงรายการ
ที่เจ้าของสั่งมา จึงเขียน migration seed 8 หมวด + ~40 รายการลง `categories`/`products` ซึ่งเป็น
master กลาง แล้ว POS อ่านจากที่นั่น (ไม่ hardcode ใน frontend ตามข้อ 4)

- SKU ตั้งตามรูปแบบเดิมของระบบ: `SRV-0001` `CLN-0001` `CTL-BL-0001` `CTL-MX-0001` `CTL-AV-0001` `CTL-AL-0001` `EYW-0001`
- `base_selling_price = 0` เพราะยังไม่มีราคามาให้ — พนักงานพิมพ์ราคาเองได้อยู่แล้วตามข้อ 6
  (Product Master Price เป็นแค่ค่าตั้งต้น) **ถ้ามีราคาจริงส่งมา จะใส่ให้ในไฟล์ migration เดียวกัน**
- ผลข้างเคียงที่ต้องรู้: `categories`/`products` ใช้ร่วมกับโมดูลคลัง สินค้าใหม่จะไปโผล่ในหน้า
  `/stock` ด้วย — เป็นข้อมูล ไม่ใช่โค้ด จึงไม่ถือว่าแก้โมดูลอื่น แต่แจ้งไว้ให้ทราบ

### 3.2 ไม่ตัดสต็อกใน Phase แรก

สเปกข้อ 18 ไม่มีสนามใดผูกกับสต็อก และครึ่งหนึ่งของ Product List ที่สั่งมาเป็นบริการที่ไม่มีของในคลัง
(ค่าประกอบแว่น ซ่อมแว่น) ส่วนการต่อเข้า `stock_lots` ต้องแก้ตรรกะของโมดูลคลังซึ่งข้อ 23 ห้ามไว้

จึงเก็บ `product_id` ไว้ในทุก item เพื่อให้ต่อยอดได้ แต่ Phase 1 **ไม่หัก `remaining_qty`**
ผลคือยอดคงคลังจะไม่ลดตามการขายหน้าร้าน — **ถ้าต้องการให้ตัด บอกได้ จะทำเป็น Phase เพิ่ม**

### 3.3 ใช้ `pos_payments` แยก ไม่ใช้ `payments` เดิม

ตาราง `payments` รองรับ deposit/partial/full อยู่แล้วและมี `sale_id` ว่างรออยู่ แต่ทำตามสเปกข้อ 18
เพราะ (ก) สเปกระบุชัด (ข) `payments` เป็นรางเงินของ Main Process การเขียนลงไปจะทำให้ POS ไปโผล่ใน
รายงานเงินของเคส/ออเดอร์ ซึ่งขัดข้อ 23 ที่ห้ามรวม POS เข้า Main Process
(ค) `pos_payments` ต้องมี `amount_received`/`change_amount` ที่ `payments` ไม่มี

### 3.4 `sales` เดิมคงไว้เฉย ๆ

ไม่ย้ายข้อมูล ไม่ลบ ไม่แก้ `api/routes/sales.php` — ของเดิมยังเรียกได้ตามปกติ แค่ไม่มีหน้าจอไหนเรียก
(ซึ่งก็ไม่มีอยู่แล้วตั้งแต่ต้น) ปลอดภัยที่สุดและไม่กระทบใคร

---

## 4. Database Schema

ไฟล์เดียว: `stock/api/migrations/016_pos_walkin.sql` (รันด้วย `php stock/api/bin/migrate.php`
ตามกลไกเดิมที่บันทึกลง `schema_migrations`)

### 4.1 `pos_sales`

```
id                        int unsigned PK AI
pos_no                    varchar(30)  UNIQUE       POS-2026-0001
sale_date                 datetime     INDEX        default วันนี้ · แก้ย้อนหลังได้ตามสิทธิ์
customer_id               int unsigned NULL FK customers(id)
customer_name_snapshot    varchar(255) NULL
customer_phone_snapshot   varchar(50)  NULL
subtotal                  decimal(12,2) NOT NULL default 0
discount_amount           decimal(12,2) NOT NULL default 0   เตรียมไว้ Phase หลัง
total_amount              decimal(12,2) NOT NULL default 0
paid_amount               decimal(12,2) NOT NULL default 0
balance_amount            decimal(12,2) NOT NULL default 0
payment_status            enum('unpaid','partial','paid') NOT NULL default 'unpaid'
fulfillment_status        enum('waiting','delivered')     NOT NULL default 'waiting'
delivered_at              datetime NULL
status                    enum('active','void') NOT NULL default 'active'
void_reason               varchar(255) NULL
void_by                   int unsigned NULL FK admins(id)
void_at                   datetime NULL
note                      text NULL
created_by                int unsigned NULL FK admins(id)
created_at / updated_at   datetime
```

`payment_status` กับ `fulfillment_status` เป็นคนละคอลัมน์ ไม่มีตรรกะไหนผูกกัน (ข้อ 12)
ยกเลิกใช้ `status='void'` ไม่ hard delete (ข้อ 21)

### 4.2 `pos_sale_items`

```
id                    int unsigned PK AI
sale_id               int unsigned NOT NULL FK pos_sales(id) ON DELETE CASCADE
product_id            int unsigned NULL FK products(id)      NULL = สินค้า Custom
product_name_snapshot varchar(255) NOT NULL
sku_snapshot          varchar(100) NULL
quantity              int unsigned NOT NULL default 1
unit_price            decimal(12,2) NOT NULL default 0        ราคาที่ขายจริง ไม่ใช่ราคา master
line_total            decimal(12,2) NOT NULL default 0
item_meta             longtext NULL                           JSON: power / color / frame_code
sort_order            int NOT NULL default 0
created_at            datetime
```

snapshot ชื่อ/SKU/ราคาไว้ทุกแถว — แก้ราคาใน master ทีหลังแล้วใบเก่าต้องไม่เปลี่ยน (ข้อ 6)

### 4.3 `pos_payments`

```
id              int unsigned PK AI
sale_id         int unsigned NOT NULL FK pos_sales(id)
payment_method  varchar(30) NOT NULL          cash · transfer · credit · thungngern
amount          decimal(12,2) NOT NULL        เงินที่เข้าใบขายจริง
amount_received decimal(12,2) NULL            เงินสดที่รับมา (ไว้คิดทอน)
change_amount   decimal(12,2) NULL
paid_at         datetime NOT NULL
created_by      int unsigned NULL FK admins(id)
note            varchar(255) NULL
cancelled_at    datetime NULL                 ยกเลิกงวด ไม่ลบแถว
created_at      datetime
```

รับเพิ่มทีหลัง = **INSERT แถวใหม่เสมอ** ห้าม UPDATE แถวเดิม (ข้อ 17, 23)

### 4.4 seed สินค้า (ในไฟล์ migration เดียวกัน)

`INSERT IGNORE` 8 หมวดลง `categories` และ ~40 รายการลง `products` — ใช้ `INSERT IGNORE` บน
`sku` ที่เป็น UNIQUE รันซ้ำแล้วไม่พัง

---

## 5. API — `api/routes/pos.php` (ไฟล์ใหม่ไฟล์เดียว)

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/pos/products` | Product master สำหรับ POS — join `categories` คืนหมวด+รายการ+ราคาตั้งต้น+`attributes` (นิยาม dynamic field) รองรับ `?q=` ค้นชื่อ/SKU |
| GET | `/api/pos/sales` | History — filter `from` `to` `payment_status` `fulfillment_status` `method` `created_by` · search `q` (POS no. / ชื่อ / เบอร์ / ชื่อสินค้า) |
| GET | `/api/pos/sales/:id` | Detail — sale + items + payments |
| POST | `/api/pos/sales` | บันทึกการขาย (ทั้ง transaction) |
| POST | `/api/pos/sales/:id/payments` | รับชำระเพิ่ม |
| POST | `/api/pos/sales/:id/deliver` | มาร์กส่งมอบ / ยกเลิกส่งมอบ |
| POST | `/api/pos/sales/:id/void` | ยกเลิกใบ (ต้องมี `void_reason`) |

**`POST /api/pos/sales` — ลำดับใน `Db::tx()`**

```
BEGIN
  ตรวจ items ครบไหม · ดึงราคาจาก body แต่คำนวณ line_total/subtotal/total ใหม่ฝั่ง server
  ออก pos_no ด้วย nextCode('POS', 'pos_sales', 'pos_no')     ← ใช้ helper เดิมของระบบ
  INSERT pos_sales (ยอดที่ server คำนวณ)
  INSERT pos_sale_items ทีละแถว
  INSERT pos_payments ถ้ามีรับเงินงวดแรก
  คำนวณ paid_amount / balance_amount / payment_status จาก pos_payments
  UPDATE pos_sales ด้วยยอดที่สรุปได้ + fulfillment_status + delivered_at
COMMIT   (error ใด ๆ → ROLLBACK อัตโนมัติตามกลไก Db::tx เดิม)
```

**Backend ไม่เชื่อยอดรวมจาก frontend** (ข้อ 19) — รับมาแค่ `quantity` กับ `unit_price` ต่อรายการ
แล้วบวกเอง ถ้าที่ frontend ส่งมาไม่ตรง ให้ยึดของ server

---

## 6. Frontend — โครงคอมโพเนนต์

```
frontend-next/app/(frontdesk)/pos/
  page.jsx                 หน้าขาย — ประกอบร่างอย่างเดียว ไม่มี logic
  pos.css                  สไตล์เฉพาะ POS (ธีมส้ม) import ที่ layout ของกลุ่มนี้
  history/page.jsx         POS History
  detail/page.jsx          POS Detail + รับชำระเพิ่ม

frontend-next/components/pos/
  ProductPicker.jsx        ค้น/เลือกสินค้า — modal เต็มจอบน mobile, dropdown บน desktop
  CartList.jsx             รายการในตะกร้า
  CartItemRow.jsx          หนึ่งแถว: [-] qty [+] · ราคา/ชิ้น · รวม · แก้ไข · ลบ
  ItemMetaFields.jsx       dynamic field ตามชนิดสินค้า ผูกกับ item ไม่ใช่ทั้งใบ
  CustomerBox.jsx          ค้นลูกค้าเก่า + Quick Customer (ชื่อ / เบอร์ แยกช่อง)
  PaymentPanel.jsx         ช่องทาง · เต็ม/มัดจำ · รับเงินมา · เงินทอน
  SummaryCard.jsx          สรุปยอด (ข้อ 13)
  ConfirmSaleModal.jsx     ยืนยันก่อน save + กันกดซ้ำ
  SaleSuccess.jsx          หน้าจอหลังบันทึกสำเร็จ
  PosStatusBadge.jsx       ป้าย payment_status / fulfillment_status

frontend-next/lib/pos/
  cart.js                  reducer ล้วน ๆ: add/remove/setQty/setPrice/setMeta/clear + คำนวณยอด
  posApi.js                ห่อ api client เฉพาะเส้น /api/pos/*
  posMeta.js               นิยาม dynamic field ต่อ product_type (อ่านจาก products.attributes)
```

`cart.js` เป็นฟังก์ชันบริสุทธิ์ทั้งไฟล์ ไม่แตะ React — เทสได้ด้วย `npm test` ที่มีอยู่
(`node --test lib/__tests__/**`) นี่คือที่ที่ตรรกะยอดเงินอยู่ ไม่ใช่ในคอมโพเนนต์

**ใช้ของเดิมที่มีอยู่แล้ว ไม่สร้างซ้ำ:** `Card` `Field` `Stack` `Row` `Badge` `Kpi` `Empty`
`Loading` `Check` (`components/ui.jsx`) · `DataTable` · `Toast` · `Confirm` · `Picker`
· `QueryParamPage` (สำหรับหน้า detail ที่รับ `?id=`)

### Layout

| จอ | โครง |
|---|---|
| Desktop / iPad แนวนอน | grid 2 คอลัมน์ `minmax(0,1.7fr) minmax(320px,1fr)` ≈ 63/37 · ฝั่งขวา `position:sticky` |
| iPad แนวตั้ง | 2 คอลัมน์แคบลง หรือพับเป็นแนวตั้งที่ ~1024px |
| Mobile | คอลัมน์เดียวเรียงลง · แถบสรุปยอด + ปุ่มชำระเงินติดล่างจอ (`position:sticky; bottom:0`) |

Breakpoint ตามที่ `globals.css` ใช้อยู่แล้ว ไม่ตั้งชุดใหม่

---

## 7. Flow ใหม่

```
/pos
 │
 ├─ ค้นหา/เลือกสินค้า ──> เพิ่มเข้า Cart ทันที
 │                        └─ ถ้าสินค้ามี dynamic field → กรอกในแถวนั้น
 │                        └─ ถ้าเลือก "อื่นๆ (พิมพ์เอง)" → พิมพ์ชื่อ + ราคา
 │
 ├─ แก้จำนวน / แก้ราคาต่อชิ้น / ลบ  (ราคาตั้งต้นมาจาก master แต่แก้ได้)
 │
 ├─ ลูกค้า (ไม่บังคับ) ──> ค้นลูกค้าเก่า หรือ Quick Customer (ชื่อ / เบอร์ แยกช่อง)
 │
 ├─ ชำระเงิน ──> ช่องทาง · เต็มจำนวน หรือ มัดจำ
 │               └─ Cash: กรอก "รับเงินมา" → คิดเงินทอนอัตโนมัติ
 │
 ├─ [ ] ลูกค้ารับสินค้าแล้ว   (แยกจากสถานะจ่ายเงินโดยสิ้นเชิง)
 │
 ├─ กด "ชำระเงิน / บันทึกการขาย"
 │      └─ เปิด Confirm Modal (ไม่ save ทันที) → [กลับไปแก้ไข] / [ยืนยันและบันทึก]
 │            └─ ปุ่มยืนยัน disabled ทันทีที่กด + idempotency key กันกดซ้ำ
 │
 ├─ Success: เลขที่ POS · ยอดขาย · ยอดชำระ · ยอดค้าง
 │      └─ [ขายรายการใหม่] [ดูรายละเอียด] [ดูประวัติ POS]   ([พิมพ์ใบเสร็จ] เว้นที่ไว้)
 │
 └─> /pos/history ──> /pos/detail?id=..
                        └─ ยอดค้าง > 0 → [+ รับชำระเพิ่ม] → INSERT pos_payments แถวใหม่
```

---

## 8. Validation

ทำทั้งสองฝั่ง — frontend กันไม่ให้กดผิด, backend เป็นด่านจริง

| กฎ | Frontend | Backend |
|---|---|---|
| Cart ต้องมี ≥ 1 รายการ | ปุ่มชำระเงิน disabled | 400 |
| `quantity >= 1` (จำนวนเต็ม) | stepper ไม่ให้ต่ำกว่า 1 | 400 |
| `unit_price >= 0` | input `min=0` | 400 |
| สินค้า Custom ต้องมีชื่อ | required | 400 |
| dynamic field ที่ required ต้องครบ | ไฮไลต์แถวที่ขาด | 400 |
| `amount >= 0` และไม่เกินยอดค้าง | คุมค่าในช่อง | 400 |
| Cash จ่ายเต็ม: `amount_received >= due` | ปุ่ม disabled + ข้อความ | 400 |
| จ่ายไม่ครบ → ห้ามเป็น `paid` | คำนวณสถานะจากยอด | server คำนวณเอง |
| มัดจำ / ยังไม่รับของ → ต้องมีชื่อ **หรือ** เบอร์ | ไฮไลต์ช่องลูกค้า | 400 |
| ยอดรวม | คำนวณโชว์ | **คำนวณใหม่ ไม่เชื่อ frontend** |
| กดซ้ำ | ปุ่ม disabled ตอน submit | idempotency key ต่อ 1 ใบ |
| ใบที่ `void` | ซ่อนปุ่มแก้ไข | ปฏิเสธทุกการเขียน |

**Edge case ที่จะทดสอบ:** ตะกร้าว่าง · qty 0 / ติดลบ / ทศนิยม · ราคา 0 (ของแถม) · รับเงินน้อยกว่ายอด ·
รับเงินเกิน (ต้องได้เงินทอน) · มัดจำ 0 บาท · จ่ายเพิ่มเกินยอดค้าง · จ่ายเพิ่มจนพอดี → `paid` ·
ส่งมอบทั้งที่ยังค้างเงิน (ต้องได้) · void ใบที่จ่ายแล้ว · กดยืนยันรัว ๆ · สินค้า custom ล้วนทั้งใบ ·
เปลี่ยนราคาใน master แล้วเปิดใบเก่า (ต้องเห็นราคาเดิม)

---

## 9. Permission

ใช้ `stock/api/src/Roles.php` + `frontend-next/lib/roles.js` เดิม ไม่เพิ่มบทบาทใหม่

| บทบาท | ขาย | รับชำระเพิ่ม | ดู History | แก้วันที่ย้อนหลัง | Void |
|---|---|---|---|---|---|
| `sales` | ✅ | ✅ | ✅ | ❌ (ล็อกเป็นวันนี้) | ❌ |
| `admin` ขึ้นไป | ✅ | ✅ | ✅ | ✅ | ✅ |
| `stock` | ❌ (คนละฝั่ง) | ❌ | ❌ | ❌ | ❌ |

ทุกใบเก็บ `created_by` · หน้าเว็บซ่อนปุ่มที่ไม่มีสิทธิ์ แต่ **API ตรวจซ้ำทุกเส้น**

---

## 10. ไฟล์ทั้งหมด

### สร้างใหม่ — ตามที่ทำจริง (14 ไฟล์)

```
stock/api/migrations/016_pos_walkin.sql                 3 ตาราง + seed 8 หมวด 41 รายการ
stock/api/migrations/017_pos_client_ref.sql             คีย์กันบันทึกซ้ำ
stock/api/migrations/018_pos_custom_single_name_field.sql  แก้ช่องชื่อสินค้าซ้ำสองช่อง
api/routes/pos.php                                      7 endpoint
frontend-next/app/(frontdesk)/pos/layout.jsx            โหลด CSS ให้ทั้งสามหน้า
frontend-next/app/(frontdesk)/pos/pos.css
frontend-next/app/(frontdesk)/pos/page.jsx
frontend-next/app/(frontdesk)/pos/history/page.jsx
frontend-next/app/(frontdesk)/pos/detail/page.jsx
frontend-next/components/pos/ProductPicker.jsx
frontend-next/components/pos/CartItemRow.jsx
frontend-next/components/pos/PaymentPanel.jsx
frontend-next/components/pos/ConfirmSaleModal.jsx
frontend-next/components/pos/PosStatusBadge.jsx
frontend-next/lib/pos/cart.js · lib/pos/posApi.js
frontend-next/lib/__tests__/posCart.test.js             24 เทส
```

**ต่างจากที่ออกแบบไว้ตอนแรก:**

- แผนเดิมมี 10 คอมโพเนนต์ ทำจริง 5 — `CartList` / `SummaryCard` / `SaleSuccess` /
  `CustomerBox` / `ItemMetaFields` เป็นแค่ไม่กี่บรรทัดในที่ที่มันถูกใช้ การแยกไฟล์
  ทำให้ต้องเปิดสองไฟล์เพื่ออ่านเรื่องเดียว
- ไม่มี `lib/pos/posMeta.js` — นิยาม dynamic field มาจาก `products.attributes.pos_fields`
  ที่ฐานข้อมูล ตามข้อ 4 ที่ห้าม hardcode · ฝั่งหน้าเว็บจึงไม่ต้องมีตารางแมป
- เพิ่ม `layout.jsx` ของกลุ่ม /pos เพื่อ import CSS ครั้งเดียวใช้ทั้งสามหน้า
- migration กลายเป็นสามไฟล์ ไม่ใช่ไฟล์เดียว (ห้ามแก้ไฟล์ที่รันไปแล้ว)

### แก้ของเดิม (2 บรรทัด)

```
api/index.php                        เพิ่ม 'pos' ในลิสต์ route group
frontend-next/components/Shell.jsx   บรรทัด 50: '/sales' → '/pos'
```

---

## 11. ลำดับลงมือ

| Phase | งาน | ตรวจว่าเสร็จด้วย |
|---|---|---|
| 1 | migration + seed สินค้า | `migrate.php` ผ่าน · query เห็น 8 หมวด ~40 รายการ |
| 2 | `api/routes/pos.php` — products + สร้างใบขาย | curl ยิงจริง เห็นแถวใน 3 ตาราง ครบทั้ง transaction |
| 3 | `lib/pos/cart.js` + unit test | `npm test` ผ่าน |
| 4 | หน้า `/pos` — cart + summary | เปิดหน้าจริง ถ่ายภาพ |
| 5 | Payment + Confirm + Success | ขายจริงหนึ่งใบผ่าน UI |
| 6 | `/pos/history` + `/pos/detail` | เห็นใบที่เพิ่งขาย |
| 7 | รับชำระเพิ่ม + ส่งมอบ + void | ยอดค้างเป็น 0 · payment_status เปลี่ยนเอง |
| 8 | Responsive 3 ขนาด | ถ่ายภาพ 1440 / 1024 / 390 |
| 9 | ไล่ Validation & Edge case ตามข้อ 8 | ทดสอบทีละข้อ |

จบแต่ละ Phase หยุดให้ตรวจก่อนไป Phase ถัดไป

---

## 12. ความเสี่ยงที่ต้องรู้

1. **ราคาสินค้ายังไม่มี** — seed ที่ราคา 0 พนักงานต้องพิมพ์ราคาเองทุกครั้งจนกว่าจะได้ราคาจริง
2. **ไม่ตัดสต็อก** — ยอดคงคลังกับยอดขายหน้าร้านจะไม่ตรงกันจนกว่าจะทำ Phase ตัดสต็อก
3. **สินค้าใหม่ไปโผล่ในหน้า `/stock`** — เพราะใช้ `products` ร่วมกัน
4. **`v_stock_available` และ `v_sale_history` พังอยู่ก่อนแล้ว** (`references invalid table(s)`)
   ทำให้ `mysqldump` หยุดที่ส่วน views · POS ไม่ได้ใช้สอง view นี้ แต่ควรซ่อมแยกต่างหาก
