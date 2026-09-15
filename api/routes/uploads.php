<?php
/**
 * Case photos — center-point reference shots, payment slips, anything else
 * that gets attached to a case. Files live under api/uploads/<case_id>/ on
 * local disk (gitignored), rows live in the existing case_photos table.
 */
declare(strict_types=1);

const UPLOAD_MIME_EXT = [
    'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
    'application/pdf' => 'pdf',
];

function uploadDir(int $caseId): string
{
    $dir = dirname(__DIR__) . "/uploads/$caseId";
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

/** กล่อง "รูปภาพการวัด" ของขั้นวัด Center รับได้ 10 ใบต่อเคส */
const CENTERING_PHOTO_MAX = 10;

/*
 * โควตานับ "ต่อเคส + kind = centering" ให้ตรงกับสิ่งที่พนักงานเห็นในกล่องนั้นจริง ๆ
 * กล่องดึงรูปด้วย case_id + kind ไม่ได้กรองด้วย centering_id (ดูเหตุผลที่ GET
 * ข้างล่าง: รูปที่อัปโหลดตอนยังไม่มีแถว centerings จะมี centering_id เป็น NULL)
 * ถ้านับด้วย centering_id ตัวเลขบนจอกับตัวเลขที่ระบบบังคับจะไม่ตรงกัน
 *
 * ลิมิตแยกตาม kind เพราะสลิปโอนเงินกับไฟล์ส่งมอบยิงเข้าเส้นทางเดียวกันนี้
 * และไม่ควรถูกจำกัดตามไปด้วย
 */
function centeringPhotoRoom(int $caseId): int
{
    $row = Db::get(
        "SELECT COUNT(*) AS n FROM case_photos WHERE case_id = ? AND kind = 'centering'",
        $caseId
    );

    /* max(0, …) — เคสเก่าที่มีรูปเกิน 10 ใบมาก่อนวันบังคับลิมิตต้องได้ 0 ไม่ใช่เลขติดลบ */
    return max(0, CENTERING_PHOTO_MAX - (int) ($row['n'] ?? 0));
}

/*
 * ตัวกรองทั้งสามตัวเป็นทางเลือก ไม่ใส่ = ได้ทุกไฟล์ของเคสเหมือนเดิม
 * (หน้าชำระเงินกับหน้าส่งมอบดึงทั้งเคสแล้วไปจับคู่ payment_id เองฝั่งหน้าเว็บ
 *  เพราะมันวาดสลิปใต้รายการรับเงินหลายรายการในหน้าเดียว)
 *
 * เดิม endpoint นี้กรองด้วย case_id อย่างเดียว ทั้งที่ตอนอัปโหลดเก็บ kind /
 * centering_id / payment_id ไว้ครบ ผลคือกล่อง "รูปภาพการวัด" ของขั้นวัด Center
 * แสดงไฟล์ทุกใบของเคส สลิปโอนเงินจึงไปโผล่ปนกับรูปวัดศูนย์เลนส์
 *
 * กรองด้วย kind เป็นหลัก ไม่ใช่ centering_id — ข้อมูลจริงในตารางตอนนี้ kind
 * ถูกตั้งครบทุกแถว แต่ centering_id ตั้งไว้แค่บางแถว (รูปที่อัปโหลดตอนยังไม่มี
 * แถว centerings จะเป็น NULL) ถ้าไปกรองด้วย centering_id รูปวัดเก่าจะหายไปเฉย ๆ
 */
GET('/api/uploads', function (array $req) {
    $caseId = int_or($req['query']['case_id'] ?? null);
    if (!$caseId) {
        bad('กรุณาระบุเคส');
    }
    $sql = 'SELECT p.*, e.employee_name AS taken_by_name FROM case_photos p
           LEFT JOIN employees e ON e.id = p.taken_by
          WHERE p.case_id = ?';
    $args = [$caseId];

    /* nul() ไม่ใช่ str_or() — str_or คืน '' เสมอ ไม่เคยคืน null เงื่อนไขข้างล่าง
       จึงเป็นจริงตลอดแม้ไม่ได้ส่ง kind มา แล้วกลายเป็น AND p.kind = '' ซึ่งไม่
       แมตช์แถวไหนเลย ผลคือหน้าชำระเงินกับหน้าส่งมอบจะได้ไฟล์ 0 ใบ สลิปหายทั้งหมด */
    $kind = nul($req['query']['kind'] ?? null);
    if ($kind !== null) {
        $sql .= ' AND p.kind = ?';
        $args[] = $kind;
    }
    $centeringId = int_or($req['query']['centering_id'] ?? null);
    if ($centeringId) {
        $sql .= ' AND p.centering_id = ?';
        $args[] = $centeringId;
    }
    $paymentId = int_or($req['query']['payment_id'] ?? null);
    if ($paymentId) {
        $sql .= ' AND p.payment_id = ?';
        $args[] = $paymentId;
    }

    $sql .= ' ORDER BY p.id DESC';
    return Db::all($sql, ...$args);
});

GET('/api/uploads/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $p  = Db::get('SELECT * FROM case_photos WHERE id = ?', $id);
    if (!$p) {
        missing();
    }
    $path = dirname(__DIR__) . "/uploads/{$p['case_id']}/{$p['file_name']}";
    if (!is_file($path)) {
        missing();
    }
    header('Content-Type: ' . ($p['mime_type'] ?: 'application/octet-stream'));
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=31536000');
    readfile($path);
    exit;
});

