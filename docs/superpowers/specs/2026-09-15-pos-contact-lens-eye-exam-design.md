# ขายคอนแทคเลนส์ใน POS พร้อมวัดสายตา (Eye Exam เดิม) — Design

> **ยกเลิกแล้ว — ห้ามใช้ฉบับนี้** (16 ก.ย. 2026)
> ผู้ใช้ตัดการเปลี่ยน schema ออกทั้งหมด (ไม่เอาตาราง `eye_exams`, ไม่เอาคอลัมน์ใหม่)
> และสั่งห้ามแตะ Process หลัก / Test For / Lookup
> ใช้ฉบับแทนที่: `2026-09-16-pos-contact-lens-eye-exam-design.md`
> เก็บไฟล์นี้ไว้เป็นบันทึกว่าเคยพิจารณาทางไหนไปแล้วบ้างเท่านั้น

วันที่: 2026-09-15 · สถานะ: **ยกเลิก — ถูกแทนที่แล้ว**

รายงานวิเคราะห์ฉบับเต็ม (ของจริงจากโค้ด + DB production): https://claude.ai/artifact/9oH452ACh59R2yiecjKV3T

## 1. เป้าหมาย

- ขายคอนแทคเลนส์เป็นส่วนหนึ่งของ POS โดยตรง เลขอ้างอิงหลักคือ `POS-2026-xxxxx` ไม่สร้าง `CASE-…` สำหรับการขายนี้
- ใช้ระบบวัดสายตาเดิม (ตาราง `prescriptions` + `ExamPanel`) ไม่สร้างระบบวัดสายตาใหม่
- ค่าสายตาเป็นประวัติของ **ลูกค้า** ย้อนดูได้จากหน้าลูกค้าไม่ว่าจะวัดจากเคสตัดแว่น เคสตรวจสายตา หรือ POS
- บิล POS ที่เป็นคอนแทคเลนส์อ้างอิงได้ว่าใช้ค่าสายตาใบไหน วันที่วัดเท่าไร
- ขายคอนแทคเลนส์ **แยกข้างซ้าย / ขวาได้** ต่อกล่อง
- ค่าของกล่องคอนแทคเลนส์ **พนักงานกรอกเอง** ระบบแสดง Final Rx เป็นข้อมูลอ้างอิงเท่านั้น ไม่เติมให้อัตโนมัติ

แนวคิดประเภทงาน:

| งาน | เอกสาร |
|---|---|
| ตัดแว่น | CASE |
| ตรวจสายตาอย่างเดียว | CASE |
| ขายคอนแทคเลนส์ | POS (+ Eye Exam ถ้าวัด) |
| ขายสินค้าทั่วไป | POS |

## 2. ไม่อยู่ในขอบเขตรอบนี้

- รูปถ่ายตอนวัดสายตาที่ POS (API แนบรูปผูกกับเคสเท่านั้น) — ซ่อนกล่องรูปในโหมดไม่มีเคส
- พิมพ์ค่าสายตาบนใบเสร็จ POS (ใบเสร็จไม่อ่าน `item_meta` อยู่แล้ว คงเดิม)
- เคส "ตรวจสายตาอย่างเดียว" แบบขั้นตอนสั้น + ปุ่มปิดเคส — ทำเป็น spec แยกหลังงานนี้
- บิลร่างฝั่ง server, การตัดสต็อกคอนแทคเลนส์ (POS ไม่ตัดสต็อกอยู่แล้ว)
- backfill รอบวัดของเคสเดิมเป็น `eye_exams`

## 3. สภาพปัจจุบันที่ออกแบบทับ (สรุป)

