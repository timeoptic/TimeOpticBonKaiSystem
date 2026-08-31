<?php
/**
 * ระบบคลังและต้นทุน — ตัวเชื่อมทาง HTTP.
 *
 * ตารางคลัง (`products` `stock_lots` `inventory_logs` `categories` `suppliers`
 * `admins`) เป็นของฝั่งเขา **ห้ามเขียนเอง** แม้จะเห็นในฐานข้อมูลเดียวกันก็ตาม —
 * การตัดสต็อกหนึ่งครั้งคือเลือกล็อตตาม FIFO ล็อกแถวกันขายเกิน คิดต้นทุนของก้อน
 * ที่ตัด แล้วลงสมุด ทั้งหมดใน transaction เดียวที่ `Stock::draw()` ของเขา
 * เขียน SQL เองจะได้ยอดที่ถูกแต่ต้นทุนที่ผิด แล้วรู้ตัวตอนปิดเดือน
 *
 * ยืนยันตัวตน — เอกสารเขาบอกให้ส่งต่อคุกกี้ `optic_session` ของคนที่กด โดยไม่ต้อง
 * มี login ที่นี่ แต่นั่นใช้ได้เมื่ออยู่เครื่องเดียวกันเท่านั้น (session อยู่บนดิสก์)
 * ตอนนี้คนละเครื่อง จึงล็อกอินด้วยบัญชีใน config แล้วถือคุกกี้ไว้เอง
 * ถ้ามีคุกกี้ของผู้ใช้จริงส่งมา (forward()) จะใช้ตัวนั้นก่อนเสมอ — วันที่ย้ายมา
 * เครื่องเดียวกัน เอา user/pass ออกจาก .env ก็สลับกลับได้โดยไม่ต้องแก้โค้ด
 *
 * ทุกเมทอดโยน StockApiError เมื่อฝั่งเขาปฏิเสธ — `reason` เป็นรหัสให้โค้ดแตก
 * เงื่อนไข ส่วน `message` เป็นภาษาไทยที่เอาไปแสดงผู้ใช้ได้เลย
 */
declare(strict_types=1);

final class StockApiError extends RuntimeException
{
    /* promoted properties เฉย ๆ — readonly เป็นของ PHP 8.1 เครื่องนี้ยัง 8.0 */
    public function __construct(
        public string $reason,
        string $message,
        public int $status = 0,
        public array $payload = []
    ) {
        parent::__construct($message);
    }
}

final class StockClient
{
    private static array $cfg = [];
    private static ?string $cookie = null;
    /** คุกกี้ของผู้ใช้จริงที่ส่งต่อมา — ถ้ามี ใช้ตัวนี้แทนการล็อกอินด้วยบัญชีกลาง */
    private static ?string $forwarded = null;

    public static function configure(array $c): void
    {
        self::$cfg = $c;
        self::$cookie = null;
    }

    /** ส่งต่อ session ของคนที่กำลังใช้งานอยู่ (ใช้ได้เมื่อสองระบบอยู่เครื่องเดียวกัน) */
    public static function forward(?string $sessionId): void
    {
        self::$forwarded = ($sessionId !== null && $sessionId !== '') ? $sessionId : null;
    }

    /** off | dry | live */
    public static function mode(): string
    {
        $m = (string) (self::$cfg['mode'] ?? 'off');
        return in_array($m, ['off', 'dry', 'live'], true) ? $m : 'off';
    }

    public static function source(): string
    {
        return (string) (self::$cfg['source'] ?? 'frontdesk');
    }

    /** ยิงจริงได้ไหม — ต้องเป็น live และมี base_url */
    public static function live(): bool
    {
        return self::mode() === 'live' && (string) (self::$cfg['base_url'] ?? '') !== '';
    }

    /**
     * เหตุผลที่ยิงไม่ได้ ถ้ายิงได้คืน null — ใช้บอกผู้ใช้ว่าทำไมสต็อกไม่ขยับ
     * แทนที่จะเงียบแล้วให้ไปเจอเอาตอนนับของ
     */
    public static function unavailableReason(): ?string
    {
        $mode = self::mode();
        if ($mode === 'off') {
            return 'ยังไม่ได้เปิดการเชื่อมระบบคลัง (STOCK_API_MODE=off)';
        }
        if ((string) (self::$cfg['base_url'] ?? '') === '') {
            return 'ยังไม่ได้ตั้งที่อยู่ API ของคลัง (STOCK_API_URL)';
        }
        if ($mode === 'dry') {
            return 'โหมดทดลอง (STOCK_API_MODE=dry) — บันทึกรายการไว้แต่ยังไม่ตัดของจริง';
        }
        if (self::$forwarded === null
            && ((string) (self::$cfg['username'] ?? '') === '' || (string) (self::$cfg['password'] ?? '') === '')) {
            return 'ยังไม่ได้ตั้งบัญชีสำหรับเชื่อมคลัง (STOCK_API_USER / STOCK_API_PASS)';
        }
        return null;
    }

