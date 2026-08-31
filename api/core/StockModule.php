<?php
/**
 * ระบบคลังและต้นทุน — ตัวต่อเข้ากับโค้ดใน `stock/`.
 *
 * เมื่อก่อนสองระบบอยู่คนละ repo คนละเครื่อง จึงคุยกันทาง HTTP (ดู
 * `stock/docs/integration.md`) ตอนนี้อยู่ repo เดียวกันแล้ว เรียกตรงในโปรเซส
 * เดียวกันได้ — หายไปหนึ่ง hop, หายไปหนึ่งบัญชีที่ต้องเก็บรหัสผ่านไว้ใน .env
 * และที่สำคัญกว่านั้น การตัดสต็อกกับการเขียนแถวใน `case_stock_issues` อยู่ใน
 * transaction เดียวกันได้จริง เพราะใช้ PDO ตัวเดียวกัน
 *
 * สามอย่างที่ต้องทำก่อนเรียกโค้ดฝั่งคลัง:
 *
 *   1. autoloader ของเขา — `Optic\` ยังไม่มี Composer ทั้งสองฝั่ง
 *   2. **PDO ตัวเดียวกัน** — ถ้าปล่อยให้เขาเปิดคอนเนกชันของตัวเอง การเขียน
 *      สองฝั่งจะอยู่คนละ transaction ล็อกกันเองจนหมดเวลา แทนที่จะปลอดภัยขึ้น
 *   3. session — ทั้งสองระบบใช้คุกกี้ `optic_session` ตัวเดียวกัน ล็อกอินครั้ง
 *      เดียวใช้ได้ทั้งสองหน้า
 */
declare(strict_types=1);

final class StockModule
{
    private static bool $booted = false;

    public static function boot(): void
    {
        if (self::$booted) {
            return;
        }
        self::$booted = true;

        require_once dirname(__DIR__, 2) . '/stock/api/src/bootstrap.php';

        /* คอนเนกชันเดียว — ดูข้อ 2 ข้างบน
           ส่งเป็นฟังก์ชัน ไม่ใช่ตัวคอนเนกชัน เพราะ boot() ทำงานทุก request แต่
           คำขอส่วนใหญ่ไม่ได้แตะฐานเลย ถ้าต่อทันทีตรงนี้ คำถามว่า "ใครล็อกอินอยู่"
           จะกลายเป็นการวิ่งไปถามฐาน และวันที่ฐานปิดอยู่ จะรอ 23 วินาทีแล้วได้ 500
           ทั้งที่คำตอบจริงคือ "ยังไม่มีใครล็อกอิน" ซึ่งอ่านจาก session ได้ทันที */
        \Optic\Db::setConnFactory(static fn(): PDO => Db::pdo());

        /* ชื่อคุกกี้ อายุ และที่เก็บ session เป็นของฝั่งคลังทั้งหมด ที่นี่ไม่ตั้งเอง
           เพราะสองที่ตั้งคนละค่าคือทางที่จะได้ session สองใบโดยไม่รู้ตัว */
        \Optic\Auth::start();
    }

    /** คนที่กำลังใช้งานอยู่ — null คือยังไม่ได้ล็อกอิน */
    public static function actor(): ?array
    {
        self::boot();
        return \Optic\Auth::actor();
    }

    /**
     * ชื่อช่องที่แปลว่า "ของนี้เราซื้อมาเท่าไร" ไม่ใช่ "ขายเท่าไร"
     *
     * ราคาขายเปิดให้ทุกคนเห็น เพราะการบอกราคาลูกค้าคืองาน ส่วนราคาซื้อไม่ใช่
     * `product_expense` คือชื่อที่ v_stock_lot ตั้งให้ stock_lots.cost_per_unit
     */
    private const COST_FIELDS = [
        'product_expense', 'cost_per_unit',
        'unit_cost', 'unitCost',
        'total_cost', 'totalCost',
    ];

    /**
     * ตัดตัวเลขต้นทุนออกจากคำตอบ ถ้าคนที่ถามไม่มีสิทธิ์เห็น
     *
     * ทำที่ทางออกทางเดียว ไม่ใช่ไล่แก้ทีละ query — `SELECT *` จาก `v_stock_lot`
     * มีอยู่หกจุดในโปรเจกต์นี้ และจุดที่เจ็ดจะถูกเขียนขึ้นวันหนึ่งโดยคนที่ไม่รู้
     * เรื่องนี้ · เป็น null ไม่ใช่ 0 เพราะศูนย์เป็นตัวเลขที่อ่านว่า "ฟรี"
     *
     * ตัดตอนตอบ ไม่ใช่ตอนบันทึก — `case_stock_issues` ยังเก็บต้นทุนไว้ครบตามเดิม
     * แม้คนที่กดขายจะเป็นพนักงานหน้าร้าน ไม่งั้นบัญชีจะมีรูตามคนที่บังเอิญกดปุ่ม
     */
    public static function redactCost(mixed $value, ?array $actor): mixed
    {
        if ($actor !== null && \Optic\Roles::seeCost((string) $actor['role'])) {
            return $value;
        }
        return self::blankCosts($value);
    }

    private static function blankCosts(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        foreach ($value as $key => $item) {
            $value[$key] = (is_string($key) && in_array($key, self::COST_FIELDS, true))
                ? null
                : self::blankCosts($item);
        }
        return $value;
    }
}
