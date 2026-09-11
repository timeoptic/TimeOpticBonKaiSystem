<?php
/**
 * รอบกวาดแจ้งเตือน — เตือนคิวจองรายคน + สรุปคิวส่งมอบวันละครั้ง
 *
 * PHP has no long-lived process to hold a setInterval, so instead of a timer
 * this runs once per invocation. Drive it from Windows Task Scheduler via
 * api/cli/reminder.php, or from the UI via POST /api/reminders/run.
 *
 * งานตามเวลาทุกอย่างเกาะรอบนี้รอบเดียว มีงานใน Task Scheduler ให้ดูแลใบเดียว
 * ตัวสรุปคิวส่งมอบจึงไม่ตั้งเวลาเอง แต่ถูกเรียกทุกนาทีแล้วตัดสินเองว่าถึงรอบยัง
 */
declare(strict_types=1);

final class Scheduler
{
    /** don't fire reminders for bookings whose slot is already this far past */
    private const GRACE_MINUTES = 45;

    /**
     * Bookings whose start is inside their own reminder window and that have
     * not been reminded yet.
     *
     * public เพื่อให้ถามได้ว่า "ตอนนี้ใครถึงคิวเตือนบ้าง" โดยไม่ต้องยิงจริง —
     * รูปเดียวกับ `DeliveryDigest::queue()` · เกณฑ์ตรงนี้คือทั้งหมดที่ตัดสินว่า
     * ลูกค้าจะได้รับการเตือนหรือไม่ ทดสอบผ่าน runOnce() ไม่ได้เพราะขั้นถัดไป
     * คือการส่งเข้ากลุ่มจริง
     */
    public static function dueBookings(): array
    {
        return Db::all(
            'SELECT b.*, e.employee_name AS assigned_name,
                    TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(b.booking_date, b.booking_time)) AS mins_away
               FROM bookings b
               LEFT JOIN employees e ON e.id = b.assigned_to
              WHERE b.reminder_sent_at IS NULL
                AND b.status IN (\'booked\', \'confirmed\')
                AND b.reminder_minutes > 0
                AND TIMESTAMP(b.booking_date, b.booking_time)
                      BETWEEN NOW() - INTERVAL ? MINUTE
                          AND NOW() + INTERVAL b.reminder_minutes MINUTE
              ORDER BY b.booking_date, b.booking_time
              LIMIT 20',
            self::GRACE_MINUTES
        );
    }

    private static function stepNotes(int $bookingId): string
    {
        $rows = Db::all(
            'SELECT question, note FROM booking_notes
              WHERE booking_id = ? ORDER BY created_at LIMIT 12',
            $bookingId
        );
        $out = [];
        foreach ($rows as $r) {
            $out[] = $r['question'] ? "• {$r['question']}: {$r['note']}" : "• {$r['note']}";
        }
        return implode("\n", $out);
    }

    public static function runOnce(): array
    {
        if (!Telegram::isEnabled()) {
            return ['sent' => 0, 'skipped' => 'telegram ปิดอยู่หรือยังไม่ได้ตั้งค่า'];
        }
        /* สรุปคิวส่งมอบขี่รอบกวาดนี้ไปด้วย แทนที่จะตั้งงานตามเวลาอีกตัว —
           ตัวมันเองรู้ว่าถึงรอบหรือยัง (ดู DeliveryDigest::isDue) */
        $digest = DeliveryDigest::runOnce();

        $rows = self::dueBookings();
        $sent = 0;
        foreach ($rows as $b) {
            $minutes = max(0, (int) $b['mins_away']);
            $payload = $b + [
                'service_label' => Booking::serviceLabel($b['service_type'] ?? null),
                'step_notes'    => self::stepNotes((int) $b['id']),
            ];
            $res = Telegram::send(
                Telegram::reminderMessage($payload, $minutes),
                ['kind' => 'booking_reminder', 'booking_id' => (int) $b['id']]
            );
            if ($res['ok']) {
                // mark only on success so a transient failure retries next run
                Db::run('UPDATE bookings SET reminder_sent_at = NOW() WHERE id = ?', (int) $b['id']);
                $sent++;
            }
        }
        return ['sent' => $sent, 'checked' => count($rows), 'digest' => $digest];
    }
}