POST('/api/uploads', function (array $req) {
    $body   = $req['body'];
    $caseId = int_or($body['case_id'] ?? null);
    if (!$caseId) {
        bad('กรุณาระบุเคส');
    }
    if (!Db::get('SELECT id FROM cases WHERE id = ?', $caseId)) {
        bad('ไม่พบเคส');
    }
    $kind = str_or($body['kind'] ?? null, 'other') ?: 'other';

    /* ด่านนี้ต้องอยู่ก่อน move_uploaded_file() ไม่งั้นไฟล์ที่ถูกปฏิเสธจะตกค้างบนดิสก์ */
    if ($kind === 'centering' && centeringPhotoRoom($caseId) < 1) {
        bad('แนบรูปการวัดได้ไม่เกิน ' . CENTERING_PHOTO_MAX . ' รูปต่อเคส — ลบรูปเก่าก่อนถ้าจะเพิ่ม');
    }
    $centeringId = int_or($body['centering_id'] ?? null);
    if ($centeringId && !Db::get('SELECT id FROM centerings WHERE id = ?', $centeringId)) {
        bad('ไม่พบข้อมูลศูนย์เลนส์');
    }
    $paymentId = int_or($body['payment_id'] ?? null);
    if ($paymentId && !Db::get('SELECT id FROM payments WHERE id = ?', $paymentId)) {
        bad('ไม่พบข้อมูลการชำระเงิน');
    }
    $takenBy = int_or($body['taken_by'] ?? null);
    if ($takenBy && !Db::get('SELECT id FROM employees WHERE id = ?', $takenBy)) {
        bad('ไม่พบพนักงาน');
    }
    $file = $_FILES['file'] ?? null;
    if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
        bad('กรุณาเลือกไฟล์');
    }
    if ($file['size'] > 8 * 1024 * 1024) {
        bad('ไฟล์ใหญ่เกินไป (จำกัด 8MB)');
    }
    $mime = mime_content_type($file['tmp_name']) ?: '';
    $ext  = UPLOAD_MIME_EXT[$mime] ?? null;
    if (!$ext) {
        bad('รองรับเฉพาะไฟล์ JPG, PNG, WEBP, PDF');
    }

    $fileName = uniqid('photo_', true) . ".$ext";
    $dest     = uploadDir($caseId) . "/$fileName";
    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        bad('บันทึกไฟล์ไม่สำเร็จ');
    }

    $id = Db::tx(function (Tx $q) use ($body, $caseId, $centeringId, $paymentId, $kind, $takenBy, $fileName, $file, $mime) {
        $r = $q->run(
            'INSERT INTO case_photos (case_id, centering_id, payment_id, kind, file_name,
               original_name, mime_type, file_size, caption, taken_by)
             VALUES (?,?,?,?,?,?,?,?,?,?)',
            $caseId,
            $centeringId,
            $paymentId,
            $kind,
            $fileName,
            str_or($file['name'] ?? null),
            $mime,
            (int) $file['size'],
            nul($body['caption'] ?? null),
            $takenBy
        );
        logEvent($q, $caseId, [
            'action'      => 'photo_uploaded',
            'entity'      => 'case_photo',
            'entity_id'   => $r['insertId'],
            'employee_id' => $takenBy,
        ]);
        return $r['insertId'];
    });

    return Db::get('SELECT * FROM case_photos WHERE id = ?', $id);
});

