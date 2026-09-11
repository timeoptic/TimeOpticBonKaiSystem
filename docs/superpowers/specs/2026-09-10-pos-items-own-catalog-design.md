# รายการสินค้าหน้าร้าน (POS) แยกออกจากแคตตาล็อกของคลัง — Design

วันที่ 10 กันยายน 2026 · แนวทาง "ก" ที่เจ้าของร้านเลือก

---

## 1. ปัญหา

หน้า `/pos` ค้นสินค้าไม่เจอสักตัว ("ไม่พบสินค้าที่ค้นหา") ทั้งบนโฮสต์และเครื่องในร้าน

- POS อ่านรายการจาก `products` + `categories` หมวด `Pos*` — ตารางกลางที่คลังใช้ด้วย
  (ตัดสินไว้ใน `2026-09-01-pos-walkin-design.md` ข้อ 3.1 และจดผลข้างเคียงไว้แล้วว่าจะโผล่ในหน้าคลัง)
- การล้างข้อมูลวันที่ 9 ก.ย. ลบสินค้าทั้ง 41 ตัวทิ้ง ส่วนฐานบนโฮสต์ตั้งจากดัมป์โครงเปล่า
  ที่บันทึกว่า 026 รันแล้ว — ไม่มีอะไรเอากลับมาให้เอง · หมวด 8 หมวดยังอยู่ แต่ว่าง
- เอา 41 ตัวกลับเข้า `products` ตรง ๆ ไม่ได้: กฎคลังตั้งแต่วันนี้คือ "คงเหลือ ≤ ขั้นต่ำ และ 0 = เตือนเมื่อหมด"
  ลองรันใน transaction แล้ว rollback — ต่ำกว่าขั้นต่ำ 0→41 · สินค้ารอสั่ง 0→41 · หมดสต็อก 0→41 ·
  Telegram รอบเช้า 41 แถว · ค่าประกอบแว่นกับซ่อมแว่นไม่ใช่ของที่ต้องสั่ง

เจ้าของร้าน: **"มันไม่เกี่ยวกับคลังเลย"**

## 2. เป้าหมาย / ไม่ใช่เป้าหมาย

**เป้าหมาย**
- หน้า `/pos` มีรายการ 41 ตัวให้เลือก จัดกลุ่ม 8 กลุ่มตามที่ร้านใช้ (ตรงกับ `<select>` ของระบบเดิม)
- ข้อมูลสินค้าหน้าร้านไม่อยู่ในตารางใดที่โมดูลคลังอ่าน — คลังไม่เห็น ไม่นับ ไม่เตือน
- โค้ดโมดูลคลัง (`stock/api/src`, `frontend-next/stockmod`) **ไม่ถูกแก้สักบรรทัด**
- หน้าเว็บ POS ไม่ต้องแก้ — API คืนรูปเดิม

**ไม่ใช่เป้าหมาย**
- หน้าแก้ราคา / เพิ่มลดรายการ POS จากหน้าเว็บ (ราคายังพิมพ์ตอนขายเหมือนทุกวันนี้ เพราะราคาตั้งต้นเป็น 0 อยู่แล้ว)
- ตัดสต็อกจากการขายหน้าร้าน (ไม่เคยทำ และตอนนี้ยิ่งไม่เกี่ยว)
- ย้ายข้อมูลใบขาย POS เก่า (บนโฮสต์และในร้าน `pos_sales` = 0 ใบ)

## 3. Schema — migration `stock/api/migrations/033_pos_items_own_catalog.sql`

วางไว้ฝั่ง `stock/api/migrations/` เพราะตาราง POS ทั้งชุด (018) อยู่ที่นี่และรันด้วย `migrate.php`
ตัวเดียวกัน · ไฟล์ถูก `exec()` ทั้งก้อน — ทุกคำสั่งต้องรันซ้ำได้โดยไม่พังและไม่ได้แถวซ้ำ

### 3.1 `pos_items`

```
id           INT UNSIGNED PK AI
sku          VARCHAR(40)  NOT NULL UNIQUE     SRV-0001 … CST-0001 (รหัสเดิมจาก 026)
group_code   VARCHAR(30)  NOT NULL            PosService … PosCustom
group_name   VARCHAR(100) NOT NULL            "บริการ / อะไหล่แว่น" …  ← ProductPicker จัดกลุ่มด้วยค่านี้
name         VARCHAR(255) NOT NULL
base_price   DECIMAL(12,2) NOT NULL DEFAULT 0  0 = "ตั้งราคาเอง"
pos_fields   LONGTEXT NULL                    JSON นิยามช่องกรอกเพิ่ม (ค่าสายตา / สี / รหัสแว่น)
is_custom    TINYINT(1) NOT NULL DEFAULT 0    "อื่นๆ (พิมพ์เอง)"
sort_order   INT NOT NULL DEFAULT 0           ลำดับตามใบที่ร้านให้มา
is_active    TINYINT(1) NOT NULL DEFAULT 1    เลิกขายตัวไหน = 0 ไม่ลบ (ใบเก่ายังชี้ถึง)
created_at / updated_at
KEY (is_active, sort_order)
```

