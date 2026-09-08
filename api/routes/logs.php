<?php
/**
 * บันทึกการใช้งาน — เส้นสำหรับ "อ่าน" อย่างเดียว
 *
 * ไม่มี POST/PUT/DELETE ที่นี่โดยตั้งใจ · ล็อกที่ลบทิ้งได้จากหน้าจอคือล็อกที่
 * เชื่อไม่ได้ตอนที่ต้องใช้จริง ๆ · ของเก่าหายไปเองตามอายุที่ ActivityLog กำหนด
 * ซึ่งเป็นกฎเดียวกับทุกแถว ไม่ใช่การเลือกลบเป็นรายการ
 *
 * ทั้งกลุ่มเป็นงานของแอดมิน — กันด้วย ADMIN_PREFIXES ใน index.php ที่เดียว
 */
declare(strict_types=1);

/** ชนิดที่มีจริง — ค่าที่ไม่รู้จักถูกทิ้ง ไม่ใช่ส่งต่อเข้า SQL */
const LOG_KINDS = ['audit', 'auth', 'error', 'request'];

/**
 * เงื่อนไข + พารามิเตอร์จากตัวกรองบนหน้าจอ
 *
 * @return array{0: string, 1: array}
 */
function logFilters(array $q): array
{
    $where  = [];
    $params = [];

    $kind = str_or($q['kind'] ?? null);
    if (in_array($kind, LOG_KINDS, true)) {
        $where[]  = 'kind = ?';
        $params[] = $kind;
    }

    $actor = int_or($q['actor_id'] ?? null);
    if ($actor !== null) {
        $where[]  = 'actor_id = ?';
        $params[] = $actor;
    }

    $entity = str_or($q['entity'] ?? null);
    if ($entity !== '') {
        $where[]  = 'entity = ?';
        $params[] = $entity;
    }

    $entityId = int_or($q['entity_id'] ?? null);
    if ($entityId !== null) {
        $where[]  = 'entity_id = ?';
        $params[] = $entityId;
    }

    /* ช่วงวันที่เป็น "ทั้งวันนั้น" ทั้งสองฝั่ง — คนกรอก 8 ก.ย. ถึง 8 ก.ย. หมายถึง
       ทั้งวันที่ 8 ไม่ใช่ช่วงเวลาศูนย์วินาทีที่เที่ยงคืน */
    $from = nul($q['from'] ?? null);
    if ($from !== null) {
        $where[]  = 'at >= ?';
        $params[] = substr($from, 0, 10) . ' 00:00:00';
    }
    $to = nul($q['to'] ?? null);
    if ($to !== null) {
        $where[]  = 'at <= ?';
        $params[] = substr($to, 0, 10) . ' 23:59:59';
    }

    /* ค้นในสิ่งที่คนจำได้: ชื่อคนทำ ข้อความสรุป เส้นทาง และค่าที่เปลี่ยน
       (ค้น changes ด้วย เพราะคำถามจริงคือ "ใครแก้เบอร์นี้" ไม่ใช่ "แก้ลูกค้าคนไหน") */
    $term = str_or($q['q'] ?? null);
    if ($term !== '') {
        $p        = like($term);
        $where[]  = '(actor_name LIKE ? OR summary LIKE ? OR path LIKE ? OR changes LIKE ? OR payload LIKE ?)';
        $params   = array_merge($params, [$p, $p, $p, $p, $p]);
    }

    return [$where ? ('WHERE ' . implode(' AND ', $where)) : '', $params];
}

GET('/api/logs', function (array $req) {
    $q = $req['query'];
    [$where, $params] = logFilters($q);

    $limit  = min(max(int_or($q['limit'] ?? null, 50) ?? 50, 1), 500);
    $offset = max(int_or($q['offset'] ?? null, 0) ?? 0, 0);

    /* นับก่อน แล้วค่อยดึงหน้าเดียว — ตารางนี้โตเป็นแสนแถว การส่งทั้งชุดมาให้
       หน้าเว็บหั่นเองแบบหน้าอื่น ๆ ทำที่นี่ไม่ได้ */
    $total = (int) (Db::get("SELECT COUNT(*) n FROM activity_log $where", ...$params)['n'] ?? 0);

    $rows = Db::all(
        "SELECT * FROM activity_log $where ORDER BY at DESC, id DESC LIMIT ? OFFSET ?",
        ...array_merge($params, [$limit, $offset])
    );

    /* คลายกลับเป็นโครงสร้างตั้งแต่ที่นี่ — หน้าเว็บไม่ต้องรู้ว่าเก็บเป็น JSON ในคอลัมน์ */
    foreach ($rows as &$r) {
        $r['changes'] = $r['changes'] ? json_decode((string) $r['changes'], true) : null;
        $r['payload'] = $r['payload'] ? json_decode((string) $r['payload'], true) : null;
    }
    unset($r);

    return ['rows' => $rows, 'total' => $total, 'limit' => $limit, 'offset' => $offset];
});

/** รายชื่อคนที่เคยมีร่องรอยในล็อก — ตัวเลือกของช่องกรอง "ใคร" */
GET('/api/logs/actors', function () {
    return Db::all(
        "SELECT actor_id AS id,
                MAX(actor_name) AS name,
                MAX(actor_role) AS role,
                COUNT(*) AS n,
                MAX(at)  AS last_at
           FROM activity_log
          WHERE actor_id IS NOT NULL
          GROUP BY actor_id
          ORDER BY MAX(at) DESC
          LIMIT 100"
    );
});

/**
 * ตัวเลขบนหัวหน้าจอ — วันนี้เกิดอะไรขึ้นบ้าง
 *
 * นับเฉพาะวันนี้ ไม่ใช่ทั้งตาราง เพราะ "ทั้งหมด 480,000 แถว" ไม่ได้ตอบอะไรที่
 * คนเปิดหน้านี้อยากรู้ · ใช้ดัชนี idx_log_at ตัวเดียวจบ
 */
GET('/api/logs/stats', function () {
    $row = Db::get(
        "SELECT COUNT(*) AS total,
                SUM(kind = 'audit')   AS audit,
                SUM(kind = 'auth')    AS auth,
                SUM(kind = 'error')   AS error,
                SUM(kind = 'request') AS request,
                COUNT(DISTINCT actor_id) AS actors
           FROM activity_log
          WHERE at >= CURDATE()"
    ) ?? [];

    $oldest = Db::get('SELECT MIN(at) AS at FROM activity_log');

    return [
        'today'  => [
            'total'   => (int) ($row['total'] ?? 0),
            'audit'   => (int) ($row['audit'] ?? 0),
            'auth'    => (int) ($row['auth'] ?? 0),
            'error'   => (int) ($row['error'] ?? 0),
            'request' => (int) ($row['request'] ?? 0),
            'actors'  => (int) ($row['actors'] ?? 0),
        ],
        'oldest' => $oldest['at'] ?? null,
    ];
});
