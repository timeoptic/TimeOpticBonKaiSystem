<?php
/**
 * เลขใบเสร็จ — ชุดเลขของ "ใบที่ออกให้ลูกค้าจริง"
 *
 * ออกเลขตอนเปิดออเดอร์ / กดขาย POS ใน transaction เดียวกัน (ตั้งแต่ 1 ต.ค. 2026)
 * เดิมออกตอนมีคนเปิดหน้าใบเสร็จครั้งแรก ใบที่เปิดย้อนหลังจึงได้เลขท้ายแถว เช่นบิล
 * วันที่ 08/09 ได้ Bill-2026-10-00041 ต่อจากบิลวันที่ 26/09 บัญชีไล่ตามไม่ได้
 * ตอนนี้เลขเดินตามลำดับวันที่บนใบ (order_date / sale_date) ซึ่งเป็นวันเปิดบิล
 *
 * รูปแบบ  Bill-2026-09-00042   ใบเสร็จของเคสแว่น
 *         BillP-2026-09-00007  ใบเสร็จของการขาย POS  (คนละชุด เดินเลขแยกกัน)
 * ปีกับเดือนมาจากวันที่บนใบ เลขท้ายเดินยาวทั้งปี ไม่รีเซ็ตรายเดือน
 *
 * เลขที่ออกแล้วไม่หาย: ลบออเดอร์ / ยกเลิกใบขาย แถวยังอยู่และถูกตีตรายกเลิก
 * (voided_at) ชุดเลขจึงต่อเนื่องไม่มีหลุด
 *
 * ออกเลขครั้งเดียวต่อใบ แล้วผูกถาวร — เปิดหน้าซ้ำ ลูกค้าทำใบหายมาขอใหม่ หรือ
 * พนักงานสองคนเปิดพร้อมกัน ก็ได้เลขเดิมเสมอ ข้อนี้บังคับด้วย UNIQUE ที่ฐาน
 * (uq_receipt_order / uq_receipt_sale) ไม่ใช่ด้วยความระวังของโค้ดเรียก
 *
 * เรียงเลขใหม่ทั้งปี: api/cli/renumber-receipts.php
 */
declare(strict_types=1);

/** ชุดเลขของแต่ละที่มา — คีย์คือชนิดใบ ค่าคือคำนำหน้าเลข */
const RECEIPT_PREFIX = ['order' => 'Bill', 'sale' => 'BillP'];

/** วันที่บนใบวันแรกที่ได้เลขชุดนี้ — บิลก่อนหน้านี้อยู่ยุคระบบ Access ใช้เลขบิลเดิม (C…)
 *  ร้านเลือกเริ่มที่ 1 ก.ย. 2026 (1 ต.ค. 2026) ไม่ย้อนทั้งปี เพราะเดือน 1–8 ออกใบจากระบบเก่าไปแล้ว */
const RECEIPT_START = '2026-09-01';

/** แถวใบเสร็จของออเดอร์/ใบขายนี้ ถ้ายังไม่เคยออกเลขคืน null */
function receiptFor(string $kind, int $id): ?array
{
    $col = $kind === 'order' ? 'order_id' : 'sale_id';
    return Db::get("SELECT * FROM receipts WHERE $col = ?", $id) ?: null;
}

/**
 * เลขถัดไปของชุดนี้ในปีของ $docDate — ต้องเรียกใน transaction
 *
 * แถวตัวนับถูกล็อก FOR UPDATE จนจบ transaction ของคนเรียก สองเครื่องที่เปิด
 * ออเดอร์พร้อมกันจึงได้เลขต่อกัน ไม่ใช่เลขเดียวกันแล้วฝั่งหนึ่ง rollback ทั้งออเดอร์
 * ปีที่ยังไม่มีแถวตัวนับ ตั้งต้นจากเลขสูงสุดที่มีอยู่ใน receipts ของปีนั้น
 */
