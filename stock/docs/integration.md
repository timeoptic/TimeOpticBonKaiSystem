# TimeOptic — คู่มือเชื่อมระบบคลังกับหน้าร้าน

ระบบคลังและต้นทุน กับระบบหน้าร้าน ใช้ฐานข้อมูล `timeoptic` (MariaDB 10.4.32) ร่วมกันอยู่แล้ว
เอกสารนี้บอกว่าใครเป็นเจ้าของตารางไหน เรียก API เส้นไหนได้ และมีกติกาอะไรที่ทั้งสองฝั่งห้ามพัง

| | |
| --- | --- |
| ฐานข้อมูล | `timeoptic` · MariaDB 10.4.32 |
| ตารางทั้งหมด | 47 (รวม view 4 ตัว) |
| ของฝั่งคลัง | 6 · ที่เหลือเป็นหน้าร้าน |
| API | 39 เส้นทาง |
| สร้างเมื่อ | 27 สิงหาคม 2026 |

ส่วน **Data dictionary** ท้ายไฟล์อ่านตรงจาก `information_schema` ไม่ได้พิมพ์มือ
สร้างใหม่ได้ด้วย `.\run.ps1 php api/bin/datadict.php md`

---

## สิ่งที่ฝั่งหน้าร้านต้องทำ

เรียงตามลำดับที่ควรทำ ฝั่งคลังไม่ต้องแก้อะไรเพิ่มแล้ว ทุกอย่างที่ต้องใช้เปิดรออยู่

### 1 · ส่ง `case_code` มาด้วยตอนตัดสต็อก

เพิ่มฟิลด์เดียวใน request ที่ยิงมาอยู่แล้ว `POST /api/stock/issue` รับ `reference_doc` อยู่แล้ว
และหน้าความเคลื่อนไหวก็แสดงมันอยู่แล้ว

```json
{
  "source":        "frontdesk",
  "idem_key":      "case-C-2026-000481-line-2",
  "sku":           "LEN-160-N225-L",
  "quantity":      1,
  "reference_doc": "C-2026-000481"
}
```

**ทำไมเร่ง:** ตอนนี้ `inventory_logs.reference_doc` เป็น `null` อยู่ 37 แถว แปลว่าของออกจากคลัง
ไปแล้วแต่ตามกลับไม่ได้ว่าเป็นของเคสไหน ยิ่งปล่อยไว้นานยิ่งย้อนไปเติมยาก

### 2 · ตั้ง `idem_key` ให้คงเดิมเมื่อ retry

คีย์นี้คือสิ่งเดียวที่กันการตัดสต็อกซ้ำ ถ้าเน็ตหลุดตอนยิงแล้วยิงใหม่ด้วยคีย์เดิม
ระบบจะคืนคำตอบเดิมโดยไม่ตัดของรอบสอง

| ทำแบบนี้ | อย่าทำแบบนี้ |
| --- | --- |
| `case-<case_code>-line-<n>` | `uuid_v4()` |
| ประกอบจากสิ่งที่ระบุรายการนั้นได้จริง ยิงกี่ครั้งก็ได้คีย์เดิม | สุ่มใหม่ทุกครั้ง การ retry จะกลายเป็นการตัดสต็อกรอบสองเงียบ ๆ |

### 3 · ตัดสินใจร่วมกันเรื่อง `fk_pw_lot`

ตาราง `production_withdrawals` เป็นของฝั่งหน้าร้าน ฝั่งคลังจึงไม่แตะเอง
แต่มันมี foreign key ยิงเข้ามาที่ `stock_lots`

```
production_withdrawals.stock_lot_id  ->  stock_lots.id   (fk_pw_lot)
```

ผลตอนนี้คือ **ลบล็อตไม่ได้ถ้ามีใบเบิกผลิตอ้างอยู่** และเทสต์ของฝั่งคลังฟ้องอยู่หนึ่งข้อ
(`api/tests/00-foundation.test.php` ข้อ "ไม่มี foreign key ข้ามไปหาตารางของระบบหน้าร้าน")

มีสองทาง — เก็บไว้ตามเดิมแล้วรับผลนั้น หรือเปลี่ยนไปเก็บ `lot_number` เป็นข้อความแล้ว drop FK ทิ้ง
ถ้าเลือกทางหลัง ฝั่งคลังเขียน migration ให้ได้ แต่ต้องตกลงกันก่อน

---

## ระบบสองตัวเชื่อมกันยังไง

ทั้งสองระบบชี้ไปที่ฐานข้อมูล `timeoptic` ตัวเดียวกัน ไม่ได้แยกฐาน ไม่ต้อง sync
สิ่งที่แยกคือ **ความเป็นเจ้าของตาราง** และเส้นทางที่ใช้เขียน

| ฝั่ง | ตารางที่เป็นเจ้าของ | เขียนยังไง |
| --- | --- | --- |
| **คลังและต้นทุน** | `products` `stock_lots` `inventory_logs` `categories` `suppliers` `admins` | ผ่าน API ของตัวเอง (PHP service ที่คุมกฎ FIFO และสิทธิ์) |
| **หน้าร้าน** | `cases` `customers` `bookings` `production_jobs` `sales` `payments` … (39 ตาราง) | ผ่านโค้ดของหน้าร้านเอง |

เส้นที่หน้าร้านต้องใช้จริง ๆ มีอยู่ไม่กี่เส้น

- `GET /api/stock/{sku}` — เช็คของก่อนรับปากลูกค้า
- `POST /api/stock/issue` — ตัดออก
- `POST /api/stock/return` — คืนกลับ
- `POST /api/rx` — เปิดใบสั่งตัดสำหรับเลนส์ที่ไม่มีในสต็อก

---

## ตัดสต็อกแล้วอ้างเลขอะไร

**คำตอบ: `cases.case_code` ลงในช่อง `inventory_logs.reference_doc`**

ช่องนี้มีอยู่แล้ว เป็น `varchar(100)` และใช้งานอยู่จริง — ในตารางตอนนี้มีค่าอย่าง
`SO-2026-1015` กับ `ISS-2026-0408` อยู่ ไม่ต้องเพิ่มคอลัมน์ ไม่ต้องแก้ API

### ทำไมต้อง `case_code` ไม่ใช่ `cases.id`

| | `cases.id` | `cases.case_code` |
| --- | --- | --- |
| ชนิด | `int unsigned` | `varchar(40) NOT NULL UNIQUE` |
| คืออะไร | surrogate key — เลขที่ฐานข้อมูลแจก | business key — เลขที่ร้านใช้จริง |
| คนอ่านรู้เรื่องไหม | ไม่ ต้อง join ก่อนถึงจะรู้ว่าเคสไหน | รู้ทันที ใช้คุยกับลูกค้าได้เลย |
| ถ้าย้ายฐาน / re-seed | เลขเลื่อน ประวัติชี้ผิดเคส | คงเดิม เพราะเป็นเลขที่ออกโดยกระบวนการ ไม่ใช่โดย AUTO_INCREMENT |

### ได้อะไรฟรีทันทีที่เริ่มส่ง

- แสดงในหน้า **ความเคลื่อนไหว** และ **แดชบอร์ด** อยู่แล้ว ไม่ต้องแก้ UI
- ค้นหาได้ — ช่องค้นหาของ `GET /api/movements` วิ่งชน `reference_doc` ด้วย
- เรียงลำดับได้ — `?sort=doc`

`reference_doc` ยาวได้ 100 ตัวอักษร ส่วน `case_code` ยาวสุด 40 จึงลงได้สบาย
และเหลือที่พอถ้าวันหลังอยากเติม suffix อย่างเลขบรรทัดในเคส

---

## กติกาที่ห้ามพัง

### 1 · ห้าม foreign key ข้ามระบบ

สมุดสต็อกเป็นบันทึกประวัติ มันต้องเก็บ *สำเนา* ของเลขอ้างอิง ณ เวลาที่ของเคลื่อน
ไม่ใช่ตัวชี้ที่ยังมีชีวิต ถ้าผูกเป็น FK แล้ววันหนึ่งเคสถูกลบหรือย้าย ผลลัพธ์มีสองทางและแย่ทั้งคู่ —
ลบเคสไม่ได้เพราะสมุดสต็อกค้ำอยู่ หรือประวัติสต็อกถูก cascade ลบตามไป

ตอนนี้มีของจริงผิดกติกาอยู่หนึ่งจุด ดูข้อ 3 ของหัวข้อ "สิ่งที่ฝั่งหน้าร้านต้องทำ"

### 2 · ทุกคำสั่งเขียนต้องมี `idem_key`

`issue` · `scrap` · `return` รับคู่ `source` + `idem_key` ที่ต้องคงเดิมเมื่อ retry
ถ้าคำขอเดิมมาซ้ำ ระบบจะคืนคำตอบเดิมโดยไม่ตัดสต็อกซ้ำ

### 3 · ห้ามส่งชื่อคนทำมาใน body

API อ่าน "ใครทำรายการนี้" จาก session เท่านั้น ถ้าส่ง `actor_id` มาจะถูกทับด้วยค่าจาก session เสมอ
ผู้เรียกจึงอ้างเป็นคนอื่นไม่ได้ ถ้าอยากบันทึกว่าใครมารับของ ให้ใช้ `taken_by`
ซึ่งเป็นข้อความชื่อ ไม่ใช่ตัวตนที่ระบบเชื่อ

### 4 · ต้นทุนเป็นสิทธิ์ ไม่ใช่การตั้งค่าหน้าจอ

บทบาท `staff` จะไม่ได้รับฟิลด์ต้นทุนกลับมาเลย — ถูกตัดออกจาก JSON ตั้งแต่ชั้น API
ไม่ใช่ซ่อนด้วย CSS ถ้าหน้าร้านล็อกอินด้วยบัญชี staff แล้วต้องการต้นทุน จะไม่มีทางได้
ต้องเปลี่ยนบทบาทของบัญชีที่ใช้เชื่อม

### 5 · อย่าเขียนตารางคลังตรง ๆ

อย่า `UPDATE stock_lots` หรือ `INSERT inventory_logs` เอง แม้จะอยู่ฐานข้อมูลเดียวกันและเขียนได้ก็ตาม
การตัดสต็อกหนึ่งครั้งคือการเลือกล็อตตาม FIFO ล็อกแถวกันขายเกิน คิดต้นทุนของก้อนที่ตัด แล้วลงสมุด —
ทั้งหมดอยู่ใน transaction เดียวที่ `Stock::draw()` เขียน SQL เองจะได้ยอดที่ถูกแต่ต้นทุนที่ผิด
แล้วรู้ตัวตอนปิดเดือน

---

## API · พื้นฐาน

