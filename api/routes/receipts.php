<?php
/**
 * ใบเสร็จรับเงิน — ชุดเลขของ "ใบที่ออกให้ลูกค้าจริง" + ประวัติการสั่งพิมพ์
 *
 * กติกาตั้งแต่ 13 ต.ค. 2026 (ร้านขอ):
 *   - เลขออกเมื่อพนักงานกด "ออกใบเสร็จ" เท่านั้น — เปิดออเดอร์ เปิดเคส ขาย POS หรือเปิดหน้า
 *     ใบเสร็จ ไม่ทำให้เกิดเลข (เดิม 1 ต.ค.–13 ต.ค. ออกเลขตอนเปิดออเดอร์/ขาย)
 *   - ปี/เดือนบนเลข และวันที่บนใบ = วันที่กดออกใบจริง (issued_at / doc_date)
 *   - หนึ่งออเดอร์ (เคส) หรือหนึ่งใบขาย POS ได้ใบเสร็จใบเดียว — ใบนั้นครอบการรับเงินทุกครั้ง
 *     ของออเดอร์ (มัดจำ + ส่วนที่เหลือ) ผูกไว้ใน receipt_payments
 *   - พิมพ์ซ้ำ = ใบเดิม เลขเดิม ยอดเดิม วันที่เดิม · ทุกการกดพิมพ์ลง receipt_print_logs
 *
 * รูปแบบ  Bill-2026-10-00042   ใบเสร็จของเคสแว่น
 *         BillP-2026-10-00007  ใบเสร็จของการขาย POS  (คนละชุด เดินเลขแยกกัน — ร้านเลือกเอง)
 * เลขท้ายเดินยาวทั้งปี ไม่รีเซ็ตรายเดือน · เลขที่ออกแล้วไม่นำกลับมาใช้
 *
 * ลบออเดอร์ / ยกเลิกใบขาย: แถวยังอยู่ status = VOIDED เลขจึงไม่หลุดจากชุด
 * source_type/source_id จำว่าเคยเป็นของใคร แม้ order_id/sale_id จะถูกปลดเป็น NULL
 *
 * การกันออกซ้ำบังคับที่ฐาน: uq_receipt_order / uq_receipt_sale (ใบเดียวต่อที่มา),
 * uq_receipt_no (เลขไม่ซ้ำ), uq_receipt_idem (กดซ้ำได้ใบเดิม) · ตัวนับล็อก FOR UPDATE
 *
 * ตรวจ/รีเซ็ตเลข ต.ค. 2569: api/cli/receipt-tracking.php
 */
declare(strict_types=1);

/** ชุดเลขของแต่ละที่มา — คีย์คือชนิดใบ ค่าคือคำนำหน้าเลข */
const RECEIPT_PREFIX = ['order' => 'Bill', 'sale' => 'BillP'];

/** บิลที่วันที่บนบิลก่อนวันนี้อยู่ยุคระบบ Access — ออกใบได้แต่ไม่ได้เลข Bill ใช้เลขบิลเดิม (C…)
 *  ร้านเลือกเริ่มที่ 1 ก.ย. 2026 (1 ต.ค. 2026) ไม่ย้อนทั้งปี เพราะเดือน 1–8 ออกใบจากระบบเก่าไปแล้ว */
const RECEIPT_START = '2026-09-01';

/** ผลการพิมพ์ที่ตั้งได้หลังกดพิมพ์ — REQUESTED ตั้งตอนกด ส่วน CONFIRMED/FAILED มาจากคนยืนยันเท่านั้น */
const RECEIPT_PRINT_RESULTS = ['UNKNOWN', 'CONFIRMED', 'FAILED'];

function receiptCol(string $kind): string
{
    return $kind === 'order' ? 'order_id' : 'sale_id';
}

/** แถวใบเสร็จของออเดอร์/ใบขายนี้ ถ้ายังไม่เคยออกคืน null */
function receiptFor(string $kind, int $id): ?array
{
    $col = receiptCol($kind);
    return Db::get("SELECT * FROM receipts WHERE $col = ?", $id) ?: null;
}