function nextReceiptNo(Tx $q, string $prefix, string $docDate): string
{
    $ts   = strtotime($docDate) ?: time();
    $year = (int) date('Y', $ts);
    $q->run(
        "INSERT IGNORE INTO receipt_counters (prefix, year, last_no)
         SELECT ?, ?, COALESCE(MAX(CAST(SUBSTRING_INDEX(receipt_no, '-', -1) AS UNSIGNED)), 0)
           FROM receipts WHERE receipt_no LIKE ?",
        $prefix,
        $year,
        "$prefix-$year-%"
    );
    $n = (int) $q->get(
        'SELECT last_no FROM receipt_counters WHERE prefix = ? AND year = ? FOR UPDATE',
        $prefix,
        $year
    )['last_no'] + 1;
    $q->run('UPDATE receipt_counters SET last_no = ? WHERE prefix = ? AND year = ?', $n, $prefix, $year);
    return sprintf('%s-%d-%s-%0' . CODE_PAD . 'd', $prefix, $year, date('m', $ts), $n);
}

/**
 * ออกเลขให้ออเดอร์/ใบขายนี้ภายใน transaction ของคนเรียก — มีแล้วคืนของเดิม
 * ใช้ตอนเปิดออเดอร์ (routes/orders.php) และตอนขาย POS (routes/pos.php)
 */
function issueReceiptIn(Tx $q, string $kind, int $id, string $docDate, float $total, ?int $by): array
{
    $col = $kind === 'order' ? 'order_id' : 'sale_id';
    if ($row = $q->get("SELECT * FROM receipts WHERE $col = ?", $id)) {
        return $row;
    }
    $q->run(
        "INSERT INTO receipts (receipt_no, $col, doc_date, total_amount, issued_by)
         VALUES (?, ?, ?, ?, ?)",
        substr($docDate, 0, 10) >= RECEIPT_START ? nextReceiptNo($q, RECEIPT_PREFIX[$kind], $docDate) : null,
        $id,
        substr($docDate, 0, 10),
        $total,
        $by
    );
    return $q->get("SELECT * FROM receipts WHERE $col = ?", $id);
}

/**
 * ตีตรายกเลิกใบเสร็จของออเดอร์/ใบขายนี้ — เลขยังอยู่ในชุด ไม่ลบแถว
 * $detach = true ตอนจะลบออเดอร์ทิ้ง: ปลด order_id ก่อน (FK เป็น SET NULL อยู่แล้ว
 * แต่ทำเองชัดกว่า) แล้วให้ void_reason จำไว้ว่าเคยเป็นของออเดอร์ไหน
 */
function voidReceiptIn(Tx $q, string $kind, int $id, string $reason, bool $detach = false): void
{
    $col = $kind === 'order' ? 'order_id' : 'sale_id';
    $q->run(
        "UPDATE receipts SET voided_at = COALESCE(voided_at, NOW()), void_reason = ?"
            . ($detach ? ", $col = NULL" : '') . " WHERE $col = ?",
        mb_substr($reason, 0, 255),
        $id
    );
}

/**
 * ออกเลขใบเสร็จให้ออเดอร์/ใบขายนี้ — มีอยู่แล้วคืนของเดิม ไม่สร้างใหม่
 *
 * ออเดอร์ใหม่ได้เลขตั้งแต่ตอนเปิดแล้ว ทางนี้เหลือไว้ให้ออเดอร์เก่าที่ยังไม่มีเลข
 * (เช่นปีก่อน ๆ ที่ไม่ได้อยู่ในรอบเรียงเลขใหม่) · เลขตามปี/เดือนของวันที่บนใบ
 *
 * การชนกันของสองคนที่กดพร้อมกันจบที่ UNIQUE ของฐาน ไม่ใช่ที่ล็อกในโค้ด:
 * ฝั่งที่แพ้ได้ error แล้ววนกลับไปอ่านแถวที่ฝั่งชนะเพิ่งเขียน จึงได้เลขเดียวกัน
 * ลองใหม่ 3 รอบพอ — เกินกว่านั้นแปลว่าไม่ใช่การชนกันธรรมดา ต้องให้มันดังออกมา
 */
