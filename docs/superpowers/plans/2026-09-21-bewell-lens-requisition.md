# Bewell Lens Requisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้าขายของ Bewell เลือกเลนส์จำลองได้ด้วยหน้าตาเลือกเลนส์เดิม แล้วออกใบเบิกเลนส์ที่ผูกเคส/ลูกค้า/ค่าสายตาสุดท้าย พร้อมสถานะ 6 ค่า

**Architecture:** ข้อมูลเลนส์จำลองเป็นไฟล์ JS ฝั่งหน้าเว็บ ป้อนเข้า `LensPicker` ตัวเดิมผ่าน `fetcher` ส่วนแถวที่เลือกมี `id: null` ใบสั่งจึงไม่ผูกล็อตและไม่ตัดสต็อก ใบเบิกเป็นของจริงในสองตารางใหม่ มีไฟล์ route ใหม่หนึ่งไฟล์ และหน้าเว็บเรียก sync หลังบันทึกใบสั่งสำเร็จ logic เดิมไม่แก้

**Tech Stack:** PHP 8.4 (router เอง, PDO MySQL), Next.js (React, JSX), `node --test`, test harness ของ `api/tests/run.php`

**Spec:** `docs/superpowers/specs/2026-09-21-bewell-lens-requisition-design.md`

## Global Constraints

- ไม่แก้ logic เดิม เพิ่มได้อย่างเดียว (ไฟล์เดิมแตะเฉพาะจุดลงทะเบียนและจุดที่ระบุ)
- `NEXT_PUBLIC_LENS_SOURCE=mock` เปิดโหมด Bewell ถ้าไม่ตั้ง พฤติกรรมเหมือน TimeOptic ทุกอย่าง
- เลนส์จำลองต้องไม่มี `id` ของล็อต (`id: null`) และไม่เขียนลงตารางสต็อก
- สถานะ: `pending` รอเบิก · `issued` เบิกแล้ว · `ordered` ส่งผลิต/สั่งเลนส์ · `received` ได้รับเลนส์ · `assembled` ประกอบแล้ว · `cancelled` ยกเลิก
- ข้อความ UI เป็นภาษาไทย
- PHP: `php` = `%LOCALAPPDATA%\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe` (เทสต์ API รันกับฐาน `bewell` ตาม `.env` ใน transaction ที่ roll back เสมอ)

---

### Task 1: ตาราง + กติกาใบเบิก (backend service)

**Files:**
- Modify: `api/services/Migrate.php` (ท้าย array ใน `tables()` ก่อน `];` ที่ปิด)
- Create: `api/services/LensRequisition.php`
- Modify: `api/tests/run.php` (require service + route)
- Test: `api/tests/98-lens-requisition.test.php`

**Interfaces:**
- Produces: `LensRequisition::FLOW`, `::LABEL`, `::STAMP`, `::transitionError(string $from, string $to, bool $hasRx): ?string`, `::finalRx(Tx $q, array $order): ?array` (`$order` มี `final_prescription_id`, `case_id`), `::snapshot(array $rx): array`, `::cleanItems(array $items): array` (คีย์เรียงตามคอลัมน์ items)

- [ ] **Step 1: เพิ่มสองตารางใน `Migrate::tables()`**

```php
            /* ใบเบิกเลนส์ของ Bewell — เลนส์ไม่ใช่สต็อก ไม่ผ่าน CaseStock หรือ rx_orders
               rx_snapshot = ค่าสายตาที่คัดลอกไว้ตอนออกใบ ใบที่ส่งร้านเลนส์ไปแล้วต้องไม่เปลี่ยนตาม
               ใบค่าสายตาที่ถูกแก้ทีหลัง (null = เคสยังไม่ยืนยันค่าสายตาสุดท้าย) */
            'lens_requisitions' => "CREATE TABLE IF NOT EXISTS lens_requisitions (
                id              int(10) unsigned NOT NULL AUTO_INCREMENT,
                req_no          varchar(30) NOT NULL,
                case_id         int(10) unsigned NOT NULL,
                customer_id     int(10) unsigned NOT NULL,
                order_id        int(10) unsigned DEFAULT NULL,
                prescription_id int(10) unsigned DEFAULT NULL,
                rx_snapshot     longtext DEFAULT NULL,
                status          enum('pending','issued','ordered','received','assembled','cancelled') NOT NULL DEFAULT 'pending',
                total           decimal(12,2) NOT NULL DEFAULT 0,
                note            text DEFAULT NULL,
                cancel_reason   varchar(255) DEFAULT NULL,
                created_by      int(10) unsigned DEFAULT NULL,
                created_at      datetime NOT NULL DEFAULT current_timestamp(),
                updated_at      datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                issued_at       datetime DEFAULT NULL,
                ordered_at      datetime DEFAULT NULL,
                received_at     datetime DEFAULT NULL,
                assembled_at    datetime DEFAULT NULL,
                cancelled_at    datetime DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_lr_no (req_no),
                KEY idx_lr_case (case_id),
                KEY idx_lr_order (order_id),
                KEY idx_lr_status (status),
                CONSTRAINT fk_lr_case FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE,
                CONSTRAINT fk_lr_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
                CONSTRAINT fk_lr_order FOREIGN KEY (order_id) REFERENCES custom_orders (id) ON DELETE SET NULL,
                CONSTRAINT fk_lr_rx FOREIGN KEY (prescription_id) REFERENCES prescriptions (id) ON DELETE SET NULL
              ) $c",

            /* รายการในใบเบิก — ทุกช่องของ spec คัดลอกเก็บไว้ ใบเก่ายังอ่านได้ครบ
               แม้วันหนึ่งแหล่งเลนส์เปลี่ยนจาก MOCK เป็นฐานจริง */
            'lens_requisition_items' => "CREATE TABLE IF NOT EXISTS lens_requisition_items (
                id             int(10) unsigned NOT NULL AUTO_INCREMENT,
                requisition_id int(10) unsigned NOT NULL,
                eye            enum('R','L','pair') NOT NULL,
                source         varchar(20) NOT NULL DEFAULT 'MOCK',
                mock_code      varchar(120) DEFAULT NULL,
                brand          varchar(80) NOT NULL,
                lens_type      varchar(80) DEFAULT NULL,
                design         varchar(120) DEFAULT NULL,
                lens_index     varchar(10) DEFAULT NULL,
                coating        varchar(80) DEFAULT NULL,
                option_name    varchar(80) DEFAULT NULL,
                photochromic   varchar(80) DEFAULT NULL,
                color          varchar(40) DEFAULT NULL,
                quantity       int(11) NOT NULL DEFAULT 1,
                unit_price     decimal(12,2) NOT NULL DEFAULT 0,
                line_total     decimal(12,2) NOT NULL DEFAULT 0,
                PRIMARY KEY (id),
                KEY idx_lri_req (requisition_id),
                CONSTRAINT fk_lri_req FOREIGN KEY (requisition_id) REFERENCES lens_requisitions (id) ON DELETE CASCADE
              ) $c",
```

- [ ] **Step 2: สร้างตารางในฐาน bewell**

Run: `php -r "$c=require 'api/config.php'; require 'api/core/Http.php'; require 'api/core/Db.php'; require 'api/core/Helpers.php'; require 'api/services/Migrate.php'; Db::configure($c['db']); print_r(Migrate::run());"`
Expected: `lens_requisitions`, `lens_requisition_items` อยู่ในรายการที่สร้าง

