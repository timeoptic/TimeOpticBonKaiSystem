<?php
/**
 * HTTP concerns: the error type the whole API throws, and JSON output.
 */
declare(strict_types=1);

class HttpError extends RuntimeException
{
    public int $status;

    /**
     * ข้อมูลที่ส่งกลับไปพร้อมข้อความ — เช่น `reason` ที่หน้าเว็บใช้แตกเงื่อนไข
     * (ข้อความภาษาไทยเปลี่ยนได้ รหัสเหตุผลคือสิ่งที่โค้ดตัดสินใจด้วย)
     */
    public array $payload;

    public function __construct(int $status, string $message, array $payload = [])
    {
        parent::__construct($message);
        $this->status  = $status;
        $this->payload = $payload;
    }
}

/** 400 — the caller sent something we cannot accept */
function bad(string $msg): void
{
    throw new HttpError(400, $msg);
}

/** 404 */
function missing(string $msg = 'ไม่พบข้อมูล / Not found'): void
{
    throw new HttpError(404, $msg);
}

final class Http
{
    /** Emit a JSON response and stop. */
    public static function json(int $status, mixed $payload): void
    {
        $body = json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
        );
        if ($body === false) {
            $body = json_encode(['error' => 'ไม่สามารถแปลงผลลัพธ์เป็น JSON ได้']);
            $status = 500;
        }
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('Content-Length: ' . strlen((string) $body));
        echo $body;
    }

    /** Allow the Vite dev server to call us during development. */
    public static function cors(array $allowed): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && in_array($origin, $allowed, true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
            header('Access-Control-Allow-Credentials: true');
            header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
            header('Access-Control-Allow-Headers: Content-Type');
            header('Access-Control-Max-Age: 86400');
        }
        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
    }

    /** Decode the JSON request body; {} when there is none.
     *  A multipart request (file upload) has already been parsed into
     *  $_POST/$_FILES by PHP itself — hand that back instead of trying to
     *  JSON-decode the raw multipart body. */
    public static function body(): array
    {
        $ct = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
        if (str_starts_with($ct, 'multipart/form-data')) {
            return $_POST;
        }
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }
        if (strlen($raw) > 2 * 1024 * 1024) {
            throw new HttpError(413, 'Payload too large');
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new HttpError(400, 'Invalid JSON body');
        }
        return $data;
    }
}