- `prescriptions.case_id` NULL ได้, `customer_id` NOT NULL · API สร้างแถวไม่มีเคสได้ · 8,401/8,485 แถวไม่มีเคส (ข้อมูล Access)
- ไม่มีตารางรอบวัด — `examSessions()` (`api/routes/prescriptions.php:197-268`) จัดกลุ่มด้วย `case_id` ถ้าไม่มีเคส 1 แถว = 1 รอบ
- `ExamPanel` อยู่ได้เฉพาะใน `ProcessShell` ของหน้าเคส (ปุ่มบันทึก/ยืนยันมาจาก shell)
- `caseDetail()` (`api/routes/cases.php:377-384`) ดึงแถวไม่ผูกเคสของลูกค้ามาด้วย และ `processMissing()` ถือว่ามี final = วัดสายตาเสร็จ → **Final ที่วัดจาก POS จะรั่วเข้าเคสตัดแว่น ถ้าไม่กัน**
- POS: ตะกร้าอยู่ใน React state (หายเมื่อออกจากหน้า) · ไม่มี draft · หน้า POS ไม่มีตัวเลือกลูกค้า (API รับ `customer_id` แต่ UI ไม่ส่ง) · คอนแทคเลนส์ระบุด้วย `pos_fields` ที่มี key `power` · ค่าสายตาเก็บใน `pos_sale_items.item_meta` เป็นข้อความเดียว ไม่แยกข้าง

## 4. การตัดสินใจหลัก — ทาง D

1. **POS อ้างอิงใบ Final Rx โดยตรง**: `pos_sales.final_prescription_id` → `prescriptions.id` (รูปแบบเดียวกับ `custom_orders.final_prescription_id`)
   - ครอบคลุมทั้ง "ใช้ผลวัดล่าสุด" (Final จากเคสตัดแว่นก็ได้) และ "วัดใหม่ที่ POS"
2. **ตารางรอบวัดเล็ก ๆ สำหรับการวัดที่ไม่มีเคส**: `eye_exams` + `prescriptions.exam_id`
   - แถวหนึ่งมี `case_id` หรือ `exam_id` อย่างใดอย่างหนึ่ง (หรือไม่มีเลย = ข้อมูลเก่า)
   - รอบวัดของเคสยังจัดกลุ่มด้วย `case_id` เหมือนเดิม
3. **ไม่ใช้** `source_type/source_id` (ไม่มี FK, ตอนวัดยังไม่มีบิลให้ชี้) และ **ไม่ใช้** ตารางกลาง POS↔Exam (บิลหนึ่งใช้ Final ≤ 1 ใบ)
4. **รักษาตะกร้าด้วย `sessionStorage`** ต่อแท็บ ไม่ทำบิลร่างใน DB
5. **หน้าวัดสายตาแยก** `/exam/session/` ใช้ `ExamPanel` เดิมในโหมดไม่มีเคส — หน้า POS ไม่ import ExamPanel
6. **ข้างของกล่อง** เป็น `pos_fields` แบบตัวเลือก — แยกแถวในตะกร้าได้เองเพราะ `cart.js` แยกแถวเมื่อ `item_meta` ต่างกัน

## 5. Database

ทั้งหมดเพิ่มอย่างเดียว คอลัมน์ใหม่ NULL ได้ ไม่แก้แถวเดิม

### 5.1 `api/services/Migrate.php`

```sql
CREATE TABLE IF NOT EXISTS eye_exams (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT UNSIGNED NOT NULL,
  origin       VARCHAR(20)  NOT NULL DEFAULT 'pos',
  performed_by INT UNSIGNED NULL,
  exam_date    DATETIME     NOT NULL,
  created_by   INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_exam_customer (customer_id, exam_date),
  CONSTRAINT fk_exam_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_exam_performed FOREIGN KEY (performed_by) REFERENCES employees(id) ON DELETE SET NULL
);

ALTER TABLE prescriptions
  ADD COLUMN exam_id INT UNSIGNED NULL AFTER case_id,
  ADD KEY idx_rx_exam (exam_id, kind),
  ADD CONSTRAINT fk_rx_exam FOREIGN KEY (exam_id) REFERENCES eye_exams(id) ON DELETE SET NULL;
```

(ใช้รูปแบบตรวจ `information_schema` ก่อนเพิ่มคอลัมน์ ตามที่ Migrate.php ทำอยู่)

### 5.2 `stock/api/migrations/037_pos_sale_rx.sql`

```sql
ALTER TABLE pos_sales
  ADD COLUMN final_prescription_id INT UNSIGNED NULL AFTER customer_id,
  ADD KEY idx_pos_sales_rx (final_prescription_id),
  ADD CONSTRAINT fk_pos_sales_rx FOREIGN KEY (final_prescription_id) REFERENCES prescriptions(id) ON DELETE SET NULL;

-- ข้างของกล่อง: ใส่ช่อง eye ก่อน power ให้คอนแทคเลนส์ทุกรายการ (group_code LIKE 'PosCtl%')
-- Maxim color คงช่อง color ไว้
```