function issueReceipt(string $kind, int $id, string $docDate, float $total, ?int $by): array
{
    for ($attempt = 0; $attempt < 3; $attempt++) {
        if ($row = receiptFor($kind, $id)) {
            return $row;
        }
        try {
            Db::tx(fn(Tx $q) => issueReceiptIn($q, $kind, $id, $docDate, $total, $by));
        } catch (PDOException $e) {
            /* 1062 = ชนกับ UNIQUE ตัวใดตัวหนึ่ง (เลขซ้ำ หรือใบนี้เพิ่งมีเลขไปแล้ว)
               ทั้งสองกรณีคำตอบเดียวกันคือ "วนไปอ่านของที่มีอยู่" ไม่ใช่โยนให้คนกด

               ต้องดู errno ไม่ใช่ SQLSTATE: FK ล้ม (1452 — อ้างถึงออเดอร์ที่ไม่มีจริง)
               เป็น SQLSTATE '23000' เหมือนกัน ถ้าดักรวมกันจะกลืนบั๊กจริงไปวนซ้ำสามรอบ
               แล้วโผล่มาเป็น "ออกเลขไม่สำเร็จ" ซึ่งชี้ผิดที่ */
            if ((int) ($e->errorInfo[1] ?? 0) !== 1062) {
                throw $e;
            }
        }
    }
    if ($row = receiptFor($kind, $id)) {
        return $row;
    }
    bad('ออกเลขใบเสร็จไม่สำเร็จ กรุณาลองใหม่');
}

/**
 * POST /api/receipts  { order_id } หรือ { sale_id }
 * เรียกซ้ำได้ปลอดภัย — หน้าใบเสร็จเรียกทุกครั้งที่เปิด แล้วได้เลขเดิมกลับไป
 */
POST('/api/receipts', function (array $req) {
    $actor = StockModule::actor();
    if ($actor === null) {
        bad('ต้องเข้าสู่ระบบก่อน');
    }
    $body    = $req['body'];
    $orderId = int_or($body['order_id'] ?? null);
    $saleId  = int_or($body['sale_id'] ?? null);
    if (($orderId === null) === ($saleId === null)) {
        bad('ต้องระบุ order_id หรือ sale_id อย่างใดอย่างหนึ่ง');
    }

    /* ยอดบนใบต้องมาจากฐาน ไม่ใช่จากตัวเลขที่หน้าเว็บส่งมา — ใบเสร็จที่เชื่อ
       ตัวเลขฝั่งเบราว์เซอร์คือใบเสร็จที่แก้ยอดได้ด้วย devtools */
    if ($orderId !== null) {
        $o = Db::get('SELECT total_price, discount, order_date, invoice_code FROM custom_orders WHERE id = ?', $orderId);
        if (!$o) {
            missing();
        }
        $total = round2((float) $o['total_price'] - (float) $o['discount']);
        $row   = issueReceipt('order', $orderId, (string) ($o['order_date'] ?: nowStamp()), $total, int_or($actor['id'] ?? null));
        /* บิลก่อน RECEIPT_START ไม่มีเลข Bill — ใบพิมพ์เลขบิลเดิมของระบบ Access แทน
           (แค่ในคำตอบ ไม่เขียนลงฐาน ชุดเลข Bill จึงไม่มีเลขแปลกปน) */
        if ($row['receipt_no'] === null) {
            $row['receipt_no'] = (string) ($o['invoice_code'] ?? '');
        }
        return $row;
    }

    $s = Db::get('SELECT total_amount, status, sale_date FROM pos_sales WHERE id = ?', $saleId);
    if (!$s) {
        missing();
    }
    /* ใบขายที่ยกเลิกไปแล้วต้องออกใบเสร็จไม่ได้ — ใบเสร็จคือหลักฐานว่ารับเงินจริง
       (หน้า POS ซ่อนปุ่มไว้แล้ว แต่ที่ซ่อนปุ่มอย่างเดียวคือที่ไม่ได้กันอะไรเลย) */
    if ((string) $s['status'] === 'void') {
        bad('ใบขายนี้ถูกยกเลิกแล้ว ออกใบเสร็จไม่ได้');
    }
    return issueReceipt('sale', $saleId, (string) ($s['sale_date'] ?: nowStamp()), round2((float) $s['total_amount']), int_or($actor['id'] ?? null));
});