- [ ] **Step 3: เขียนเทสต์กติกาที่ยังไม่ผ่าน** (`api/tests/98-lens-requisition.test.php` ส่วนแรก)

```php
<?php

declare(strict_types=1);

/**
 * ใบเบิกเลนส์ของ Bewell — กติกาสถานะ การหาค่าสายตาสุดท้าย และ sync จากหน้าขาย
 * ทุกข้อรันใน transaction ที่ roll back เสมอ
 */

group('ใบเบิกเลนส์ — กติกาสถานะ');

test('เดินหน้าทีละขั้นได้', function () {
    eq(LensRequisition::transitionError('pending', 'issued', true), null, 'รอเบิก → เบิกแล้ว');
    eq(LensRequisition::transitionError('received', 'assembled', true), null, 'ได้รับ → ประกอบ');
});

test('ข้ามขั้นได้', function () {
    eq(LensRequisition::transitionError('pending', 'ordered', true), null, 'รอเบิก → สั่งเลนส์');
});

test('ย้อนสถานะไม่ได้', function () {
    ok(LensRequisition::transitionError('ordered', 'issued', true) !== null, 'สั่งเลนส์ → เบิกแล้ว ต้องไม่ได้');
});

test('ยกเลิกได้จนกว่าจะประกอบแล้ว', function () {
    eq(LensRequisition::transitionError('received', 'cancelled', false), null, 'ได้รับ → ยกเลิก');
    ok(LensRequisition::transitionError('assembled', 'cancelled', true) !== null, 'ประกอบแล้วยกเลิกไม่ได้');
    ok(LensRequisition::transitionError('cancelled', 'issued', true) !== null, 'ยกเลิกแล้วไปต่อไม่ได้');
});

test('ไม่มีค่าสายตาสุดท้าย เบิกไม่ได้', function () {
    ok(LensRequisition::transitionError('pending', 'issued', false) !== null, 'ต้องห้ามเบิก');
});

test('รายการเลนส์: คำนวณยอดและบังคับยี่ห้อ', function () {
    $rows = LensRequisition::cleanItems([
        ['eye' => 'r', 'brand' => 'HOYA', 'design' => 'Nulux', 'quantity' => 1, 'unit_price' => 1500],
    ]);
    eq($rows[0]['eye'], 'R', 'ข้าง');
    eq($rows[0]['line_total'], 1500.0, 'ยอดบรรทัด');
    eq(array_keys($rows[0])[0], 'eye', 'คีย์แรกตรงกับลำดับคอลัมน์');
    $threw = false;
    try {
        LensRequisition::cleanItems([['eye' => 'L', 'brand' => '']]);
    } catch (HttpError $e) {
        $threw = $e->status === 400;
    }
    ok($threw, 'ไม่มียี่ห้อต้องตอบ 400');
});
```

และใน `api/tests/run.php` ต่อจาก `require __DIR__ . '/../routes/payments.php';`:

```php
/* ใบเบิกเลนส์ของ Bewell (98-lens-requisition) */
require __DIR__ . '/../routes/lens.php';
```

- [ ] **Step 4: รันให้เห็นว่าตก**

Run: `php api/tests/run.php lens-requisition`
Expected: FAIL (ไม่พบ `routes/lens.php` / class `LensRequisition`)

- [ ] **Step 5: เขียน `api/services/LensRequisition.php`**

```php
<?php

declare(strict_types=1);

/**
 * กติกาใบเบิกเลนส์ของ Bewell — แยกจาก route เพื่อเทสต์ได้โดยไม่ต้องผ่าน HTTP
 *
 * เลนส์ของ Bewell ไม่ใช่สต็อก ใบเบิกจึงไม่แตะ products / stock_lots / rx_orders เลย
 */
final class LensRequisition
{
    /** ลำดับงานปกติ — เดินหน้าหรือข้ามขั้นได้ ย้อนไม่ได้ · cancelled อยู่นอกลำดับ */
    public const FLOW = ['pending', 'issued', 'ordered', 'received', 'assembled'];

    public const LABEL = [
        'pending'   => 'รอเบิก',
        'issued'    => 'เบิกแล้ว',
        'ordered'   => 'ส่งผลิต / สั่งเลนส์',
        'received'  => 'ได้รับเลนส์',
        'assembled' => 'ประกอบแล้ว',
        'cancelled' => 'ยกเลิก',
    ];

    /** คอลัมน์เวลาที่ประทับตอนเข้าสถานะนั้น */
    public const STAMP = [
        'issued'    => 'issued_at',
        'ordered'   => 'ordered_at',
        'received'  => 'received_at',
        'assembled' => 'assembled_at',
        'cancelled' => 'cancelled_at',
    ];

    /** ช่องของใบค่าสายตาที่คัดลอกลงใบเบิก — PD อยู่ในใบ Final ด้วย ถ้าวัดไว้ */
    public const RX_FIELDS = [
        'r_sphere', 'r_cylinder', 'r_axis', 'r_add', 'r_pd', 'r_prism', 'r_base',
        'l_sphere', 'l_cylinder', 'l_axis', 'l_add', 'l_pd', 'l_prism', 'l_base',
        'pd_total', 'test_for',
    ];

    /** null = เปลี่ยนได้ · ข้อความ = เหตุผลที่เปลี่ยนไม่ได้ */
    public static function transitionError(string $from, string $to, bool $hasRx): ?string
    {
        if (!isset(self::LABEL[$to])) {
            return 'สถานะไม่ถูกต้อง';
        }
        if ($from === $to) {
            return 'ใบเบิกอยู่สถานะนี้อยู่แล้ว';
        }
        if ($from === 'cancelled') {
            return 'ใบเบิกนี้ถูกยกเลิกแล้ว';
        }
        if ($to === 'cancelled') {
            return $from === 'assembled' ? 'ประกอบแล้ว ยกเลิกใบเบิกไม่ได้' : null;
        }
        if (array_search($to, self::FLOW, true) < array_search($from, self::FLOW, true)) {
            return 'ย้อนสถานะใบเบิกไม่ได้';
        }
        if (!$hasRx) {
            return 'เคสนี้ยังไม่มีค่าสายตาสุดท้าย — ยืนยันค่าสายตาก่อนเบิกเลนส์';
        }
        return null;
    }

    /**
     * ค่าสายตาสุดท้ายของใบสั่ง — ใบที่ผูกกับออเดอร์ก่อน (ตั้งตอนกดยืนยันค่าสายตา)
     * ไม่มีค่อยหาใบ final ล่าสุดของเคส เหมือนที่หน้าออเดอร์หาอยู่
     */
    public static function finalRx(Tx $q, array $order): ?array
    {
        $row = null;
        if (!empty($order['final_prescription_id'])) {
            $row = $q->get('SELECT * FROM prescriptions WHERE id = ?', (int) $order['final_prescription_id']);
        }
        if (!$row && !empty($order['case_id'])) {
            $row = $q->get(
                "SELECT * FROM prescriptions WHERE case_id = ? AND kind = 'final'
                  ORDER BY confirmed_at DESC, id DESC LIMIT 1",
                (int) $order['case_id']
            );
        }
        return $row ?: null;
    }

    public static function snapshot(array $rx): array
    {
        $out = ['prescription_id' => (int) $rx['id']];
        foreach (self::RX_FIELDS as $f) {
            $out[$f] = $rx[$f] ?? null;
        }
        return $out;
    }

    /** รายการจากหน้าเว็บ → แถวพร้อมเขียน · ลำดับคีย์ = ลำดับคอลัมน์ใน INSERT ของ route */
    public static function cleanItems(array $items): array
    {
        if (!$items) {
            bad('ไม่มีรายการเลนส์');
        }
        $text = static fn($v, int $max) => mb_substr(trim((string) ($v ?? '')), 0, $max);
        $out = [];
        foreach (array_values($items) as $i => $it) {
            $n   = $i + 1;
            $eye = strtoupper(trim((string) ($it['eye'] ?? '')));
            if (!in_array($eye, ['R', 'L', 'PAIR'], true)) {
                bad("รายการที่ $n: ข้างของเลนส์ไม่ถูกต้อง");
            }
            $brand = $text($it['brand'] ?? '', 80);
            if ($brand === '') {
                bad("รายการที่ $n: ไม่มียี่ห้อเลนส์");
            }
            $qty   = max(1, (int) ($it['quantity'] ?? 1));
            $price = round((float) ($it['unit_price'] ?? 0), 2);
            if ($price < 0) {
                bad("รายการที่ $n: ราคาติดลบไม่ได้");
            }
            $source = strtoupper((string) ($it['source'] ?? 'MOCK'));
            $out[] = [
                'eye'          => $eye === 'PAIR' ? 'pair' : $eye,
                'source'       => in_array($source, ['MOCK', 'DATABASE'], true) ? $source : 'MOCK',
                'mock_code'    => $text($it['mock_code'] ?? '', 120) ?: null,
                'brand'        => $brand,
                'lens_type'    => $text($it['lens_type'] ?? '', 80) ?: null,
                'design'       => $text($it['design'] ?? '', 120) ?: null,
                'lens_index'   => $text($it['lens_index'] ?? '', 10) ?: null,
                'coating'      => $text($it['coating'] ?? '', 80) ?: null,
                'option_name'  => $text($it['option_name'] ?? '', 80) ?: null,
                'photochromic' => $text($it['photochromic'] ?? '', 80) ?: null,
                'color'        => $text($it['color'] ?? '', 40) ?: null,
                'quantity'     => $qty,
                'unit_price'   => $price,
                'line_total'   => round($qty * $price, 2),
            ];
        }
        return $out;
    }
}
```

