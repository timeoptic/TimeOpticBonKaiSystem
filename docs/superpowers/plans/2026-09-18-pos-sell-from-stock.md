# POS ขายกรอบ/คอนแทคเลนส์จากคลัง Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า `/pos` ขายกรอบแว่นกับคอนแทคเลนส์จากคลังโดยตัดสต็อกจริง พร้อมหน้าตาใหม่ตามภาพของร้าน

**Architecture:** `pos.php` เพิ่มเส้นอ่านสินค้าคลัง และตัด/คืนสต็อกผ่าน `StockClient` (in-process, PDO เดียวกัน) ภายใน `Db::tx` เดียวกับการเขียนใบ ใช้ `source='pos'` ให้ฝั่งคลังปฏิเสธเมื่อของไม่พอ · หน้าเว็บเพิ่มโหมด 3 การ์ด ตัวค้นหาตามแหล่ง และตารางบิล · ไม่แตะ schema

**Tech Stack:** PHP 8.4 (api/tests/run.php harness), Next.js 16 static export, node:test (`frontend-next/lib/__tests__`)

**Spec:** `docs/superpowers/specs/2026-09-18-pos-sell-from-stock-design.md`

## Global Constraints

- ห้ามเปลี่ยน schema (ไม่มี migration ใหม่) · ห้ามเขียน `products` / `stock_lots` / `inventory_logs` เอง — ผ่าน `StockClient::post` เท่านั้น
- ตัดสต็อกเฉพาะ `product_type IN ('Frame','ContactLen')` และ `is_custom_made = 0`
- `source = 'pos'` · `idem_key = pos-<client_ref หรือ pos_no>-<ลำดับแถว>-<sku>` · `reference_doc = pos_no`
- ซ่อน `pos_items` ที่ `group_code LIKE 'PosCtl%'` และ `sku = 'EYW-0003'` ในโค้ดเท่านั้น
- รันเทสต์ PHP ด้วย `C:\Users\USER\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe api/tests/run.php <filter>`
- ทำและดูบน local (:8099) ก่อน · ไม่ deploy Hostinger ในแผนนี้

---

### Task 1: API — สินค้าคลังสำหรับ POS + ซ่อนรายการซ้ำ

**Files:**
- Modify: `api/routes/pos.php` (ส่วน "รายการสินค้าหน้าร้าน")
- Test: `api/tests/81-pos-stock-sale.test.php` (ใหม่)

**Interfaces:**
- Produces: `GET /api/pos/stock-products?type=Frame|ContactLen` → `list<{id, sku, name, brand, product_type, base_selling_price, on_hand:int, category_code, category_name, attributes:array, pos_fields:list, stock:true}>` · ค่าคงที่ PHP `POS_STOCK_TYPES = ['Frame','ContactLen']` · ฟังก์ชัน `posStockFields(string $type): array`

- [ ] **Step 1: เทสต์ที่ล้ม** — fixture สร้าง Frame 1 ตัว (lot 2 ชิ้น) + ContactLen 1 ตัว (lot 0 ชิ้น) ใน `rollback()` แล้วเช็ก: `stock-products?type=Frame` มี sku นั้นและ `on_hand = 2`; `type=ContactLen` มี `on_hand = 0` และ `pos_fields[0].key = 'eye'`; `type=Lens` → 400; `/api/pos/products` ไม่มี sku ขึ้นต้น `CT` จากกลุ่ม `PosCtl%` และไม่มี `EYW-0003`
- [ ] **Step 2: รัน `run.php 81-pos` ต้องล้ม** (route ยังไม่มี)
- [ ] **Step 3: เขียน route**

```php
const POS_STOCK_TYPES = ['Frame', 'ContactLen'];

function posStockFields(string $type): array
{
    return $type === 'ContactLen'
        ? [['key' => 'eye', 'label' => 'ข้าง', 'type' => 'choice', 'required' => true,
            'options' => [['R', 'ขวา (R)'], ['L', 'ซ้าย (L)'], ['RL', 'ทั้งสองข้าง']]]]
        : [];
}

GET('/api/pos/stock-products', function (array $req) {
    posRequireSeller(posActor());
    $type = str_or($req['query']['type'] ?? null);
    if (!in_array($type, POS_STOCK_TYPES, true)) bad('ประเภทสินค้าไม่ถูกต้อง');
    $rows = Db::all(
        'SELECT p.id, p.sku, p.name, p.brand, p.product_type, p.base_selling_price, p.attributes,
                c.code AS category_code, c.name AS category_name,
                COALESCE((SELECT SUM(l.remaining_qty) FROM stock_lots l
                           WHERE l.product_id = p.id AND l.remaining_qty > 0), 0) AS on_hand
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.product_type = ? AND p.is_custom_made = 0
          ORDER BY (on_hand > 0) DESC, p.brand, p.name', $type);
    return array_map(fn($r) => [...], $rows);   // คีย์ตาม Produces
});
```
และใน `GET /api/pos/products` เพิ่ม `"group_code NOT LIKE 'PosCtl%'", "sku <> 'EYW-0003'"` ใน `$where`
- [ ] **Step 4: รันเทสต์ผ่าน** และ `run.php 80-pos` ยังผ่าน (ถ้าเทสต์ 80 นับ 41 รายการจาก `/products` ให้แก้ให้นับจากตาราง ไม่ใช่จาก route)
- [ ] **Step 5: Commit** `POS: สินค้ากรอบ/คอนแทคเลนส์จากคลัง · ซ่อนรายการซ้ำในแค็ตตาล็อก POS`