| เรื่อง | รายละเอียด |
| --- | --- |
| Base URL | `http://<host>:8080/api` |
| รูปแบบข้อมูล | JSON ทั้งขาเข้าและขาออก · `Content-Type: application/json` · UTF-8 ไม่ escape |
| ยืนยันตัวตน | Session cookie ชื่อ `optic_session` — เรียก `POST /api/auth/login` ก่อน แล้วส่ง cookie ไปกับทุกคำขอ |
| แบ่งหน้า | ค่าเริ่มต้น 25 แถวต่อหน้า · `?page=` เริ่มที่ 1 และถูก clamp ให้อยู่ในช่วงที่มีจริง · `?per=` ใช้ได้เฉพาะ `/api/products` รับ 5–100 |
| เรียงลำดับ | `?sort=` เป็น whitelist เสมอ ค่าที่ไม่รู้จักตกไปใช้ค่าเริ่มต้น ไม่ error · `?dir=asc\|desc` ค่าอื่นถือว่าไม่ระบุ |

คำตอบที่เป็นรายการ

```json
{ "rows": [], "total": 37, "page": 1, "perPage": 25 }
```

คำตอบที่เป็น error — HTTP status บอกประเภทปัญหา `reason` เป็นรหัสให้โค้ดแตกเงื่อนไข
`message` เป็นภาษาไทยที่เอาไปแสดงผู้ใช้ได้เลย

```json
{ "reason": "insufficient", "message": "…", "sku": "…", "wanted": 3, "available": 1 }
```

| Status | `reason` | แปลว่า |
| --- | --- | --- |
| 400 | `bad_request` | ข้อมูลที่ส่งมาไม่ผ่านการตรวจ — `message` บอกว่าช่องไหน |
| 401 | `unauthenticated` | ยังไม่ล็อกอิน หรือ session หมดอายุ |
| 403 | `forbidden` | ล็อกอินแล้วแต่บทบาทไม่มีสิทธิ์ |
| 404 | `not_found` | ไม่มีรายการที่อ้างถึง |
| 409 | `unknown_sku` | ไม่มีสินค้ารหัสนี้ในแคตตาล็อก |
| 409 | `insufficient` | ของไม่พอตัด — แนบ `wanted` กับ `available` มาด้วย |
| 409 | `custom_made` | สินค้าสั่งตัด ไม่มีสต็อกให้ตัดหรือรับเข้า ต้องไปทาง RX |
| 409 | `duplicate_sku` | SKU ซ้ำกับสินค้าที่มีอยู่ |
| 409 | `in_flight` | คำขอ `idem_key` เดียวกันกำลังทำอยู่ ให้ลองใหม่ |
| 409 | `unknown_original` | คืนของโดยอ้าง `reverses_key` ที่ไม่มีอยู่ |
| 409 | `has_stock` | เปลี่ยนสินค้าที่ยังมีสต็อกให้เป็นสั่งตัดไม่ได้ |
| 409 | `has_history` | ลบสินค้าที่เคยเคลื่อนไหวไม่ได้ |
| 409 | `ambiguous_recipient` | ส่ง `issued_to_admin_id` กับ `branch_id` มาพร้อมกัน |
| 400 | `branch_not_issuable` | ใช้ `branch_id` กับ scrap หรือ return |

---

## API · เข้าสู่ระบบ

### `POST /api/auth/login`

ไม่ต้องล็อกอินก่อน แลกชื่อผู้ใช้กับรหัสผ่านเป็น session cookie

```
{ "username": "…", "password": "…" }
-> { "actor": { id, username, displayName, jobTitle, role, roleLabel, employeeId } }
```

### `POST /api/auth/logout`

ทิ้ง session ทั้งใบ คืน `{ "ok": true }`

### `GET /api/auth/me`

ตอนนี้ล็อกอินเป็นใคร คืน `{ "actor": null }` ถ้ายังไม่ได้ล็อกอิน ไม่ใช่ 401 — ใช้เช็คสถานะตอนเปิดหน้าได้
บทบาทถูกอ่านใหม่จากฐานข้อมูล ไม่ใช่จาก session ที่ค้างไว้

### `GET /api/health`

`{ "ok": true, "time": "…" }` ใช้กับ monitor ได้ ไม่ต้องล็อกอิน

---

## API · อ่านข้อมูล

ทุกเส้นในหมวดนี้ต้องล็อกอิน และทุกเส้นที่มีตัวเลขเงินจะตัดฟิลด์ต้นทุนออกเป็น `null` เมื่อผู้เรียกเป็น `staff`

### `GET /api/summary`

ตัวเลขสรุปสำหรับหัวหน้าจอ

```
-> { products, lots, onHand, stockValue, rxAwaitingCost, lotsMissingCost }
```

### `GET /api/products`

แคตตาล็อกสินค้าพร้อมยอดคงเหลือและต้นทุนของล็อตที่จะถูกตัดเป็นก้อนถัดไป

| พารามิเตอร์ | ค่า | ทำอะไร |
| --- | --- | --- |
| `q` | ข้อความ | ค้นจาก SKU · ชื่อ · แบรนด์ |
| `type` | `Lens` `Frame` `Sunglass` `ContactLen` `Accessory` | กรองตามชนิดสินค้า |
| `make` | `ready` `custom` `rx` | `ready` เฉพาะสำเร็จรูป · `custom` เฉพาะสั่งตัด · `rx` สิ่งที่สั่งพิเศษได้จริง (สั่งตัด หรือของสต็อกที่หมดแล้ว) |
| `eye` | `left` `right` | กรองตามข้างตา อ่านจาก `attributes.eye_side` |
| `cat` | ตัวเลข | กรองด้วย `category_id` — ผลเหมือน `type` แต่ต้องรู้ id ก่อน |
| `sort` | `sku` `name` `brand` `type` `eye` `onhand` `price` | ค่าเริ่มต้น `sku` |
| `dir` | `asc` `desc` | ไม่ระบุ = ตามธรรมชาติของคอลัมน์ |
| `per` | 5–100 | ค่าเริ่มต้น 25 |
| `page` | ตัวเลข | เริ่มที่ 1 |

```
-> rows[]: { id, sku, name, brand, productType, categoryId, basePrice, isCustomMade,
             eyeSide, onHand, stockValue, lotsMissingCost, nextCost }
```

### `GET /api/products/next-sku`

รหัสที่สินค้าตัวถัดไปของชนิดนั้นจะได้ ใช้ให้ฟอร์มโชว์รหัสก่อนกดบันทึก
ยังไม่จองรหัสไว้ — ตัวที่จองจริงคือตอน `POST /api/products`

| พารามิเตอร์ | จำเป็น | ความหมาย |
| --- | --- | --- |
| `type` | ใช่ | หนึ่งในห้าชนิด |

```
-> { "sku": "LNS-0001" }
```

### `GET /api/products/hints`

ชื่อสินค้าและแบรนด์ที่แคตตาล็อกมีอยู่แล้วของชนิดนั้น ให้ฟอร์มเสนอกลับ
เป็นตัวช่วยเติม ไม่ใช่รายการปิด — พิมพ์ชื่อหรือแบรนด์ใหม่ได้เสมอ

| พารามิเตอร์ | จำเป็น | ความหมาย |
| --- | --- | --- |
| `type` | ใช่ | หนึ่งในห้าชนิด |

```
-> { "names": [ … ], "brands": [ … ] }
```

### `GET /api/products/{id}`

สินค้าหนึ่งตัวแบบเต็ม — เพิ่ม `attributes` (สเปกทั้งก้อนเป็น JSON), `lots[]` ทุกล็อตของมัน
และ `logs[]` ประวัติการเคลื่อนไหว

### `GET /api/lots`

ล็อตสต็อกเรียงตามคิว FIFO คำตอบแนบ `counts` ของแต่ละสถานะมาให้ทำเป็นแท็บได้

| พารามิเตอร์ | ค่า |
| --- | --- |
| `state` | สถานะของล็อต เช่น เหลืออยู่ · หมดแล้ว · ยังไม่มีต้นทุน |
| `q` | ค้นจากเลขล็อต · SKU · ชื่อสินค้า |
| `sort` `dir` `page` | เหมือนเส้นอื่น (แถวต่อหน้าคงที่ 25) |

### `GET /api/movements`

สมุดสต็อก — ทุกการเคลื่อนไหวที่เคยเกิด **นี่คือเส้นที่ใช้ตามรอยว่าเคสไหนตัดของอะไรไป**

| พารามิเตอร์ | ค่า | ทำอะไร |
| --- | --- | --- |
| `type` | `IN` `OUT` `ADJUST` `RX_ORDER` `RETURN` `SCRAP` | กรองตามชนิดการเคลื่อนไหว |
| `q` | ข้อความ | ค้นจาก `reference_doc` · SKU · ชื่อสินค้า · เลขล็อต |
| `who` | ตัวเลข | เฉพาะที่คนนี้เป็นคนทำ |
| `from` `to` | `YYYY-MM-DD` | ช่วงวันที่ |
| `sort` | `doc` … | `doc` เรียงตามเลขอ้างอิง |

```
-> rows[]: { id, actionType, quantity, unitCost, referenceDoc, notes, … }
   counts: { … }
```

### `GET /api/report`

สมุดสต็อกบวกรวมตามช่วงวัน สำหรับแดชบอร์ด
`from` ค่าเริ่มต้น = วันที่ 1 ของเดือนนี้ · `to` ค่าเริ่มต้น = วันนี้

### `GET /api/receive-defaults/{sku}`

ล็อตใหม่ของสินค้าที่เคยรับแล้ว ควรเริ่มต้นด้วยค่าอะไร

```
-> { sku, name, brand, isCustomMade, lastLot: { … } | null, suggestedLotNumber }
```

### `GET /api/notes`

คำที่ร้านใช้อธิบายเหตุผลที่ของเคลื่อน เรียงตามที่ใช้บ่อยที่สุด · `?action=` ค่าเริ่มต้น `OUT`

### `GET /api/categories`

หมวดหมู่ทั้งห้า `{ id, code, name }` โดย `code` ตรงกับ `products.product_type` แบบหนึ่งต่อหนึ่ง

### `GET /api/suppliers`

ผู้ขายที่ร้านสั่งของ สำหรับ dropdown ตอนรับของเข้า

---

## API · ตัด · คืน · ของเสีย

หมวดนี้คือเส้นที่หน้าร้านใช้จริงตอนขายของ ทั้งสามเส้นเขียนเป็น transaction เดียว
ล็อกแถวล็อตด้วย `FOR UPDATE` และเลือกล็อตตาม FIFO เอง — ผู้เรียกบอกแค่ว่า *อะไร กี่ชิ้น*

### `GET /api/stock/{sku}`

เช็คก่อนรับปากลูกค้า — ของชิ้นนี้เหลือเท่าไหร่ ตัดได้ไหม หรือเป็นสินค้าสั่งตัดที่ต้องไปทาง RX