และสร้าง `api/routes/lens.php` ชั่วคราวให้ require ผ่าน (Task 2 เติมเส้นทาง):

```php
<?php

declare(strict_types=1);

require_once __DIR__ . '/../services/LensRequisition.php';
```

- [ ] **Step 6: รันให้ผ่าน**

Run: `php api/tests/run.php lens-requisition`
Expected: ผ่าน 6/6

- [ ] **Step 7: Commit**

```bash
git add api/services/Migrate.php api/services/LensRequisition.php api/routes/lens.php api/tests/run.php api/tests/98-lens-requisition.test.php
git commit -m "ใบเบิกเลนส์: ตารางใหม่ + กติกาสถานะ"
```

---

### Task 2: API ใบเบิกเลนส์

**Files:**
- Modify: `api/routes/lens.php`
- Modify: `api/index.php:51-54` (เพิ่ม `'lens'` ต่อท้ายรายการ route)
- Modify: `api/services/ActivityLog.php` (`ENTITIES` + `ENTITY_LABEL`)
- Test: `api/tests/98-lens-requisition.test.php` (ต่อท้าย)

**Interfaces:**
- Consumes: `LensRequisition::*` จาก Task 1
- Produces (HTTP):
  - `POST /api/lens-requisitions/sync` body `{order_id:int, items:[{eye,source,mock_code,brand,lens_type,design,lens_index,coating,option_name,photochromic,color,quantity,unit_price}]}` → ใบเต็ม
  - `POST /api/lens-requisitions/:id/status` body `{status, reason?}` → ใบเต็ม
  - `GET /api/lens-requisitions?status=&q=` → รายการแบบย่อ `{id, req_no, case_id, case_code, customer_name, status, status_label, total, has_rx, summary, created_at}`
  - `GET /api/lens-requisitions/:id` → ใบเต็ม
  - `GET /api/cases/:id/lens-requisitions` → ใบเต็มของเคส (ใหม่สุดก่อน)
  - ใบเต็ม = แถว `lens_requisitions` + `case_code, customer_name, customer_phone, invoice_code, created_by_name, status_label, rx_snapshot (array|null), items[]`

- [ ] **Step 1: เทสต์ API ที่ยังไม่ผ่าน** (ต่อท้าย `98-lens-requisition.test.php`)

