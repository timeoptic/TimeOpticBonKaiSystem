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

        /* คอนเนกชันเดียว — ดูข้อ 2 ข้างบน */
        \Optic\Db::setConn(Db::pdo());

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
}