### `POST /api/stock/issue`

ตัดของออกจากคลัง — ขาย เบิกใช้ หรือจ่ายให้สาขา ลงสมุดเป็น `OUT`
สิทธิ์: owner · accountant · staff

| ฟิลด์ | จำเป็น | ความหมาย |
| --- | --- | --- |
| `source` | ใช่ | ชื่อระบบที่เรียก ยาวไม่เกิน 30 เช่น `frontdesk` |
| `idem_key` | ใช่ | คีย์กันตัดซ้ำ ยาวไม่เกิน 120 **ต้องคงเดิมเมื่อ retry** |
| `sku` | ใช่ | รหัสสินค้า |
| `quantity` | ใช่ | จำนวนชิ้น จำนวนเต็มบวก |
| `reference_doc` | ไม่ | เลขอ้างอิงจากระบบต้นทาง — **ที่ที่ `case_code` ควรอยู่** ยาวไม่เกิน 100 |
| `note` | ไม่ | เหตุผล ยาวไม่เกิน 500 |
| `taken_by` | ไม่ | ชื่อคนจากสาขาที่มารับของ ยาวไม่เกิน 120 · เว้นไว้ได้ — ตัวที่ผูกหนี้คือ `branch_id` |
| `issued_to_admin_id` | ไม่ | เบิกให้พนักงานคนนี้ · ส่งพร้อม `branch_id` ไม่ได้ |
| `branch_id` | ไม่ | สาขาที่มาเบิก · ใช้ได้เฉพาะ `issue` |
| `actor_id` | — | ส่งมาก็ถูกทับด้วยค่าจาก session |

```
-> { "cuts": [ { lotNumber, quantity, unit_cost }, … ], "total_cost": … }
   staff จะไม่ได้ total_cost และไม่ได้ unit_cost ในแต่ละ cut
```

### `POST /api/stock/scrap`

ตัดของเสียทิ้ง ลงสมุดเป็น `SCRAP` ไม่ใช่ `OUT` — ถ้ากองรวมกับการขาย ต้นทุนขายจะบวม
และตอบไม่ได้ว่าเดือนนี้เสียไปกี่ชิ้น ฟิลด์เหมือน `issue` ยกเว้นส่ง `branch_id` ไม่ได้

### `POST /api/stock/return`

คืนของกลับเข้าคลัง โดยอ้างรายการเดิมที่จะกลับรายการ ไม่ได้บอกว่าคืนอะไรกี่ชิ้นเอง —
ระบบไปอ่านจากรายการเดิม ของจึงกลับเข้าล็อตที่มันออกมาจริง ๆ พร้อมต้นทุนเดิม

| ฟิลด์ | จำเป็น | ความหมาย |
| --- | --- | --- |
| `source` | ใช่ | ชื่อระบบที่เรียก |
| `idem_key` | ใช่ | คีย์ของ *การคืน* ครั้งนี้ (คนละตัวกับของเดิม) |
| `reverses_key` | ใช่ | `idem_key` ของรายการเดิมที่กำลังกลับรายการ ถ้าไม่พบจะได้ `unknown_original` |
| `note` | ไม่ | เหตุผลที่คืน |

---

## API · ใบสั่งตัด RX

สำหรับเลนส์ที่ร้านไม่ได้สต็อก — สั่งเฉพาะราย ของยังไม่มาแต่ต้องบันทึกไว้ก่อน
ต้นทุนจริงมาทีหลังตอนใบกำกับมาถึง

### `POST /api/rx`

เปิดใบสั่งตัด ลงสมุดเป็น `RX_ORDER` ไม่แตะยอดสต็อกเพราะของยังไม่เคยอยู่ในคลัง
สิทธิ์: owner · accountant · staff

| ฟิลด์ | จำเป็น | ความหมาย |
| --- | --- | --- |
| `sku` | ไม่* | รหัส**รุ่นเลนส์**ที่สั่ง — ไม่ใช่รหัสต่อค่าสายตา |
| `lens_name` | ไม่* | ชื่อรุ่นเลนส์ · ถ้าตรงกับรุ่นสั่งตัดที่มีอยู่จะใช้ตัวนั้น ถ้าไม่มีจะสร้างรุ่นใหม่ให้ในคำขอเดียวกัน (**ต้องมีสิทธิ์แก้แคตตาล็อก**) |
| `reference_doc` | ไม่ | เว้นว่างแล้วระบบออกเลขให้เอง เป็น `RX-{ปี}-{ลำดับ}` เช่น `RX-2026-0133` · ส่งเลขของร้านมาแทนได้ |
| `eye_side` | ไม่ | `left` หรือ `right` |
| `sph` `cyl` | ไม่ | ค่าสายตาของใบสั่งนี้ ทศนิยมไม่เกินสองตำแหน่ง ติดลบได้ |
| `axis` | ไม่ | จำนวนเต็ม 0–180 |
| `add` | ไม่ | เก็บตามที่เขียน เช่น `+2.00` |
| `sale_price` | ไม่ | ราคาที่ขายให้ลูกค้ารายนี้ · **ต้องมีสิทธิ์ลงต้นทุน** |
| `note` | ไม่ | รายละเอียดเพิ่มเติม |
| `unit_cost` | ไม่ | ถ้ารู้ต้นทุนแล้วใส่ได้เลย · **ต้องมีสิทธิ์ลงต้นทุน** |

* ต้องมีอย่างใดอย่างหนึ่ง — `sku` เมื่อรุ่นนั้นอยู่ในแคตตาล็อกแล้ว หรือ `lens_name` เมื่อยัง
ไม่มี การเปิดใบสั่งจึงไม่ต้องหยุดไปสร้างสินค้าก่อน

ค่าสายตาอยู่กับ**ใบสั่ง** ไม่ใช่กับสินค้า — สั่งเลนส์รุ่นเดียวกันให้ลูกค้าคนละคน
คนละค่าสายตาได้ โดยไม่ต้องสร้างสินค้าใหม่ เก็บในตาราง `rx_orders` ที่ผูกกับแถว
`inventory_logs` แบบหนึ่งต่อหนึ่ง (รูปแบบเดียวกับ `branch_issues`)

### `GET /api/rx/next-doc`

เลขที่ใบสั่งที่ใบถัดไปจะได้ ใช้ให้ฟอร์มโชว์เลขก่อนกดบันทึก
ยังไม่จองเลขไว้ — ตัวที่จองจริงคือตอน `POST /api/rx`

```
-> { "referenceDoc": "RX-2026-0133" }
```

### `GET /api/rx/orders`

สมุดใบสั่งทั้งเล่ม — ใบสั่ง ค่าสายตา ต้นทุน และราคาขาย ในการอ่านครั้งเดียว

| พารามิเตอร์ | จำเป็น | ความหมาย |
| --- | --- | --- |
| `q` | ไม่ | ค้นจากเลขที่ใบสั่ง · SKU · ชื่อเลนส์ · หมายเหตุ |
| `pending` | ไม่ | `1` = เฉพาะใบที่ยังไม่มีต้นทุน |
| `page` `per` | ไม่ | แบ่งหน้า (`per` มากสุด 100) |

```
-> { rows: [ { id, sku, name, referenceDoc, createdAt, actorName, note,
               unitCost, salePrice, eyeSide, sph, cyl, axis, add } ], total, page, perPage }
```

### `GET /api/rx/awaiting-cost`

ใบสั่งตัดที่ยังไม่รู้ต้นทุน คือคิวงานของฝ่ายบัญชี

### `POST /api/rx/{id}/cost`

ลงต้นทุนของใบสั่งตัดเมื่อใบกำกับมาถึง `{id}` คือ id ของแถวใน `inventory_logs`
สิทธิ์: owner · accountant

```json
{ "unit_cost": 1250.00 }
```

---

## API · รับของและแคตตาล็อก

### `POST /api/lots`

รับล็อตใหม่เข้าคลัง ลงสมุดเป็น `IN` เว้นต้นทุนว่างได้ถ้าใบกำกับยังไม่มา
ระบบจะนับล็อตนั้นแยกไว้แทนที่จะคิดเป็นศูนย์ · สิทธิ์: owner · accountant · staff

| ฟิลด์ | จำเป็น | ความหมาย |
| --- | --- | --- |
| `sku` | ใช่ | ต้องมีในแคตตาล็อกแล้ว และต้องไม่ใช่สินค้าสั่งตัด |
| `lot_number` | ไม่ | เว้นว่างแล้วระบบออกให้เอง เป็น `L{ปีเดือนวัน}-{ลำดับ}` เช่น `L260829-01` · ส่งเลขของผู้ขายมาแทนได้ |
| `quantity` | ใช่ | จำนวนที่รับเข้า |
| `received_date` | ใช่ | `YYYY-MM-DD` — เป็นตัวจัดคิว FIFO |
| `cost_per_unit` | ไม่ | ต้นทุนต่อชิ้น · **ต้องมีสิทธิ์ลงต้นทุน** |
| `supplier_id` | ไม่ | ผู้ขาย |
| `expiry_date` | ไม่ | ห้ามเป็นวันก่อน `received_date` |
| `note` | ไม่ | เช่น เลขที่ใบส่งของ |

```
-> { "lot": { lotNumber, quantity, awaitingCost, name } }
```

### `POST /api/products`

เพิ่มสินค้าใหม่เข้าแคตตาล็อก · สิทธิ์: owner · accountant

| ฟิลด์ | จำเป็น | ความหมาย |
| --- | --- | --- |
| `sku` | ไม่ | เว้นว่างแล้วระบบออกให้เองตามชนิดสินค้า เช่น `LNS-0001` · ถ้าส่งมาแล้วซ้ำจะได้ `duplicate_sku` |
| `name` | ใช่ | ยาวไม่เกิน 255 |
| `product_type` | ใช่ | หนึ่งในห้าชนิด |
| `category_id` | ใช่ | ต้องมีอยู่จริง มีหนึ่งหมวดต่อหนึ่งชนิด |
| `base_selling_price` | ใช่ | ตัวเลขไม่ติดลบ ทศนิยมไม่เกินสองตำแหน่ง |
| `brand` | ไม่ | ยาวไม่เกิน 120 |
| `is_custom_made` | ไม่ | `true` = สั่งตัด ไม่เก็บสต็อก |
| `attributes` | ไม่ | อ็อบเจกต์ JSON — สเปกที่ต่างกันไปตามชนิด |

### `POST /api/products/{id}/update`

ฟิลด์เหมือนตอนสร้าง คีย์ใน `attributes` ที่ระบบไม่รู้จักจะถูกเก็บไว้ไม่แตะต้อง
เปลี่ยนสินค้าที่ยังมีสต็อกให้เป็นสั่งตัดไม่ได้ — จะได้ `has_stock`

