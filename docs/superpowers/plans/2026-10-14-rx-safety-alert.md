# Prescription Safety Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มระบบแจ้งเตือนค่าสายตา (INFO / WARNING / CRITICAL) ในขั้นวัดสายตา + บันทึก Clinical Review + ตั้งค่าเกณฑ์แบบมีเวอร์ชัน โดยไม่แก้โลจิกเดิม

**Architecture:** ตัวคำนวณล้วน 2 ชุด (JS สำหรับ UI ทันที, PHP สำหรับบันทึก audit จากค่าในฐานข้อมูล) ใช้ fixture กรณีทดสอบไฟล์เดียวกัน · ตารางใหม่ 2 ตาราง (append-only) · endpoint ใหม่ 3 เส้นใน route file ใหม่ · UI เป็น component ใหม่ที่เสียบเข้า ExamPanel 3 จุด และหน้า settings 1 จุด

**Tech Stack:** PHP 8.4 (WinGet) + MariaDB/MySQL · Next.js (React, JSX) · `node --test` · harness PHP ของโปรเจกต์ (`api/tests/run.php`) · Playwright

**Spec:** `docs/superpowers/specs/2026-10-14-rx-safety-alert-design.md`

## Global Constraints

- ห้ามแก้/ลบบรรทัดโค้ดเดิม — เพิ่มอย่างเดียว (spec ข้อ 2.6, 11) · `/api/prescriptions/:id/confirm`, `saveDraft`, ตารางเทียบเดิม, `normCyl`/`RX_NORMALIZE`, `FINAL_REQUIRED` คงเดิม
- ช่องว่าง/NULL = missing ห้ามแทนด้วย 0 · `0`, `0.00`, `plano` = 0
- CYL ว่าง + AXIS ว่าง = เลนส์ทรงกลม (CYL 0) · SPH ว่าง = ตานั้นไม่คำนวณ Δ
- ค่าเริ่มต้นเกณฑ์: sph 0.75/1.50 · cyl 0.75/1.50 · se 1.00/2.00 · add 0.50/1.00 · axis warn 20° min_cyl 0.75
- เทียบ `|Δ|` หลังปัดที่ 0.01 · AXIS วนรอบ 180 · transpose เป็น minus-cyl ก่อนเทียบ
- `rx_alert_rule_versions` และ `rx_reviews` — ไม่มี UPDATE/DELETE
- ข้อความต้องเป็น "ควรตรวจสอบ" ไม่ใช่ "ผิด/แรงเกินไป"
- ทำบน Local (:3010 / :8095) เท่านั้น ห้ามขึ้น Hostinger · ห้าม push จนผู้ใช้สั่ง
- รัน PHP ด้วย WinGet PHP 8.4 (`php` บน PATH) ไม่ใช่ XAMPP

## Review Focus

1. ข้อมูลเก่า import (`'+02.00'`, `'090'`, `'plano'`, ช่องว่างล้วน `'  '`) → parse ถูก ไม่ขึ้น ERROR ปลอม — เทสต์ใน Task 1 fixture
2. แว่นเดิมมาจากคอลัมน์ `old_*` ของแถว measured (ไม่มีแถว old) → ใช้เทียบได้ทั้ง JS และ PHP — Task 1 (JS: ExamPanel ให้ oldForm อยู่แล้ว) + Task 3 เทสต์ PHP `loadOld()`
3. DDL ใน MySQL commit ทรานแซกชันเอง → สร้างตารางนอก `rollback()` เสมอ — Task 2 `RxSafetyStore::ensure()` เรียกก่อนเทสต์
4. หน้าต่างแจ้งเตือนบนมือถือ/iPad ต้องไม่ล้นจอ ตาราง Δ เลื่อนในกรอบ — Task 5 Playwright 6 viewport
5. บันทึก review ล้มหลัง `/confirm` สำเร็จ → ไม่ย้อนการยืนยัน แต่ banner ขึ้น "ยังไม่ได้ทบทวน" และกดบันทึกใหม่ได้ — Task 4 + Task 5

---

### Task 1: ตัวคำนวณ JS + fixture กลาง

**Files:**
- Create: `frontend-next/lib/rxSafety.js`
- Create: `api/tests/fixtures/rx-safety-cases.json`
- Test: `frontend-next/lib/__tests__/rxSafety.test.js`