```php
group('ใบเบิกเลนส์ — sync จากหน้าขายและการเปลี่ยนสถานะ');

/** ลูกค้า + เคส + ออเดอร์ (+ ใบค่าสายตา final ถ้าขอ) */
function lrFixture(Tx $q, bool $withFinal = true): array
{
    $tag  = bin2hex(random_bytes(3));
    $cust = (int) $q->run('INSERT INTO customers (first_name, last_name) VALUES (?, ?)', 'ทดสอบ', "ใบเบิก-$tag")['insertId'];
    $case = (int) $q->run('INSERT INTO cases (case_code, customer_id) VALUES (?, ?)', "TEST-LR-$tag", $cust)['insertId'];
    $rx   = null;
    if ($withFinal) {
        $rx = (int) $q->run(
            "INSERT INTO prescriptions (case_id, customer_id, kind, r_sphere, r_cylinder, r_axis, l_sphere, confirmed_at)
             VALUES (?, ?, 'final', '-1.25', '-0.50', '180', '-1.00', NOW())",
            $case, $cust
        )['insertId'];
    }
    $order = (int) $q->run(
        "INSERT INTO custom_orders (customer_id, case_id, order_date, frame_name, total_price, discount)
         VALUES (?, ?, NOW(), 'oldframe', 3000, 0)",
        $cust, $case
    )['insertId'];
    return ['customer' => $cust, 'case' => $case, 'rx' => $rx, 'order' => $order];
}

function lrItems(int $price = 1500): array
{
    $one = fn(string $eye) => [
        'eye' => $eye, 'source' => 'MOCK', 'mock_code' => 'MOCK-HOYA-TEST', 'brand' => 'HOYA',
        'lens_type' => 'Single Vision', 'design' => 'Nulux', 'lens_index' => '1.56',
        'coating' => 'VG', 'option_name' => 'Blue Control', 'quantity' => 1, 'unit_price' => $price,
    ];
    return [$one('R'), $one('L')];
}

function lrSync(int $order, array $items): array
{
    return Router::dispatch('POST', '/api/lens-requisitions/sync', [], ['order_id' => $order, 'items' => $items]);
}

function lrStatus(int $id, string $status, string $reason = ''): array
{
    return Router::dispatch('POST', "/api/lens-requisitions/$id/status", [], ['status' => $status, 'reason' => $reason]);
}

test('sync ครั้งแรกสร้างใบรอเบิก ผูกเคส ลูกค้า และคัดลอกค่าสายตาสุดท้าย', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $r = lrSync($f['order'], lrItems());
        eq($r['status'], 'pending', 'สถานะ');
        eq((int) $r['case_id'], $f['case'], 'เคส');
        eq((int) $r['customer_id'], $f['customer'], 'ลูกค้า');
        eq((int) $r['prescription_id'], $f['rx'], 'ใบค่าสายตา');
        eq($r['rx_snapshot']['r_sphere'], '-1.25', 'SPH ขวาในใบเบิก');
        eq(count($r['items']), 2, 'จำนวนรายการ');
        eq((float) $r['total'], 3000.0, 'ยอดรวม');
        ok(str_starts_with($r['req_no'], 'LR-'), 'เลขใบ ' . $r['req_no']);
    });
});

test('sync ซ้ำตอนยังรอเบิก แทนที่รายการในใบเดิม', function () {
    rollback(function (Tx $q) {
        $f  = lrFixture($q);
        $a  = lrSync($f['order'], lrItems(1500));
        $b  = lrSync($f['order'], [lrItems(2000)[0]]);
        eq((int) $b['id'], (int) $a['id'], 'ใบเดิม');
        eq(count($b['items']), 1, 'รายการใหม่');
        eq((float) $b['total'], 2000.0, 'ยอดใหม่');
    });
});

test('เบิกไปแล้ว sync ซ้ำตอบ 409', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $a = lrSync($f['order'], lrItems());
        lrStatus((int) $a['id'], 'issued');
        $code = null;
        try {
            lrSync($f['order'], lrItems(9));
        } catch (HttpError $e) {
            $code = $e->status;
        }
        eq($code, 409, 'รหัสตอบ');
    });
});

test('ยกเลิกใบเดิมแล้ว sync ได้ใบใหม่', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $a = lrSync($f['order'], lrItems());
        lrStatus((int) $a['id'], 'cancelled', 'ลูกค้าเปลี่ยนรุ่น');
        $b = lrSync($f['order'], lrItems(2500));
        ok((int) $b['id'] !== (int) $a['id'], 'ต้องเป็นใบใหม่');
    });
});

test('ไม่มีค่าสายตาสุดท้าย: ออกใบได้ แต่เบิกไม่ได้ จนกว่าจะยืนยันค่าสายตา', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q, false);
        $a = lrSync($f['order'], lrItems());
        eq($a['rx_snapshot'], null, 'ยังไม่มีค่าสายตา');
        $code = null;
        try {
            lrStatus((int) $a['id'], 'issued');
        } catch (HttpError $e) {
            $code = $e->status;
        }
        eq($code, 409, 'เบิกตอนไม่มีค่าสายตา');
        $q->run(
            "INSERT INTO prescriptions (case_id, customer_id, kind, r_sphere, confirmed_at) VALUES (?, ?, 'final', '-2.00', NOW())",
            $f['case'], $f['customer']
        );
        $b = lrStatus((int) $a['id'], 'issued');
        eq($b['status'], 'issued', 'เบิกได้หลังยืนยันค่าสายตา');
        eq($b['rx_snapshot']['r_sphere'], '-2.00', 'ดึงค่าสายตาใหม่ตอนเบิก');
        ok($b['issued_at'] !== null, 'ประทับเวลาเบิก');
    });
});

test('เปลี่ยนสถานะเขียนไทม์ไลน์เคส และยกเลิกต้องมีเหตุผล', function () {
    rollback(function (Tx $q) {
        $f = lrFixture($q);
        $a = lrSync($f['order'], lrItems());
        lrStatus((int) $a['id'], 'ordered');
        $ev = $q->get(
            "SELECT note FROM case_events WHERE case_id = ? AND action = 'lens_requisition_status' ORDER BY id DESC LIMIT 1",
            $f['case']
        );
        ok($ev !== null && str_contains($ev['note'], 'ส่งผลิต'), 'ไทม์ไลน์: ' . json_encode($ev, JSON_UNESCAPED_UNICODE));
        $code = null;
        try {
            lrStatus((int) $a['id'], 'cancelled');
        } catch (HttpError $e) {
            $code = $e->status;
        }
        eq($code, 400, 'ยกเลิกไม่มีเหตุผล');
    });
});

test('รายการรวมค้นด้วยรหัสเคสเจอ', function () {
    rollback(function (Tx $q) {
        $f    = lrFixture($q);
        lrSync($f['order'], lrItems());
        $code = $q->get('SELECT case_code FROM cases WHERE id = ?', $f['case'])['case_code'];
        $rows = Router::dispatch('GET', '/api/lens-requisitions', ['q' => $code]);
        eq(count($rows), 1, 'จำนวนที่เจอ');
        ok(str_contains($rows[0]['summary'], 'Nulux'), 'สรุปรายการ ' . $rows[0]['summary']);
        $byCase = Router::dispatch('GET', '/api/cases/' . $f['case'] . '/lens-requisitions');
        eq(count($byCase), 1, 'ใบของเคส');
    });
});
```

- [ ] **Step 2: รันให้เห็นว่าตก**

Run: `php api/tests/run.php lens-requisition`
Expected: ข้อใหม่ตกด้วย "ไม่พบเส้นทาง" หรือ 404

- [ ] **Step 3: เขียนเส้นทางใน `api/routes/lens.php`** (ต่อจาก require)