DELETE('/api/uploads/:id', function (array $req) {
    $id = int_or($req['params']['id']);
    $p  = Db::get('SELECT * FROM case_photos WHERE id = ?', $id);
    if (!$p) {
        missing();
    }
    $path = dirname(__DIR__) . "/uploads/{$p['case_id']}/{$p['file_name']}";
    Db::tx(function (Tx $q) use ($id, $p) {
        $q->run('DELETE FROM case_photos WHERE id = ?', $id);
        logEvent($q, int_or($p['case_id']), [
            'action'    => 'photo_deleted',
            'entity'    => 'case_photo',
            'entity_id' => $id,
        ]);
    });
    if (is_file($path)) {
        unlink($path);
    }
    return ['ok' => true];
});

/* ------------------------------------------------------------------ *
 * ปุ่ม "ส่งรูป" ของขั้นวัด Center
 * ------------------------------------------------------------------ */

/** ชื่อล็อกของการส่งรูปต่อเคส — กดยืนยันซ้ำจากสองแท็บ/สองเครื่องพร้อมกันได้รอบเดียว */
function centeringSendLock(int $caseId): string
{
    return 'optic_centering_send_' . $caseId;
}

/**
 * ลงไทม์ไลน์ของเคสว่าส่งอะไร ใครส่ง เมื่อไร — ทั้งส่งสำเร็จและส่งไม่ออก
 *
 * payload ใช้ชื่อฟิลด์ตามที่ร้านกำหนดไว้ (caseId, caseNumber, centerImages,
 * centerNote, sentBy, sentAt) · caseNumber คือรหัสเคส ไม่ใช่ id
 *
 * @param array{case_id:int, case_code:string, photo_ids:list<int>, note:?string,
 *              actor:?array, sent_at:string, ok:bool, error:?string} $f
 */
function centeringSendRecord(Tx $q, array $f): void
{
    $count = count($f['photo_ids']);
    logEvent($q, $f['case_id'], [
        'action'      => $f['ok'] ? 'centering_photos_sent' : 'centering_photos_send_failed',
        'entity'      => 'case_photo',
        'employee_id' => $f['actor']['employeeId'] ?? null,
        'note'        => mb_substr($f['ok']
            ? "ส่งรูปวัด Center $count รูปเข้า Telegram"
            : 'ส่งรูปวัด Center ไม่สำเร็จ: ' . $f['error'], 0, 250),
        'payload'     => [
            'caseId'       => $f['case_id'],
            'caseNumber'   => $f['case_code'],
            'centerImages' => $f['photo_ids'],
            'centerNote'   => $f['note'],
            'sentBy'       => [
                'id'   => $f['actor']['id'] ?? null,
                'name' => $f['actor']['displayName'] ?? $f['actor']['username'] ?? null,
            ],
            'sentAt'       => $f['sent_at'],
            'ok'           => $f['ok'],
            'error'        => $f['error'],
        ],
    ]);
}

/*
 * ส่งรูปทุกใบในกล่อง "รูปภาพการวัด" + หมายเหตุ เข้ากลุ่ม Telegram "รูปวัด Center"
 *
 * body: case_id, case_code, photo_ids (ชุดที่ผู้ใช้เห็นใน popup ตามลำดับบนจอ), note
 *
 * หน้าเว็บส่ง "สิ่งที่ผู้ใช้ตรวจแล้ว" มา ส่วนของที่ส่งออกไปจริงอ่านจากฐานทั้งหมด —
 * ถ้าสองอย่างไม่ตรงกัน (เปิดเคสอื่นค้างไว้ มีคนเพิ่ม/ลบรูประหว่างนั้น ยิง id สลิปมาปน)
 * ปฏิเสธทั้งชุด ไม่ส่งของที่ไม่ได้ผ่านตาคนกด
 *
 * หมายเหตุใช้ตามที่หน้าจอส่งมา เพราะนั่นคือข้อความในช่องหมายเหตุที่ผู้ใช้เห็นใน popup
 * แม้ยังไม่ได้กดบันทึก Draft (หน้าเว็บเตือนไว้ในกล่องแล้ว)
 *
 * ด่านทั้งหมดอยู่ก่อนถึง Telegram — api/tests/31-centering-photo-send.test.php
 */
