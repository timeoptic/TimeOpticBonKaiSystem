<?php
/**
 * ชื่อผู้รับใบเสร็จ — รายชื่อที่หน้า /print/receipt หยิบมาเติมบล็อกลูกค้า
 *
 * ทำไมไม่ใช่ตาราง `customers`: ชื่อบนใบเสร็จไม่ใช่ชื่อคนที่มาตัดแว่นเสมอไป
 * เคสเป็นของพ่อ แต่ลูกเป็นคนออกบิล — เป็นคนละคำถามกัน จึงเป็นคนละตาราง
 *
 * เลขผู้เสียภาษี 13 หลักของบุคคลธรรมดาคือเลขบัตรประชาชน ผลค้นหนึ่งครั้งกวาดมาได้
 * ทีละหลายราย จึงคืนแบบปิดกลางเสมอ (`tax_id_masked`) ค่าเต็มออกทีละรายที่
 * GET /api/bill-parties/:id ตอนที่คนกดเลือกแล้วเท่านั้น
 *
 * ใครทำอะไรบันทึกที่ services/ActivityLog.php อยู่แล้ว ตารางนี้จึงไม่มี created_by
 * ให้ต้องดูแลอีกชุด (และ `tax_id` อยู่ใน SECRET_HINTS ของตัวบันทึก จึงไม่ลงล็อกดิบ ๆ)
 */
declare(strict_types=1);

/** เลขผู้เสียภาษีในรูปที่เทียบกันได้ — ใบเดียวกันคนพิมพ์มีขีดบ้างไม่มีบ้าง */
function billTaxDigits(mixed $v): string
{
    return preg_replace('/\D+/', '', (string) $v) ?? '';
}

/** ชื่อในรูปที่เทียบกันได้ — ยุบช่องว่างซ้ำ ตัดหัวท้าย ตัวพิมพ์เล็ก */
function billNameKey(mixed $v): string
{
    return mb_strtolower(billNameClean($v));
}

/** ชื่อในรูปที่เก็บลงฐาน — ช่องว่างซ้ำในชื่อคือการพิมพ์พลาด ไม่ใช่ความหมาย */
function billNameClean(mixed $v): string
{
    return preg_replace('/\s+/u', ' ', trim((string) $v)) ?? '';
}

/**
 * ปิดกลางเลขผู้เสียภาษี — เห็นหัวสี่ท้ายสาม พอให้คนหน้าร้านแยกออกว่าบรรทัดไหน
 * ของใคร โดยไม่ต้องกวาดเลขบัตรของทุกคนออกไปที่เบราว์เซอร์พร้อมกัน
 */
function billMaskTaxId(mixed $v): string
{
    $s = trim((string) $v);
    $n = mb_strlen($s);
    if ($n === 0) {
        return '';
    }
    if ($n <= 4) {
        return str_repeat('*', $n);
    }
    $head = mb_substr($s, 0, 4);
    $tail = $n >= 8 ? mb_substr($s, -3) : '';
    return $head . str_repeat('*', $n - mb_strlen($head) - mb_strlen($tail)) . $tail;
}

/** แถวในรูปที่ปลอดภัยพอจะอยู่ในผลค้นหลายรายการพร้อมกัน */
function billPartyListRow(array $r): array
{
    $masked = billMaskTaxId($r['tax_id'] ?? null);
    unset($r['tax_id']);
    $r['tax_id_masked'] = $masked;
    return $r;
}

/**
 * GET /api/bill-parties
 *   ?q=            ค้นชื่อ / เบอร์ / ที่อยู่ / เลขผู้เสียภาษี
 *   ?customer_id=  เปิดใบเสร็จของลูกค้าคนนี้
 *
 * สองพารามิเตอร์นี้ทำคนละหน้าที่โดยตั้งใจ:
 *   มีคำค้น   → ค้นทั้งรายชื่อ `customer_id` แค่ดันของลูกค้าคนนี้ขึ้นบนสุด
 *               (ลูกออกใบให้แม่ด้วย ต้องค้นเจอ ไม่ใช่ถูกกรองทิ้ง)
 *   ไม่มีคำค้น → กรองเหลือเฉพาะของลูกค้าคนนี้ เพราะหน้าใบเสร็จเอาแถวแรกมาเติมให้
 *               อัตโนมัติ คืนของคนอื่นมาคือพิมพ์เลขบัตรคนอื่นลงใบลูกค้า
 */
GET('/api/bill-parties', function (array $req) {
    $query = $req['query'];
    $term  = str_or($query['q'] ?? null);
    $cust  = int_or($query['customer_id'] ?? null);
    $limit = min(int_or($query['limit'] ?? null, 20), 200);

    $where = [];
    $args  = [];
    if ($term !== '') {
        $p       = like($term);
        $digits  = billTaxDigits($term);
        $where[] = "(name LIKE ? OR phone LIKE ? OR address LIKE ?
                     OR REPLACE(REPLACE(tax_id, '-', ''), ' ', '') LIKE ?)";
        array_push($args, $p, $p, $p, $digits === '' ? $p : '%' . $digits . '%');
    } elseif ($cust !== null) {
        $where[] = 'customer_id = ?';
        $args[]  = $cust;
    }
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    /* customer_id = 0 ไม่เคยตรงกับแถวไหน จึงใช้แทน "ไม่ได้ระบุลูกค้า" ได้โดยไม่ต้อง
       ต่อ SQL คนละแบบสองชุด */
    $rows = Db::all(
        "SELECT * FROM bill_parties
         $sqlWhere
          ORDER BY (customer_id = ?) DESC,
                   COALESCE(last_used_at, created_at) DESC, id DESC
          LIMIT ?",
        ...[...$args, $cust ?? 0, $limit]
    );

    return array_map('billPartyListRow', $rows);
});