```php
/**
 * ใบเบิกเลนส์ของ Bewell
 *
 * หน้าขายบันทึกออเดอร์ด้วยเส้นทางเดิมก่อน แล้วค่อยเรียก /sync ที่นี่ — ออเดอร์เดิมจึงไม่มีอะไร
 * เปลี่ยน และ sync ที่พลาดไม่ทำให้ออเดอร์พัง
 */

function lensActorEmployee(): ?int
{
    $a = StockModule::actor();
    return isset($a['employeeId']) ? (int) $a['employeeId'] : null;
}

function lensReqLoad(int $id): array
{
    $r = Db::get(
        "SELECT lr.*, c.case_code, CONCAT_WS(' ', cu.first_name, cu.last_name) AS customer_name,
                cu.phone AS customer_phone, o.invoice_code, e.employee_name AS created_by_name
           FROM lens_requisitions lr
           JOIN cases c      ON c.id = lr.case_id
           JOIN customers cu ON cu.id = lr.customer_id
           LEFT JOIN custom_orders o ON o.id = lr.order_id
           LEFT JOIN employees e     ON e.id = lr.created_by
          WHERE lr.id = ?",
        $id
    );
    if (!$r) {
        missing('ไม่พบใบเบิกเลนส์');
    }
    $r['rx_snapshot']  = $r['rx_snapshot'] ? json_decode($r['rx_snapshot'], true) : null;
    $r['status_label'] = LensRequisition::LABEL[$r['status']] ?? $r['status'];
    $r['items']        = Db::all(
        "SELECT * FROM lens_requisition_items WHERE requisition_id = ? ORDER BY FIELD(eye, 'R', 'L', 'pair'), id",
        $id
    );
    return $r;
}

GET('/api/lens-requisitions', function (array $req) {
    $status = (string) ($req['query']['status'] ?? '');
    $term   = trim((string) ($req['query']['q'] ?? ''));
    $where  = [];
    $args   = [];
    if (isset(LensRequisition::LABEL[$status])) {
        $where[] = 'lr.status = ?';
        $args[]  = $status;
    }
    if ($term !== '') {
        $where[] = '(lr.req_no LIKE ? OR c.case_code LIKE ? OR cu.first_name LIKE ? OR cu.last_name LIKE ? OR cu.phone LIKE ?)';
        array_push($args, ...array_fill(0, 5, "%$term%"));
    }
    $rows = Db::all(
        "SELECT lr.id, lr.req_no, lr.case_id, lr.status, lr.total, lr.created_at,
                lr.rx_snapshot IS NOT NULL AS has_rx, c.case_code,
                CONCAT_WS(' ', cu.first_name, cu.last_name) AS customer_name,
                (SELECT GROUP_CONCAT(CONCAT(i.eye, ': ', CONCAT_WS(' ', i.brand, i.design, i.lens_index, i.coating))
                         ORDER BY FIELD(i.eye, 'R', 'L', 'pair') SEPARATOR ' · ')
                   FROM lens_requisition_items i WHERE i.requisition_id = lr.id) AS summary
           FROM lens_requisitions lr
           JOIN cases c      ON c.id = lr.case_id
           JOIN customers cu ON cu.id = lr.customer_id"
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . ' ORDER BY lr.id DESC LIMIT 300',
        ...$args
    );
    foreach ($rows as &$r) {
        $r['has_rx']       = (bool) $r['has_rx'];
        $r['status_label'] = LensRequisition::LABEL[$r['status']] ?? $r['status'];
    }
    unset($r);
    return $rows;
});

GET('/api/lens-requisitions/:id', fn(array $req) => lensReqLoad((int) $req['params']['id']));

GET('/api/cases/:id/lens-requisitions', function (array $req) {
    $ids = Db::all('SELECT id FROM lens_requisitions WHERE case_id = ? ORDER BY id DESC', (int) $req['params']['id']);
    return array_map(static fn($r) => lensReqLoad((int) $r['id']), $ids);
});

POST('/api/lens-requisitions/sync', function (array $req) {
    $orderId = int_or($req['body']['order_id'] ?? null);
    if (!$orderId) {
        bad('ต้องระบุออเดอร์');
    }
    $raw      = $req['body']['items'] ?? [];
    $items    = LensRequisition::cleanItems(is_array($raw) ? $raw : []);
    $employee = lensActorEmployee();

    $id = Db::tx(function (Tx $q) use ($orderId, $items, $employee) {
        $order = $q->get(
            'SELECT o.id, o.case_id, o.final_prescription_id, COALESCE(o.customer_id, c.customer_id) AS customer_id
               FROM custom_orders o LEFT JOIN cases c ON c.id = o.case_id
              WHERE o.id = ? FOR UPDATE',
            $orderId
        );
        if (!$order) {
            missing('ไม่พบออเดอร์');
        }
        if (!$order['case_id']) {
            bad('ออเดอร์นี้ไม่ได้ผูกกับเคส จึงออกใบเบิกเลนส์ไม่ได้');
        }
        $rx    = LensRequisition::finalRx($q, $order);
        $snap  = $rx ? json_encode(LensRequisition::snapshot($rx), JSON_UNESCAPED_UNICODE) : null;
        $total = round(array_sum(array_column($items, 'line_total')), 2);

        /* ใบที่ยังใช้งานของออเดอร์นี้มีได้ใบเดียว — ยกเลิกแล้วค่อยออกใบใหม่ */
        $open = $q->get(
            "SELECT id, status FROM lens_requisitions
              WHERE order_id = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1 FOR UPDATE",
            $orderId
        );
        if ($open && $open['status'] !== 'pending') {
            throw new HttpError(
                409,
                'ใบเบิกเลนส์ของออเดอร์นี้เบิกไปแล้ว แก้รายการไม่ได้ — ยกเลิกใบเดิมก่อนถ้าต้องการเปลี่ยนเลนส์',
                ['reason' => 'lens_req_locked']
            );
        }
        if ($open) {
            $id = (int) $open['id'];
            $q->run(
                'UPDATE lens_requisitions SET prescription_id = ?, rx_snapshot = ?, total = ? WHERE id = ?',
                $rx['id'] ?? null, $snap, $total, $id
            );
            $q->run('DELETE FROM lens_requisition_items WHERE requisition_id = ?', $id);
            $action = 'lens_requisition_updated';
        } else {
            $id = (int) $q->run(
                'INSERT INTO lens_requisitions (req_no, case_id, customer_id, order_id, prescription_id, rx_snapshot, total, created_by)
                 VALUES (?,?,?,?,?,?,?,?)',
                nextCode('LR', 'lens_requisitions', 'req_no'),
                (int) $order['case_id'], (int) $order['customer_id'], $orderId,
                $rx['id'] ?? null, $snap, $total, $employee
            )['insertId'];
            $action = 'lens_requisition_created';
        }
        foreach ($items as $it) {
            $q->run(
                'INSERT INTO lens_requisition_items (requisition_id, eye, source, mock_code, brand, lens_type, design,
                   lens_index, coating, option_name, photochromic, color, quantity, unit_price, line_total)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                $id, ...array_values($it)
            );
        }
        logEvent($q, (int) $order['case_id'], [
            'action' => $action, 'entity' => 'lens_requisition', 'entity_id' => $id, 'employee_id' => $employee,
        ]);
        return $id;
    });
    return lensReqLoad($id);
});

POST('/api/lens-requisitions/:id/status', function (array $req) {
    $id       = (int) $req['params']['id'];
    $to       = (string) ($req['body']['status'] ?? '');
    $reason   = mb_substr(trim((string) ($req['body']['reason'] ?? '')), 0, 255);
    $employee = lensActorEmployee();

    Db::tx(function (Tx $q) use ($id, $to, $reason, $employee) {
        $r = $q->get(
            'SELECT lr.*, o.final_prescription_id
               FROM lens_requisitions lr LEFT JOIN custom_orders o ON o.id = lr.order_id
              WHERE lr.id = ? FOR UPDATE',
            $id
        );
        if (!$r) {
            missing('ไม่พบใบเบิกเลนส์');
        }
        /* ค่าสายตาถูกยืนยันหลังออกใบ — ใบที่ยังรอเบิกยังไม่ได้ไปไหน ดึงค่าล่าสุดได้ */
        if (!$r['rx_snapshot'] && $r['status'] === 'pending') {
            $rx = LensRequisition::finalRx($q, $r);
            if ($rx) {
                $r['rx_snapshot'] = json_encode(LensRequisition::snapshot($rx), JSON_UNESCAPED_UNICODE);
                $q->run(
                    'UPDATE lens_requisitions SET prescription_id = ?, rx_snapshot = ? WHERE id = ?',
                    (int) $rx['id'], $r['rx_snapshot'], $id
                );
            }
        }
        $why = LensRequisition::transitionError($r['status'], $to, (bool) $r['rx_snapshot']);
        if ($why !== null) {
            throw new HttpError(409, $why, ['reason' => 'lens_req_transition']);
        }
        if ($to === 'cancelled' && $reason === '') {
            bad('ต้องระบุเหตุผลที่ยกเลิกใบเบิก');
        }
        $col = LensRequisition::STAMP[$to];
        $q->run(
            "UPDATE lens_requisitions SET status = ?, `$col` = NOW(), cancel_reason = ? WHERE id = ?",
            $to, $to === 'cancelled' ? $reason : $r['cancel_reason'], $id
        );
        logEvent($q, (int) $r['case_id'], [
            'action'      => 'lens_requisition_status',
            'entity'      => 'lens_requisition',
            'entity_id'   => $id,
            'employee_id' => $employee,
            'note'        => $r['req_no'] . ': ' . LensRequisition::LABEL[$r['status']] . ' → ' . LensRequisition::LABEL[$to]
                . ($reason !== '' ? ' · ' . $reason : ''),
            'payload'     => ['from' => $r['status'], 'to' => $to],
        ]);
    });
    return lensReqLoad($id);
});
```

