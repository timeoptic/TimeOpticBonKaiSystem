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
    /* ค้นชื่อกลางด้วย — เซลล์ที่จำได้แต่ชื่อกลางแล้วหาไม่เจอ คือต้นทางของใบซ้ำ */
    $p = like($term);
    return Db::all(
        'SELECT * FROM customers
          WHERE first_name LIKE ? OR mid_name LIKE ? OR last_name LIKE ? OR phone LIKE ?
             OR email LIKE ? OR line_id LIKE ? OR notes LIKE ? OR CAST(id AS CHAR) = ?
          ORDER BY id DESC LIMIT ?',
        $p, $p, $p, $p, $p, $p, $p, $term, $limit
    );
});

/**
 * "คนนี้มีอยู่ในระบบแล้วหรือยัง" — ถามก่อนสร้างลูกค้าใหม่
 *
 * ปัญหาที่แก้: เซลล์ค้นหาไม่เจอ (พิมพ์ชื่อผิด เว้นวรรคไม่เหมือนเดิม เบอร์ใส่ขีด)
 * แล้วกดสร้างใหม่ — ลูกค้าคนเดียวเลยมีสองใบ ประวัติค่าสายตาแยกกันอยู่คนละใบ
 *
 * ต้องเทียบแบบ "ปรับรูปแบบให้เหมือนกันก่อน" ไม่ใช่เทียบตรง ๆ เพราะข้อมูลเดิมกับ
 * ข้อมูลที่เพิ่งพิมพ์แทบไม่เคยอยู่ในรูปเดียวกัน:
 *   เบอร์โทร   ตัดทุกอย่างที่ไม่ใช่ตัวเลขออก   081-234-5678 = 0812345678
 *   อีเมล/LINE ตัดช่องว่างหัวท้าย + ตัวพิมพ์เล็ก
 *   ชื่อ        ยุบช่องว่างซ้ำ + ตัวพิมพ์เล็ก แล้วเทียบสองแบบ (นับ/ไม่นับชื่อกลาง)
 *
 * ตอบเป็นรายชื่อ + เหตุผลที่คิดว่าซ้ำ ไม่ได้ตัดสินใจแทน — ชื่อซ้ำกันจริง ๆ ก็มี
 * ฝั่งหน้าจอเอาไปให้คนเลือกว่าจะใช้ใบเดิมหรือยืนยันว่าเป็นคนละคน
 *
 * ต้องลงทะเบียนก่อน GET /api/customers/:id — Router เอาเส้นทางแรกที่ตรง
 * ไม่งั้น "duplicates" จะถูกอ่านเป็น id
 */
function normPhone(?string $v): string
{
    return preg_replace('/\D+/', '', (string) $v) ?? '';
}

function normText(?string $v): string
{
    return mb_strtolower(trim((string) $v));
}

/** ชื่อเต็มในรูปที่เทียบกันได้ — ยุบช่องว่างซ้ำ ตัวพิมพ์เล็ก */
function normName(?string $first, ?string $mid, ?string $last): string
{
    $joined = trim(implode(' ', array_filter([
        trim((string) $first), trim((string) $mid), trim((string) $last),
    ], fn ($x) => $x !== '')));
    return mb_strtolower(preg_replace('/\s+/u', ' ', $joined));
}