/**
 * เลขถัดไปของชุดนี้ในปีของ $docDate — ต้องเรียกใน transaction
 *
 * แถวตัวนับถูกล็อก FOR UPDATE จนจบ transaction ของคนเรียก สองเครื่องที่กดออกใบ
 * พร้อมกันจึงได้เลขต่อกัน ไม่ใช่เลขเดียวกัน
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
 * ผูกการรับเงินของออเดอร์/ใบขายเข้ากับใบเสร็จ — เรียกซ้ำได้ ก้อนที่ผูกแล้วไม่ผูกซ้ำ
 *
 * ใบเดียวต่อเคส แต่เงินเข้ามาทีหลังได้ (มัดจำวันนี้ ส่วนที่เหลือวันรับแว่น) ก้อนใหม่จึงถูก
 * ผูกตอนเปิดดูใบครั้งถัดไป · ยอดบนใบ (total_amount) ไม่ได้เปลี่ยนตาม เพราะเป็นยอดของบิล
 * ไม่ใช่ยอดที่จ่ายแล้ว · รายการ 0 บาท ("ยังไม่ชำระ") และที่ยกเลิกไปแล้วไม่นับเป็นหลักฐานรับเงิน
 */
function linkReceiptPayments(?Tx $q, array $rc): void
{
    $run = $q ? [$q, 'run'] : [Db::class, 'run'];
    if ($rc['order_id']) {
        $run(
            'INSERT IGNORE INTO receipt_payments (receipt_id, payment_id)
             SELECT ?, p.id FROM payments p
              WHERE p.order_id = ? AND p.cancelled_at IS NULL AND p.amount > 0',
            (int) $rc['id'],
            (int) $rc['order_id']
        );
    } elseif ($rc['sale_id']) {
        $run(
            'INSERT IGNORE INTO receipt_payments (receipt_id, pos_payment_id)
             SELECT ?, p.id FROM pos_payments p
              WHERE p.sale_id = ? AND p.cancelled_at IS NULL AND p.amount > 0',
            (int) $rc['id'],
            (int) $rc['sale_id']
        );
    }
}

/**
 * ออกใบเสร็จให้ออเดอร์/ใบขายนี้ภายใน transaction ของคนเรียก — มีแล้วคืนของเดิม
 *
 * ยอดบนใบมาจากฐาน ไม่ใช่จากหน้าเว็บ · วันที่บนใบคือวันที่กดออกจริง
 * บิลที่วันที่บนบิลก่อน RECEIPT_START ได้แถว (ไว้จำชื่อบนใบ) แต่ไม่ได้เลข Bill
 */
function issueReceiptIn(Tx $q, string $kind, int $id, ?string $idemKey, ?int $by): array
{
    $col = receiptCol($kind);
    if ($row = $q->get("SELECT * FROM receipts WHERE $col = ?", $id)) {
        return $row;
    }
    /* key ผูกกับที่มาเสมอ — key เดียวกันจากคนละบิล (เครื่องเดิมสร้าง key ซ้ำ) ต้องไม่ได้ใบของบิลอื่น */
    if ($idemKey !== null) {
        $idemKey = mb_substr(($kind === 'order' ? 'o' : 's') . "$id:$idemKey", 0, 120);
        if ($row = $q->get('SELECT * FROM receipts WHERE idem_key = ?', $idemKey)) {
            return $row;
        }
    }

    if ($kind === 'order') {
        $o = $q->get('SELECT total_price, discount, order_date FROM custom_orders WHERE id = ?', $id);
        if (!$o) {
            missing();
        }
        $billDate = (string) ($o['order_date'] ?: nowStamp());
        $total    = round2((float) $o['total_price'] - (float) $o['discount']);
    } else {
        $s = $q->get('SELECT total_amount, status, sale_date FROM pos_sales WHERE id = ?', $id);
        if (!$s) {
            missing();
        }
        /* ใบเสร็จคือหลักฐานว่ารับเงินจริง ใบขายที่ยกเลิกแล้วออกไม่ได้ */
        if ((string) $s['status'] === 'void') {
            bad('ใบขายนี้ถูกยกเลิกแล้ว ออกใบเสร็จไม่ได้');
        }
        $billDate = (string) ($s['sale_date'] ?: nowStamp());
        $total    = round2((float) $s['total_amount']);
    }

    $now = nowStamp();
    $q->run(
        "INSERT INTO receipts (receipt_no, $col, source_type, source_id, status, doc_date, total_amount,
                               issued_at, issued_by, idem_key)
         VALUES (?, ?, ?, ?, 'ISSUED', ?, ?, ?, ?, ?)",
        substr($billDate, 0, 10) >= RECEIPT_START ? nextReceiptNo($q, RECEIPT_PREFIX[$kind], $now) : null,
        $id,
        $kind === 'order' ? 'CASE' : 'POS',
        $id,
        substr($now, 0, 10),
        $total,
        $now,
        $by,
        $idemKey
    );
    $row = $q->get("SELECT * FROM receipts WHERE $col = ?", $id);
    linkReceiptPayments($q, $row);
    return $row;
}