- [ ] **Step 4: ลงทะเบียน** — `api/index.php` เพิ่ม `'lens'` ต่อจาก `'bookings', 'settings', 'logs',` และใน `ActivityLog.php`:
  - `ENTITIES`: `'/api/lens-requisitions' => 'lens_requisitions',`
  - `ENTITY_LABEL`: `'lens_requisitions' => 'ใบเบิกเลนส์',`

- [ ] **Step 5: รันให้ผ่าน + เทสต์เดิมไม่พัง**

Run: `php api/tests/run.php lens-requisition` → ผ่านครบ
Run: `php api/tests/run.php` → จำนวนที่ตกต้องไม่มากกว่าตอนก่อนเริ่มงาน (บันทึก baseline ไว้ก่อน Task 1)

- [ ] **Step 6: Commit**

```bash
git add api/routes/lens.php api/index.php api/services/ActivityLog.php api/tests/98-lens-requisition.test.php
git commit -m "ใบเบิกเลนส์: API sync / เปลี่ยนสถานะ / รายการ"
```

---

### Task 3: ข้อมูลเลนส์จำลอง + ตัวกรอง (frontend lib)

**Files:**
- Create: `frontend-next/lib/lens/mockLenses.js`
- Create: `frontend-next/lib/lens/lensSource.js`
- Test: `frontend-next/lib/__tests__/lensSource.test.js`

**Interfaces:**
- Produces: `MOCK_LENSES`, `LENS_SOURCE` (`'mock' | 'stock'`), `mockLabel(l)`, `toStockRow(l)` → `{id:null, mock:true, mock_code, sku, product_name, brand, lens_type, lens_design, lens_index, coating, option, photochromic, tint, price_pair, product_price}`, `searchMockLenses(term, {coating}, list?)`, `requisitionItems(items, prices)` → รายการสำหรับ `/sync`

- [ ] **Step 1: เทสต์ที่ยังไม่ผ่าน**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_LENSES } from '../lens/mockLenses.js';
import { searchMockLenses, toStockRow, requisitionItems } from '../lens/lensSource.js';

test('mock lenses: รหัสไม่ซ้ำ และทุกตัวมีราคาต่อคู่', () => {
  const codes = MOCK_LENSES.map((l) => l.mock_code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(MOCK_LENSES.every((l) => l.price_pair > 0));
});

test('toStockRow: ไม่ผูกล็อต และราคาข้างละครึ่งคู่', () => {
  const r = toStockRow(MOCK_LENSES[0]);
  assert.equal(r.id, null);
  assert.equal(r.mock, true);
  assert.equal(r.product_price * 2, MOCK_LENSES[0].price_pair);
  assert.equal(r.lens_design, MOCK_LENSES[0].design);
});

test('searchMockLenses: ค้นหลายคำแบบ AND', () => {
  const rows = searchMockLenses('hoya 1.60');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.brand === 'HOYA' && r.lens_index === '1.60'));
});

test('searchMockLenses: ตัวกรอง Coating ของหน้าเดิม — Auto = ปรับแสง, Blue = ตัดแสงฟ้า', () => {
  assert.ok(searchMockLenses('', { coating: 'Auto' }).every((r) => r.photochromic));
  assert.ok(searchMockLenses('', { coating: 'Blue' }).every((r) => /blue|guard|cut/i.test(r.option)));
});

test('requisitionItems: เฉพาะข้างที่เป็นเลนส์จำลอง พร้อมราคาของข้างนั้น', () => {
  const mock = toStockRow(MOCK_LENSES[0]);
  const items = requisitionItems(
    { lensOd: mock, lensOs: { id: 5, sku: 'LNS-1' } },
    { lens_od_price: 1500, lens_os_price: 900 },
  );
  assert.equal(items.length, 1);
  assert.deepEqual(
    [items[0].eye, items[0].unit_price, items[0].source, items[0].design],
    ['R', 1500, 'MOCK', MOCK_LENSES[0].design],
  );
  assert.deepEqual(requisitionItems(undefined, {}), []);
});
```

- [ ] **Step 2: รันให้เห็นว่าตก** — `cd frontend-next && node --test lib/__tests__/lensSource.test.js` → FAIL (module not found)

- [ ] **Step 3: เขียน `lib/lens/mockLenses.js`** (ประมาณ 37 รายการ ใช้ builder `L(brand, type, design, index, coating, option, photochromic, color, pricePair)` สร้าง `mock_code` จากทุกช่อง) และ `lib/lens/lensSource.js`:

```js
import { MOCK_LENSES } from './mockLenses.js';

/** 'mock' = Bewell (เลนส์จำลอง) · ไม่ตั้ง = เลือกเลนส์จากคลังแบบ TimeOptic เดิม */
export const LENS_SOURCE = process.env.NEXT_PUBLIC_LENS_SOURCE === 'mock' ? 'mock' : 'stock';

const BLUE = /blue|guard|cut/i;
/* ตัวกรอง Coating ของ LensPicker ใช้คำของคลัง TimeOptic — แปลงเป็นคำถามต่อเลนส์จำลอง */
const COATING_MATCH = {
  Hard: (l) => /hard/i.test(l.coating),
  MC: (l) => !/hard/i.test(l.coating),
  Auto: (l) => Boolean(l.photochromic),
  Blue: (l) => BLUE.test(l.option),
  'Auto-Blue': (l) => Boolean(l.photochromic) && BLUE.test(l.option),
};

export function mockLabel(l) {
  return [l.brand, l.lens_type, l.design, l.lens_index, l.coating, l.option, l.photochromic, l.color]
    .filter(Boolean).join(' ');
}

export function toStockRow(l) {
  return {
    id: null,
    mock: true,
    mock_code: l.mock_code,
    sku: l.mock_code,
    product_name: mockLabel(l),
    brand: l.brand,
    lens_type: l.lens_type,
    lens_design: l.design,
    lens_index: l.lens_index,
    coating: l.coating,
    option: l.option,
    photochromic: l.photochromic,
    tint: l.color,
    price_pair: l.price_pair,
    product_price: l.price_pair / 2,
  };
}