POST('/api/customers/duplicates', function (array $req) {
    $b = $req['body'];

    $phone = normPhone($b['phone'] ?? null);
    $email = normText($b['email'] ?? null);
    $line  = normText($b['line_id'] ?? null);
    $birth = trim((string) ($b['birth_date'] ?? ''));
    $full  = normName($b['first_name'] ?? null, $b['mid_name'] ?? null, $b['last_name'] ?? null);
    $short = normName($b['first_name'] ?? null, null, $b['last_name'] ?? null);
    $skip  = int_or($b['exclude_id'] ?? null);

    if ($full === '' && $phone === '' && $email === '' && $line === '') {
        return ['matches' => []];
    }

    /* ดึงมาเฉพาะแถวที่มีโอกาสซ้ำ แล้วค่อยหาเหตุผลใน PHP — ตารางลูกค้าของร้านเดียว
       ไม่ได้ใหญ่ แต่ก็ไม่ควรกวาดทั้งตารางทุกครั้งที่มีคนกดบันทึก */
    /* ด่าน "ช่องนี้กรอกมาไหม" ใช้ CHAR_LENGTH(?) > 0 ไม่ใช่ ? <> ''
       การเทียบพารามิเตอร์กับลิเทอรัลว่างเป็นการเทียบของสองอย่างที่ coercibility
       เท่ากัน ถ้า collation ของทั้งสองไม่ตรง MariaDB ปฏิเสธทั้งคำสั่งด้วย 1267
       (บนโฮสต์ พารามิเตอร์ได้ utf8mb4_general_ci ส่วนลิเทอรัลได้ unicode_ci —
       ดูคำอธิบายเต็มที่ /api/bookings/calendar) · ความยาวเป็นตัวเลข ไม่มี collation
       ส่วนบรรทัด `... = ?` ที่เหลือเทียบกับคอลัมน์ซึ่งเป็น IMPLICIT จึงชนะและไม่พัง */
    $rows = Db::all(
        "SELECT * FROM customers
          WHERE (CHAR_LENGTH(?) > 0 AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                   COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+','') = ?)
             OR (CHAR_LENGTH(?) > 0 AND LOWER(TRIM(COALESCE(email,''))) = ?)
             OR (CHAR_LENGTH(?) > 0 AND LOWER(TRIM(COALESCE(line_id,''))) = ?)
             OR (CHAR_LENGTH(?) > 0 AND LOWER(TRIM(COALESCE(first_name,''))) = ?)
             OR (CHAR_LENGTH(?) > 0 AND LOWER(TRIM(COALESCE(last_name,''))) = ?)
          ORDER BY id DESC LIMIT 50",
        $phone, $phone,
        $email, $email,
        $line, $line,
        normText($b['first_name'] ?? null), normText($b['first_name'] ?? null),
        normText($b['last_name'] ?? null), normText($b['last_name'] ?? null)
    );

    $out = [];
    foreach ($rows as $r) {
        if ($skip && (int) $r['id'] === $skip) {
            continue;
        }
        $rFull  = normName($r['first_name'], $r['mid_name'], $r['last_name']);
        $rShort = normName($r['first_name'], null, $r['last_name']);
        $why    = [];

        if ($phone !== '' && normPhone($r['phone']) === $phone) {
            $why[] = 'เบอร์โทรตรงกัน';
        }
        if ($email !== '' && normText($r['email']) === $email) {
            $why[] = 'อีเมลตรงกัน';
        }
        if ($line !== '' && normText($r['line_id']) === $line) {
            $why[] = 'LINE ID ตรงกัน';
        }
        if ($full !== '' && $rFull === $full) {
            $why[] = 'ชื่อ-นามสกุลตรงกัน';
        } elseif ($short !== '' && $rShort === $short) {
            $why[] = 'ชื่อ-นามสกุลตรงกัน (ชื่อกลางต่างกัน)';
        }
        if ($birth !== '' && substr((string) $r['birth_date'], 0, 10) === substr($birth, 0, 10)) {
            $why[] = 'วันเกิดตรงกัน';
        }

        if ($why) {
            $r['why'] = $why;
            /* เบอร์/อีเมล/LINE ชี้ตัวคนได้จริง ชื่อซ้ำอย่างเดียวยังเป็นแค่ "น่าสงสัย" */
            $r['strong'] = (bool) array_intersect($why, ['เบอร์โทรตรงกัน', 'อีเมลตรงกัน', 'LINE ID ตรงกัน']);
            $out[] = $r;
        }
    }

    usort($out, fn ($a, $b2) => (int) $b2['strong'] <=> (int) $a['strong']);
    return ['matches' => array_slice($out, 0, 10)];
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

/**
 * อายุที่ลูกค้าบอก — คนละช่องกับวันเกิด และไม่ได้แปลงเป็นวันเกิดปลอม
 *
 * คืน null เมื่อไม่ได้กรอกมา · กรอกมาแล้วใช้ไม่ได้คือ 400 ไม่ใช่เงียบ ๆ ทิ้งค่า
 * เพดาน 120 เท่ากับด่านของวันเกิด — เลขเดียวกันควรผ่าน/ไม่ผ่านเหมือนกันทั้งสองทาง
 */
function customerAge($v): ?int
{
    $s = trim((string) ($v ?? ''));
    if ($s === '') {
        return null;
    }
    if (preg_match('/^\d{1,3}$/', $s) !== 1 || (int) $s > 120) {
        throw new HttpError(400, 'อายุต้องเป็นตัวเลข 0–120 ปี', ['reason' => 'bad_age']);
    }
    return (int) $s;
}

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
    /* กรอกมาทั้งวันเกิดและอายุ = วันเกิดชนะ · ดูเหตุผลที่ PUT ข้างล่าง */
    $age = trim((string) ($body['birth_date'] ?? '')) !== ''
        ? null
        : customerAge($body['age_years'] ?? null);
    $r = Db::run(
        'INSERT INTO customers (first_name, mid_name, last_name, sex, nationality,
           email, phone, line_id, birth_date, notes, age_years, age_recorded_on)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        ...[...customerCols($body), $age, $age === null ? null : today()]
    );
    return Db::get('SELECT * FROM customers WHERE id = ?', $r['insertId']);
});

