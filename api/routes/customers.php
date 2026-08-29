<?php
/** Customer records, plus the roll-up shown on one customer's page. */
declare(strict_types=1);

GET('/api/customers', function (array $req) {
    $q     = $req['query'];
    $term  = str_or($q['q'] ?? null);
    $limit = min(int_or($q['limit'] ?? null, 200), 1000);

    if ($term === '') {
        return Db::all('SELECT * FROM customers ORDER BY id DESC LIMIT ?', $limit);
    }
    $p = like($term);
    return Db::all(
        'SELECT * FROM customers
          WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?
             OR email LIKE ? OR line_id LIKE ? OR notes LIKE ? OR CAST(id AS CHAR) = ?
          ORDER BY id DESC LIMIT ?',
        $p, $p, $p, $p, $p, $p, $term, $limit
    );
});

/**
 * "ครั้งก่อนลูกค้าตัดแว่นอะไรกับเรา" — หนึ่งแถวคือแว่นหนึ่งคู่ที่เคยสั่งตัด
 *
 * ตั้งต้นจาก custom_orders ไม่ใช่ prescriptions เพราะคำถามคือ *แว่น* ที่เคยได้ไป
 * ไม่ใช่ครั้งที่เคยมาวัดตา รอบที่วัดแล้วไม่ได้ตัดจึงไม่นับเป็นประวัติแว่นเดิม
 *
 * ค่าสายตาที่แนบไปคือใบที่ออเดอร์นั้นถูกสร้างจากจริง (final_prescription_id) ซึ่งเป็น
 * คำตอบที่ตรงที่สุด ถ้าใบนั้นหายไปค่อยถอยไปหาใบ final ของเคสเดียวกัน แล้วค่อยเป็น
 * measured ตามลำดับ — ไม่ใช่หยิบใบไหนก็ได้ของลูกค้าคนนี้มาแปะ
 *
 * `exclude_case` ตัดเคสปัจจุบันออก เพราะกรอบกับเลนส์ที่กำลังเลือกอยู่ไม่ใช่ "ของเดิม"
 */
GET('/api/customers/:id/eyewear-history', function (array $req) {
    $id      = int_or($req['params']['id']);
    $exclude = int_or($req['query']['exclude_case'] ?? null);
    $limit   = min(int_or($req['query']['limit'] ?? null, 20), 50);

    $args  = [$id];
    $where = 'o.customer_id = ?';
    if ($exclude) {
        $where .= ' AND (o.case_id IS NULL OR o.case_id <> ?)';
        $args[] = $exclude;
    }
    $args[] = $limit;

    $orders = Db::all(
        "SELECT o.id AS order_id, o.case_id, o.invoice_code, o.order_date,
                o.final_prescription_id,
                o.frame_name, o.frame_brand, o.frame_model, o.frame_color,
                o.frame_size, o.frame_sku,
                o.lens_name, o.lens_brand, o.lens_design, o.lens_index,
                o.lens_coating, o.lens_tint, o.lens_addons, o.lens_type,
                o.total_price, o.discount,
                cs.case_code, cs.opened_at
           FROM custom_orders o
           LEFT JOIN cases cs ON cs.id = o.case_id
          WHERE $where
          ORDER BY COALESCE(o.order_date, cs.opened_at) DESC, o.id DESC
          LIMIT ?",
        ...$args
    );
    if (!$orders) {
        return [];
    }

    /* ใบสายตาของทุกเคสในรายการ ดึงรอบเดียวแล้วค่อยจับคู่ ไม่ยิงทีละแถว */
    $caseIds = array_values(array_filter(array_map(fn($o) => (int) $o['case_id'], $orders)));
    $rxIds   = array_values(array_filter(array_map(fn($o) => (int) $o['final_prescription_id'], $orders)));

    $byCase = [];
    if ($caseIds) {
        $in = implode(',', array_fill(0, count($caseIds), '?'));
        foreach (Db::all(
            "SELECT * FROM prescriptions
              WHERE case_id IN ($in) AND kind IN ('final','measured')
              ORDER BY FIELD(kind,'final','measured'), id DESC",
            ...$caseIds
        ) as $r) {
            $byCase[(int) $r['case_id']] ??= $r;   // final มาก่อนเสมอจาก ORDER BY
        }
    }
    $byId = [];
    if ($rxIds) {
        $in = implode(',', array_fill(0, count($rxIds), '?'));
        foreach (Db::all("SELECT * FROM prescriptions WHERE id IN ($in)", ...$rxIds) as $r) {
            $byId[(int) $r['id']] = $r;
        }
    }

    return array_map(function (array $o) use ($byId, $byCase) {
        $o['prescription'] = $byId[(int) $o['final_prescription_id']]
            ?? $byCase[(int) $o['case_id']]
            ?? null;
        return $o;
    }, $orders);
});

