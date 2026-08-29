<?php
/**
 * Advance queue bookings (จองคิวล่วงหน้า).
 *
 * A booking can be for a known customer or just a name and a phone number.
 * When they arrive it becomes a real case — creating the customer record then
 * if this was their first visit.
 */
declare(strict_types=1);

const BOOKING_COLS = ['customer_id', 'first_name', 'last_name', 'phone', 'line_id',
    'booking_date', 'booking_time', 'duration_min', 'service_type', 'channel',
    'assigned_to', 'reminder_minutes', 'intake_note', 'notes'];

function bookingVals(array $b): array
{
    $out = [];
    foreach (BOOKING_COLS as $c) {
        if ($c === 'customer_id' || $c === 'assigned_to') {
            $out[] = int_or($b[$c] ?? null);
        } elseif ($c === 'service_type') {
            // NOT NULL columns — never let a blank field become NULL
            $out[] = str_or($b['service_type'] ?? null) ?: 'eye_exam';
        } elseif ($c === 'channel') {
            $out[] = str_or($b['channel'] ?? null) ?: 'phone';
        } elseif ($c === 'duration_min') {
            $out[] = max(5, int_or($b['duration_min'] ?? null, 30) ?? 30);
        } elseif ($c === 'reminder_minutes') {
            /* หน้าจองคิวไม่ถามทีละใบแล้ว — ไม่ส่งมาก็ใช้ค่าที่ตั้งไว้ในหน้า ตั้งค่า
               (reminder_default_minutes) ปรับที่เดียวมีผลกับคิวที่จองหลังจากนั้นทั้งหมด */
            $fallback = int_or(Telegram::settings()['reminder_default_minutes'] ?? null, 10) ?? 10;
            $n = int_or($b['reminder_minutes'] ?? null, $fallback) ?? $fallback;
            $out[] = $n < 0 ? 0 : min($n, 1440);
        } elseif ($c === 'booking_time') {
            $t = str_or($b['booking_time'] ?? null);
            $out[] = strlen($t) === 5 ? $t . ':00' : $t;
        } else {
            $out[] = nul($b[$c] ?? null);
        }
    }
    return $out;
}

GET('/api/bookings/calendar', function (array $req) {
    $raw   = str_or($req['query']['month'] ?? null);
    $month = preg_match('/^\d{4}-\d{2}$/', $raw) ? $raw : substr(today(), 0, 7);

    $days = Db::all(
        "SELECT booking_date AS d, COUNT(*) total,
                SUM(status IN ('booked','confirmed')) pending,
                SUM(status = 'arrived') arrived,
                SUM(status = 'in_service') in_service,
                SUM(status = 'done') done,
                SUM(status = 'no_show') no_show,
                SUM(status = 'cancelled') cancelled
           FROM bookings
          WHERE DATE_FORMAT(booking_date, '%Y-%m') = ?
          GROUP BY booking_date ORDER BY booking_date",
        $month
    );
    return ['month' => $month, 'days' => $days];
});

GET('/api/bookings/today', function () {
    $sel  = Sql::BOOKING_SELECT;
    $from = Sql::BOOKING_FROM;
    $rows = Db::all(
        "SELECT $sel $from
          WHERE b.booking_date = CURDATE() AND b.status <> 'cancelled'
          ORDER BY b.booking_time"
    );
    return array_map(fn($r) => Booking::shape($r), $rows);
});

GET('/api/bookings', function (array $req) {
    $q     = $req['query'];
    $where = [];
    $args  = [];

    if ($date = str_or($q['date'] ?? null)) {
        $where[] = 'b.booking_date = ?';
        $args[]  = $date;
    }
    if ($from = str_or($q['from'] ?? null)) {
        $where[] = 'b.booking_date >= ?';
        $args[]  = $from;
    }
    if ($to = str_or($q['to'] ?? null)) {
        $where[] = 'b.booking_date <= ?';
        $args[]  = $to;
    }
    if ($status = str_or($q['status'] ?? null)) {
        $where[] = 'b.status = ?';
        $args[]  = $status;
    }
    if (($q['upcoming'] ?? null) === '1') {
        $where[] = "TIMESTAMP(b.booking_date, b.booking_time) >= NOW()
                    AND b.status IN ('booked','confirmed')";
    }
    if ($term = str_or($q['q'] ?? null)) {
        $p = like($term);
        $where[] = '(b.booking_code LIKE ? OR b.phone LIKE ? OR b.first_name LIKE ?
                  OR b.last_name LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?
                  OR c.phone LIKE ? OR b.intake_note LIKE ?)';
        array_push($args, $p, $p, $p, $p, $p, $p, $p, $p);
    }

    $sel      = Sql::BOOKING_SELECT;
    $bkFrom   = Sql::BOOKING_FROM;
    $sqlWhere = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $args[]   = min(int_or($q['limit'] ?? null, 300), 1000);

    $rows = Db::all(
        "SELECT $sel $bkFrom $sqlWhere ORDER BY b.booking_date, b.booking_time LIMIT ?",
        ...$args
    );
    return array_map(fn($r) => Booking::shape($r), $rows);
});