PUT('/api/customers/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    if (!Db::get('SELECT id FROM customers WHERE id = ?', $id)) {
        missing();
    }
    /* วันที่ถามอายุขยับเฉพาะตอนที่ "ตัวเลขอายุ" เปลี่ยนจริง — กดบันทึกหน้านี้ด้วยเรื่องอื่น
       แล้วปล่อยให้วันที่เลื่อนมาเป็นวันนี้ เท่ากับอ้างว่าเพิ่งถามลูกค้าใหม่ ทั้งที่ไม่ได้ถาม
       ผลคืออายุจะไม่ยอมโตสักที เพราะฐานนับหนึ่งใหม่ทุกครั้งที่มีคนเปิดหน้าแก้ไข */
    $old = Db::get('SELECT age_years, age_recorded_on FROM customers WHERE id = ?', $id);
    $age = customerAge($req['body']['age_years'] ?? null);
    $was = $old['age_years'] === null ? null : (int) $old['age_years'];
    /* มีวันเกิดแล้วอายุที่กรอกไว้ต้องหายไป ไม่ใช่นอนคู่กัน — วันเกิดคำนวณอายุได้แม่นกว่า
       และค่าที่ไม่มีใครอ่านแต่ยังอยู่ในฐาน คือค่าที่วันหนึ่งจะมีคนอ่านแล้วได้เลขผิด */
    if (trim((string) ($req['body']['birth_date'] ?? '')) !== '') {
        $age = null;
    }
    if ($age === null) {
        $recorded = null;
    } elseif ($age === $was && $old['age_recorded_on'] !== null) {
        $recorded = $old['age_recorded_on'];
    } else {
        $recorded = today();
    }
    Db::run(
        'UPDATE customers SET first_name=?, mid_name=?, last_name=?, sex=?, nationality=?,
           email=?, phone=?, line_id=?, birth_date=?, notes=?, age_years=?, age_recorded_on=? WHERE id=?',
        ...[...customerCols($req['body']), $age, $recorded, $id]
    );
    return Db::get('SELECT * FROM customers WHERE id = ?', $id);
});

/** ช่องที่ "เติมข้อมูลลูกค้า" เขียนได้ ตามลำดับบนจอ — ป้ายใช้ในข้อความและไทม์ไลน์ */
const CUSTOMER_FILL_FIELDS = [
    'birth_date' => 'วันเกิด',
    /* ลูกค้าบางคนบอกมาแค่อายุ — ขั้นรับลูกค้าต้องจดได้โดยไม่ต้องเดาวันเกิดให้เขา
       เติมช่องนี้แล้ว age_recorded_on ถูกตั้งเป็นวันนี้ไปด้วย (ดูใน tx ข้างล่าง) */
    'age_years'  => 'อายุ',
    'phone'      => 'เบอร์โทร',
    'line_id'    => 'LINE / WhatsApp',
    'email'      => 'อีเมล',
    'sex'        => 'เพศ',
];