### `POST /api/products/{id}/delete`

ทำได้เฉพาะของที่เพิ่งพิมพ์ผิด — ถ้าเคยมีล็อตหรือเคยเคลื่อนไหวจะได้ `has_history`

### `POST /api/lots/{id}/update` · `POST /api/lots/{id}/delete`

แก้หรือลบล็อต เช่น ลงต้นทุนที่เพิ่งรู้ หรือแก้วันที่ที่คีย์ผิด · สิทธิ์: owner · accountant

---

## API · สาขาและค้างรับ

สาขาอื่นมาเบิกของ ต่างจากการเบิกปกติตรงที่ **ของออกวันหนึ่ง เงินเข้าอีกวันหนึ่ง**
กำไรจึงถูกลงในวันที่รับเงิน ไม่ใช่วันที่เบิก

### `GET /api/branches`

รายชื่อสาขา · `?active=1` เอาเฉพาะที่ยังเปิดใช้งาน
`staff` เห็นชื่อได้ (ต้องใช้บันทึกการเบิก) แต่ไม่เห็นยอดค้าง

### `POST /api/branches`

เพิ่มสาขา · `name` (จำเป็น) · `contact` · `note` · สิทธิ์: owner

### `POST /api/branches/{id}/update`

ส่งเฉพาะฟิลด์ที่จะเปลี่ยน ที่ไม่ส่งจะคงค่าเดิม
`is_active: false` = ปิดไม่ให้เบิกใหม่ แต่ประวัติยังอยู่ · สิทธิ์: owner

### `GET /api/settlements`

ของที่ออกไปให้สาขาแล้วเงินยังไม่มา อะไรที่ยังค้างจะเรียงขึ้นบนสุดเสมอไม่ว่าจะเรียงคอลัมน์ไหน
คำตอบแนบ `summary` ยอดรวมมาด้วย · พารามิเตอร์ `status` `branch` `q` `sort` `dir` `page`
สิทธิ์: owner · accountant

### `POST /api/settlements/{id}/settle`

บันทึกรับเงินจากสาขา รับเท่าทุนหรือน้อยกว่าทุนได้ กำไรจะเป็นศูนย์หรือติดลบตามจริง ไม่ใช่ error

```json
{ "amount": 3200.00, "received_date": "2026-08-27", "note": "…" }
```

### `POST /api/settlements/{id}/write-off`

ตัดหนี้สูญ ต่างจากรับเงินศูนย์บาท — อันนั้นคือได้เงินมาจริงศูนย์บาท อันนี้คือยอมรับว่าจะไม่ได้

```json
{ "note": "เหตุผลที่ตัดหนี้" }
```

---

## API · ผู้ใช้และสิทธิ์

### `GET /api/policy`

ตารางสิทธิ์ทั้งใบ อ่านได้ทุกบทบาทที่ล็อกอินแล้ว เพราะมันคือ *กฎ* ไม่ใช่ข้อมูลที่กฎปกป้อง —
และค่าในตารางถูกอ่านจากฟังก์ชันที่ API ใช้บังคับจริง ไม่ใช่ค่าที่พิมพ์ซ้ำไว้

### `GET /api/people`

ชื่อคนอย่างเดียว สำหรับ dropdown "ใครเป็นคนเบิก"

### `GET /api/users` · `POST /api/users` · `POST /api/users/{id}/update` · `POST /api/users/{id}/password`

จัดการบัญชีผู้ใช้ · สิทธิ์: owner เท่านั้น
ฟิลด์ตอนสร้าง: `username` `password` `display_name` `role` `job_title`

### บทบาททั้งสาม

| สิ่งที่ทำได้ | owner | accountant | staff |
| --- | --- | --- | --- |
| ดูสินค้า ยอดคงเหลือ ราคาขาย | ✓ | ✓ | ✓ |
| ดูล็อต ความเคลื่อนไหว ใครเบิก | ✓ | ✓ | ✓ |
| เบิก · ตัดของเสีย · คืนของ | ✓ | ✓ | ✓ |
| รับของเข้าคลัง | ✓ | ✓ | ✓ |
| เห็นต้นทุน มูลค่าคลัง ต้นทุนขาย | ✓ | ✓ | — |
| กรอกต้นทุน | ✓ | ✓ | — |
| แก้แคตตาล็อกสินค้า | ✓ | ✓ | — |
| ยอดและกำไรจากสาขา · หน้าค้างรับ | ✓ | ✓ | — |
| จัดการสาขา | ✓ | — | — |
| จัดการผู้ใช้และสิทธิ์ | ✓ | — | — |

ตารางนี้คัดลอกมาจาก `GET /api/policy` ถ้าสงสัยว่าอันไหนเป็นปัจจุบัน ให้เชื่อ API ไม่ใช่เอกสาร

---

# Data dictionary

อ่านตรงจาก `information_schema` ของฐานข้อมูล `timeoptic` ไม่ได้พิมพ์มือ
จำนวนแถวคือค่า ณ ตอนที่สร้างเอกสาร ส่วนคอลัมน์ ชนิด และความสัมพันธ์เป็นของจริงทั้งหมด

สร้างใหม่: `.\run.ps1 php api/bin/datadict.php md`

## ตารางของระบบคลังและต้นทุน

หกตารางนี้คือทั้งหมดที่ระบบคลังเป็นเจ้าของ นอกจากนี้เป็นของหน้าร้าน

### `categories`

*ระบบคลัง · 5 แถว*

หมวดหมู่สินค้า มีหนึ่งแถวต่อหนึ่งชนิดสินค้า และ code ตรงกับ products.product_type

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `name` | `varchar(100)` | no |  | — | — |
| `code` | `varchar(20)` | no | UQ | — | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `products.category_id`

### `suppliers`

*ระบบคลัง · 8 แถว*

ผู้ขายที่ร้านสั่งของ อ้างจาก stock_lots.supplier_id

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `name` | `varchar(120)` | no | UQ | — | — |
| `contact_person` | `varchar(120)` | yes |  | `NULL` | — |
| `phone` | `varchar(60)` | yes |  | `NULL` | — |
| `email` | `varchar(120)` | yes |  | `NULL` | — |
| `default_lead_days` | `smallint(6)` | no |  | `7` | — |
| `active` | `tinyint(1)` | no |  | `1` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `stock_lots.supplier_id`

### `products`

*ระบบคลัง · 37 แถว*

แคตตาล็อกสินค้า หนึ่งแถวคือของหนึ่งอย่างที่ร้านขาย เลนส์คนละค่าสายตาถือเป็นคนละแถว เพราะสต็อกแยกตามค่าสายตาอยู่แล้ว สเปกที่ต่างกันไปตามชนิดเก็บใน attributes เป็น JSON

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `sku` | `varchar(100)` | no | UQ | — | — |
| `category_id` | `int(10) unsigned` | no | IX | — | `categories.id` |
| `product_type` | `varchar(30)` | no |  | — | — |
| `name` | `varchar(255)` | no |  | — | — |
| `brand` | `varchar(120)` | yes |  | `NULL` | — |
| `base_selling_price` | `decimal(12,2)` | no |  | `0.00` | — |
| `is_custom_made` | `tinyint(1)` | no |  | `0` | — |
| `attributes` | `longtext` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `inventory_logs.product_id` · `stock_lots.product_id`

### `stock_lots`

*ระบบคลัง · 52 แถว*

ของที่รับเข้ามาเป็นล็อต แต่ละล็อตถือต้นทุนของตัวเอง การตัดสต็อกเดินตาม FIFO จาก received_date แล้ว id

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `lot_number` | `varchar(100)` | no |  | — | — |
| `product_id` | `int(10) unsigned` | no | IX | — | `products.id` |
| `supplier_id` | `int(10) unsigned` | yes | IX | `NULL` | `suppliers.id` |
| `cost_per_unit` | `decimal(12,2)` | yes |  | `NULL` | — |
| `initial_qty` | `int(10) unsigned` | no |  | `1` | — |
| `remaining_qty` | `int(10) unsigned` | no |  | `1` | — |
| `received_date` | `date` | no |  | — | — |
| `expiry_date` | `date` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `inventory_logs.lot_id` · `production_withdrawals.stock_lot_id`

### `inventory_logs`

*ระบบคลัง · 238 แถว*

สมุดสต็อก ทุกการเคลื่อนไหวลงที่นี่และไม่มีการลบ reference_doc คือเลขอ้างอิงจากระบบต้นทาง (เช่น case_code) เก็บเป็นข้อความ ไม่ใช่ foreign key

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `product_id` | `int(10) unsigned` | no | IX | — | `products.id` |
| `lot_id` | `int(10) unsigned` | yes | IX | `NULL` | `stock_lots.id` |
| `action_type` | `enum('IN','OUT','ADJUST','RX_ORDER','RETURN','SCRAP')` | no |  | — | — |
| `quantity` | `int(11)` | no |  | — | — |
| `unit_cost` | `decimal(12,2)` | yes |  | `NULL` | — |
| `reference_doc` | `varchar(100)` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_by` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `created_by_kind` | `enum('employee','admin','system','user')` | no |  | `'user'` | — |
| `issued_to_admin_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `branch_issue_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

### `admins`

*ระบบคลัง · 8 แถว*

บัญชีผู้ใช้ของระบบคลัง มีสามบทบาท owner / accountant / staff

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `username` | `varchar(64)` | yes | UQ | `NULL` | — |
| `display_name` | `varchar(255)` | no |  | — | — |
| `job_title` | `varchar(120)` | yes |  | `NULL` | — |
| `email` | `varchar(255)` | yes |  | `NULL` | — |
| `password_hash` | `varchar(255)` | yes |  | `NULL` | — |
| `role` | `enum('owner','accountant','staff')` | no | IX | `'staff'` | — |
| `is_active` | `tinyint(1)` | no |  | `1` | — |
| `employee_id` | `int(10) unsigned` | yes | UQ | `NULL` | — |
| `last_login_at` | `datetime` | yes |  | `NULL` | — |
| `created_by` | `int(10) unsigned` | yes | IX | `NULL` | `admins.id` |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `admins.created_by`

## ลูกค้าและเคส


### `customers`

*ระบบหน้าร้าน · 8 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `first_name` | `varchar(100)` | no | IX | — | — |
| `mid_name` | `varchar(100)` | yes |  | `NULL` | — |
| `last_name` | `varchar(100)` | yes |  | `NULL` | — |
| `sex` | `varchar(20)` | yes |  | `NULL` | — |
| `nationality` | `varchar(60)` | yes |  | `NULL` | — |
| `email` | `varchar(120)` | yes |  | `NULL` | — |
| `phone` | `varchar(40)` | yes | IX | `NULL` | — |
| `line_id` | `varchar(80)` | yes |  | `NULL` | — |
| `birth_date` | `date` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `bookings.customer_id` · `cases.customer_id` · `custom_orders.customer_id` · `prescriptions.customer_id` · `sales.customer_id`

### `cases`

*ระบบหน้าร้าน · 21 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_code` | `varchar(40)` | no | UQ | — | — |
| `customer_id` | `int(10) unsigned` | no | IX | — | `customers.id` |
| `status` | `varchar(40)` | no | IX | `'reception'` | `case_statuses.code` |
| `is_new_customer` | `tinyint(1)` | no |  | `0` | — |
| `is_rush` | `tinyint(1)` | no |  | `0` | — |
| `priority_note` | `varchar(200)` | yes |  | `NULL` | — |
| `received_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `recorded_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `opened_at` | `datetime` | no |  | `current_timestamp()` | — |
| `closed_at` | `datetime` | yes |  | `NULL` | — |
| `cancelled_reason` | `varchar(255)` | yes |  | `NULL` | — |
| `reception_note` | `text` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |
| `referral_source` | `varchar(20)` | yes |  | `NULL` | — |
| `closed_by` | `int(10) unsigned` | yes |  | `NULL` | — |
| `case_type` | `varchar(40)` | yes |  | `NULL` | — |
| `referral_note` | `varchar(255)` | yes |  | `NULL` | — |

