# ถึงฝั่งหน้าร้าน — ตัดสต็อกยังไง

วิเคราะห์ถูกหมด แต่แผน 1–4 **ใช้ไม่ได้แล้ว เพราะเราตัดสินใจรวมเป็น repo เดียวกัน**

พอโค้ดอยู่โปรเจกต์เดียวกัน ฐานข้อมูลเดียวกัน PHP เดียวกัน — **ไม่ต้องคุยกันผ่าน HTTP**
`pickLot()` เรียกฟังก์ชันตรงๆ ได้เลย

## ทิ้งได้เลย

| จากแผนเดิม | เพราะ |
|---|---|
| `StockClient.php` | ไม่ต้องมี ไม่มี HTTP ให้ยิง |
| base URL / config IP | ไม่ต้องมี |
| login + cookie `optic_session` | ไม่ต้องมี — session เดียวกันอยู่แล้ว |
| บัญชี service + เลือก role | ไม่ต้องมี — คนที่กดคือคนที่ล็อกอินอยู่ |
| `stock_api.mode = direct\|api` | ไม่ต้องมี — มีทางเดียว |

---

## ตัดสต็อก

```php
use Optic\Service\StockGate;

$out = StockGate::issue([
    'source'        => 'frontdesk',
    'idem_key'      => "case-{$case['case_code']}-line-{$line}",
    'sku'           => $item['sku'],
    'quantity'      => 1,
    'reference_doc' => $case['case_code'],
    'note'          => 'เริ่มผลิต',
]);

// $out['cuts'] = [ ['lot' => 'LOT-2026-014', 'lot_id' => 512, 'quantity' => 1, 'unit_cost' => '1980.00'], ... ]
// $out['total_cost'], $out['remaining_after']
```

เอา `$out['cuts'][n]['lot_id']` ไปลง `production_withdrawals.stock_lot_id` แทนที่จะเลือกล็อตเอง

**ฟังก์ชันที่มี**

| | |
|---|---|
| `StockGate::availability($sku)` | เช็คของก่อนรับปากลูกค้า |
| `StockGate::issue($req)` | ตัดออก — ขาย เบิกใช้ ผลิต |
| `StockGate::scrap($req)` | ตัดของเสีย (แยกจาก issue ของเสียจะได้ไม่ปนต้นทุนขาย) |
| `StockGate::returnStock($req)` | คืนของ ส่ง `reverses_key` = `idem_key` ของรายการเดิม |

**พารามิเตอร์ที่บังคับ:** `source` · `idem_key` · `sku` · `quantity`
**ที่ควรส่ง:** `reference_doc` = `case_code` · `note`

---

## สามอย่างที่ต้องรู้

### 1 · `idem_key` ต้องคงเดิมเมื่อ retry

เป็นสิ่งเดียวที่กันตัดซ้ำ ยิงคีย์เดิมสองครั้งจะได้คำตอบเดิมโดยไม่ตัดของรอบสอง

```
✅ case-<case_code>-line-<n>     ประกอบจากสิ่งที่ระบุรายการนั้นได้จริง
❌ uuid_v4()                     สุ่มใหม่ทุกครั้ง = retry กลายเป็นตัดสองรอบเงียบๆ
```

### 2 · ไม่ต้องส่ง id คนทำรายการ

`StockGate` อ่านจาก `Auth::actor()` เอง ซึ่งอ่าน `$_SESSION` ตัวเดียวกับที่หน้าร้าน
ล็อกอินไว้ ส่ง `actor_id` มาก็ถูกทับเสมอ

นี่คือสิ่งที่แก้ปัญหา `created_by = NULL` ทั้ง 51 แถว — โดยไม่ต้องส่งฟิลด์อะไรเพิ่มเลย

> ทำได้เพราะทั้งสองฝั่งใช้ `session_name('optic_session')` และ `session_save_path()`
> เดียวกัน ถ้าโค้ดหน้าร้าน `session_start()` เองอยู่แล้ว ให้ตั้งสองค่านี้ให้ตรงก่อน
> — หรือเรียก `Auth::start()` แทนไปเลย

### 3 · อย่าเขียนตารางเอง

`UPDATE stock_lots` / `INSERT inventory_logs` — เลิกทั้งหมด **ในคอมมิตเดียวกับที่เปลี่ยน
มาเรียก `StockGate`** ถ้าสองทางทำงานพร้อมกันแม้ชั่วโมงเดียว ของจะถูกตัดสองรอบต่องาน
และไม่มีใครสังเกตจนกว่าจะนับสต็อก

การตัดหนึ่งครั้งคือ: เลือกล็อตตาม FIFO → ล็อกแถวกันขายเกิน → คิดต้นทุนของก้อนที่ตัด →
ลงสมุด ทั้งหมดใน transaction เดียว เขียน SQL เองได้ยอดที่ถูกแต่ต้นทุนที่ผิด

---

## error

โยน `Optic\ApiError` มี `->reason` กับ `->getMessage()` (ข้อความไทย เอาไปโชว์ได้เลย)

```php
try {
    $out = StockGate::issue([...]);
} catch (\Optic\ApiError $e) {
    // insufficient · unknown_sku · custom_made · in_flight · forbidden
    if ($e->reason === 'insufficient') {
        $available = $e->extra['available'];
    }
    return ['error' => $e->getMessage()];
}
```

---

## 51 แถวเก่า

| ช่อง | ย้อนได้ | |
|---|---|---|
| `unit_cost` | **16 / 51** | จะทำให้ — ย้อนจาก `lot_id` ที่บันทึกไว้แล้ว แม่นยำ ไม่ใช่เดา |
| `reference_doc` | 14 / 51 | ยังไม่ทำ — จับคู่ด้วยเวลา ±120 วิ เป็นการอนุมาน ผูกผิดแย่กว่าปล่อยว่าง |
| `created_by` | 0 / 51 | ไม่เคยถูกบันทึกที่ไหนเลย |

อีก 35 แถวที่ย้อน `unit_cost` ไม่ได้ เพราะล็อตนั้นเองยังไม่มีต้นทุน (รอใบกำกับ)
พอบัญชีลงต้นทุนล็อต ค่อยย้อนเพิ่มได้

**ถ้ามี log ที่ผูก `case_id` กับแถวใน `inventory_logs` ได้แน่นอน ส่งมา** แล้วย้อนให้ครบทั้ง 51

---

## หมายเหตุ

`unit_cost` / `total_cost` ที่ได้กลับมาเป็นตัวเลขจริงเสมอเมื่อเรียกแบบนี้ — ที่เคยบอกว่า
role `staff` จะไม่เห็นต้นทุน อันนั้นเป็นการตัดข้อมูลของชั้น HTTP ไม่ใช่ของ `StockGate`
ถ้าจะเอาไปโชว์บนจอพนักงาน ต้องเช็ค `Roles::seeCost($actor['role'])` เอง