function bookingRow(?int $id): ?array
{
    $sel  = Sql::BOOKING_SELECT;
    $from = Sql::BOOKING_FROM;
    return Booking::shape(Db::get("SELECT $sel $from WHERE b.id = ?", $id));
}

function bookingDetail(?int $id): array
{
    $b = bookingRow($id);
    if (!$b) {
        missing();
    }
    $b['step_notes'] = Db::all(
        'SELECT n.*, e.employee_name AS recorded_by_name FROM booking_notes n
           LEFT JOIN employees e ON e.id = n.recorded_by
          WHERE n.booking_id = ? ORDER BY n.created_at, n.id',
        $id
    );
    $b['notifications'] = Db::all(
        'SELECT id, kind, ok, error, created_at FROM notification_log
          WHERE booking_id = ? ORDER BY created_at DESC LIMIT 20',
        $id
    );
    return $b;
}

GET('/api/bookings/:id', fn(array $r) => bookingDetail(int_or($r['params']['id'])));

POST('/api/bookings', function (array $req) {
    $body = $req['body'];
    if (nul($body['booking_date'] ?? null) === null) {
        bad('กรุณาเลือกวันที่จอง');
    }
    if (nul($body['booking_time'] ?? null) === null) {
        bad('กรุณาเลือกเวลาจอง');
    }
    $cid = int_or($body['customer_id'] ?? null);
    if ($cid && !Db::get('SELECT id FROM customers WHERE id = ?', $cid)) {
        bad('ไม่พบลูกค้ารายนี้');
    }
    if (!$cid && str_or($body['first_name'] ?? null) === '' && str_or($body['phone'] ?? null) === '') {
        bad('กรุณาเลือกลูกค้าเดิม หรือกรอกชื่อ/เบอร์โทรของลูกค้าใหม่');
    }
    $code = nextCode('BK', 'bookings', 'booking_code');

    $id = Db::tx(function (Tx $q) use ($body, $code) {
        $names = implode(',', BOOKING_COLS);
        $marks = implode(',', array_fill(0, count(BOOKING_COLS), '?'));
        $r = $q->run(
            "INSERT INTO bookings (booking_code, $names, created_by)
             VALUES (?, $marks, ?)",
            ...[$code, ...bookingVals($body), int_or($body['created_by'] ?? null)]
        );
        $bid = $r['insertId'];

        $notes = is_array($body['step_notes'] ?? null) ? $body['step_notes'] : [];
        foreach ($notes as $n) {
            if (!is_array($n) || str_or($n['note'] ?? null) === '') {
                continue;
            }
            $q->run(
                'INSERT INTO booking_notes (booking_id, step, question, note, recorded_by)
                 VALUES (?,?,?,?,?)',
                $bid,
                str_or($n['step'] ?? null, 'intake') ?: 'intake',
                nul($n['question'] ?? null),
                str_or($n['note']),
                int_or($n['recorded_by'] ?? null) ?? int_or($body['created_by'] ?? null)
            );
        }
        return $bid;
    });

    bookingCreatedPing($id);
    return bookingDetail($id);
});

/** A failed ping must never affect the booking itself. */
function bookingCreatedPing(int $id): void
{
    try {
        if (!Telegram::isEnabled()) {
            return;
        }
        $b = bookingRow($id);
        if (!$b) {
            return;
        }
        $b['service_label'] = Booking::serviceLabel($b['service_type'] ?? null);
        Telegram::send(
            Telegram::bookingCreatedMessage($b),
            ['kind' => 'booking_created', 'booking_id' => $id]
        );
    } catch (Throwable) {
        // swallowed on purpose
    }
}