ถูกอ้างโดย: `bookings.case_id` · `booking_notes.case_id` · `case_events.case_id` · `case_photos.case_id` · `case_processes.case_id` · `centerings.case_id` · `customer_notifications.case_id` · `custom_orders.case_id` · `frame_fittings.case_id` · `lens_jobs.case_id` · `payments.case_id` · `prescriptions.case_id` · `production_jobs.case_id` · `production_withdrawals.case_id` · `qc_checks.case_id`

### `case_events`

*ระบบหน้าร้าน · 419 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `bigint(20) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | IX | — | `cases.id` |
| `from_status` | `varchar(40)` | yes |  | `NULL` | — |
| `to_status` | `varchar(40)` | yes |  | `NULL` | — |
| `action` | `varchar(60)` | no |  | — | — |
| `entity` | `varchar(40)` | yes |  | `NULL` | — |
| `entity_id` | `int(10) unsigned` | yes |  | `NULL` | — |
| `employee_id` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `note` | `text` | yes |  | `NULL` | — |
| `payload` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

### `case_photos`

*ระบบหน้าร้าน · 0 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | IX | — | `cases.id` |
| `centering_id` | `int(10) unsigned` | yes | IX | `NULL` | `centerings.id` |
| `payment_id` | `int(10) unsigned` | yes | IX | `NULL` | `payments.id` |
| `kind` | `varchar(30)` | no |  | `'centering'` | — |
| `file_name` | `varchar(200)` | no |  | — | — |
| `original_name` | `varchar(255)` | yes |  | `NULL` | — |
| `mime_type` | `varchar(80)` | yes |  | `NULL` | — |
| `file_size` | `int(10) unsigned` | yes |  | `NULL` | — |
| `caption` | `varchar(255)` | yes |  | `NULL` | — |
| `taken_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

### `case_processes`

*ระบบหน้าร้าน · 8 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | IX | — | `cases.id` |
| `process` | `varchar(20)` | no |  | — | — |
| `status` | `varchar(20)` | no |  | `'not_started'` | — |
| `started_at` | `datetime` | yes |  | `NULL` | — |
| `completed_at` | `datetime` | yes |  | `NULL` | — |
| `note` | `varchar(500)` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

### `case_statuses`

*ระบบหน้าร้าน · 32 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `code` | `varchar(40)` | no | PK | — | — |
| `stage_no` | `varchar(4)` | no |  | — | — |
| `label_th` | `varchar(80)` | no |  | — | — |
| `label_en` | `varchar(80)` | no |  | — | — |
| `stage_group` | `varchar(20)` | no |  | — | — |
| `sort_order` | `smallint(6)` | no | IX | — | — |
| `is_waiting` | `tinyint(1)` | no |  | `0` | — |
| `is_terminal` | `tinyint(1)` | no |  | `0` | — |

ถูกอ้างโดย: `cases.status`

### `customer_notifications`

*ระบบหน้าร้าน · 2 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | IX | — | `cases.id` |
| `channel` | `varchar(30)` | no |  | `'phone'` | — |
| `contacted_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `contacted_at` | `datetime` | no |  | `current_timestamp()` | — |
| `result` | `varchar(30)` | no |  | `'reached'` | — |
| `note` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

### `notification_log`

*ระบบหน้าร้าน · 55 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `channel` | `varchar(20)` | no |  | `'telegram'` | — |
| `kind` | `varchar(40)` | no |  | `'booking_reminder'` | — |
| `booking_id` | `int(10) unsigned` | yes | IX | `NULL` | `bookings.id` |
| `target` | `varchar(120)` | yes |  | `NULL` | — |
| `message` | `text` | yes |  | `NULL` | — |
| `ok` | `tinyint(1)` | no |  | `0` | — |
| `error` | `varchar(255)` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no | IX | `current_timestamp()` | — |

## นัดหมายและคิว


### `bookings`

*ระบบหน้าร้าน · 5 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `booking_code` | `varchar(40)` | no | UQ | — | — |
| `customer_id` | `int(10) unsigned` | yes | IX | `NULL` | `customers.id` |
| `case_id` | `int(10) unsigned` | yes | IX | `NULL` | `cases.id` |
| `first_name` | `varchar(100)` | yes |  | `NULL` | — |
| `last_name` | `varchar(100)` | yes |  | `NULL` | — |
| `phone` | `varchar(40)` | yes |  | `NULL` | — |
| `line_id` | `varchar(80)` | yes |  | `NULL` | — |
| `booking_date` | `date` | no | IX | — | — |
| `booking_time` | `time` | no |  | — | — |
| `duration_min` | `smallint(6)` | no |  | `30` | — |
| `service_type` | `varchar(60)` | no |  | `'eye_exam'` | — |
| `channel` | `varchar(30)` | no |  | `'phone'` | — |
| `status` | `varchar(20)` | no | IX | `'booked'` | — |
| `assigned_to` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `reminder_minutes` | `smallint(6)` | no |  | `10` | — |
| `reminder_sent_at` | `datetime` | yes | IX | `NULL` | — |
| `confirmed_at` | `datetime` | yes |  | `NULL` | — |
| `arrived_at` | `datetime` | yes |  | `NULL` | — |
| `cancelled_reason` | `varchar(255)` | yes |  | `NULL` | — |
| `intake_note` | `text` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `booking_notes.booking_id` · `notification_log.booking_id`

### `booking_notes`

*ระบบหน้าร้าน · 0 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `booking_id` | `int(10) unsigned` | no | IX | — | `bookings.id` |
| `case_id` | `int(10) unsigned` | yes | IX | `NULL` | `cases.id` |
| `step` | `varchar(40)` | no |  | `'intake'` | — |
| `question` | `varchar(200)` | yes |  | `NULL` | — |
| `note` | `text` | no |  | — | — |
| `recorded_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

## ค่าสายตาและงานเลนส์


### `prescriptions`

*ระบบหน้าร้าน · 44 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | yes | IX | `NULL` | `cases.id` |
| `customer_id` | `int(10) unsigned` | no | IX | — | `customers.id` |
| `kind` | `enum('old','measured','final')` | no |  | `'measured'` | — |
| `source` | `varchar(30)` | yes |  | `NULL` | — |
| `based_on_id` | `int(10) unsigned` | yes | IX | `NULL` | `prescriptions.id` |
| `adjust_reason` | `text` | yes |  | `NULL` | — |
| `test_date` | `datetime` | no |  | `current_timestamp()` | — |
| `test_for` | `varchar(80)` | yes |  | `NULL` | — |
| `r_sphere` | `varchar(20)` | yes |  | `NULL` | — |
| `r_cylinder` | `varchar(20)` | yes |  | `NULL` | — |
| `r_axis` | `varchar(20)` | yes |  | `NULL` | — |
| `r_add` | `varchar(20)` | yes |  | `NULL` | — |
| `r_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `r_va` | `varchar(20)` | yes |  | `NULL` | — |
| `r_prism` | `varchar(20)` | yes |  | `NULL` | — |
| `r_base` | `varchar(20)` | yes |  | `NULL` | — |
| `l_sphere` | `varchar(20)` | yes |  | `NULL` | — |
| `l_cylinder` | `varchar(20)` | yes |  | `NULL` | — |
| `l_axis` | `varchar(20)` | yes |  | `NULL` | — |
| `l_add` | `varchar(20)` | yes |  | `NULL` | — |
| `l_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `l_va` | `varchar(20)` | yes |  | `NULL` | — |
| `l_prism` | `varchar(20)` | yes |  | `NULL` | — |
| `l_base` | `varchar(20)` | yes |  | `NULL` | — |
| `pd_total` | `varchar(20)` | yes |  | `NULL` | — |
| `bin_r_sphere` | `varchar(20)` | yes |  | `NULL` | — |
| `bin_r_add` | `varchar(20)` | yes |  | `NULL` | — |
| `bin_r_va` | `varchar(20)` | yes |  | `NULL` | — |
| `bin_r_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `bin_l_sphere` | `varchar(20)` | yes |  | `NULL` | — |
| `bin_l_add` | `varchar(20)` | yes |  | `NULL` | — |
| `bin_l_va` | `varchar(20)` | yes |  | `NULL` | — |
| `bin_l_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `old_glasses_type` | `varchar(20)` | yes |  | `NULL` | — |
| `dist_vertical_r` | `varchar(20)` | yes |  | `NULL` | — |
| `dist_vertical_l` | `varchar(20)` | yes |  | `NULL` | — |
| `dist_monitor_r` | `varchar(20)` | yes |  | `NULL` | — |
| `dist_monitor_l` | `varchar(20)` | yes |  | `NULL` | — |
| `health_cataract` | `tinyint(1)` | no |  | `0` | — |
| `health_eye_surgery` | `tinyint(1)` | no |  | `0` | — |
| `health_diabetes` | `tinyint(1)` | no |  | `0` | — |
| `health_bp` | `tinyint(1)` | no |  | `0` | — |
| `health_heart` | `tinyint(1)` | no |  | `0` | — |
| `health_note` | `varchar(255)` | yes |  | `NULL` | — |
| `known_from` | `varchar(40)` | yes |  | `NULL` | — |
| `exam_note` | `text` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `performed_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `recorded_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `confirmed_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `confirmed_at` | `datetime` | yes |  | `NULL` | — |
| `revision` | `smallint(6)` | no |  | `1` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |
| `va_naked_r` | `varchar(20)` | yes |  | `NULL` | — |
| `va_naked_l` | `varchar(20)` | yes |  | `NULL` | — |
| `old_r_sphere` | `varchar(20)` | yes |  | `NULL` | — |
| `old_l_sphere` | `varchar(20)` | yes |  | `NULL` | — |
| `old_r_add` | `varchar(20)` | yes |  | `NULL` | — |
| `old_l_add` | `varchar(20)` | yes |  | `NULL` | — |
| `old_r_va` | `varchar(20)` | yes |  | `NULL` | — |
| `old_l_va` | `varchar(20)` | yes |  | `NULL` | — |
| `old_r_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `old_l_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `old_r_cylinder` | `varchar(20)` | yes |  | `NULL` | — |
| `old_r_axis` | `varchar(20)` | yes |  | `NULL` | — |
| `old_l_cylinder` | `varchar(20)` | yes |  | `NULL` | — |
| `old_l_axis` | `varchar(20)` | yes |  | `NULL` | — |
| `health_eye_disease` | `tinyint(1)` | no |  | `0` | — |
| `health_drug_allergy` | `tinyint(1)` | no |  | `0` | — |
| `health_medication` | `tinyint(1)` | no |  | `0` | — |
| `external_place` | `varchar(120)` | yes |  | `NULL` | — |
| `external_date` | `date` | yes |  | `NULL` | — |

ถูกอ้างโดย: `custom_orders.final_prescription_id` · `prescriptions.based_on_id`

### `centerings`

*ระบบหน้าร้าน · 2 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | IX | — | `cases.id` |
| `order_id` | `int(10) unsigned` | yes | IX | `NULL` | `custom_orders.id` |
| `frame_product_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `r_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `l_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `pd_total` | `varchar(20)` | yes |  | `NULL` | — |
| `r_height` | `varchar(20)` | yes |  | `NULL` | — |
| `l_height` | `varchar(20)` | yes |  | `NULL` | — |
| `r_seg_height` | `varchar(20)` | yes |  | `NULL` | — |
| `l_seg_height` | `varchar(20)` | yes |  | `NULL` | — |
| `vertex_distance` | `varchar(20)` | yes |  | `NULL` | — |
| `pantoscopic_tilt` | `varchar(20)` | yes |  | `NULL` | — |
| `wrap_angle` | `varchar(20)` | yes |  | `NULL` | — |
| `center_point_note` | `text` | yes |  | `NULL` | — |
| `other_params` | `text` | yes |  | `NULL` | — |
| `performed_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `photo_taken_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `recorded_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `confirmed_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `confirmed_at` | `datetime` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `case_photos.centering_id`