/**
 * ตีตรายกเลิกใบเสร็จของออเดอร์/ใบขายนี้ — เลขยังอยู่ในชุด ไม่ลบแถว
 * $detach = true ตอนจะลบออเดอร์ทิ้ง: ปลด order_id (source_id ยังจำไว้)
 */
function voidReceiptIn(Tx $q, string $kind, int $id, string $reason, bool $detach = false): void
{
    $col = receiptCol($kind);
    $q->run(
        "UPDATE receipts SET status = 'VOIDED', voided_at = COALESCE(voided_at, NOW()), void_reason = ?"
            . ($detach ? ", $col = NULL" : '') . " WHERE $col = ?",
        mb_substr($reason, 0, 255),
        $id
    );
}

/**
 * ออกใบเสร็จ (นอก transaction) — มีอยู่แล้วคืนของเดิม ไม่สร้างใหม่
 *
 * การชนกันของสองคนที่กดพร้อมกันจบที่ UNIQUE ของฐาน: ฝั่งที่แพ้ได้ 1062 แล้ววนกลับไป
 * อ่านแถวที่ฝั่งชนะเพิ่งเขียน จึงได้ใบเดียวกัน · ต้องดู errno ไม่ใช่ SQLSTATE เพราะ
 * FK ล้ม (1452) ก็เป็น 23000 เหมือนกัน ดักรวมแล้วจะกลืนบั๊กจริง
 */
function issueReceipt(string $kind, int $id, ?string $idemKey, ?int $by): array
{
    for ($attempt = 0; $attempt < 3; $attempt++) {
        if ($row = receiptFor($kind, $id)) {
            return $row;
        }
        try {
            return Db::tx(fn(Tx $q) => issueReceiptIn($q, $kind, $id, $idemKey, $by));
        } catch (PDOException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) !== 1062) {
                throw $e;
            }
        }
    }
    if ($row = receiptFor($kind, $id)) {
        return $row;
    }
    bad('ออกใบเสร็จไม่สำเร็จ กรุณาลองใหม่');
}

/**
 * ใบเสร็จหนึ่งใบพร้อมสิ่งที่หน้าเคส/POS ต้องโชว์: สถานะ ประวัติพิมพ์ล่าสุด และเงินที่ครอบ
 * ผูกเงินก้อนใหม่ที่เข้ามาหลังออกใบไปด้วย (ใบเดียวต่อเคส)
 */
