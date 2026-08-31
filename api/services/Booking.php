<?php
/**
 * Booking vocabulary. Kept in code rather than the database so it stays easy
 * to tweak — same decision the Node version made.
 */
declare(strict_types=1);

final class Booking
{
    public const SERVICE_TYPES = [
        ['eye_exam', 'วัดสายตา'],
        ['choose_frame', 'เลือกกรอบ/เลนส์'],
        ['pickup', 'รับแว่น'],
        ['adjust', 'ปรับ/ซ่อมแว่น'],
        ['contact_lens', 'คอนแทคเลนส์'],
        ['consult', 'ปรึกษา/สอบถาม'],
        ['other', 'อื่น ๆ'],
    ];

    public const STATUSES = [
        ['booked', 'จองแล้ว'],
        ['confirmed', 'ยืนยันแล้ว'],
        ['arrived', 'ลูกค้ามาถึง'],
        ['in_service', 'กำลังให้บริการ'],
        ['done', 'เสร็จสิ้น'],
        ['no_show', 'ไม่มาตามนัด'],
        ['cancelled', 'ยกเลิก'],
    ];

    public const CHANNELS = [
        ['phone', 'โทรศัพท์'], ['line', 'LINE'], ['facebook', 'Facebook'],
        ['walk_in', 'เดินเข้าร้าน'], ['web', 'เว็บไซต์'], ['other', 'อื่น ๆ'],
    ];

    /** default intake questions asked when a booking is taken */
    public const INTAKE_QUESTIONS = [
        'มาด้วยเรื่องอะไร / อาการที่พบ',
        'เคยตัดแว่นกับเราหรือยัง',
        'ใช้แว่น/คอนแทคเลนส์เดิมแบบไหน',
        'ใช้สายตาหนักด้านไหน (จอ/ขับรถ/อ่านหนังสือ)',
        'งบประมาณคร่าว ๆ',
        'ต้องการรับแว่นเมื่อไหร่',
    ];

    public const STATUS_CODES = ['booked', 'confirmed', 'arrived', 'in_service',
        'done', 'no_show', 'cancelled'];

    public static function serviceLabel(?string $code): string
    {
        foreach (self::SERVICE_TYPES as [$c, $label]) {
            if ($c === $code) {
                return $label;
            }
        }
        return (string) $code;
    }

    /**
     * The linked customer record wins over the free-text fields typed at
     * booking time.
     */
    public static function shape(?array $b): ?array
    {
        if (!$b) {
            return null;
        }
        $b['first_name'] = $b['cust_first_name'] ?? $b['first_name'] ?? null;
        $b['last_name']  = $b['cust_last_name']  ?? $b['last_name']  ?? null;
        $b['phone']      = $b['cust_phone']      ?? $b['phone']      ?? null;
        $b['line_id']    = $b['cust_line_id']    ?? $b['line_id']    ?? null;
        return $b;
    }
}