### `frame_fittings`

*ระบบหน้าร้าน · 1 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | IX | — | `cases.id` |
| `order_id` | `int(10) unsigned` | yes | IX | `NULL` | `custom_orders.id` |
| `frame_size` | `varchar(60)` | yes |  | `NULL` | — |
| `lens_width` | `varchar(20)` | yes |  | `NULL` | — |
| `bridge_width` | `varchar(20)` | yes |  | `NULL` | — |
| `temple_length` | `varchar(20)` | yes |  | `NULL` | — |
| `ed` | `varchar(20)` | yes |  | `NULL` | — |
| `dbl` | `varchar(20)` | yes |  | `NULL` | — |
| `r_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `l_pd` | `varchar(20)` | yes |  | `NULL` | — |
| `r_height` | `varchar(20)` | yes |  | `NULL` | — |
| `l_height` | `varchar(20)` | yes |  | `NULL` | — |
| `fitting_data` | `text` | yes |  | `NULL` | — |
| `other_params` | `text` | yes |  | `NULL` | — |
| `performed_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `recorded_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `confirmed_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `confirmed_at` | `datetime` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |
| `frame_box_a` | `decimal(6,2)` | yes |  | `NULL` | — |
| `frame_box_b` | `decimal(6,2)` | yes |  | `NULL` | — |

### `lens_jobs`

*ระบบหน้าร้าน · 7 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | IX | — | `cases.id` |
| `order_id` | `int(10) unsigned` | yes | IX | `NULL` | `custom_orders.id` |
| `source` | `enum('stock','order')` | no |  | `'stock'` | — |
| `status` | `varchar(30)` | no | IX | `'waiting_picking'` | — |
| `left_lens_stock_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `right_lens_stock_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `rx_checked` | `tinyint(1)` | no |  | `0` | — |
| `lens_checked` | `tinyint(1)` | no |  | `0` | — |
| `picked_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `picked_at` | `datetime` | yes |  | `NULL` | — |
| `checked_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `supplier_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `supplier_order_no` | `varchar(80)` | yes |  | `NULL` | — |
| `order_date` | `date` | yes |  | `NULL` | — |
| `lead_time_days` | `smallint(6)` | yes |  | `NULL` | — |
| `expected_arrival` | `date` | yes |  | `NULL` | — |
| `original_eta` | `date` | yes |  | `NULL` | — |
| `follow_up_count` | `smallint(6)` | no |  | `0` | — |
| `received_at` | `datetime` | yes |  | `NULL` | — |
| `received_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `arrival_checked_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `recorded_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `lens_followups.lens_job_id`

### `lens_followups`

*ระบบหน้าร้าน · 1 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `lens_job_id` | `int(10) unsigned` | no | IX | — | `lens_jobs.id` |
| `seq` | `smallint(6)` | no |  | `1` | — |
| `contacted_at` | `datetime` | no |  | `current_timestamp()` | — |
| `contacted_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `channel` | `varchar(30)` | yes |  | `NULL` | — |
| `previous_eta` | `date` | yes |  | `NULL` | — |
| `new_eta` | `date` | yes |  | `NULL` | — |
| `affects_appointment` | `tinyint(1)` | no |  | `0` | — |
| `customer_notified` | `tinyint(1)` | no |  | `0` | — |
| `notified_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `new_appointment_date` | `date` | yes |  | `NULL` | — |
| `supplier_reply` | `text` | yes |  | `NULL` | — |
| `note` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

### `qc_checks`

*ระบบหน้าร้าน · 5 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | IX | — | `cases.id` |
| `job_id` | `int(10) unsigned` | yes | IX | `NULL` | `production_jobs.id` |
| `attempt` | `smallint(6)` | no |  | `1` | — |
| `result` | `enum('pass','fail')` | no |  | — | — |
| `action_taken` | `varchar(30)` | yes |  | `NULL` | — |
| `check_rx` | `tinyint(1)` | no |  | `0` | — |
| `check_centering` | `tinyint(1)` | no |  | `0` | — |
| `check_lens` | `tinyint(1)` | no |  | `0` | — |
| `check_frame` | `tinyint(1)` | no |  | `0` | — |
| `check_finish` | `tinyint(1)` | no |  | `0` | — |
| `defects` | `text` | yes |  | `NULL` | — |
| `note` | `text` | yes |  | `NULL` | — |
| `checked_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `checked_at` | `datetime` | no |  | `current_timestamp()` | — |
| `check_lens_od` | `tinyint(1)` | no |  | `0` | — |
| `check_lens_os` | `tinyint(1)` | no |  | `0` | — |

## ผลิตและเบิกของ


### `production_jobs`

*ระบบหน้าร้าน · 4 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | UQ | — | `cases.id` |
| `order_id` | `int(10) unsigned` | yes | IX | `NULL` | `custom_orders.id` |
| `matched_at` | `datetime` | yes |  | `NULL` | — |
| `matched_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `match_customer_ok` | `tinyint(1)` | no |  | `0` | — |
| `match_rx_ok` | `tinyint(1)` | no |  | `0` | — |
| `match_note` | `text` | yes |  | `NULL` | — |
| `assigned_technician` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `edging_started_at` | `datetime` | yes |  | `NULL` | — |
| `edging_finished_at` | `datetime` | yes |  | `NULL` | — |
| `edged_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `edging_remark` | `text` | yes |  | `NULL` | — |
| `pack_glasses` | `tinyint(1)` | no |  | `0` | — |
| `pack_case` | `tinyint(1)` | no |  | `0` | — |
| `pack_cloth` | `tinyint(1)` | no |  | `0` | — |
| `pack_warranty` | `tinyint(1)` | no |  | `0` | — |
| `pack_prescription` | `tinyint(1)` | no |  | `0` | — |
| `pack_accessories` | `tinyint(1)` | no |  | `0` | — |
| `packed_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `pack_checked_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `packed_at` | `datetime` | yes |  | `NULL` | — |
| `packing_note` | `text` | yes |  | `NULL` | — |
| `pickup_at` | `datetime` | yes |  | `NULL` | — |
| `handed_over_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `adjustment_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `adjustment_remark` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |
| `status` | `varchar(30)` | no |  | `'WAITING_FOR_ITEMS'` | — |
| `started_at` | `datetime` | yes |  | `NULL` | — |
| `started_by` | `int(10) unsigned` | yes |  | `NULL` | — |
| `received_by_customer_name` | `varchar(120)` | yes |  | `NULL` | — |

ถูกอ้างโดย: `production_withdrawals.production_job_id` · `qc_checks.job_id`

### `production_withdrawals`

*ระบบหน้าร้าน · 0 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | no | IX | — | `cases.id` |
| `production_job_id` | `int(10) unsigned` | yes | IX | `NULL` | `production_jobs.id` |
| `item_type` | `varchar(20)` | no |  | — | — |
| `stock_lot_id` | `int(10) unsigned` | yes | IX | `NULL` | `stock_lots.id` |
| `is_extra` | `tinyint(1)` | no |  | `0` | — |
| `reason` | `varchar(255)` | yes |  | `NULL` | — |
| `withdrawn_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `withdrawn_at` | `datetime` | no |  | `current_timestamp()` | — |

### `stock_requests`

*ระบบหน้าร้าน · 14 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `source` | `varchar(30)` | no | IX | — | — |
| `idem_key` | `varchar(120)` | no |  | — | — |
| `action` | `enum('ISSUE','SCRAP','RETURN')` | no |  | — | — |
| `sku` | `varchar(100)` | no | IX | — | — |
| `quantity` | `int(11)` | no |  | — | — |
| `actor_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `status` | `enum('pending','done','failed')` | no |  | `'pending'` | — |
| `response` | `longtext` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

### `product_locations`

*ระบบหน้าร้าน · 8 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `product_name` | `varchar(200)` | no | UQ | — | — |
| `location` | `varchar(100)` | no |  | — | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |

## ขายและการเงิน


### `sales`

*ระบบหน้าร้าน · 4 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `invoice_code` | `varchar(50)` | yes |  | `NULL` | — |
| `sale_date` | `datetime` | no | IX | `current_timestamp()` | — |
| `product_stock_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `customer_id` | `int(10) unsigned` | yes | IX | `NULL` | `customers.id` |
| `employee_id` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `price` | `decimal(12,2)` | no |  | `0.00` | — |
| `discount` | `decimal(12,2)` | no |  | `0.00` | — |
| `pay_type` | `varchar(30)` | yes |  | `NULL` | — |
| `marketing` | `varchar(50)` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