**Interfaces — Produces:**
- `DEFAULT_RULES` (object รูปแบบ spec 6.3)
- `parseNum(raw) → {state:'missing'|'invalid'|'ok', value:number|null}`
- `parseAxis(raw) → same`
- `eyeRx(eye) → {sph, cyl, axis, add, errors:string[]}` — eye = `{sphere, cylinder, axis, add, va}` ค่าดิบ
- `transpose({sph, cyl, axis}) → {sph, cyl, axis}` (minus-cyl)
- `evaluate({old, final, testFor, rules}) → {alerts:Alert[], compare:{r:EyeCompare,l:EyeCompare}, hasOld:boolean, fingerprint:string, counts:{info,warning,critical,error}}`
  - `old`/`final` = `{r:{sphere,cylinder,axis,add,va}, l:{…}}` หรือ `null`
  - `Alert = {eye:'r'|'l'|null, field:'sphere'|'cylinder'|'axis'|'add'|'va'|'se'|'test_for', rule:string, level:'info'|'error'|'warning'|'critical', old:number|null, final:number|null, delta:number|null, message:string}`
  - `EyeCompare = {comparable:boolean, note:string|null, rows:[{key:'sph'|'cyl'|'axis'|'se'|'add', old, final, delta, level:null|'warning'|'critical'}]}`
  - `fingerprint` = สตริง canonical (ไม่ hash ฝั่ง JS — PHP hash เอง) `JSON.stringify([oldVec, finalVec, testFor])` โดย vec = `[r.sph,r.cyl,r.axis,r.add,l.sph,l.cyl,l.axis,l.add]` หลัง transpose ปัด 2 ตำแหน่ง (null คงเป็น null)
- `MULTIFOCAL = ['Progressive','Bi-focal','Degressive']`

- [ ] **Step 1: เขียน fixture** `api/tests/fixtures/rx-safety-cases.json` — array ของ `{name, old, final, test_for, rules?, expect:{alerts:[[eye,field,level]], deltas?:{"r.sph":-2}, hasOld?:bool, comparable?:{r:bool,l:bool}}}` ครอบกรณี spec 10.1 ทั้งหมด (1–10, 13, 14 + parse legacy, ADD multifocal, SE-only, rule off, axis wrap 175/5 = 10, axis 20° warning)
- [ ] **Step 2: เขียนเทสต์** อ่าน fixture ด้วย `fs.readFileSync(new URL('../../../api/tests/fixtures/rx-safety-cases.json', import.meta.url))` แล้ว `evaluate` แต่ละกรณี เทียบชุด `[eye,field,level]` (เรียงแล้ว) และ deltas · เพิ่มเทสต์หน่วย `parseNum('plano')→0`, `parseNum('  ')→missing`, `parseAxis('090')→90`, `transpose({sph:1,cyl:2,axis:180})→{sph:3,cyl:-2,axis:90}`
- [ ] **Step 3: รัน** `cd frontend-next && node --test lib/__tests__/rxSafety.test.js` → FAIL (module not found)
- [ ] **Step 4: เขียน `lib/rxSafety.js`** ตามกฎ spec ข้อ 4–5
- [ ] **Step 5: รัน** เทสต์เดิม + `npm test` ทั้งชุด → PASS
- [ ] **Step 6: Commit** `feat(rx-safety): ตัวคำนวณแจ้งเตือนค่าสายตา (JS) + กรณีทดสอบกลาง`

### Task 2: ตัวคำนวณ PHP + ตาราง + เกณฑ์มีเวอร์ชัน

**Files:**
- Create: `api/services/RxSafety.php` (class `RxSafety` — evaluate ล้วน · class `RxSafetyStore` — ตาราง/เกณฑ์/review)
- Modify (เพิ่มบรรทัด): `api/services/Migrate.php` — เรียก `RxSafetyStore::ensure()` ใน `run()`; `api/index.php` — `require services/RxSafety.php`; `api/tests/run.php` — `require services/RxSafety.php`
- Test: `api/tests/99-rx-safety-engine.test.php`

**Interfaces — Produces:**
- `RxSafety::DEFAULT_RULES`, `RxSafety::evaluate(?array $old, array $final, ?string $testFor, array $rules): array` — คืนรูปเดียวกับ JS (`alerts`, `compare`, `hasOld`, `fingerprint` = **sha1** ของสตริง canonical เดียวกับ JS, `counts`)
- `RxSafety::eyesOf(array $row, string $prefix = ''): array` — แปลงแถว DB (`r_sphere`… หรือ `old_r_sphere`…) เป็น `{r:{…}, l:{…}}`
- `RxSafetyStore::ensure(): void` — CREATE TABLE IF NOT EXISTS ทั้งสอง + seed เวอร์ชัน 1 ถ้าว่าง
- `RxSafetyStore::current(): array{version:int, rules:array}`
- `RxSafetyStore::history(): array`
- `RxSafetyStore::save(array $rules, ?string $note, ?array $actor): array` — ตรวจ แล้ว INSERT เวอร์ชันใหม่ · ผิดรูป → `HttpError 422 reason=rules_invalid`

