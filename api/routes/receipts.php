<?php
/**
 * เลขใบเสร็จ — ชุดเลขของ "ใบที่ออกให้ลูกค้าจริง"
 *
 * ทำไมไม่ใช้ invoice_code ของออเดอร์: ทุกออเดอร์มีเลข INV ตั้งแต่วินาทีที่สร้าง
 * ไม่ว่าจะพิมพ์ใบเสร็จหรือไม่ แต่ร้านออกใบเสร็จเฉพาะตอนลูกค้าขอ เลขบนใบที่ออกจริง
 * จึงกระโดดเป็นหลุม (00001, 00007, 00023) ซึ่งเป็นสิ่งที่ชุดเลขเอกสารภาษีห้ามเป็น
 * ชุดนี้เดินเลขเฉพาะตอนมีคนเปิดหน้าใบเสร็จ จึงต่อเนื่องตามการออกใบจริง
 *
 * รูปแบบ  Bill-2026-09-00042   ใบเสร็จของเคสแว่น
 *         BillP-2026-09-00007  ใบเสร็จของการขาย POS  (คนละชุด เดินเลขแยกกัน)
 * เดือนเป็นป้ายบอกช่วงเวลาเฉย ๆ เลขท้ายเดินยาวทั้งปี ไม่รีเซ็ตรายเดือน
 *
 * ออกเลขครั้งเดียวต่อใบ แล้วผูกถาวร — เปิดหน้าซ้ำ ลูกค้าทำใบหายมาขอใหม่ หรือ
 * พนักงานสองคนเปิดพร้อมกัน ก็ได้เลขเดิมเสมอ ข้อนี้บังคับด้วย UNIQUE ที่ฐาน
 * (uq_receipt_order / uq_receipt_sale) ไม่ใช่ด้วยความระวังของโค้ดเรียก
 */
declare(strict_types=1);

/** ชุดเลขของแต่ละที่มา — คีย์คือชนิดใบ ค่าคือคำนำหน้าเลข */
const RECEIPT_PREFIX = ['order' => 'Bill', 'sale' => 'BillP'];

/** แถวใบเสร็จของออเดอร์/ใบขายนี้ ถ้ายังไม่เคยออกเลขคืน null */
function receiptFor(string $kind, int $id): ?array
{
    $col = $kind === 'order' ? 'order_id' : 'sale_id';
    return Db::get("SELECT * FROM receipts WHERE $col = ?", $id) ?: null;
}

/**
 * ออกเลขใบเสร็จให้ออเดอร์/ใบขายนี้ — มีอยู่แล้วคืนของเดิม ไม่สร้างใหม่
 *
 * การชนกันของสองคนที่กดพร้อมกันจบที่ UNIQUE ของฐาน ไม่ใช่ที่ล็อกในโค้ด:
 * ฝั่งที่แพ้ได้ error แล้ววนกลับไปอ่านแถวที่ฝั่งชนะเพิ่งเขียน จึงได้เลขเดียวกัน
 * ลองใหม่ 3 รอบพอ — เกินกว่านั้นแปลว่าไม่ใช่การชนกันธรรมดา ต้องให้มันดังออกมา
 */
function issueReceipt(string $kind, int $id, float $total, ?int $by): array
{
    for ($attempt = 0; $attempt < 3; $attempt++) {
        if ($row = receiptFor($kind, $id)) {
            return $row;
        }
        try {
            Db::tx(function (Tx $q) use ($kind, $id, $total, $by) {
                $no  = nextCode(RECEIPT_PREFIX[$kind], 'receipts', 'receipt_no', true);
                $col = $kind === 'order' ? 'order_id' : 'sale_id';
                $q->run(
                    "INSERT INTO receipts (receipt_no, $col, total_amount, issued_by)
                     VALUES (?, ?, ?, ?)",
                    $no,
                    $id,
                    $total,
                    $by
                );
            });
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
        $o = Db::get('SELECT total_price, discount FROM custom_orders WHERE id = ?', $orderId);
        if (!$o) {
            missing();
        }
        $total = round2((float) $o['total_price'] - (float) $o['discount']);
        return issueReceipt('order', $orderId, $total, int_or($actor['id'] ?? null));
    }

    $s = Db::get('SELECT total_amount, status FROM pos_sales WHERE id = ?', $saleId);
    if (!$s) {
        missing();
    }
    /* ใบขายที่ยกเลิกไปแล้วต้องออกใบเสร็จไม่ได้ — ใบเสร็จคือหลักฐานว่ารับเงินจริง
       (หน้า POS ซ่อนปุ่มไว้แล้ว แต่ที่ซ่อนปุ่มอย่างเดียวคือที่ไม่ได้กันอะไรเลย) */
    if ((string) $s['status'] === 'void') {
        bad('ใบขายนี้ถูกยกเลิกแล้ว ออกใบเสร็จไม่ได้');
    }
    return issueReceipt('sale', $saleId, round2((float) $s['total_amount']), int_or($actor['id'] ?? null));
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