### Task 2: API — ตัดสต็อกตอนบันทึกบิล และคืนตอน void

**Files:**
- Modify: `api/routes/pos.php` (`POST /api/pos/sales`, `POST /api/pos/sales/:id/void`)
- Test: `api/tests/81-pos-stock-sale.test.php`

**Interfaces:**
- Consumes: `POS_STOCK_TYPES`, `posStockFields()` (Task 1)
- Produces: payload รายการรับ `stock_product_id:int` · แถวที่บันทึกมี `product_id` = id สินค้าคลัง, `sku_snapshot` = sku, `item_meta.stock_idem_key` · void คืนของและใส่ `item_meta.stock_return_key`

- [ ] **Step 1: เทสต์ที่ล้ม** (ใน `rollback()` ทุกข้อ, เรียกผ่าน `posCall`):
  1. ขาย Frame qty 1 → ใบสร้าง, `remaining_qty` ของล็อตลด 1, มีแถว `inventory_logs` ที่ `reference_doc = pos_no`
  2. ขาย ContactLen ที่ on_hand 0 → error 400 และ `pos_sales` ไม่มีใบใหม่ และล็อตไม่เปลี่ยน
  3. ContactLen ไม่ระบุข้าง → 400 "ต้องระบุข้าง"
  4. POST ซ้ำด้วย `client_ref` เดิม → ได้ใบเดิม ล็อตลดแค่ 1
  5. void ใบข้อ 1 → ล็อตกลับเท่าเดิม
  6. ขายรายการ `pos_items` ปกติ → ไม่มีแถว inventory_logs ใหม่
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: เขียนโค้ด** — ในลูปตรวจรายการ:

```php
$spid = int_or($it['stock_product_id'] ?? null);
if ($spid !== null) {
    $sp = Db::get('SELECT id, sku, name, product_type FROM products
                    WHERE id = ? AND is_custom_made = 0', $spid);
    if (!$sp || !in_array($sp['product_type'], POS_STOCK_TYPES, true)) bad("รายการที่ $n: ไม่พบสินค้าในคลัง");
    // ช่องบังคับจาก posStockFields($sp['product_type']) ตรวจแบบเดียวกับ pos_fields
}
```
`$clean[]` เพิ่ม `'stock_product_id'`, `'stock_sku'` · ถ้ามีอย่างน้อยหนึ่งรายการจากคลังและ `StockClient::unavailableReason() !== null` → `bad('ขายของจากคลังไม่ได้ตอนนี้ — ' . reason)` · ใน `Db::tx` หลัง INSERT แต่ละแถวจากคลัง:

```php
$idem = 'pos-' . ($ref ?? $posNo) . '-' . ($n + 1) . '-' . $c['stock_sku'];
try {
    $res = StockClient::post('/stock/issue', [
        'source' => 'pos', 'idem_key' => substr($idem, 0, 120), 'sku' => $c['stock_sku'],
        'quantity' => $c['qty'], 'reference_doc' => $posNo, 'note' => "ขายหน้าร้าน $posNo",
    ]);
} catch (StockApiError $e) {
    bad("รายการที่ " . ($n + 1) . " ({$c['name']}): " . $e->getMessage());
}
// เขียน item_meta ใหม่ = meta เดิม + stock_idem_key + stock_lots (lot ids จาก $res['cuts'])
```
void: ใน `Db::tx` เดียวกับ UPDATE สถานะ วนแถวที่มี `item_meta.stock_idem_key` → `StockClient::post('/stock/return', ['source'=>'pos','idem_key'=>'rev-'.$key,'reverses_key'=>$key,'note'=>"ยกเลิกบิล $posNo — $reason"])`
- [ ] **Step 4: รันเทสต์ผ่าน** ทั้ง 80 และ 81
- [ ] **Step 5: Commit** `POS: ขายกรอบ/คอนแทคเลนส์ตัดสต็อกจริง · ยกเลิกบิลคืนเข้าคลัง`