นิยามช่องใหม่ใน `pos_fields`:

```json
{"key":"eye","label":"ข้าง","type":"choice","required":true,
 "options":[["R","ขวา (R)"],["L","ซ้าย (L)"],["RL","ทั้งสองข้าง"]]}
```

- `type` ไม่ระบุ = ช่องข้อความแบบเดิม (ของเดิมไม่ต้องแก้)
- "ทั้งสองข้าง" ไว้สำหรับกล่องที่ใช้ค่าเดียวกันสองตา
- migration อัปเดตข้อมูล `pos_items` แบบ idempotent (ใส่ `eye` เฉพาะรายการที่ยังไม่มี)

## 6. API

| Route | การเปลี่ยนแปลง |
|---|---|
| `POST /api/eye-exams` (ใหม่) | body `{customer_id, performed_by?}` → สร้างรอบ `origin='pos'` · สิทธิ์ `frontdesk.use` |
| `GET /api/eye-exams/:id` (ใหม่) | รอบ + ชื่อลูกค้า + แถว `prescriptions` ของรอบ (old/measured/final) |
| `GET /api/customers/:id/latest-final-rx` (ใหม่) | Final ที่ยืนยันแล้วล่าสุด 1 แถว (`kind='final' AND confirmed_at IS NOT NULL ORDER BY test_date DESC, id DESC LIMIT 1`) + ที่มา: `case_code` หรือ `exam_id` · ไม่มี = `null` |
| `POST /api/prescriptions` | รับ `exam_id` · ถ้ามี: รอบต้องมีอยู่, `eye_exams.customer_id` = `customer_id` ของแถว, ห้ามมี `case_id` ด้วย |
| `PUT /api/prescriptions/:id` | เพิ่ม `exam_id` ในชุดคอลัมน์ · กติกาเดียวกับ POST |
| `examSessions()` | key จัดกลุ่ม: `exam-{exam_id}` → `case-{case_id}` → `rx-{id}` · รอบ exam ส่ง `exam_id` และเลข POS ที่อ้างอิง (ถ้ามี) |
| `caseDetail()` | แถวไม่ผูกเคสที่ดึงมาต้องเป็น `p.exam_id IS NULL` เท่านั้น (กันการรั่ว) |
| `POST /api/pos/sales` | รับ `customer_id` (มีอยู่แล้ว) + `final_prescription_id` (ไม่บังคับ) · ถ้ามี rx: ต้องมี `customer_id`, แถวต้อง `kind='final'` + ยืนยันแล้ว + `customer_id` ตรงกัน · ตรวจช่อง `type=choice` ว่าค่าอยู่ใน `options` |
| `posSaleFull()` | ถ้า `final_prescription_id` ไม่ว่าง แนบ `rx` (1 query ด้วย PK: ค่า R/L, `test_date`, `case_id`/`case_code`, `exam_id`) |
| `GET /api/pos/sales` | ไม่แก้ query (`s.*` มีคอลัมน์ใหม่เอง) |

ไม่ส่ง `customer_id`/`final_prescription_id` = พฤติกรรมเดิม 100%

## 7. Frontend

### 7.1 หน้า POS `app/(frontdesk)/pos/page.jsx`

- ห่อด้วย `QueryParamPage` (เริ่มอ่าน `?rx=`)
- **ตัวเลือกลูกค้า** (ไม่บังคับ) ใช้ `Picker` + `/api/customers` — ช่องชื่อ/เบอร์พิมพ์เองยังอยู่ · เลือกลูกค้าแล้วเติม snapshot ชื่อ/เบอร์ให้
- **แผง "ข้อมูลสายตาสำหรับคอนแทคเลนส์"** แสดงเมื่อตะกร้ามีรายการที่ `pos_fields` มี key `power`
  - ยังไม่เลือกลูกค้า → ข้อความ "เลือกลูกค้าเพื่อใช้ค่าสายตา" (ขายต่อได้โดยไม่แนบ)
  - เลือกแล้ว → โหลด `latest-final-rx` ครั้งเดียวต่อลูกค้า
  - ปุ่ม **ใช้ผลวัดนี้** (แนบ `final_prescription_id`) · **วัดสายตาใหม่** · **ไม่แนบค่าสายตา**
  - แนบแล้ว: ตาราง OD/OS ย่อ + วันที่วัด + ที่มา + ปุ่มเปลี่ยน