function receiptView(array $rc): array
{
    if ((string) $rc['status'] === 'ISSUED') {
        linkReceiptPayments(null, $rc);
    }
    $last = Db::get(
        'SELECT l.status, l.requested_at, l.attempt_no, a.display_name AS requested_by_name
           FROM receipt_print_logs l LEFT JOIN admins a ON a.id = l.requested_by
          WHERE l.receipt_id = ? ORDER BY l.id DESC LIMIT 1',
        (int) $rc['id']
    );
    $by = $rc['issued_by'] ? Db::get('SELECT display_name FROM admins WHERE id = ?', (int) $rc['issued_by']) : null;
    $pays = Db::all(
        'SELECT rp.payment_id, rp.pos_payment_id,
                COALESCE(p.amount, pp.amount) AS amount, COALESCE(p.paid_at, pp.paid_at) AS paid_at,
                COALESCE(p.method, pp.payment_method) AS method, p.kind
           FROM receipt_payments rp
           LEFT JOIN payments p      ON p.id = rp.payment_id
           LEFT JOIN pos_payments pp ON pp.id = rp.pos_payment_id
          WHERE rp.receipt_id = ? ORDER BY paid_at, rp.id',
        (int) $rc['id']
    );
    return $rc + [
        'issued_by_name'    => $by['display_name'] ?? null,
        'print_count'       => (int) ($last['attempt_no'] ?? 0),
        /* ไม่มีแถวพิมพ์เลย = ยังไม่เคยสั่งพิมพ์ — ไม่ได้แปลว่าไม่เคยมีกระดาษออก
           ใบที่ออกก่อนมีระบบติดตามพิมพ์อาจพิมพ์ไปแล้วโดยไม่มีบันทึก */
        'print_status'      => $last['status'] ?? 'NOT_REQUESTED',
        'last_printed_at'   => $last['requested_at'] ?? null,
        'last_printed_by'   => $last['requested_by_name'] ?? null,
        'payments'          => $pays,
        'paid_total'        => round2(array_sum(array_map(fn($p) => (float) $p['amount'], $pays))),
    ];
}

function receiptActorId(): int
{
    $actor = StockModule::actor();
    if ($actor === null) {
        bad('ต้องเข้าสู่ระบบก่อน');
    }
    return (int) ($actor['id'] ?? 0);
}

/** order_id หรือ sale_id อย่างใดอย่างหนึ่งจากคำขอ → [kind, id] */
function receiptSource(array $in): array
{
    $orderId = int_or($in['order_id'] ?? null);
    $saleId  = int_or($in['sale_id'] ?? null);
    if (($orderId === null) === ($saleId === null)) {
        bad('ต้องระบุ order_id หรือ sale_id อย่างใดอย่างหนึ่ง');
    }
    return $orderId !== null ? ['order', $orderId] : ['sale', $saleId];
}

/** บิลยุค Access ไม่มีเลข Bill — คืนเลขบิลเดิมไว้พิมพ์ (แค่ในคำตอบ ไม่เขียนลงฐาน) */
function receiptWithLegacyNo(array $rc): array
{
    if ($rc['receipt_no'] === null && $rc['order_id']) {
        $o = Db::get('SELECT invoice_code FROM custom_orders WHERE id = ?', (int) $rc['order_id']);
        $rc['receipt_no'] = (string) ($o['invoice_code'] ?? '');
    }
    return $rc;
}

/**
 * POST /api/receipts  { order_id } หรือ { sale_id } — ดูใบเสร็จที่ออกไว้แล้ว
 *
 * เดิม (ก่อน 13 ต.ค. 2026) ทางนี้ออกเลขให้ทุกครั้งที่เปิดหน้าใบเสร็จ ตอนนี้แค่อ่าน —
 * ยังไม่ออกคืน status NOT_ISSUED · คงเป็น POST ไว้ให้หน้าที่เปิดค้างจาก build เก่าไม่พัง
 */
POST('/api/receipts', function (array $req) {
    receiptActorId();
    [$kind, $id] = receiptSource($req['body']);
    $rc = receiptFor($kind, $id);
    if (!$rc) {
        return ['id' => null, 'receipt_no' => null, 'status' => 'NOT_ISSUED', 'print_status' => 'NOT_REQUESTED'];
    }
    return receiptWithLegacyNo(receiptView($rc));
});

/**
 * POST /api/receipts/issue  { order_id | sale_id, idem_key } — ปุ่ม "ออกใบเสร็จ"
 * ทางเดียวที่ทำให้เกิดเลข · กดซ้ำ / สองเครื่องพร้อมกัน / เน็ตหลุดแล้วยิงใหม่ ได้ใบเดิม
 */
POST('/api/receipts/issue', function (array $req) {
    $by  = receiptActorId();
    [$kind, $id] = receiptSource($req['body']);
    $key = nul($req['body']['idem_key'] ?? null);
    $rc  = issueReceipt($kind, $id, $key === null ? null : mb_substr($key, 0, 120), $by ?: null);
    return receiptWithLegacyNo(receiptView($rc));
});