กลุ่มเป็นคอลัมน์ ไม่ใช่ตารางแยก — มี 8 กลุ่ม ไม่มีข้อมูลอื่นของกลุ่มให้เก็บ

### 3.2 ข้อมูลตั้งต้น 41 ตัว

ชุดเดียวกับ 026 ทุกตัว (ชื่อ · SKU · กลุ่ม · pos_fields · ธง custom) — `INSERT … ON DUPLICATE KEY UPDATE`
เขียนทับ group/name/pos_fields/is_custom/sort_order แต่**ไม่แตะ `base_price`** (ราคาเป็นของร้าน)

สะกดตาม 026: "น้ำยา Anti fog" (HTML ของระบบเดิมเขียน "Anit fog")

### 3.3 `pos_sale_items.pos_item_id`

```
ADD COLUMN IF NOT EXISTS pos_item_id INT UNSIGNED NULL AFTER product_id
KEY + FK → pos_items(id) ON DELETE RESTRICT ON UPDATE CASCADE
```

`product_id` คงไว้ตามเดิม (nullable) ให้ใบเก่าในเครื่องอื่นยังอ่านหมวดได้ · ใบใหม่เขียน `pos_item_id` แทน
และ `product_id = NULL`

### 3.4 เก็บกวาดของเก่าในตารางคลัง

1. ลบสินค้าในหมวด `Pos*` ที่ **ไม่เคยถูกขาย** และไม่มีล็อต/สมุดสต็อก
   (`NOT EXISTS pos_sale_items` · `stock_lots` · `inventory_logs`) — บนโฮสต์และในร้านมี 0 ตัว
   แต่ฐานที่รัน migration ครบตั้งแต่ศูนย์จะมี 41 ตัวจาก 018/026
2. ลบหมวด `Pos*` ที่ไม่เหลือสินค้า — ตอนนี้ทั้ง 8 หมวดขึ้นในช่องเลือกหมวดของคลัง (`Inventory.php:867`)

ถ้าฐานไหนมีสินค้า POS ที่ขายไปแล้วผ่าน `product_id` แถวนั้นกับหมวดของมันอยู่ต่อ (ลบไม่ได้และไม่ควรลบ)

## 4. API — `api/routes/pos.php`

### `GET /api/pos/products`
อ่าน `pos_items WHERE is_active = 1 ORDER BY sort_order, sku` · คืนรูปเดิมทุกคีย์ที่หน้าเว็บใช้:

| คีย์ | ค่า |
|---|---|
| `id` | `pos_items.id` |
| `sku` `name` | ตรงตัว |
| `brand` `product_type` | `null` |
| `base_selling_price` | `base_price` |
| `category_code` / `category_name` | `group_code` / `group_name` |
| `pos_fields` | แตก JSON แล้ว (array) |
| `pos_custom` | `is_custom` เป็น bool |

ค้นด้วย `?q=` ยังได้ (name / sku) · ลบ `POS_CATEGORY_PREFIX` ทิ้ง

### `POST /api/pos/sales`
- `items[].product_id` ในคำขอ **ความหมายเปลี่ยนเป็น `pos_items.id`** — คงชื่อคีย์เดิมไว้เพื่อไม่ต้องแก้หน้าเว็บ
  (`lib/pos/cart.js`) · คอมเมนต์ในโค้ดบอกไว้ตรงจุดนั้น
- ตรวจ: ต้องมีใน `pos_items` และ `is_active = 1` — ไม่เจอ = 400 "ไม่พบสินค้ารหัส … ในรายการของหน้าร้าน"
  (id ของสินค้าคลังที่ยิงมาจะไม่ผ่าน เหมือนกฎเดิม)
- custom ดูจาก `is_custom` · ช่องบังคับดูจาก `pos_fields` — ตรรกะเดิมทุกข้อ แค่เปลี่ยนแหล่ง
- บันทึก `pos_item_id` · `sku_snapshot` จาก `pos_items.sku` · `product_id = NULL`
- ไม่มี `product_id` เลย (null) = ยังรับเป็นรายการพิมพ์เองได้เหมือนเดิม