PUT('/api/bookings/:id', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $cur  = Db::get('SELECT * FROM bookings WHERE id = ?', $id);
    if (!$cur) {
        missing();
    }
    // when the slot moves, clear the sent flag so the reminder fires for the new time
    $moved = str_or($body['booking_date'] ?? null) !== (string) $cur['booking_date']
        || substr(str_or($body['booking_time'] ?? null), 0, 5) !== substr((string) $cur['booking_time'], 0, 5);

    $set   = implode(',', array_map(fn($c) => "$c=?", BOOKING_COLS));
    $extra = $moved ? ', reminder_sent_at = NULL' : '';

    /* แก้ไขคิว = อัปเดตเฉพาะช่องที่ฟอร์มส่งมา ช่องที่ไม่ได้ส่ง (เช่น บันทึกเบื้องต้น
       ที่ตัดออกจากฟอร์มไปแล้ว) ต้องคงค่าเดิมไว้ ไม่ใช่ถูกเขียนทับด้วยค่า default
       — union ฝั่งซ้ายชนะ: คีย์ที่มีใน $body ใช้ของ $body ที่เหลือหยิบจากแถวเดิม */
    Db::run(
        "UPDATE bookings SET $set $extra WHERE id = ?",
        ...[...bookingVals($body + $cur), $id]
    );
    return bookingDetail($id);
});

POST('/api/bookings/:id/status', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $b    = Db::get('SELECT * FROM bookings WHERE id = ?', $id);
    if (!$b) {
        missing();
    }
    $s = str_or($body['status'] ?? null);
    if (!in_array($s, Booking::STATUS_CODES, true)) {
        bad("สถานะ \"$s\" ไม่ถูกต้อง");
    }

    Db::run(
        "UPDATE bookings SET status = ?,
           confirmed_at = CASE WHEN ? = 'confirmed' AND confirmed_at IS NULL THEN NOW() ELSE confirmed_at END,
           arrived_at   = CASE WHEN ? = 'arrived'   AND arrived_at   IS NULL THEN NOW() ELSE arrived_at END,
           cancelled_reason = CASE WHEN ? IN ('cancelled','no_show') THEN ? ELSE cancelled_reason END
         WHERE id = ?",
        $s, $s, $s, $s, nul($body['reason'] ?? null), $id
    );

    if (str_or($body['note'] ?? null) !== '') {
        Db::run(
            'INSERT INTO booking_notes (booking_id, case_id, step, question, note, recorded_by)
             VALUES (?,?,?,?,?,?)',
            $id,
            int_or($b['case_id']),
            $s,
            'เปลี่ยนสถานะ',
            str_or($body['note']),
            int_or($body['employee_id'] ?? null)
        );
    }
    return bookingDetail($id);
});

POST('/api/bookings/:id/notes', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $b    = Db::get('SELECT * FROM bookings WHERE id = ?', $id);
    if (!$b) {
        missing();
    }
    if (str_or($body['note'] ?? null) === '') {
        bad('กรุณากรอกบันทึก');
    }
    Db::run(
        'INSERT INTO booking_notes (booking_id, case_id, step, question, note, recorded_by)
         VALUES (?,?,?,?,?,?)',
        $id,
        int_or($b['case_id']),
        str_or($body['step'] ?? null, 'intake') ?: 'intake',
        nul($body['question'] ?? null),
        str_or($body['note']),
        int_or($body['recorded_by'] ?? null)
    );
    return bookingDetail($id);
});

DELETE('/api/bookings/:id/notes/:note_id', function (array $req) {
    Db::run(
        'DELETE FROM booking_notes WHERE id = ? AND booking_id = ?',
        int_or($req['params']['note_id']),
        int_or($req['params']['id'])
    );
    return bookingDetail(int_or($req['params']['id']));
});