- [ ] **Step 1: เทสต์** อ่าน fixture เดียวกัน วน `RxSafety::evaluate` เทียบเหมือน JS + `fingerprint` ของ JS canonical string (hash ด้วย sha1 ใน PHP) เท่ากันระหว่างสองค่าที่สมมูล (+cyl vs −cyl)
- [ ] **Step 2: รัน** `php api/tests/run.php rx-safety-engine` → FAIL
- [ ] **Step 3: เขียน `RxSafety`** (port ตรงจาก JS — ชื่อฟังก์ชันและข้อความตรงกัน)
- [ ] **Step 4: เขียน `RxSafetyStore`** + เทสต์ save: ค่า critical ≤ warn → 422; save แล้ว `current().version` เพิ่ม 1 (ใน `rollback()`; `ensure()` เรียกก่อนเปิดทรานแซกชัน)
- [ ] **Step 5: รัน** `php api/tests/run.php rx-safety` แล้ว `php api/tests/run.php` ทั้งชุด → PASS (ข้อที่พังอยู่ก่อนแล้วให้จดไว้ ไม่ใช่ของงานนี้)
- [ ] **Step 6: Commit** `feat(rx-safety): ตัวคำนวณ PHP + ตารางเกณฑ์/review`

### Task 3: API — เกณฑ์ + บันทึก/อ่าน review

**Files:**
- Create: `api/routes/rx-safety.php`
- Modify (เพิ่มบรรทัด): `api/index.php` — เติม `'rx-safety'` ในรายการ route groups; `api/tests/run.php` ไม่ต้อง (เทสต์ `require_once` เอง)
- Test: `api/tests/99-rx-safety-api.test.php`

**Interfaces — Produces (HTTP):**
- `GET /api/settings/rx-alert-rules` → `{version, rules, defaults, history:[{version, rules, note, changed_by_name, changed_at}]}`
- `PUT /api/settings/rx-alert-rules` body `{rules, note}` → `{version, rules, history}` (ประตู `system.zone` เดิมของ `/api/settings` ทำงานเอง)
- `GET /api/cases/:id/rx-reviews` → `[{id, prescription_id, rule_version, fingerprint, max_severity, reason, reviewed_by_name, reviewed_at, alerts, old_rx, measured_rx, final_rx}]` ใหม่สุดก่อน
- `POST /api/cases/:id/rx-reviews` body `{prescription_id, reason}` → 201 `{review}` · `{review:null}` ถ้าไม่มี CRITICAL · 422 `review_reason_required` · 404 ถ้าใบไม่ใช่ของเคส
- helper `rxCaseSets(int $caseId, int $finalId): array{old:?array, measured:?array, final:array, finalRow:array, oldRow:?array, measuredRow:?array}` — old = แถว `kind='old'` ล่าสุดของเคส ไม่มีก็ `old_*` ของแถว measured (มีค่าอย่างน้อย 1 ช่อง)

- [ ] **Step 1: เทสต์** (ทุกข้อใน `rollback()`, actor ผ่าน `\Optic\Auth::as()` แบบ `32-customer-fill`):
  - ไม่มี CRITICAL → `{review:null}` และไม่มีแถวเพิ่ม
  - CRITICAL ไม่มีเหตุผล / เหตุผล `'   '` → 422 `review_reason_required` (spec ข้อ 12 ปรับ)
  - มีเหตุผล → 201 แถวมี `rule_version`, `fingerprint`, `reviewed_by_name`, `alerts` มี sph critical · timeline `case_events` มี `rx_review_confirmed`
  - POST ซ้ำค่าเดิมไม่มีเหตุผล → คืนแถวเดิม จำนวนแถวไม่เพิ่ม (spec 16)
  - แก้ `r_sphere` แล้ว POST ไม่มีเหตุผล → 422 · แถวเก่ายังอยู่ (spec 11)
  - save เกณฑ์ใหม่ → review เดิมยังชี้ `rule_version` เดิม (spec 15)
  - ใช้ legacy `old_r_sphere` บนแถว measured → เทียบได้
  - `prescription_id` ของเคสอื่น → 404