- **แต่ละกล่องคอนแทคเลนส์**: ช่อง "ข้าง" (ปุ่มเลือก R / L / ทั้งสองข้าง) + ช่อง "ค่าสายตา" กรอกเอง · ถ้ามี rx แนบอยู่ แสดงค่า SPH/CYL/AX ของข้างที่เลือกเป็นข้อความอ้างอิงใต้ช่อง
- `CartItemRow`: รองรับ `type: 'choice'` (กลุ่มปุ่ม, มีป้ายและขนาดแตะผ่าน e2e) — ช่องแบบเดิมเป็น input เหมือนเดิม
- `ConfirmSaleModal`: แสดง "ขวา (R) · -2.50" แทนค่าเปล่า

### 7.2 Draft ตะกร้า `lib/pos/draft.js` (ใหม่, pure + unit test)

- เก็บ `{v:1, savedAt, client_ref, saleDate, items, form, customer, rx}` ที่ `sessionStorage['pos-draft']`
- บันทึกทุกครั้งที่ตะกร้า/ฟอร์มเปลี่ยน · กู้คืนตอนเปิดหน้า POS ถ้าอายุไม่เกิน 12 ชม.
- ล้างเมื่อบันทึกบิลสำเร็จ หรือกด "เริ่มบิลใหม่"
- ครอบด้วย try/catch — storage ใช้ไม่ได้ POS ยังทำงานแบบเดิม
- `client_ref` เดิมถูกกู้ด้วย จึงยังกันบิลซ้ำได้

### 7.3 หน้าวัดสายตาไม่มีเคส `app/(frontdesk)/exam/session/page.jsx` (ใหม่)

- `?id=<exam_id>&return=pos`
- โหลด `GET /api/eye-exams/:id` → สร้าง host object `{ id: null, exam_id, customer_id, first_name, last_name, prescriptions, centering: null }`
- ให้ `ProcessActions` provider ของหน้าเอง + แถบปุ่ม **บันทึก Draft** / **ยืนยันผลวัดสายตา**
- ยืนยันสำเร็จ → ถ้า `return=pos` ไป `/pos/?rx=<final_id>` · ปุ่ม "กลับหน้า POS" ยกเลิกกลางทางได้ ตะกร้ายังอยู่

### 7.4 `ExamPanel.jsx` — เพิ่มโหมดไม่มีเคส (โหมดเคสต้องเหมือนเดิมทุก request)

- เลือกแถวของรอบ: `c.id ? case_id === c.id : exam_id === c.exam_id`
- save body: โหมดเคสส่ง `case_id` เหมือนเดิม · โหมด exam ส่ง `exam_id`
- ข้ามการเรียก `/processes/exam/start` เมื่อไม่มีเคส
- สถานะล็อกเมื่อไม่มีเคส: อ่าน `finalRow.confirmed_at`
- ซ่อน PD จาก centering, กล่องรูป, ข้อความ "เคสนี้"

### 7.5 แสดงผลอื่น

- `pos/detail`: การ์ด "ค่าสายตาที่ใช้" (OD/OS, วันที่วัด, ลิงก์ไปเคส `step=exam` หรือ `/exam/session/?id=`) · รายการสินค้าแสดงป้ายช่อง ("ข้าง: ขวา (R) · ค่าสายตา: -2.50")
- `ExamHistory` (หน้าลูกค้า): รอบจาก POS แสดง "วัดที่ POS · POS-2026-xxxxx" และลิงก์เปิดรอบ
- `print/prescription`: ใช้ชื่อจากแถวค่าสายตาเมื่อไม่มีเคส (แก้ NAME "—")
- `lib/manual.js` ส่วน POS: ขั้นตอนคอนแทคเลนส์ + วัดสายตา