/** turn a booking into a real case, creating the customer record if they are new */
POST('/api/bookings/:id/open-case', function (array $req) {
    $id   = int_or($req['params']['id']);
    $body = $req['body'];
    $b    = Db::get('SELECT * FROM bookings WHERE id = ?', $id);
    if (!$b) {
        missing();
    }
    if ($b['case_id']) {
        bad('การจองนี้เปิดเคสไปแล้ว');
    }

    $notes = Db::all(
        'SELECT question, note FROM booking_notes WHERE booking_id = ? ORDER BY created_at',
        $id
    );
    $lines = [$b['intake_note']];
    foreach ($notes as $n) {
        $lines[] = $n['question'] ? "{$n['question']}: {$n['note']}" : $n['note'];
    }
    $reception = implode("\n", array_filter($lines, fn($l) => $l !== null && $l !== ''));

    $result = Db::tx(function (Tx $q) use ($b, $body, $id, $reception) {
        $customerId      = int_or($b['customer_id']);
        $createdCustomer = false;

        if (!$customerId) {
            $r = $q->run(
                'INSERT INTO customers (first_name, last_name, phone, line_id, notes)
                 VALUES (?,?,?,?,?)',
                str_or($b['first_name']) ?: 'ลูกค้าจองคิว',
                nul($b['last_name']),
                nul($b['phone']),
                nul($b['line_id']),
                'มาจากการจองคิว ' . $b['booking_code']
            );
            $customerId      = $r['insertId'];
            $createdCustomer = true;
        }

        $code   = nextCode('CASE', 'cases', 'case_code');
        $status = str_or($body['status'] ?? null, 'reception') ?: 'reception';

        $rc = $q->run(
            'INSERT INTO cases (case_code, customer_id, status, is_new_customer, is_rush,
               received_by, recorded_by, reception_note)
             VALUES (?,?,?,?,?,?,?,?)',
            $code,
            $customerId,
            $status,
            $createdCustomer ? 1 : 0,
            boolInt($body['is_rush'] ?? null),
            int_or($body['received_by'] ?? null) ?? int_or($b['assigned_to']),
            int_or($body['received_by'] ?? null) ?? int_or($b['created_by']),
            $reception !== '' ? $reception : null
        );
        $caseId = $rc['insertId'];

        logEvent($q, $caseId, [
            'to_status'   => $status,
            'action'      => 'case_opened',
            'entity'      => 'booking',
            'entity_id'   => $id,
            'employee_id' => int_or($body['received_by'] ?? null),
            'note'        => 'เปิดจากการจองคิว ' . $b['booking_code'],
        ]);
        $q->run(
            "UPDATE bookings SET case_id = ?, customer_id = ?, status = 'in_service',
               arrived_at = COALESCE(arrived_at, NOW()) WHERE id = ?",
            $caseId,
            $customerId,
            $id
        );
        $q->run('UPDATE booking_notes SET case_id = ? WHERE booking_id = ?', $caseId, $id);

        return [
            'caseId'          => $caseId,
            'customerId'      => $customerId,
            'createdCustomer' => $createdCustomer,
            'caseCode'        => $code,
        ];
    });

    return $result + ['booking' => bookingDetail($id)];
});

DELETE('/api/bookings/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $b  = Db::get('SELECT * FROM bookings WHERE id = ?', $id);
    if (!$b) {
        missing();
    }
    if ($b['case_id']) {
        bad('ลบไม่ได้ — การจองนี้เปิดเคสไปแล้ว (ใช้ปุ่ม "ยกเลิก" แทน)');
    }
    Db::run('DELETE FROM bookings WHERE id = ?', $id);
    return ['ok' => true];
});

/** send this booking's reminder immediately */
POST('/api/bookings/:id/remind', function (array $req) {
    $id = int_or($req['params']['id']);
    $b  = bookingRow($id);
    if (!$b) {
        missing();
    }
    $notes = Db::all(
        'SELECT question, note FROM booking_notes WHERE booking_id = ? ORDER BY created_at LIMIT 12',
        $id
    );
    $noteLines = [];
    foreach ($notes as $n) {
        $noteLines[] = $n['question'] ? "• {$n['question']}: {$n['note']}" : "• {$n['note']}";
    }

    $startsAt = strtotime((string) $b['starts_at']);
    $mins     = max(0, (int) round(($startsAt - time()) / 60));

    $payload = $b + [
        'service_label' => Booking::serviceLabel($b['service_type'] ?? null),
        'step_notes'    => implode("\n", $noteLines),
    ];

    $res = Telegram::send(
        Telegram::reminderMessage($payload, $mins),
        ['kind' => 'booking_reminder_manual', 'booking_id' => $id, 'force' => true]
    );
    if (!$res['ok']) {
        bad($res['error'] ?? 'ส่งไม่สำเร็จ');
    }
    Db::run('UPDATE bookings SET reminder_sent_at = NOW() WHERE id = ?', $id);
    return bookingDetail($id);
});