- [ ] **Step 2: รัน** `php api/tests/run.php rx-safety-api` → FAIL
- [ ] **Step 3: เขียน route file**
- [ ] **Step 4: รัน** `php api/tests/run.php rx-safety` + `php api/tests/run.php rx-test-for` (regression `/confirm` เดิม) → PASS
- [ ] **Step 5: Commit** `feat(rx-safety): API เกณฑ์ + Clinical Review`

### Task 4: UI หน้าวัดสายตา — Banner + Dialog + จุดเสียบ

**Files:**
- Create: `frontend-next/components/RxSafetyBanner.jsx`, `frontend-next/components/RxSafetyDialog.jsx`, `frontend-next/lib/useRxSafety.js` (hook โหลดเกณฑ์ + reviews)
- Modify (เพิ่มบรรทัด): `ExamPanel.jsx` — import, hook, `<RxSafetyBanner>` ใต้ `rx-missing-note`/ก่อนตารางเทียบ, จุดเสียบ 1 ใน `beforeComplete` ก่อน `saveDraft()`, จุดเสียบ 2 หลัง `/confirm`; `app/globals.css` — คลาส `rx-safety-*`

**Interfaces:**
- Consumes: `evaluate`, `DEFAULT_RULES` (Task 1) · API Task 3
- `useRxSafety(caseId) → {rules, version, reviews, reload}`
- `<RxSafetyBanner result reviewState onFocusField />` — `reviewState = {status:'none'|'reviewed'|'missing', review}`
- `<RxSafetyDialog>` เปิดผ่าน `openRxSafetyDialog(result, {reviewed}) → Promise<{ok:boolean, reason:string, focus?:{eye,field}}>` (state ภายใน ExamPanel แบบเดียวกับ Confirm.jsx)
- `focusRxCell(eye, field)` — `document.querySelector('[data-rx-final] input[data-cell="r_sphere"]')`; ถ้า RxGrid ไม่มี data-cell ใช้การหาจาก index คอลัมน์ในตาราง Final (ไม่แก้ RxGrid)

- [ ] **Step 1:** hook + Banner (แสดง INFO/ERROR ระหว่างกรอก, ตาราง Δ, สถานะทบทวน, ประวัติพับไว้)
- [ ] **Step 2:** Dialog (สรุปจำนวน, กลุ่ม OD/OS, ค่าเดิม/ใหม่/Δ, คลิก focus, ปุ่ม ตรวจสอบอีกครั้ง / ยืนยันหลังตรวจสอบ, ช่องเหตุผลเมื่อมี CRITICAL ที่ยังไม่ทบทวน, ปุ่มปิดใช้เมื่อมี error)
- [ ] **Step 3:** เสียบ ExamPanel 3 จุด · ไม่แตะบรรทัดเดิม
- [ ] **Step 4:** ตรวจบน :3010 ด้วยมือ (เคสทดสอบที่สร้างผ่าน UI แล้วลบทิ้งไม่ได้ → ใช้ Playwright mock แทน ข้อมูลจริงไม่ถูกแตะ)
- [ ] **Step 5: Commit** `feat(rx-safety): แจ้งเตือนในหน้าวัดสายตา`

### Task 5: หน้าตั้งค่าเกณฑ์ + E2E

**Files:**
- Create: `frontend-next/app/(frontdesk)/settings/RxAlertRules.jsx`, `frontend-next/e2e/rx-safety.spec.js`
- Modify (เพิ่มบรรทัด): `settings/page.jsx` — import + `<RxAlertRules />`

- [ ] **Step 1:** RxAlertRules — ตาราง 5 กฎ (เปิด/ปิด, เตือน, ทบทวน), หมายเหตุ, บันทึก, คำเตือนค่าทดลอง, ประวัติเวอร์ชัน
- [ ] **Step 2:** Playwright (mock API แบบ `e2e/exam-history-print.spec.js`): banner ขึ้นเมื่อค่าเปลี่ยน, dialog ปุ่มปิดใช้เมื่อ error, ใส่เหตุผลแล้วเรียก POST rx-reviews, หน้าต่างไม่ล้นจอ 6 viewport
- [ ] **Step 3:** `npm test`, `php api/tests/run.php`, `npx playwright test e2e/rx-safety.spec.js` → PASS
- [ ] **Step 4: Commit** `feat(rx-safety): หน้าตั้งค่าเกณฑ์ + e2e`
- [ ] **Step 5:** ให้ผู้ใช้ดูบน http://localhost:3010 — ยังไม่ขึ้น Hostinger