/**
 * GET /api/receipts/for?case_id= | order_id= | sale_id= — ส่วน "ใบเสร็จรับเงิน" ของหน้าเคส/POS
 *
 * คืนทุกที่มาที่ออกใบได้ (ทุกออเดอร์ของเคส) พร้อมใบที่ออกแล้ว ถ้ายังไม่ออก receipt = null
 * และใบที่ยกเลิกแล้วของที่มาเดียวกันใน history (เอกสารยกเลิกต้องคงประวัติไว้)
 */
GET('/api/receipts/for', function (array $req) {
    receiptActorId();
    $q = $req['query'];
    if ($caseId = int_or($q['case_id'] ?? null)) {
        $orders = Db::all(
            'SELECT id, invoice_code, order_date, total_price, discount FROM custom_orders
              WHERE case_id = ? ORDER BY id',
            $caseId
        );
        $sources = array_map(fn($o) => ['order', $o], $orders);
    } elseif ($orderId = int_or($q['order_id'] ?? null)) {
        $o = Db::get('SELECT id, invoice_code, order_date, total_price, discount FROM custom_orders WHERE id = ?', $orderId);
        $sources = $o ? [['order', $o]] : [];
    } elseif ($saleId = int_or($q['sale_id'] ?? null)) {
        $s = Db::get('SELECT id, pos_no, sale_date, total_amount, status FROM pos_sales WHERE id = ?', $saleId);
        $sources = $s ? [['sale', $s]] : [];
    } else {
        bad('ต้องระบุ case_id, order_id หรือ sale_id');
    }

    $out = [];
    foreach ($sources as [$kind, $src]) {
        $id   = (int) $src['id'];
        $rc   = receiptFor($kind, $id);
        $type = $kind === 'order' ? 'CASE' : 'POS';
        $out[] = [
            'source_type' => $type,
            'source_id'   => $id,
            'source_no'   => $kind === 'order' ? $src['invoice_code'] : $src['pos_no'],
            'bill_date'   => $kind === 'order' ? $src['order_date'] : $src['sale_date'],
            'bill_total'  => $kind === 'order'
                ? round2((float) $src['total_price'] - (float) $src['discount'])
                : round2((float) $src['total_amount']),
            'receipt'     => $rc ? receiptWithLegacyNo(receiptView($rc)) : null,
            'history'     => Db::all(
                "SELECT id, receipt_no, legacy_no, status, issued_at, voided_at, void_reason
                   FROM receipts
                  WHERE source_type = ? AND source_id = ? AND status = 'VOIDED' AND " . receiptCol($kind) . ' IS NULL
                  ORDER BY id',
                $type,
                $id
            ),
        ];
    }
    return $out;
});

/**
 * POST /api/receipts/:id/prints  { client_key } — กดพิมพ์หนึ่งครั้ง = หนึ่งแถว REQUESTED
 *
 * ไม่ออกเลขใหม่ ไม่แตะยอด/วันที่ของใบ · client_key เดิมซ้ำ (กดสองทีติด) ได้แถวเดิม
 * ใบที่ยกเลิกแล้วพิมพ์ไม่ได้ — กระดาษที่ออกไปจะเป็นใบเสร็จของบิลที่ไม่มีอยู่
 */