## 8. Flow

```
POS เพิ่มคอนแทคเลนส์ → (เลือกลูกค้า) → แผงข้อมูลสายตา
  ├─ ใช้ผลวัดล่าสุด → แนบ final_prescription_id
  ├─ วัดสายตาใหม่ → บันทึก draft → POST /api/eye-exams
  │     → /exam/session/?id=…&return=pos → ExamPanel เดิม → ยืนยัน
  │     → /pos/?rx=FINAL_ID → กู้ draft + แนบ rx
  └─ ไม่แนบ
→ กรอกข้าง + ค่าสายตาต่อกล่อง → รับเงิน → POST /api/pos/sales → ล้าง draft
```

รอบวัดที่ลูกค้าไม่ซื้อ ยังเป็นประวัติสายตาของลูกค้าตามปกติ

## 9. ผลกระทบและการกัน

- **POS ทั่วไป**: ไม่ต้องเลือกลูกค้า ไม่เห็นแผงค่าสายตา · API เดิมผ่าน `80-pos-items` ทั้งหมด
- **เคสตัดแว่น**: flow 6 ขั้นไม่เปลี่ยน · `caseDetail` กัน `exam_id` · ExamPanel โหมดเคสส่ง body เดิม (ตรวจด้วย e2e ก่อน/หลัง)
- **เปลี่ยนลูกค้าของเคส**: ย้ายเฉพาะแถวที่ผูกเคส รอบ POS ไม่ย้าย (ถูกต้อง)
- **Performance**: ประวัติ POS ไม่เพิ่ม query · detail +1 PK lookup เฉพาะบิลที่แนบ rx · หน้า POS +1 query เฉพาะมีคอนแทคเลนส์และเลือกลูกค้า · ExamPanel ไม่อยู่ใน bundle POS
- **CSS**: ใส่ `pos/pos.css` หรือ globals ไฟล์เดียว ไม่แยกชื่อไฟล์ CSS ต่อหน้า

## 10. การทดสอบ

- API (PHP, `api/tests`): eye-exams create/get + สิทธิ์ · prescriptions `exam_id` (ลูกค้าไม่ตรง / มีทั้ง case+exam = 400) · `examSessions` จัดกลุ่มรอบ exam เป็นรอบเดียว · `caseDetail` ไม่ดึงแถว exam และขั้นวัดสายตาของเคสไม่ขึ้นเสร็จจาก Final ของ POS · `latest-final-rx` · POS create กับ rx (ลูกค้าไม่ตรง / ไม่ใช่ final / ไม่ยืนยัน = 400; ไม่ส่ง = เหมือนเดิม) · ช่อง choice ค่าไม่อยู่ใน options = 400 · `posSaleFull` แนบ rx
- Lib (node --test): `lib/pos/draft.js` (save/restore/expire/storage พัง) · helper ค่าอ้างอิงตามข้าง
- E2E (Playwright, mock API): บิลทั่วไปไม่เปลี่ยน · คอนแทคเลนส์ R/L แยกแถว · ใช้ผลวัดล่าสุด · ไปวัดสายตาแล้วกลับมาตะกร้าครบ · ExamPanel ในเคสส่ง request เดิม · `buttons.spec` / `mobile.spec` ผ่าน

## 11. ลำดับงาน (รายละเอียดใน implementation plan)

1. เทสต์ baseline ของเดิม (examSessions, caseDetail, processMissing, e2e ขั้นวัดสายตาในเคส)
2. DB + API รอบวัด + กันการรั่วใน `caseDetail`
3. POS API (`final_prescription_id`, ช่อง choice, `posSaleFull`) + migration 037
4. ExamPanel โหมดไม่มีเคส + หน้า `/exam/session/`
5. หน้า POS (ลูกค้า, แผงค่าสายตา, ช่องข้าง, draft, กลับจากหน้าวัด)
6. แสดงผล (pos/detail, ExamHistory, print/prescription, manual)

Deploy ทีละขั้น: migration (dry-run) → API → หน้าเว็บ ตามวิธีเทียบ chunk + md5 guard เดิม · `/cases/detail/`, `/customers/detail/` มี session อื่นแก้บ่อย ต้องเช็กก่อนขึ้น