GET('/api/customers/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $c  = Db::get('SELECT * FROM customers WHERE id = ?', $id);
    if (!$c) {
        missing();
    }
    $sel  = Sql::ORDER_SELECT;
    $from = Sql::ORDER_FROM;

    $c['prescriptions'] = Db::all(
        'SELECT p.*, e.employee_name FROM prescriptions p
           LEFT JOIN employees e ON e.id = p.performed_by
          WHERE p.customer_id = ? ORDER BY p.test_date DESC, p.id DESC',
        $id
    );
    /* ประวัติสายตาแบบรายรอบ — 1 รอบ = 1 เคส, ในรอบมี 3 ชุดค่า (เดิม/วัดได้/ใช้จริง) */
    $c['exam_sessions'] = examSessions($id);
    $c['orders'] = Db::all(
        "SELECT $sel $from WHERE o.customer_id = ? ORDER BY o.order_date DESC",
        $id
    );
    $c['cases'] = Db::all(
        'SELECT * FROM v_case_board WHERE customer_id = ? ORDER BY opened_at DESC',
        $id
    );
    return $c;
});

/** the writable columns, in insert order */
function customerCols(array $b): array
{
    return [
        str_or($b['first_name'] ?? null),
        nul($b['mid_name'] ?? null),
        nul($b['last_name'] ?? null),
        nul($b['sex'] ?? null),
        nul($b['nationality'] ?? null),
        nul($b['email'] ?? null),
        nul($b['phone'] ?? null),
        nul($b['line_id'] ?? null),
        nul($b['birth_date'] ?? null),
        nul($b['notes'] ?? null),
    ];
}

POST('/api/customers', function (array $req) {
    $body = $req['body'];
    if (str_or($body['first_name'] ?? null) === '' && str_or($body['last_name'] ?? null) === '') {
        bad('กรุณากรอกชื่อลูกค้า');
    }
    $r = Db::run(
        'INSERT INTO customers (first_name, mid_name, last_name, sex, nationality,
           email, phone, line_id, birth_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?)',
        ...customerCols($body)
    );
    return Db::get('SELECT * FROM customers WHERE id = ?', $r['insertId']);
});

PUT('/api/customers/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    if (!Db::get('SELECT id FROM customers WHERE id = ?', $id)) {
        missing();
    }
    Db::run(
        'UPDATE customers SET first_name=?, mid_name=?, last_name=?, sex=?, nationality=?,
           email=?, phone=?, line_id=?, birth_date=?, notes=? WHERE id=?',
        ...[...customerCols($req['body']), $id]
    );
    return Db::get('SELECT * FROM customers WHERE id = ?', $id);
});

DELETE('/api/customers/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $n  = (int) (Db::get('SELECT COUNT(*) n FROM custom_orders WHERE customer_id = ?', $id)['n'] ?? 0);
    if ($n) {
        bad("ลบไม่ได้ — ลูกค้ารายนี้มีออเดอร์ $n รายการ");
    }
    $k = (int) (Db::get('SELECT COUNT(*) n FROM cases WHERE customer_id = ?', $id)['n'] ?? 0);
    if ($k) {
        bad("ลบไม่ได้ — ลูกค้ารายนี้มีเคส $k รายการ");
    }
    Db::run('DELETE FROM customers WHERE id = ?', $id);
    return ['ok' => true];
});