export function searchMockLenses(term = '', { coating = '' } = {}, list = MOCK_LENSES) {
  const words = String(term).toLowerCase().split(/\s+/).filter(Boolean);
  const byCoating = COATING_MATCH[coating];
  return list
    .filter((l) => !byCoating || byCoating(l))
    .filter((l) => {
      const hay = `${mockLabel(l)} ${l.mock_code}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .map(toStockRow);
}

export function requisitionItems(items, prices) {
  const out = [];
  for (const [slot, eye, priceKey] of [['lensOd', 'R', 'lens_od_price'], ['lensOs', 'L', 'lens_os_price']]) {
    const r = items?.[slot];
    if (!r?.mock) continue;
    out.push({
      eye,
      source: 'MOCK',
      mock_code: r.mock_code,
      brand: r.brand,
      lens_type: r.lens_type,
      design: r.lens_design,
      lens_index: r.lens_index,
      coating: r.coating,
      option_name: r.option || '',
      photochromic: r.photochromic || '',
      color: r.tint || '',
      quantity: 1,
      unit_price: Number(prices?.[priceKey]) || 0,
    });
  }
  return out;
}
```

- [ ] **Step 4: รันให้ผ่าน** — `node --test lib/__tests__/lensSource.test.js` → PASS · `npm test` → ผ่านครบ
- [ ] **Step 5: Commit** — `git add frontend-next/lib/lens frontend-next/lib/__tests__/lensSource.test.js && git commit -m "เลนส์จำลองของ Bewell + ตัวค้นหา"`

---

### Task 4: ต่อเลนส์จำลองเข้าหน้าขาย

**Files:**
- Create: `frontend-next/components/MockLensPicker.jsx`
- Modify: `frontend-next/app/(frontdesk)/orders/OrderFormView.jsx` (import, จุดเรียก `<StockPicker type="Lens">`, หลังบันทึกสำเร็จ)
- Modify: `frontend-next/.env.local` (`NEXT_PUBLIC_LENS_SOURCE=mock`, gitignored)

**Interfaces:**
- Consumes: `searchMockLenses`, `LENS_SOURCE`, `requisitionItems` (Task 3), `POST /api/lens-requisitions/sync` (Task 2)
- Produces: `<MockLensPicker picked onPick onClear />` props เดียวกับ `StockPicker`

- [ ] **Step 1: `components/MockLensPicker.jsx`**

```jsx
'use client';
/**
 * เลือกเลนส์จำลองของ Bewell — หน้าตาเดียวกับการเลือกเลนส์จากคลัง (LensPicker ตัวเดิม)
 * ต่างกันแค่แหล่งข้อมูล: ไฟล์ lib/lens/mockLenses.js ไม่ใช่ /api/stock
 *
 * แถวที่ส่งออกไปมี id เป็น null เสมอ ออเดอร์จึงไม่ผูกล็อต และขั้นขายไม่ตัดสต็อกเลนส์
 * (ทางเดียวกับชื่อเลนส์ที่พิมพ์เอง) · ของที่ต้องเบิกไปอยู่ในใบเบิกเลนส์แทน
 */
import { useState } from 'react';
import { LensPicker } from './LensPicker.jsx';
import { Icon } from './Icon.jsx';
import { searchMockLenses } from '../lib/lens/lensSource.js';

const baht = (n) => Number(n || 0).toLocaleString('th-TH');
const mockStock = (r) => ({ text: `สั่งตามเคส · คู่ละ ${baht(r.price_pair)} บาท`, tone: 'new' });

export function MockLensPicker({ picked = null, onPick, onClear = null }) {
  const [open, setOpen] = useState(false);

  if (picked?.mock && !open) {
    const sub = `เลนส์จำลอง · สั่งตามเคส · คู่ละ ${baht(picked.price_pair)} บาท`;
    return (
      <div className="picked-item">
        <Icon name="glasses" />
        <b>{picked.product_name}</b>
        <span className="muted" title={sub}>{sub}</span>
        <span className="p-id">{picked.mock_code}</span>
        <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(true)}>เปลี่ยน</button>
        {onClear && (
          <button type="button" className="btn btn-sm btn-light" onClick={onClear}>ล้าง</button>
        )}
      </div>
    );
  }

  return (
    <>
      <LensPicker
        placeholder="ยี่ห้อ / รุ่น / Index / เคลือบ"
        fetcher={(term, params) => Promise.resolve(searchMockLenses(term, params))}
        label={(r) => r.product_name}
        stock={mockStock}
        onPick={(r) => { setOpen(false); onPick(r); }}
      />
      {picked?.mock && (
        <div className="pick-actions">
          <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(false)}>
            ยกเลิกการเปลี่ยน
          </button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: `OrderFormView.jsx`** — เพิ่ม import:

```js
import { MockLensPicker } from '../../../components/MockLensPicker.jsx';
import { LENS_SOURCE, requisitionItems } from '../../../lib/lens/lensSource.js';
```

ครอบ `<StockPicker type="Lens" …/>` ด้วยเงื่อนไข (StockPicker เดิมไม่แก้):

```jsx
                      {LENS_SOURCE === 'mock' ? (
                        <MockLensPicker
                          picked={item}
                          onPick={(r) => setPicked({ [slot]: r })}
                          onClear={() => setItems({ ...picked, [slot]: null })}
                        />
                      ) : (
                        <StockPicker … เดิมทุกบรรทัด … />
                      )}
```

หลัง `const oid = editing ? id : saved.id;` เพิ่ม:

```js
      /* Bewell: เลนส์จำลองที่เลือกในรอบนี้ → ใบเบิกเลนส์ · `items` มีค่าเฉพาะตอนมีคนแตะ
         ตัวเลือกในรอบนี้ เปิดออเดอร์เก่ามาแก้เรื่องอื่นจึงไม่ล้างใบเบิกเดิม
         เรียกพลาดไม่ทำให้ออเดอร์พัง — ออเดอร์บันทึกไปแล้วด้วยเส้นทางเดิม */
      const lensItems = LENS_SOURCE === 'mock' ? requisitionItems(items, p) : [];
      if (lensItems.length) {
        try {
          await api.post('/api/lens-requisitions/sync', { order_id: oid, items: lensItems });
        } catch (ex) {
          err('บันทึกออเดอร์แล้ว แต่ออกใบเบิกเลนส์ไม่สำเร็จ: ' + (ex?.message || ex));
        }
      }
```

- [ ] **Step 3: ตั้ง `.env.local`** เพิ่มบรรทัด `NEXT_PUBLIC_LENS_SOURCE=mock` แล้วรีสตาร์ต `next dev` (ค่า NEXT_PUBLIC ถูกฝังตอนคอมไพล์)
- [ ] **Step 4: ตรวจ** — `npm test` ผ่านครบ · เปิด :3020 → เคส → ขั้นขาย → เลนส์ขวาเห็นรายการจำลอง ค้น "hoya 1.60" ได้ เลือกแล้วราคาข้างละครึ่งคู่ บันทึกแล้ว `SELECT * FROM lens_requisitions` มีใบ
- [ ] **Step 5: Commit** — `git add frontend-next/components/MockLensPicker.jsx "frontend-next/app/(frontdesk)/orders/OrderFormView.jsx" && git commit -m "หน้าขาย: เลือกเลนส์จำลองได้เมื่อ LENS_SOURCE=mock และออกใบเบิกหลังบันทึก"`

---

### Task 5: หน้าจอใบเบิก (แท็บเคส, หน้ารวม, หน้าพิมพ์, เมนู)

**Files:**
- Create: `frontend-next/lib/lens/requisition.js` (ป้ายสถานะ + ปุ่มที่กดได้ต่อสถานะ)
- Create: `frontend-next/components/LensRequisitionCard.jsx`
- Create: `frontend-next/app/(frontdesk)/cases/detail/panels/LensRequisitionPanel.jsx`
- Create: `frontend-next/app/(frontdesk)/lens-requisitions/page.jsx`
- Create: `frontend-next/app/(frontdesk)/print/lens-requisition/page.jsx`
- Modify: `frontend-next/app/(frontdesk)/cases/detail/page.jsx` (`EXTRA_VIEWS` + `EXTRA_PANELS` + import)
- Modify: `frontend-next/components/Shell.jsx` (เมนู "งานหน้าร้าน")
- Modify: `frontend-next/lib/crumb.js` (ชื่อหน้า) · `frontend-next/lib/constants.js` (`ACTION_LABEL` 3 ค่า)
- Test: `frontend-next/lib/__tests__/lensRequisition.test.js`

**Interfaces:**
- Consumes: HTTP ของ Task 2
- Produces: `STATUS_LABEL`, `STATUS_TONE`, `nextActions(status, hasRx)` → `[{to, label}]`

- [ ] **Step 1: เทสต์ `nextActions`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextActions } from '../lens/requisition.js';

test('รอเบิก: ปุ่มถัดไปทุกขั้น + ยกเลิก', () => {
  assert.deepEqual(nextActions('pending', true).map((a) => a.to),
    ['issued', 'ordered', 'received', 'assembled', 'cancelled']);
});
test('ไม่มีค่าสายตา: เหลือแค่ยกเลิก', () => {
  assert.deepEqual(nextActions('pending', false).map((a) => a.to), ['cancelled']);
});
test('ประกอบแล้ว / ยกเลิก: ไม่มีปุ่ม', () => {
  assert.deepEqual(nextActions('assembled', true), []);
  assert.deepEqual(nextActions('cancelled', true), []);
});
```

- [ ] **Step 2: `lib/lens/requisition.js`** (ให้ตรงกับ `LensRequisition::transitionError` ฝั่ง API)

```js
export const FLOW = ['pending', 'issued', 'ordered', 'received', 'assembled'];
export const STATUS_LABEL = {
  pending: 'รอเบิก', issued: 'เบิกแล้ว', ordered: 'ส่งผลิต / สั่งเลนส์',
  received: 'ได้รับเลนส์', assembled: 'ประกอบแล้ว', cancelled: 'ยกเลิก',
};
export const STATUS_TONE = {
  pending: 'orange', issued: 'blue', ordered: 'blue', received: 'purple', assembled: 'green', cancelled: 'red',
};
export function nextActions(status, hasRx) {
  if (status === 'cancelled' || status === 'assembled') return [];
  const ahead = hasRx ? FLOW.slice(FLOW.indexOf(status) + 1) : [];
  return [...ahead, 'cancelled'].map((to) => ({ to, label: STATUS_LABEL[to] }));
}
```

- [ ] **Step 3: `LensRequisitionCard.jsx`** — การ์ดหนึ่งใบ: หัว (เลขใบ, Badge สถานะ, ยอด), ป้ายเตือนเมื่อ `rx_snapshot` เป็น null, ตารางค่าสายตา R/L (SPH/CYL/AXIS/ADD/PD), ตารางรายการ (ข้าง, ยี่ห้อ, ชนิด, รุ่น, Index, เคลือบ, ออปชัน, ปรับแสง, สี, จำนวน, ราคา), ผู้สร้าง/วันที่, ปุ่มจาก `nextActions` (ยกเลิกถามเหตุผลด้วย `window.prompt`), ลิงก์พิมพ์ `/print/lens-requisition?id=` · กดปุ่ม → `POST /api/lens-requisitions/:id/status` → `onChanged()`
- [ ] **Step 4: `LensRequisitionPanel.jsx`** — `useAsync(() => api.get('/api/cases/'+c.id+'/lens-requisitions'))` แสดง `LensRequisitionCard` ทุกใบ ไม่มีใบ → ข้อความ "ยังไม่มีใบเบิกเลนส์ — เลือกเลนส์จำลองในขั้นขายแล้วกดบันทึก" · ลงทะเบียน `['lens', 'ใบเบิกเลนส์']` ใน `EXTRA_VIEWS` ก่อน `timeline` และ `lens: LensRequisitionPanel` ใน `EXTRA_PANELS`
- [ ] **Step 5: หน้า `/lens-requisitions`** — `PageHead` + `Tabs`/ปุ่มกรองสถานะ (ทั้งหมด + 6 สถานะ) + ช่องค้นหา + ตาราง (เลขใบ, รหัสเคสลิงก์ไป `/cases/detail?id=&step=lens`, ลูกค้า, สรุปเลนส์, ยอด, สถานะ, วันที่) · เรียก `GET /api/lens-requisitions?status=&q=`
- [ ] **Step 6: หน้า `/print/lens-requisition`** — ใช้ `QueryParamPage` + `useAsync(api.get('/api/lens-requisitions/'+id))` วาดใบ A4 (หัว "ใบเบิกเลนส์", เลขใบ, วันที่, เคส, ลูกค้า, ออเดอร์, ตารางค่าสายตา, ตารางเลนส์, ยอด, ผู้สร้าง, ช่องลงชื่อผู้เบิก/ผู้รับ) ปุ่มพิมพ์ `window.print()` ซ่อนด้วย `.no-print`
- [ ] **Step 7: เมนู + ชื่อหน้า + ป้ายไทม์ไลน์**
  - `Shell.jsx` กลุ่ม "งานหน้าร้าน" ต่อจากออเดอร์ตัดแว่น: `['glasses', 'ใบเบิกเลนส์', '/lens-requisitions'],`
  - `crumb.js` TITLES: `['/lens-requisitions', 'ใบเบิกเลนส์'], ['/print/lens-requisition', 'พิมพ์ใบเบิกเลนส์'],`
  - `constants.js` ACTION_LABEL: `lens_requisition_created: 'ออกใบเบิกเลนส์', lens_requisition_updated: 'แก้รายการใบเบิกเลนส์', lens_requisition_status: 'เปลี่ยนสถานะใบเบิกเลนส์',`
- [ ] **Step 8: ตรวจ** — `npm test` ผ่าน · เปิดแท็บ "ใบเบิกเลนส์" ของเคสที่ทำใน Task 4 → กดเบิกแล้ว → ส่งผลิต → ได้รับ → ประกอบแล้ว → ไทม์ไลน์มีรายการ · หน้ารวมกรองสถานะได้ · หน้าพิมพ์ขึ้นครบ
- [ ] **Step 9: Commit** — `git add` ไฟล์ทั้งหมดของ task นี้ แล้ว `git commit -m "หน้าจอใบเบิกเลนส์: แท็บในเคส หน้ารวม หน้าพิมพ์ เมนู"`

---

### Task 6: ตรวจรวม

- [ ] `php api/tests/run.php` — ไม่มีข้อที่ตกเพิ่มจาก baseline
- [ ] `cd frontend-next && npm test` — ผ่านครบ
- [ ] `npx next build` ไม่จำเป็น (เว็บรันด้วย dev) · ตรวจว่า dev ไม่มี error ใน `web-3020.log`
- [ ] ปิด `NEXT_PUBLIC_LENS_SOURCE` ชั่วคราวแล้วเปิดหน้าขาย → ต้องเห็นตัวเลือกเลนส์จากคลังแบบเดิม (ยืนยันว่าโหมด TimeOptic ไม่เปลี่ยน) แล้วตั้งกลับ