/** GET /api/bill-parties/:id — ค่าเต็มไว้พิมพ์ลงใบ ทีละรายเท่านั้น */
GET('/api/bill-parties/:id', function (array $req) {
    $row = Db::get('SELECT * FROM bill_parties WHERE id = ?', int_or($req['params']['id']));
    if (!$row) {
        missing('ไม่พบชื่อผู้รับใบเสร็จนี้');
    }
    return $row;
});

/**
 * POST /api/bill-parties — ปุ่ม "จำไว้ใช้ครั้งหน้า"
 *
 * รวมแถวซ้ำที่นี่ ไม่ใช่ด้วย UNIQUE ที่ฐาน เพราะสองชุดที่ต้องถือว่าเป็นอันเดียวกัน
 * แทบไม่เคยอยู่ในรูปเดียวกัน — ต้องปรับรูปแบบให้เหมือนกันก่อนแล้วค่อยเทียบ วิธี
 * เดียวกับ POST /api/customers/duplicates
 *
 * เกณฑ์คือ "ชื่อตรง **และ** เลขภาษีตรง" ไม่ใช่อย่างใดอย่างหนึ่ง:
 *   ชื่อพ้องกันคนละเลขภาษี = คนละนิติบุคคล ยุบรวมไม่ได้
 *   ว่างทั้งคู่ก็ถือว่าตรง — กดปุ่มซ้ำด้วยนามที่ยังไม่รู้เลขภาษี ต้องไม่งอกสองบรรทัด
 */
POST('/api/bill-parties', function (array $req) {
    $body = $req['body'];
    $name = billNameClean($body['name'] ?? null);
    if ($name === '') {
        bad('กรุณากรอกชื่อผู้รับใบเสร็จ');
    }

    $tax     = trim(str_or($body['tax_id'] ?? null));
    $address = nul($body['address'] ?? null);
    $phone   = nul($body['phone'] ?? null);
    $cust    = int_or($body['customer_id'] ?? null);
    if ($cust !== null && !Db::get('SELECT id FROM customers WHERE id = ?', $cust)) {
        bad('ไม่พบลูกค้าที่อ้างถึง');
    }

    $nameKey = billNameKey($name);
    $taxKey  = billTaxDigits($tax);

    /* ดึงมาเฉพาะแถวที่มีโอกาสซ้ำ แล้วค่อยตัดสินใน PHP — ชื่อเทียบตรงได้เพราะเก็บ
       แบบยุบช่องว่างแล้ว (collation ของตารางเป็น _ci ตัวพิมพ์ใหญ่เล็กจึงตรงกันเอง) */
    $match = null;
    $rows  = Db::all(
        "SELECT * FROM bill_parties
          WHERE name = ?
             OR (CHAR_LENGTH(?) > 0 AND REPLACE(REPLACE(tax_id, '-', ''), ' ', '') = ?)",
        $name,
        $taxKey,
        $taxKey
    );
    foreach ($rows as $row) {
        if (billNameKey($row['name']) === $nameKey && billTaxDigits($row['tax_id']) === $taxKey) {
            $match = $row;
            break;
        }
    }

    if ($match) {
        /* customer_id ใช้ COALESCE — นามนี้ผูกกับลูกค้าคนแรกที่เคยใช้ไว้แล้ว การกด
           บันทึกจากใบของคนอื่นไม่ควรย้ายมันไปทั้งดุ้น (ค้นด้วยชื่อยังเจอเหมือนเดิม)
           ส่วนสี่ช่องที่เหลือทับของเดิมตรง ๆ — แผงบนหน้าใบส่งมาครบทุกครั้ง
           ลบที่อยู่ทิ้งจึงต้องลบได้จริง */
        Db::run(
            'UPDATE bill_parties
                SET name = ?, tax_id = ?, address = ?, phone = ?,
                    customer_id = COALESCE(customer_id, ?)
              WHERE id = ?',
            $name,
            nul($tax),
            $address,
            $phone,
            $cust,
            (int) $match['id']
        );
        return Db::get('SELECT * FROM bill_parties WHERE id = ?', (int) $match['id']);
    }

    $r = Db::run(
        'INSERT INTO bill_parties (name, tax_id, address, phone, customer_id) VALUES (?,?,?,?,?)',
        $name,
        nul($tax),
        $address,
        $phone,
        $cust
    );
    return Db::get('SELECT * FROM bill_parties WHERE id = ?', $r['insertId']);
});