### `payments`

*ระบบหน้าร้าน · 9 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | yes | IX | `NULL` | `cases.id` |
| `order_id` | `int(10) unsigned` | yes | IX | `NULL` | `custom_orders.id` |
| `sale_id` | `int(10) unsigned` | yes |  | `NULL` | — |
| `kind` | `enum('deposit','partial','full','final')` | no |  | `'deposit'` | — |
| `method` | `varchar(30)` | no |  | `'Cash'` | — |
| `amount` | `decimal(12,2)` | no |  | — | — |
| `reference` | `varchar(120)` | yes |  | `NULL` | — |
| `received_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `paid_at` | `datetime` | no | IX | `current_timestamp()` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `cancelled_at` | `datetime` | yes |  | `NULL` | — |
| `cancelled_by` | `int(10) unsigned` | yes |  | `NULL` | — |
| `cancel_reason` | `varchar(255)` | yes |  | `NULL` | — |

ถูกอ้างโดย: `case_photos.payment_id`

### `incomes`

*ระบบหน้าร้าน · 2 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `cf_date` | `date` | no | IX | — | — |
| `income_type` | `varchar(80)` | yes |  | `NULL` | — |
| `branch` | `varchar(80)` | yes |  | `NULL` | — |
| `amount` | `decimal(12,2)` | no |  | `0.00` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

### `expenses`

*ระบบหน้าร้าน · 3 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `cf_date` | `date` | no | IX | — | — |
| `expense_type` | `varchar(80)` | yes |  | `NULL` | — |
| `branch` | `varchar(80)` | yes |  | `NULL` | — |
| `amount` | `decimal(12,2)` | no |  | `0.00` | — |
| `pay_type` | `varchar(30)` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

### `custom_orders`

*ระบบหน้าร้าน · 11 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `case_id` | `int(10) unsigned` | yes | IX | `NULL` | `cases.id` |
| `invoice_code` | `varchar(50)` | yes | UQ | `NULL` | — |
| `customer_id` | `int(10) unsigned` | no | IX | — | `customers.id` |
| `employee_id` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `recorded_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `final_prescription_id` | `int(10) unsigned` | yes | IX | `NULL` | `prescriptions.id` |
| `order_date` | `datetime` | no |  | `current_timestamp()` | — |
| `appointment_date` | `date` | yes |  | `NULL` | — |
| `appointment_time` | `time` | yes |  | `NULL` | — |
| `lens_type` | `varchar(50)` | yes |  | `NULL` | — |
| `frame_product_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `frame_name` | `varchar(200)` | yes |  | `NULL` | — |
| `frame_brand` | `varchar(100)` | yes |  | `NULL` | — |
| `frame_model` | `varchar(100)` | yes |  | `NULL` | — |
| `frame_color` | `varchar(80)` | yes |  | `NULL` | — |
| `frame_size` | `varchar(60)` | yes |  | `NULL` | — |
| `frame_sku` | `varchar(80)` | yes |  | `NULL` | — |
| `lens_product_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `right_lens_product_id` | `int(10) unsigned` | yes | IX | `NULL` | — |
| `lens_name` | `varchar(200)` | yes |  | `NULL` | — |
| `lens_brand` | `varchar(100)` | yes |  | `NULL` | — |
| `lens_design` | `varchar(80)` | yes |  | `NULL` | — |
| `lens_index` | `varchar(20)` | yes |  | `NULL` | — |
| `lens_coating` | `varchar(120)` | yes |  | `NULL` | — |
| `lens_tint` | `varchar(120)` | yes |  | `NULL` | — |
| `lens_addons` | `varchar(200)` | yes |  | `NULL` | — |
| `total_price` | `decimal(12,2)` | no |  | `0.00` | — |
| `discount` | `decimal(12,2)` | no |  | `0.00` | — |
| `deposit` | `decimal(12,2)` | no |  | `0.00` | — |
| `deposit_pay_type` | `varchar(30)` | yes |  | `NULL` | — |
| `marketing` | `varchar(50)` | yes |  | `NULL` | — |
| `confirmed_by` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `confirmed_at` | `datetime` | yes |  | `NULL` | — |
| `order_closed` | `tinyint(1)` | no | IX | `0` | — |
| `order_close_date` | `datetime` | yes | IX | `NULL` | — |
| `order_close_employee_id` | `int(10) unsigned` | yes | IX | `NULL` | `employees.id` |
| `order_close_income` | `decimal(12,2)` | yes |  | `NULL` | — |
| `order_close_pay_type` | `varchar(30)` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |
| `frame_price` | `decimal(10,2)` | no |  | `0.00` | — |
| `lens_od_price` | `decimal(10,2)` | no |  | `0.00` | — |
| `lens_os_price` | `decimal(10,2)` | no |  | `0.00` | — |
| `options_price` | `decimal(10,2)` | no |  | `0.00` | — |

ถูกอ้างโดย: `centerings.order_id` · `frame_fittings.order_id` · `lens_jobs.order_id` · `payments.order_id` · `production_jobs.order_id`

## สาขา


### `branches`

*ระบบหน้าร้าน · 3 แถว*

สาขาที่มาเบิกของจากคลังนี้

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `name` | `varchar(120)` | no | UQ | — | — |
| `contact` | `varchar(160)` | yes |  | `NULL` | — |
| `is_active` | `tinyint(1)` | no |  | `1` | — |
| `note` | `text` | yes |  | `NULL` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

### `branch_issues`

*ระบบหน้าร้าน · 8 แถว*

ของที่ออกไปให้สาขา ของออกวันหนึ่งเงินเข้าอีกวันหนึ่ง สถานะจึงแยกจากตัวการเคลื่อนไหว

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `branch_id` | `int(10) unsigned` | no | IX | — | — |
| `taken_by` | `varchar(120)` | no |  | — | — |
| `product_id` | `int(10) unsigned` | no | IX | — | — |
| `sku` | `varchar(100)` | no |  | — | — |
| `quantity` | `int(10) unsigned` | no |  | — | — |
| `cost_total` | `decimal(12,2)` | no |  | `0.00` | — |
| `cost_unknown_qty` | `int(10) unsigned` | no |  | `0` | — |
| `issued_at` | `datetime` | no |  | `current_timestamp()` | — |
| `issued_by` | `int(10) unsigned` | yes |  | `NULL` | — |
| `status` | `enum('pending','settled','written_off','cancelled')` | no | IX | `'pending'` | — |
| `settled_amount` | `decimal(12,2)` | yes |  | `NULL` | — |
| `settled_at` | `datetime` | yes |  | `NULL` | — |
| `settled_by` | `int(10) unsigned` | yes |  | `NULL` | — |
| `settled_note` | `text` | yes |  | `NULL` | — |
| `note` | `text` | yes |  | `NULL` | — |

## พนักงานและระบบ


### `employees`

*ระบบหน้าร้าน · 5 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned auto_increment` | no | PK | — | — |
| `employee_name` | `varchar(120)` | no | IX | — | — |
| `first_name` | `varchar(100)` | yes |  | `NULL` | — |
| `last_name` | `varchar(100)` | yes |  | `NULL` | — |
| `sex` | `varchar(20)` | yes |  | `NULL` | — |
| `birth_date` | `date` | yes |  | `NULL` | — |
| `roles` | `varchar(200)` | yes |  | `NULL` | — |
| `active` | `tinyint(1)` | no |  | `1` | — |
| `created_at` | `datetime` | no |  | `current_timestamp()` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

ถูกอ้างโดย: `bookings.assigned_to` · `bookings.created_by` · `booking_notes.recorded_by` · `cases.received_by` · `cases.recorded_by` · `case_events.employee_id` · `case_photos.taken_by` · `centerings.confirmed_by` · `centerings.performed_by` · `centerings.photo_taken_by` · `centerings.recorded_by` · `customer_notifications.contacted_by` · `custom_orders.confirmed_by` · `custom_orders.employee_id` · `custom_orders.order_close_employee_id` · `custom_orders.recorded_by` · `frame_fittings.confirmed_by` · `frame_fittings.performed_by` · `frame_fittings.recorded_by` · `lens_followups.contacted_by` · `lens_followups.notified_by` · `lens_jobs.arrival_checked_by` · `lens_jobs.checked_by` · `lens_jobs.picked_by` · `lens_jobs.received_by` · `lens_jobs.recorded_by` · `payments.received_by` · `prescriptions.confirmed_by` · `prescriptions.performed_by` · `prescriptions.recorded_by` · `production_jobs.adjustment_by` · `production_jobs.assigned_technician` · `production_jobs.edged_by` · `production_jobs.handed_over_by` · `production_jobs.matched_by` · `production_jobs.packed_by` · `production_jobs.pack_checked_by` · `production_withdrawals.withdrawn_by` · `qc_checks.checked_by` · `sales.employee_id`

### `app_settings`

*ระบบหน้าร้าน · 8 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `key` | `varchar(64)` | no | PK | — | — |
| `value` | `text` | yes |  | `NULL` | — |
| `updated_at` | `datetime on update current_timestamp()` | no |  | `current_timestamp()` | — |

### `schema_migrations`

*ระบบหน้าร้าน · 4 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `filename` | `varchar(160)` | no | PK | — | — |
| `applied_at` | `datetime` | no |  | `current_timestamp()` | — |

## ตารางค่าคงที่


### `list_len_type`

*ระบบหน้าร้าน · 6 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `code` | `varchar(50)` | no | PK | — | — |
| `label_th` | `varchar(80)` | no |  | — | — |
| `sort_order` | `tinyint(4)` | no |  | `0` | — |

### `list_marketing`

*ระบบหน้าร้าน · 5 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `code` | `varchar(50)` | no | PK | — | — |
| `label_th` | `varchar(80)` | no |  | — | — |
| `sort_order` | `tinyint(4)` | no |  | `0` | — |

### `list_pay_type`

*ระบบหน้าร้าน · 5 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `code` | `varchar(30)` | no | PK | — | — |
| `label_th` | `varchar(50)` | no |  | — | — |
| `sort_order` | `tinyint(4)` | no |  | `0` | — |

### `list_product_type`

*ระบบหน้าร้าน · 5 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `code` | `varchar(30)` | no | PK | — | — |
| `label_th` | `varchar(50)` | no |  | — | — |
| `sort_order` | `tinyint(4)` | no |  | `0` | — |

### `list_sex`

*ระบบหน้าร้าน · 3 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `code` | `varchar(20)` | no | PK | — | — |
| `label_th` | `varchar(50)` | no |  | — | — |
| `sort_order` | `tinyint(4)` | no |  | `0` | — |

## View

View อ่านอย่างเดียว เขียนไม่ได้ ใช้สำหรับหน้าจอที่ต้องรวมหลายตาราง

### `v_case_board`

*ระบบหน้าร้าน · 21 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned` | no |  | `0` | — |
| `case_code` | `varchar(40)` | no |  | — | — |
| `status` | `varchar(40)` | no |  | `'reception'` | — |
| `is_rush` | `tinyint(1)` | no |  | `0` | — |
| `opened_at` | `datetime` | no |  | `current_timestamp()` | — |
| `closed_at` | `datetime` | yes |  | `NULL` | — |
| `customer_id` | `int(10) unsigned` | no |  | — | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `stage_no` | `varchar(4)` | no |  | — | — |
| `status_label_th` | `varchar(80)` | no |  | — | — |
| `status_label_en` | `varchar(80)` | no |  | — | — |
| `stage_group` | `varchar(20)` | no |  | — | — |
| `status_order` | `smallint(6)` | no |  | — | — |
| `is_waiting` | `tinyint(1)` | no |  | `0` | — |
| `is_terminal` | `tinyint(1)` | no |  | `0` | — |
| `first_name` | `varchar(100)` | no |  | — | — |
| `last_name` | `varchar(100)` | yes |  | `NULL` | — |
| `phone` | `varchar(40)` | yes |  | `NULL` | — |
| `line_id` | `varchar(80)` | yes |  | `NULL` | — |
| `received_by_name` | `varchar(120)` | yes |  | — | — |
| `order_id` | `int(10) unsigned` | yes |  | `0` | — |
| `invoice_code` | `varchar(50)` | yes |  | `NULL` | — |
| `lens_type` | `varchar(50)` | yes |  | `NULL` | — |
| `frame_name` | `varchar(200)` | yes |  | `NULL` | — |
| `lens_name` | `varchar(200)` | yes |  | `NULL` | — |
| `appointment_date` | `date` | yes |  | `NULL` | — |
| `appointment_time` | `time` | yes |  | `NULL` | — |
| `total_price` | `decimal(12,2)` | yes |  | `0.00` | — |
| `discount` | `decimal(12,2)` | yes |  | `0.00` | — |
| `net_price` | `decimal(13,2)` | yes |  | `NULL` | — |
| `paid` | `decimal(34,2)` | yes |  | `NULL` | — |
| `balance` | `decimal(35,2)` | yes |  | `NULL` | — |
| `lens_source` | `enum('stock','order')` | yes |  | `'stock'` | — |
| `lens_status` | `varchar(30)` | yes |  | `'waiting_picking'` | — |
| `expected_arrival` | `date` | yes |  | `NULL` | — |
| `follow_up_count` | `smallint(6)` | yes |  | `0` | — |
| `age_days` | `bigint(21)` | yes |  | `NULL` | — |