    public static function get(string $path, array $query = []): array
    {
        $qs = $query ? ('?' . http_build_query($query)) : '';
        return self::call('GET', $path . $qs, null);
    }

    public static function post(string $path, array $body): array
    {
        return self::call('POST', $path, $body);
    }

    /** ล็อกอินครั้งเดียวแล้วถือคุกกี้ไว้ ครั้งต่อไปในโปรเซสเดียวกันไม่ต้องล็อกอินซ้ำ */
    private static function login(): void
    {
        $user = (string) (self::$cfg['username'] ?? '');
        $pass = (string) (self::$cfg['password'] ?? '');
        if ($user === '' || $pass === '') {
            throw new StockApiError(
                'no_credentials',
                'ยังไม่ได้ตั้งบัญชีสำหรับเชื่อมระบบคลัง — ใส่ STOCK_API_USER / STOCK_API_PASS ใน .env'
            );
        }
        [$status, $body, $cookie] = self::raw('POST', '/auth/login', ['username' => $user, 'password' => $pass], null);
        if ($status !== 200 || $cookie === null) {
            throw new StockApiError(
                (string) ($body['reason'] ?? 'login_failed'),
                (string) ($body['message'] ?? 'เข้าสู่ระบบคลังไม่สำเร็จ'),
                $status,
                $body
            );
        }
        self::$cookie = $cookie;
    }

    /**
     * ยิงหนึ่งครั้ง ถ้าโดน 401 ให้ล็อกอินใหม่แล้วลองอีกรอบเดียว — session ฝั่งเขา
     * หมดอายุได้ระหว่างวัน ไม่ควรทำให้การขายล้มเพราะเรื่องนี้
     */
    private static function call(string $method, string $path, ?array $body): array
    {
        if (!self::live()) {
            throw new StockApiError('disabled', self::unavailableReason() ?? 'การเชื่อมระบบคลังปิดอยู่');
        }
        if (self::$forwarded === null && self::$cookie === null) {
            self::login();
        }
        [$status, $out] = self::send($method, $path, $body);
        if ($status === 401 && self::$forwarded === null) {
            self::$cookie = null;
            self::login();
            [$status, $out] = self::send($method, $path, $body);
        }
        if ($status >= 200 && $status < 300) {
            return $out;
        }
        throw new StockApiError(
            (string) ($out['reason'] ?? 'http_' . $status),
            (string) ($out['message'] ?? "ระบบคลังตอบกลับ HTTP $status"),
            $status,
            $out
        );
    }

    private static function send(string $method, string $path, ?array $body): array
    {
        [$status, $out] = self::raw($method, $path, $body, self::$forwarded ?? self::$cookie);
        return [$status, $out];
    }

    /**
     * @return array{0:int,1:array,2:?string} status, decoded body, session id ที่เพิ่งได้ (ถ้ามี)
     */
    private static function raw(string $method, string $path, ?array $body, ?string $cookie): array
    {
        $url = (string) self::$cfg['base_url'] . $path;
        $ch  = curl_init($url);
        $headers = ['Accept: application/json'];

        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HEADER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_TIMEOUT, max(3, (int) (self::$cfg['timeout'] ?? 10)));
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        }
        /* ส่งต่อ session ของคนที่กำลังใช้งานอยู่ ไม่ใช่ของบัญชีกลาง (ถ้ามี) */
        if ($cookie !== null) {
            curl_setopt($ch, CURLOPT_COOKIE, 'optic_session=' . $cookie);
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        $raw    = curl_exec($ch);
        $errNo  = curl_errno($ch);
        $errMsg = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $hdrLen = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);

        if ($errNo) {
            throw new StockApiError(
                'unreachable',
                "ติดต่อระบบคลังไม่ได้ ($errMsg) — เช็คว่าเครื่องคลังเปิดอยู่และ STOCK_API_URL ถูกต้อง"
            );
        }

        $rawStr  = is_string($raw) ? $raw : '';
        $headRaw = substr($rawStr, 0, $hdrLen);
        $bodyRaw = substr($rawStr, $hdrLen);

        $newCookie = null;
        if (preg_match('/^Set-Cookie:\s*optic_session=([^;\s]+)/mi', $headRaw, $m)) {
            $newCookie = $m[1];
        }

        $decoded = json_decode($bodyRaw, true);
        return [$status, is_array($decoded) ? $decoded : [], $newCookie];
    }
}