/**
 * "เติมข้อมูลลูกค้า" จากขั้นรับลูกค้า — เขียนเฉพาะช่องที่ส่งมา และเฉพาะช่องที่ยังว่าง
 *
 * ทำไมไม่ใช้ PUT ข้างบน: PUT เขียนทับทั้งสิบคอลัมน์ในคำสั่งเดียว แต่แถวเคสที่หน้าเคส
 * ถืออยู่ไม่มีชื่อกลางกับหมายเหตุลูกค้า ส่ง {...c} ไปเมื่อไหร่ สองช่องนั้นหายเงียบ ๆ
 *
 * ช่องที่มีค่าอยู่แล้วเขียนทับไม่ได้ (409) — แก้ค่าที่มีต้องไปหน้าแก้ไขข้อมูลลูกค้า
 * และกันกรณีสองเครื่องเติมพร้อมกันด้วย: ล็อกแถวลูกค้าก่อนตรวจว่ายังว่างอยู่
 * ปฏิเสธทั้งคำขอ ไม่เติมบางช่องแล้วข้ามบางช่อง — คนกดจะไม่รู้ว่าอะไรเข้าไปบ้าง
 *
 * case_id (ถ้าส่งมา) ต้องเป็นเคสของลูกค้าคนนี้ แล้วไทม์ไลน์เคสลง customer_filled
 *
 * เทสต์: api/tests/32-customer-fill.test.php
 */