### `v_lens_tracker`

*ระบบหน้าร้าน · 1 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned` | no |  | `0` | — |
| `case_id` | `int(10) unsigned` | no |  | — | — |
| `order_id` | `int(10) unsigned` | yes |  | `NULL` | — |
| `source` | `enum('stock','order')` | no |  | `'stock'` | — |
| `status` | `varchar(30)` | no |  | `'waiting_picking'` | — |
| `supplier_order_no` | `varchar(80)` | yes |  | `NULL` | — |
| `order_date` | `date` | yes |  | `NULL` | — |
| `lead_time_days` | `smallint(6)` | yes |  | `NULL` | — |
| `expected_arrival` | `date` | yes |  | `NULL` | — |
| `original_eta` | `date` | yes |  | `NULL` | — |
| `follow_up_count` | `smallint(6)` | no |  | `0` | — |
| `supplier_name` | `varchar(120)` | yes |  | — | — |
| `case_code` | `varchar(40)` | no |  | — | — |
| `is_rush` | `tinyint(1)` | no |  | `0` | — |
| `first_name` | `varchar(100)` | no |  | — | — |
| `last_name` | `varchar(100)` | yes |  | `NULL` | — |
| `phone` | `varchar(40)` | yes |  | `NULL` | — |
| `invoice_code` | `varchar(50)` | yes |  | `NULL` | — |
| `appointment_date` | `date` | yes |  | `NULL` | — |
| `lens_name` | `varchar(200)` | yes |  | `NULL` | — |
| `days_to_eta` | `int(7)` | yes |  | `NULL` | — |
| `risk_level` | `varchar(14)` | yes |  | `NULL` | — |
| `threatens_appointment` | `int(1)` | yes |  | `NULL` | — |

### `v_order_history`

*ระบบหน้าร้าน · 11 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned` | no |  | `0` | — |
| `case_id` | `int(10) unsigned` | yes |  | `NULL` | — |
| `invoice_code` | `varchar(50)` | yes |  | `NULL` | — |
| `order_date` | `datetime` | no |  | `current_timestamp()` | — |
| `appointment_date` | `date` | yes |  | `NULL` | — |
| `appointment_time` | `time` | yes |  | `NULL` | — |
| `order_close_date` | `datetime` | yes |  | `NULL` | — |
| `lens_name` | `varchar(200)` | yes |  | `NULL` | — |
| `frame_name` | `varchar(200)` | yes |  | `NULL` | — |
| `lens_type` | `varchar(50)` | yes |  | `NULL` | — |
| `total_price` | `decimal(12,2)` | no |  | `0.00` | — |
| `discount` | `decimal(12,2)` | no |  | `0.00` | — |
| `deposit` | `decimal(12,2)` | no |  | `0.00` | — |
| `deposit_pay_type` | `varchar(30)` | yes |  | `NULL` | — |
| `order_closed` | `tinyint(1)` | no |  | `0` | — |
| `order_close_income` | `decimal(12,2)` | yes |  | `NULL` | — |
| `order_close_pay_type` | `varchar(30)` | yes |  | `NULL` | — |
| `marketing` | `varchar(50)` | yes |  | `NULL` | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `customer_id` | `int(10) unsigned` | no |  | — | — |
| `final_prescription_id` | `int(10) unsigned` | yes |  | `NULL` | — |
| `net_price` | `decimal(13,2)` | no |  | `0.00` | — |
| `paid` | `decimal(34,2)` | yes |  | `NULL` | — |
| `balance` | `decimal(35,2)` | yes |  | `NULL` | — |
| `first_name` | `varchar(100)` | no |  | — | — |
| `last_name` | `varchar(100)` | yes |  | `NULL` | — |
| `phone` | `varchar(40)` | yes |  | `NULL` | — |
| `employee_name` | `varchar(120)` | yes |  | — | — |
| `close_employee_name` | `varchar(120)` | yes |  | — | — |
| `case_code` | `varchar(40)` | yes |  | — | — |
| `case_status` | `varchar(40)` | yes |  | `'reception'` | — |

### `v_orders_unclosed`

*ระบบหน้าร้าน · 4 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned` | no |  | `0` | — |
| `invoice_code` | `varchar(50)` | yes |  | `NULL` | — |
| `order_date` | `datetime` | no |  | `current_timestamp()` | — |
| `appointment_date` | `date` | yes |  | `NULL` | — |
| `lens_name` | `varchar(200)` | yes |  | `NULL` | — |
| `frame_name` | `varchar(200)` | yes |  | `NULL` | — |
| `total_price` | `decimal(12,2)` | no |  | `0.00` | — |
| `discount` | `decimal(12,2)` | no |  | `0.00` | — |
| `deposit` | `decimal(12,2)` | no |  | `0.00` | — |
| `balance` | `decimal(14,2)` | no |  | `0.00` | — |
| `first_name` | `varchar(100)` | no |  | — | — |
| `last_name` | `varchar(100)` | yes |  | `NULL` | — |
| `employee_name` | `varchar(120)` | yes |  | — | — |

### `v_orders_unfilled`

*ระบบหน้าร้าน · 6 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned` | no |  | `0` | — |
| `invoice_code` | `varchar(50)` | yes |  | `NULL` | — |
| `order_date` | `datetime` | no |  | `current_timestamp()` | — |
| `appointment_date` | `date` | yes |  | `NULL` | — |
| `lens_name` | `varchar(200)` | yes |  | `NULL` | — |
| `frame_name` | `varchar(200)` | yes |  | `NULL` | — |
| `total_price` | `decimal(12,2)` | no |  | `0.00` | — |
| `deposit` | `decimal(12,2)` | no |  | `0.00` | — |
| `first_name` | `varchar(100)` | no |  | — | — |
| `last_name` | `varchar(100)` | yes |  | `NULL` | — |
| `employee_name` | `varchar(120)` | yes |  | — | — |
| `lens_product_id` | `int(10) unsigned` | yes |  | `NULL` | — |
| `right_lens_product_id` | `int(10) unsigned` | yes |  | `NULL` | — |
| `frame_product_id` | `int(10) unsigned` | yes |  | `NULL` | — |

### `v_stock_lot`

*ระบบหน้าร้าน · 52 แถว*

| คอลัมน์ | ชนิด | Null | คีย์ | ค่าเริ่มต้น | อ้างถึง |
| --- | --- | --- | --- | --- | --- |
| `id` | `int(10) unsigned` | no |  | `0` | — |
| `product_id` | `int(10) unsigned` | no |  | `0` | — |
| `product_type` | `varchar(30)` | no |  | — | — |
| `product_name` | `varchar(255)` | no |  | — | — |
| `brand` | `varchar(120)` | yes |  | `NULL` | — |
| `brand_name` | `varchar(120)` | yes |  | `NULL` | — |
| `sku` | `varchar(100)` | no |  | — | — |
| `model` | `longtext` | yes |  | `NULL` | — |
| `color` | `longtext` | yes |  | `NULL` | — |
| `size` | `longtext` | yes |  | `NULL` | — |
| `lens_design` | `longtext` | yes |  | `NULL` | — |
| `lens_index` | `longtext` | yes |  | `NULL` | — |
| `coating` | `longtext` | yes |  | `NULL` | — |
| `tint` | `longtext` | yes |  | `NULL` | — |
| `addons` | `longtext` | yes |  | `NULL` | — |
| `product_line` | `longtext` | yes |  | `NULL` | — |
| `vendor_name` | `longtext` | yes |  | `NULL` | — |
| `product_price` | `decimal(12,2)` | no |  | `0.00` | — |
| `product_expense` | `decimal(12,2)` | yes |  | `NULL` | — |
| `supplier_id` | `int(10) unsigned` | yes |  | `NULL` | — |
| `stock_date` | `date` | no |  | — | — |
| `notes` | `text` | yes |  | `NULL` | — |
| `initial_qty` | `int(10) unsigned` | no |  | `1` | — |
| `remaining_qty` | `int(10) unsigned` | no |  | `1` | — |
| `sold` | `int(1)` | no |  | `0` | — |
