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

GET('/api/uploads', function (array $req) {
    $caseId = int_or($req['query']['case_id'] ?? null);
    if (!$caseId) {
        bad('กรุณาระบุเคส');
    }
    return Db::all(
        'SELECT p.*, e.employee_name AS taken_by_name FROM case_photos p
           LEFT JOIN employees e ON e.id = p.taken_by
          WHERE p.case_id = ? ORDER BY p.id DESC',
        $caseId
    );
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

    $id = Db::tx(function (Tx $q) use ($body, $caseId, $fileName, $file, $mime) {
        $r = $q->run(
            'INSERT INTO case_photos (case_id, centering_id, payment_id, kind, file_name,
               original_name, mime_type, file_size, caption, taken_by)
             VALUES (?,?,?,?,?,?,?,?,?,?)',
            $caseId,
            int_or($body['centering_id'] ?? null),
            int_or($body['payment_id'] ?? null),
            str_or($body['kind'] ?? null, 'other') ?: 'other',
            $fileName,
            str_or($file['name'] ?? null),
            $mime,
            (int) $file['size'],
            nul($body['caption'] ?? null),
            int_or($body['taken_by'] ?? null)
        );
        logEvent($q, $caseId, [
            'action'      => 'photo_uploaded',
            'entity'      => 'case_photo',
            'entity_id'   => $r['insertId'],
            'employee_id' => int_or($body['taken_by'] ?? null),
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