POST('/api/receipts/:id/prints', function (array $req) {
    $by = receiptActorId();
    $id = int_or($req['params']['id']);
    $rc = Db::get('SELECT * FROM receipts WHERE id = ?', $id);
    if (!$rc) {
        missing('ไม่พบใบเสร็จนี้');
    }
    if ((string) $rc['status'] !== 'ISSUED') {
        bad('ใบเสร็จนี้ถูกยกเลิกแล้ว พิมพ์ไม่ได้');
    }
    $key = nul($req['body']['client_key'] ?? null);
    $key = $key === null ? null : mb_substr($key, 0, 64);

    for ($try = 0; $try < 3; $try++) {
        if ($key !== null && ($row = Db::get('SELECT * FROM receipt_print_logs WHERE receipt_id = ? AND client_key = ?', $id, $key))) {
            return $row;
        }
        try {
            return Db::tx(function (Tx $q) use ($rc, $id, $key, $by) {
                $q->get('SELECT id FROM receipts WHERE id = ? FOR UPDATE', $id);
                $n = (int) ($q->get('SELECT MAX(attempt_no) n FROM receipt_print_logs WHERE receipt_id = ?', $id)['n'] ?? 0) + 1;
                $r = $q->run(
                    "INSERT INTO receipt_print_logs
                       (receipt_id, receipt_no, source_type, source_id, attempt_no, status, requested_at, requested_by, client_key)
                     VALUES (?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?)",
                    $id,
                    $rc['receipt_no'],
                    $rc['source_type'],
                    $rc['source_id'],
                    $n,
                    nowStamp(),
                    $by ?: null,
                    $key
                );
                return $q->get('SELECT * FROM receipt_print_logs WHERE id = ?', $r['insertId']);
            });
        } catch (PDOException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) !== 1062) {
                throw $e;
            }
        }
    }
    bad('บันทึกการสั่งพิมพ์ไม่สำเร็จ กรุณาลองใหม่');
});

/**
 * PUT /api/receipt-prints/:id  { status, failure_reason?, printer_name? }
 *
 * UNKNOWN ตั้งเองตอนกล่องพิมพ์ของเบราว์เซอร์ปิด (ไม่รู้ว่ากดพิมพ์หรือกดยกเลิก)
 * CONFIRMED / FAILED มาจากพนักงานกดยืนยันว่ากระดาษออกหรือไม่ออก
 * ผลที่ยืนยันแล้วไม่ถูกเขียนทับด้วย UNKNOWN ของแท็บที่มาช้า
 */
PUT('/api/receipt-prints/:id', function (array $req) {
    $by     = receiptActorId();
    $id     = int_or($req['params']['id']);
    $status = strtoupper(str_or($req['body']['status'] ?? null));
    if (!in_array($status, RECEIPT_PRINT_RESULTS, true)) {
        bad('สถานะการพิมพ์ไม่ถูกต้อง');
    }
    $log = Db::get('SELECT * FROM receipt_print_logs WHERE id = ?', $id);
    if (!$log) {
        missing('ไม่พบประวัติการพิมพ์นี้');
    }
    if ($status === 'UNKNOWN' && in_array($log['status'], ['CONFIRMED', 'FAILED'], true)) {
        return $log;
    }
    Db::run(
        'UPDATE receipt_print_logs
            SET status = ?, failure_reason = ?, printer_name = COALESCE(?, printer_name),
                resolved_at = ?, resolved_by = ?
          WHERE id = ?',
        $status,
        $status === 'FAILED' ? mb_substr(str_or($req['body']['failure_reason'] ?? null), 0, 255) ?: null : null,
        nul($req['body']['printer_name'] ?? null),
        $status === 'UNKNOWN' ? null : nowStamp(),
        $status === 'UNKNOWN' ? null : ($by ?: null),
        $id
    );
    return Db::get('SELECT * FROM receipt_print_logs WHERE id = ?', $id);
});

/** GET /api/receipts/:id/prints — ประวัติการสั่งพิมพ์ของใบนี้ ใหม่สุดก่อน */
GET('/api/receipts/:id/prints', function (array $req) {
    receiptActorId();
    return Db::all(
        'SELECT l.*, a.display_name AS requested_by_name, b.display_name AS resolved_by_name
           FROM receipt_print_logs l
           LEFT JOIN admins a ON a.id = l.requested_by
           LEFT JOIN admins b ON b.id = l.resolved_by
          WHERE l.receipt_id = ? ORDER BY l.id DESC',
        int_or($req['params']['id'])
    );
});

/**
 * PUT /api/receipts/:id/bill — บล็อกลูกค้าที่พิมพ์ลงใบนี้จริง
 *
 * แยกจากการออกใบเพราะเป็นคนละเหตุการณ์: กดออกใบเสร็จ = ได้เลข ·
 * กดพิมพ์ = ตกลงว่าจะเอาชื่อชุดนี้ลงกระดาษ ใบที่ออกแล้วยังไม่พิมพ์จึงมีเลข
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