POST('/api/customers/:id/fill', function (array $req) {
    $id     = int_or($req['params']['id']);
    $body   = $req['body'];
    $caseId = int_or($body['case_id'] ?? null);

    if (!$id || !Db::get('SELECT id FROM customers WHERE id = ?', $id)) {
        missing('ไม่พบลูกค้า');
    }

    $fill = [];
    foreach (CUSTOMER_FILL_FIELDS as $col => $label) {
        $v = trim((string) ($body[$col] ?? ''));
        if ($v !== '') {
            $fill[$col] = $v;
        }
    }
    if ($fill === []) {
        throw new HttpError(400, 'ยังไม่ได้กรอกข้อมูลที่จะเติม', ['reason' => 'nothing_to_fill']);
    }

    if (isset($fill['birth_date'])) {
        /* อายุคิดกับวันนี้ของร้าน ไม่ใช่ของเครื่องที่กด — ปีเต็ม ถึงวันเกิดแล้วค่อยนับเพิ่ม */
        $ok = preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $fill['birth_date'], $m) === 1
            && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
        if ($ok) {
            [$ty, $tm, $td] = array_map('intval', explode('-', today()));
            $age = $ty - (int) $m[1] - (([$tm, $td] < [(int) $m[2], (int) $m[3]]) ? 1 : 0);
            $ok  = $fill['birth_date'] <= today() && $age <= 120;
        }
        if (!$ok) {
            throw new HttpError(400, 'วันเกิดไม่ถูกต้อง', ['reason' => 'bad_birth_date']);
        }
    }
    if (isset($fill['age_years'])) {
        /* โยน 400 เองด้วยข้อความเดียวกับหน้าเพิ่ม/แก้ไขลูกค้า — customerAge() เป็นด่านเดียว */
        $fill['age_years'] = (string) customerAge($fill['age_years']);
        /* กรอกมาทั้งคู่ในครั้งเดียว: วันเกิดชนะ ทิ้งอายุไปเลย ไม่ใช่เก็บทั้งสองแล้วค่อยเลือกทีหลัง */
        if (isset($fill['birth_date'])) {
            unset($fill['age_years']);
        }
    }
    /* ความยาวสูงสุดตามคอลัมน์บน production — phone varchar(40) · line_id varchar(80) · email varchar(120)
       ยาวเกินแล้วปล่อยลงฐานได้ 500 จาก MariaDB แทนข้อความที่คนกดอ่านรู้เรื่อง */
    if (isset($fill['phone']) && strlen(normPhone($fill['phone'])) < 9) {
        throw new HttpError(400, 'เบอร์โทรต้องมีตัวเลขอย่างน้อย 9 หลัก', ['reason' => 'bad_phone']);
    }
    if (isset($fill['phone']) && mb_strlen($fill['phone']) > 40) {
        throw new HttpError(400, 'เบอร์โทรยาวเกิน 40 ตัวอักษร', ['reason' => 'bad_phone']);
    }
    if (isset($fill['line_id']) && mb_strlen($fill['line_id']) > 80) {
        throw new HttpError(400, 'LINE / WhatsApp ยาวเกิน 80 ตัวอักษร', ['reason' => 'bad_line']);
    }
    if (isset($fill['email']) && (mb_strlen($fill['email']) > 120 || filter_var($fill['email'], FILTER_VALIDATE_EMAIL) === false)) {
        throw new HttpError(400, 'อีเมลไม่ถูกต้อง', ['reason' => 'bad_email']);
    }
    if (isset($fill['sex']) && !in_array($fill['sex'], Lookups::lists()['sex'] ?? [], true)) {
        throw new HttpError(400, 'เพศต้องเลือกจากรายการ', ['reason' => 'bad_sex']);
    }

    if ($caseId) {
        $case = Db::get('SELECT customer_id FROM cases WHERE id = ?', $caseId);
        if (!$case || (int) $case['customer_id'] !== $id) {
            throw new HttpError(400, 'เคสนี้ไม่ใช่ของลูกค้าคนนี้ — รีเฟรชหน้าแล้วลองใหม่', ['reason' => 'case_mismatch']);
        }
    }

    return Db::tx(function (Tx $q) use ($id, $fill, $caseId) {
        $c     = $q->get('SELECT * FROM customers WHERE id = ? FOR UPDATE', $id);
        $taken = array_values(array_filter(
            array_keys($fill),
            static fn(string $col): bool => trim((string) ($c[$col] ?? '')) !== ''
        ));
        if ($taken) {
            $names = implode(', ', array_map(static fn(string $col) => CUSTOMER_FILL_FIELDS[$col], $taken));
            throw new HttpError(
                409,
                "ลูกค้ามี $names อยู่แล้ว — รีเฟรชหน้าแล้วดูอีกครั้ง ถ้าจะแก้ให้ไปที่หน้าแก้ไขข้อมูลลูกค้า",
                ['reason' => 'already_filled', 'fields' => $taken]
            );
        }

        /* ลูกค้าที่มีวันเกิดอยู่แล้วไม่ต้องเติมอายุ — หน้าจอไม่เสนอช่องนี้ให้อยู่แล้ว
           ด่านนี้กันคำขอที่ยิงตรงมา ไม่ให้ฐานมีสองคำตอบของคำถามเดียวกัน */
        if (isset($fill['age_years']) && trim((string) ($c['birth_date'] ?? '')) !== '') {
            throw new HttpError(
                409,
                'ลูกค้ามีวันเกิดอยู่แล้ว — อายุคิดจากวันเกิดให้เอง ไม่ต้องกรอก',
                ['reason' => 'already_filled', 'fields' => ['birth_date']]
            );
        }

        $write = $fill;
        if (isset($write['age_years'])) {
            $write['age_recorded_on'] = today();
        }
        $sets = implode(', ', array_map(static fn(string $col) => "`$col` = ?", array_keys($write)));
        $q->run("UPDATE customers SET $sets WHERE id = ?", ...[...array_values($write), $id]);

        $actor  = StockModule::actor();
        $labels = array_map(static fn(string $col) => CUSTOMER_FILL_FIELDS[$col], array_keys($fill));
        logEvent($q, $caseId, [
            'action'      => 'customer_filled',
            'entity'      => 'customer',
            'entity_id'   => $id,
            'employee_id' => $actor['employeeId'] ?? null,
            'note'        => 'เติมข้อมูลลูกค้า: ' . implode(', ', $labels),
            'payload'     => ['customer_id' => $id, 'fields' => $fill],
        ]);

        return [
            'customer' => $q->get('SELECT * FROM customers WHERE id = ?', $id),
            'filled'   => array_keys($fill),
        ];
    });
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
