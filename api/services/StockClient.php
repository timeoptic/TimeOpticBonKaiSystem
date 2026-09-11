<?php
/**
 * ระบบคลังและต้นทุน — ตัวเรียก.
 *
 * ชื่อยังเป็น "Client" ตามเดิมเพราะที่เรียกใช้ (`CaseStock`) ไม่ต้องรู้ว่าปลายทาง
 * อยู่ที่ไหน แต่ข้างในไม่ใช่ HTTP อีกแล้ว — โค้ดฝั่งคลังอยู่ใน `stock/` ของ repo
 * นี้ เรียกเป็นฟังก์ชันตรง ๆ ในโปรเซสเดียวกัน (ดู `core/StockModule.php`)
 *
 * ตารางคลัง (`products` `stock_lots` `inventory_logs`) ยัง **ห้ามเขียนเอง**
 * เหมือนเดิม และเหตุผลก็เดิม — การตัดสต็อกหนึ่งครั้งคือเลือกล็อตตาม FIFO ล็อก
 * แถวกันขายเกิน คิดต้นทุนของก้อนที่ตัด แล้วลงสมุด ทั้งหมดใน transaction เดียว
 * ที่ `Optic\Service\Stock` ของฝั่งคลังทำให้ เขียน SQL เองจะได้ยอดที่ถูกแต่
 * ต้นทุนที่ผิด แล้วรู้ตัวตอนปิดเดือน
 *
 * ยืนยันตัวตน — ไม่มีบัญชีกลางใน .env อีกต่อไป ทุกอย่างทำในนามของคนที่ล็อกอิน
 * อยู่จริง (`Optic\Auth`) ซึ่งเป็นคนเดียวกับที่ล็อกอินเข้าหน้าเว็บนี้ เพราะสอง
 * ระบบใช้คุกกี้ `optic_session` ใบเดียวกัน สิทธิ์จึงถูกบังคับที่ฝั่งคลังตามปกติ
 * — พนักงานหน้าร้านตัดสต็อกได้ แต่ไม่เห็นต้นทุนที่ตอบกลับมา
 *
 * ทุกเมทอดยังโยน StockApiError เมื่อฝั่งคลังปฏิเสธ — `reason` เป็นรหัสให้โค้ดแตก
 * เงื่อนไข ส่วน `message` เป็นภาษาไทยที่เอาไปแสดงผู้ใช้ได้เลย
 */
declare(strict_types=1);

final class StockApiError extends RuntimeException
{
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

    public static function configure(array $c): void
    {
        self::$cfg = $c;
    }

    /**
     * เหลือไว้ให้ `index.php` เรียกได้เหมือนเดิม แต่ไม่ทำอะไรแล้ว — session ของ
     * คนที่กดคือ session เดียวกันกับที่โปรเซสนี้ถืออยู่ ไม่มีอะไรให้ส่งต่อ
     */
    public static function forward(?string $sessionId): void
    {
    }

    /** off | dry | live */
    public static function mode(): string
    {
        /* ค่าปริยายเป็น live แล้ว — ตอนคนละเครื่องมันต้องเป็น off เพราะยังไม่ได้
           ตั้ง IP กับบัญชี ตอนนี้ไม่มีอะไรให้ตั้ง โค้ดอยู่ในโฟลเดอร์ข้าง ๆ */
        $m = (string) (self::$cfg['mode'] ?? 'live');
        return in_array($m, ['off', 'dry', 'live'], true) ? $m : 'live';
    }

    public static function source(): string
    {
        return (string) (self::$cfg['source'] ?? 'frontdesk');
    }

    public static function live(): bool
    {
        return self::mode() === 'live';
    }

    /** เหตุผลที่ตัดของจริงไม่ได้ ถ้าตัดได้คืน null */
    public static function unavailableReason(): ?string
    {
        $mode = self::mode();
        if ($mode === 'off') {
            return 'ปิดการเชื่อมระบบคลังไว้ (STOCK_API_MODE=off)';
        }
        if ($mode === 'dry') {
            return 'โหมดทดลอง (STOCK_API_MODE=dry) — บันทึกรายการไว้แต่ยังไม่ตัดของจริง';
        }
        if (StockModule::actor() === null) {
            return 'ยังไม่ได้เข้าสู่ระบบ — การตัดสต็อกต้องรู้ว่าใครเป็นคนตัด';
        }
        return null;
    }

    public static function post(string $path, array $body): array
    {
        if (!self::live()) {
            throw new StockApiError('disabled', self::unavailableReason() ?? 'การเชื่อมระบบคลังปิดอยู่');
        }
        StockModule::boot();

        try {
            return match ($path) {
                /* StockGate ประทับตัวตนคนที่ล็อกอินลงคำขอเอง และเช็กสิทธิ์ให้ด้วย
                   ห้ามเรียก Stock:: ตรง ๆ ข้ามมัน — actor_id ที่ผู้เรียกใส่มาเองจะผ่าน */
                '/stock/issue'  => \Optic\Service\StockGate::issue($body),
                '/stock/return' => \Optic\Service\StockGate::returnStock($body),
                '/stock/backorder-lot' => \Optic\Service\StockGate::backorderLot((string) ($body['sku'] ?? '')),
                '/rx'           => self::rx($body),
                default         => throw new StockApiError('unknown_path', "ไม่รู้จักเส้นทาง $path"),
            };
        } catch (\Optic\ApiError $e) {
            throw new StockApiError($e->reason, $e->getMessage(), $e->status, $e->payload());
        }
    }

    /** อ่านอย่างเดียว — ใช้เช็กของก่อนรับปากลูกค้า */
    public static function get(string $path, array $query = []): array
    {
        if (!preg_match('#^/stock/availability/(.+)$#', $path, $m)) {
            throw new StockApiError('unknown_path', "ไม่รู้จักเส้นทาง $path");
        }
        StockModule::boot();
        try {
            return \Optic\Service\StockGate::availability(rawurldecode($m[1]));
        } catch (\Optic\ApiError $e) {
            throw new StockApiError($e->reason, $e->getMessage(), $e->status, $e->payload());
        }
    }

    /**
     * ใบสั่งตัด RX รับ role กับ actor เป็นพารามิเตอร์ ไม่ได้ไปอ่าน session เอง
     * (บริการฝั่งคลังตั้งใจไม่แตะ Auth) จึงต้องหยิบคนที่ล็อกอินอยู่มาส่งให้ที่นี่
     */
    private static function rx(array $body): array
    {
        $actor = StockModule::actor();
        if ($actor === null) {
            throw new StockApiError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนจึงจะเปิดใบสั่งตัดได้', 401);
        }
        return \Optic\Service\Rx::order($body, $actor['roles'], (int) $actor['id']);
    }
}
