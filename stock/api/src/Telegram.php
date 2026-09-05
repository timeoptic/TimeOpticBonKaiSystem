<?php

declare(strict_types=1);

namespace Optic;

/**
 * ข้อความจากฝั่งคลัง เข้ากลุ่ม Telegram ของคลัง
 *
 * ฝั่งหน้าร้านมีตัวส่งของตัวเองอยู่แล้ว (`api/services/Telegram.php`) และตัวนั้น
 * ผูกกับสมุดบันทึกการแจ้งเตือนคิวจอง ซึ่งเป็นเรื่องของหน้าร้าน · เรียกข้ามมาใช้
 * จะได้แถวในสมุดนั้นที่ไม่มีคิวจองผูกอยู่ และผูกโมดูลนี้เข้ากับตารางของอีกฝั่ง
 * ตัวส่งของฝั่งนี้จึงเป็นคนละตัว และอ่านคีย์คนละชุด — `STOCK_TELEGRAM_*`
 * ไม่ใช่ `TELEGRAM_*` ที่หน้าร้านใช้ · ตั้งใจให้ไม่มี fallback: ถ้าคลังยังไม่ได้
 * ตั้งค่าของตัวเอง ให้เงียบไปเลย ดีกว่าไปโผล่ในกลุ่มแจ้งเตือนคิวลูกค้า ซึ่ง
 * เป็นกลุ่มที่คนอ่านเพื่อรอคิว ไม่ใช่เพื่อรู้ว่าเลนส์เหลือน้อย
 *
 * ไม่มีคิว ไม่มีการลองใหม่: ข้อความเตือนของใกล้หมดที่ส่งไม่ผ่านวันนี้ ไม่ต้องส่ง
 * ซ้ำพรุ่งนี้ เพราะพรุ่งนี้จะมีข้อความของพรุ่งนี้ที่บอกเรื่องเดียวกันอยู่แล้ว
 */
final class Telegram
{
    /**
     * ส่งข้อความ คืนค่าว่าไปถึงไหม
     *
     * ไม่โยน exception เพราะที่เรียกคืองานตามเวลาซึ่งไม่มีใครนั่งดู · เขียนเหตุ
     * ลง stderr ให้ Task Scheduler เก็บไว้ แล้วจบด้วยรหัสที่บอกได้ว่าไม่ผ่าน
     */
    public static function send(string $text): bool
    {
        $token = (string) (Env::get('STOCK_TELEGRAM_BOT_TOKEN') ?? '');
        $chat  = (string) (Env::get('STOCK_TELEGRAM_CHAT_ID') ?? '');

        if ($token === '' || $chat === '') {
            fwrite(STDERR, "ยังไม่ได้ตั้ง STOCK_TELEGRAM_BOT_TOKEN หรือ STOCK_TELEGRAM_CHAT_ID ใน stock/.env\n");
            return false;
        }

        $ch = curl_init("https://api.telegram.org/bot{$token}/sendMessage");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS     => json_encode([
                'chat_id'    => $chat,
                'text'       => $text,
                'parse_mode' => 'HTML',
                // ลิงก์ในข้อความไม่ต้องกางพรีวิว — ข้อความเตือนสั้น ๆ ที่มีการ์ด
                // เว็บใหญ่ ๆ ต่อท้ายคือข้อความที่อ่านยากขึ้นโดยไม่ได้อะไร
                'disable_web_page_preview' => true,
            ], JSON_UNESCAPED_UNICODE),
        ]);

        /* PHP บน Windows ไม่มีชุดใบรับรองของตัวเองและไม่อ่านคลังของ Windows —
           ตั้ง CA_BUNDLE ใน .env ชี้ไฟล์ .pem · ห้ามแก้ด้วยการปิด VERIFYPEER
           นั่นคือยอมรับใบอะไรก็ได้ รวมถึงของคนที่สวมเป็น Telegram แล้วอ่าน token */
        foreach ([Env::get('CA_BUNDLE'), ini_get('curl.cainfo'), ini_get('openssl.cafile')] as $ca) {
            if (is_string($ca) && $ca !== '' && is_readable($ca)) {
                curl_setopt($ch, CURLOPT_CAINFO, $ca);
                break;
            }
        }

        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_errno($ch) ? curl_error($ch) : null;
        curl_close($ch);

        if ($err !== null) {
            fwrite(STDERR, "ส่ง Telegram ไม่สำเร็จ: {$err}\n");
            return false;
        }
        if ($code !== 200) {
            fwrite(STDERR, "Telegram ตอบ {$code}: " . (is_string($body) ? mb_substr($body, 0, 200) : '') . "\n");
            return false;
        }

        return true;
    }
}