### Task 3: cart.js — แถวจากคลัง

**Files:**
- Modify: `frontend-next/lib/pos/cart.js`
- Test: `frontend-next/lib/__tests__/posCart.test.js`

**Interfaces:**
- Produces: `addItem(items, product)` เมื่อ `product.stock === true` → แถวมี `stock: true, stock_product_id: product.id, on_hand, product_type` · `validateCart` เพิ่มข้อความ `เกินจำนวนในคลัง (เหลือ N)` · `toItemsPayload` ส่ง `stock_product_id` แทน `product_id` · `isContactLens(it)` = มีช่อง power หรือ `product_type === 'ContactLen'` · `clearCart()` = `[]`

- [ ] **Step 1: เทสต์ที่ล้ม** — แถวคลัง id 5 กับแถว pos_items id 5 ไม่รวมกัน · qty เกิน on_hand ขึ้น error · payload แถวคลังมี `stock_product_id` ไม่มี `product_id` · `isContactLens`
- [ ] **Step 2: รัน `node --test lib/__tests__/posCart.test.js` ให้ล้ม**
- [ ] **Step 3: แก้ cart.js** (เงื่อนไขรวมแถวต้องเทียบ `!!it.stock === !!product.stock` ด้วย)
- [ ] **Step 4: เทสต์ผ่าน**
- [ ] **Step 5: Commit**

### Task 4: หน้าเว็บ — โหมด 3 การ์ด ตัวค้นหา ตารางบิล แผงขวาใหม่

**Files:**
- Create: `frontend-next/components/pos/PosModeCards.jsx`, `frontend-next/components/pos/PosCategoryChips.jsx`
- Modify: `frontend-next/app/(frontdesk)/pos/page.jsx`, `pos.css`, `components/pos/ProductPicker.jsx`, `components/pos/CartItemRow.jsx`, `lib/pos/posApi.js`

- [ ] **Step 1:** `posApi.stockProducts(type)` → `GET /api/pos/stock-products?type=`
- [ ] **Step 2:** `PosModeCards({ mode, onMode })` — 3 การ์ด `frame | contact | other` ไอคอน + ชื่อ + คำอธิบาย + วงกลม/ติ๊ก
- [ ] **Step 3:** page โหลดสินค้าตามโหมด (cache ต่อโหมดใน state) · `PosCategoryChips` สร้างจาก `brand` (โหมดคลัง) หรือ `category_name` (โหมด other) กดซ้ำ = ล้างตัวกรอง
- [ ] **Step 4:** `ProductPicker` รับ `chip` กรองเพิ่ม · แถวคลังโชว์ `คงเหลือ N` · `on_hand <= 0` = ปุ่ม disabled + ป้าย "หมด" · placeholder ตามภาพ
- [ ] **Step 5:** ตารางบิล: หัว "รายการสินค้าในบิล (N รายการ)" + ปุ่ม "ล้างรายการ" (confirm) + "เพิ่มรายการด้วยตนเอง" (หา `pos_custom` จาก `/api/pos/products` แล้ว `addItem`) · หัวคอลัมน์ สินค้า / จำนวน / ราคาต่อหน่วย / รวมเงิน / จัดการ · `CartItemRow` จัดเป็นแถวกริดเดียวกัน แถวคลังมีป้าย "ตัดสต็อก · เหลือ N"
- [ ] **Step 6:** แผงขวา: กล่องยอดรวมสีเขียวพร้อมไอคอนและป้าย "N รายการ" · หัวข้อ "ข้อมูลลูกค้า" · กล่องส่งมอบแบบการ์ด · ปุ่มรับเงินมีไอคอน — ช่องและตรรกะเดิมทุกตัว · `needsRx` ใช้ `isContactLens`
- [ ] **Step 7:** `npx next build` ผ่าน · `node --test lib/__tests__/pos*.test.js` ผ่าน
- [ ] **Step 8: Commit**

### Task 5: ข้อมูลทดสอบ local + ดูบน :8099

- [ ] **Step 1:** สร้างสินค้าทดสอบในฐาน **local** ผ่าน `stock/api` (Catalog + รับเข้า) : กรอบ 3 ตัว (หนึ่งตัวของหมด) คอนแทคเลนส์ 3 ตัว (หนึ่งตัวของหมด) ชื่อขึ้นต้น `TEST-`
- [ ] **Step 2:** build → `frontend-next/out` · `node check-build-origin.mjs` ผ่าน
- [ ] **Step 3:** ลองขายจริงบน :8099: ขายกรอบ → หน้าความเคลื่อนไหวคลังมีเลขบิล · ยกเลิกบิล → ของคืน · ของหมดกดไม่ได้
- [ ] **Step 4:** ส่งลิงก์ให้ผู้ใช้ดู รอ OK ก่อน deploy