POST('/api/centering-photos/send', function (array $req) {
    $body   = $req['body'];
    $caseId = int_or($body['case_id'] ?? null);
    $case   = $caseId ? Db::get(
        'SELECT c.id, c.case_code, cu.first_name, cu.last_name
           FROM cases c JOIN customers cu ON cu.id = c.customer_id
          WHERE c.id = ?',
        $caseId
    ) : null;
    if (!$case) {
        missing('ไม่พบเคส');
    }
    if (str_or($body['case_code'] ?? null) !== (string) $case['case_code']) {
        throw new HttpError(409, 'ข้อมูลเคสบนหน้าจอไม่ตรงกับเคสนี้ — รีเฟรชหน้าแล้วลองใหม่', ['reason' => 'case_changed']);
    }

    $photos = Db::all(
        "SELECT id, file_name, original_name, mime_type FROM case_photos
          WHERE case_id = ? AND kind = 'centering'",
        $caseId
    );
    if ($photos === []) {
        throw new HttpError(400, 'กรุณาเพิ่มรูปภาพก่อนส่ง', ['reason' => 'no_photos']);
    }

    $shown = array_map('intval', is_array($body['photo_ids'] ?? null) ? $body['photo_ids'] : []);
    $want  = $shown;
    $have  = array_map(static fn(array $p): int => (int) $p['id'], $photos);
    sort($want);
    sort($have);
    if ($want !== $have) {
        throw new HttpError(409, 'รูปภาพในเคสมีการเปลี่ยนแปลง — กรุณาตรวจสอบรูปอีกครั้งก่อนส่ง', ['reason' => 'photos_changed']);
    }

    $byId  = array_column($photos, null, 'id');
    $files = [];
    foreach ($shown as $id) {
        $p    = $byId[$id];
        $name = $p['original_name'] ?: $p['file_name'];
        $path = dirname(__DIR__) . "/uploads/$caseId/{$p['file_name']}";
        if (!is_file($path)) {
            throw new HttpError(409, "ไม่พบไฟล์รูป $name ในเครื่อง — ลบรูปนี้แล้วแนบใหม่", ['reason' => 'file_missing']);
        }
        $files[] = ['id' => $id, 'mime_type' => (string) $p['mime_type'], 'path' => $path, 'name' => $name];
    }

    $note = trim(str_or($body['note'] ?? null));
    $note = $note === '' ? null : mb_substr($note, 0, 1000);

    $lock = centeringSendLock($caseId);
    if ((int) (Db::get('SELECT GET_LOCK(?, 0) AS got', $lock)['got'] ?? 0) !== 1) {
        throw new HttpError(409, 'กำลังส่งรูปของเคสนี้อยู่ — รอสักครู่', ['reason' => 'sending']);
    }
    try {
        if (!Telegram::isConfigured('centering')) {
            throw new HttpError(
                400,
                'ยังไม่ได้ตั้งค่ากลุ่ม Telegram "รูปวัด Center" — แจ้งผู้ดูแลระบบให้ตั้งที่หน้า Settings',
                ['reason' => 'not_configured']
            );
        }

        $actor  = StockModule::actor();
        $sentBy = (string) ($actor['displayName'] ?? $actor['username'] ?? '');
        $sentAt = nowStamp();
        /* รูปสิบใบขึ้นไป Telegram ใช้เวลาเกินลิมิตสามสิบวินาทีปกติของ PHP ได้ */
        @set_time_limit(180);

        $res = Telegram::sendCenteringPhotos(
            Telegram::centeringPhotosMessage([
                'case_code' => $case['case_code'],
                'customer'  => trim($case['first_name'] . ' ' . $case['last_name']),
                'count'     => count($files),
                'note'      => $note,
                'sent_by'   => $sentBy,
                'sent_at'   => $sentAt,
            ]),
            $files
        );

        Db::tx(fn(Tx $q) => centeringSendRecord($q, [
            'case_id'   => $caseId,
            'case_code' => (string) $case['case_code'],
            'photo_ids' => $shown,
            'note'      => $note,
            'actor'     => $actor,
            'sent_at'   => $sentAt,
            'ok'        => $res['ok'],
            'error'     => $res['error'],
        ]));

        if (!$res['ok']) {
            throw new HttpError(502, 'ส่งรูปไม่สำเร็จ กรุณาลองอีกครั้ง', ['reason' => 'send_failed', 'detail' => $res['error']]);
        }
        return [
            'ok'        => true,
            'case_id'   => $caseId,
            'case_code' => $case['case_code'],
            'count'     => count($files),
            'sent_by'   => $sentBy,
            'sent_at'   => $sentAt,
        ];
    } finally {
        Db::get('SELECT RELEASE_LOCK(?) AS released', $lock);
    }
});