/**
 * PUT /api/receipts/:id/bill — บล็อกลูกค้าที่พิมพ์ลงใบนี้จริง
 *
 * แยกจาก POST /api/receipts เพราะเป็นคนละเหตุการณ์: เปิดหน้า = ออกเลข ·
 * กดพิมพ์ = ตกลงว่าจะเอาชื่อชุดนี้ลงกระดาษ ใบที่เปิดดูเฉย ๆ แล้วปิดไปจึงมีเลข
 * แต่ไม่มีบล็อกลูกค้า ซึ่งตรงกับสิ่งที่เกิดขึ้นจริง
 *
 * เขียนทับได้ — พิมพ์ใหม่ด้วยชื่ออื่นคือเจตนาของคนกด ไม่ใช่ความผิดพลาด
 * ร่องรอยว่าเคยเป็นอะไรมาก่อนอยู่ที่ activity_log
 */
PUT('/api/receipts/:id/bill', function (array $req) {
    $id = int_or($req['params']['id']);
    if (!Db::get('SELECT id FROM receipts WHERE id = ?', $id)) {
        missing('ไม่พบใบเสร็จนี้');
    }

    $body    = $req['body'];
    $partyId = int_or($body['bill_party_id'] ?? null);

    Db::run(
        'UPDATE receipts
            SET bill_name = ?, bill_tax_id = ?, bill_address = ?, bill_phone = ?, bill_party_id = ?
          WHERE id = ?',
        nul($body['bill_name'] ?? null),
        nul($body['bill_tax_id'] ?? null),
        nul($body['bill_address'] ?? null),
        nul($body['bill_phone'] ?? null),
        $partyId,
        $id
    );

    /* "ใช้ล่าสุดเมื่อไหร่" นับจากการพิมพ์ลงใบจริง ไม่ใช่การกดบันทึกชื่อ — ลำดับใน
       กล่องค้นจึงสะท้อนนามที่ร้านใช้อยู่จริง ไม่ใช่นามที่เพิ่งพิมพ์แก้คำผิด */
    if ($partyId !== null) {
        Db::run('UPDATE bill_parties SET last_used_at = NOW() WHERE id = ?', $partyId);
    }

    return Db::get('SELECT * FROM receipts WHERE id = ?', $id);
});

/** GET /api/receipts — ทะเบียนเลขใบเสร็จที่ออกไปแล้ว เรียงใหม่สุดก่อน */
GET('/api/receipts', function (array $req) {
    $q     = $req['query'];
    $where = [];
    $args  = [];
    if ($from = str_or($q['from'] ?? null)) {
        $where[] = 'DATE(r.issued_at) >= ?';
        $args[]  = $from;
    }
    if ($to = str_or($q['to'] ?? null)) {
        $where[] = 'DATE(r.issued_at) <= ?';
        $args[]  = $to;
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[]   = min(int_or($q['limit'] ?? null, 200), 2000);

    return Db::all(
        "SELECT r.*, a.display_name AS issued_by_name, o.invoice_code, c.case_code, s.pos_no
           FROM receipts r
           LEFT JOIN admins a        ON a.id = r.issued_by
           LEFT JOIN custom_orders o ON o.id = r.order_id
           LEFT JOIN cases c         ON c.id = o.case_id
           LEFT JOIN pos_sales s     ON s.id = r.sale_id
           $sqlWhere
          ORDER BY r.issued_at DESC, r.id DESC LIMIT ?",
        ...$args
    );
});