## 5. รายงาน — `api/services/SalesReport.php::posCategories`

```
LEFT JOIN pos_items pi   ON pi.id = i.pos_item_id
LEFT JOIN products p     ON p.id = i.product_id        -- ใบเก่า
LEFT JOIN categories cat ON cat.id = p.category_id
COALESCE(pi.group_name, cat.name, 'Custom') AS category
```

## 6. สิ่งที่ไม่แตะ

- โมดูลคลังทั้งหมด · `Inventory::LOW_STOCK` · สคริปต์เตือน
- หน้าเว็บ POS (`ProductPicker` `cart.js` `CartItemRow`)
- `import-access.php` — `pos_items` ไม่อยู่ในรายการ `WIPE` จึงไม่ถูกล้างตอนนำเข้า · กฎ `WIPE_WHERE`
  ของหมวด `Pos*` ปล่อยไว้ (ยังกันสินค้า POS เก่าที่ขายไปแล้วในฐานอื่น)

## 7. ตรวจสอบ

ในเครื่อง (ฐานในร้าน):
1. `php stock/api/bin/migrate.php --dry` เห็น 033 ตัวเดียว → รันจริง → รันซ้ำไม่มีอะไรค้าง
2. นับ: `pos_items` 41 · หมวด `Pos*` ใน `categories` 0 · `Inventory::stockStateCounts` ไม่เปลี่ยนจากก่อนรัน
3. สคริปต์ยิงเส้นผ่าน Router ตัวจริงในทรานแซกชันที่ rollback (แบบ `api/cli/sweep-write-routes.php`):
   - `GET /api/pos/products` ได้ 41 แถว 8 กลุ่ม รูปคีย์ครบตามตารางข้อ 4
   - ขาย: สินค้าธรรมดา · คอนแทคเลนส์พร้อมค่าสายตา · custom พร้อมชื่อ → ผ่าน, `pos_item_id` ถูก
   - คอนแทคเลนส์ไม่ใส่ค่าสายตา · custom ไม่มีชื่อ · id ที่ไม่มี · id ที่ `is_active = 0` → 400
   - `SalesReport::posCategories` คืนชื่อกลุ่มของใบที่เพิ่งขาย
4. เทสต์คลัง `run.php` ผลเท่าเดิม (ไม่มีข้อไหนเปลี่ยนสถานะ) · `npm test` หน้าเว็บผ่าน
5. `php api/cli/sweep-get-routes.php` / `sweep-write-routes.php` ไม่มีเส้นใหม่แดง

## 8. ขึ้นโฮสต์

1. สำรอง: ดัมป์ `categories products pos_sale_items` บนโฮสต์ + `public_html` (ไม่รวม uploads)
2. ดูเวลาแก้ไฟล์ของเซสชันอื่นก่อน build — ถ้ามีงานค้าง อัปเฉพาะ `api/routes/pos.php`,
   `api/services/SalesReport.php`, `stock/api/migrations/033_*.sql` แทนทั้งก้อน
3. **migration ก่อนโค้ด:** อัปไฟล์ 033 → `php stock/api/bin/migrate.php --dry` → รันจริง
   (โค้ดเก่าระหว่างนั้นคืนรายการว่างเหมือนตอนนี้ ไม่แย่ลง)
4. อัปโค้ด → ตรวจด้วย PHP CLI บนโฮสต์: `pos_items` 41 · ไม่มีหมวด `Pos*` · ผลของ products endpoint
   (ไม่ยิง POST ขายบนโฮสต์ — มี Telegram และ activity log จริง)
5. ฐานในร้านรัน 033 ด้วย

**ถอยกลับ:** คืน `public_html` จากที่สำรอง · ตาราง `pos_items` กับคอลัมน์ใหม่ปล่อยไว้ได้ ไม่มีโค้ดเก่าอ่าน

## 9. ความเสี่ยงที่รู้

- `exec()` หลายคำสั่งในก้อนเดียว — คำสั่งหลังที่ล้มอาจไม่โยน error · กันด้วยการเขียนให้รันซ้ำได้
  และข้อ 7.2 นับผลจริงหลังรันทุกครั้ง
- `ADD CONSTRAINT IF NOT EXISTS` ต้องเช็กว่า MariaDB ของโฮสต์รองรับ (`SELECT VERSION()`) ก่อนรัน
- ร้านจะตั้งราคา POS ไม่ได้จากหน้าเว็บจนกว่าจะมีหน้าแก้รายการ — วันนี้พิมพ์ราคาตอนขายอยู่แล้ว
