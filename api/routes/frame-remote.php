<?php
/**
 * กรอบจากคลังของอีกสาขา — สถานะ / ส่งใหม่ / ปิดรายการที่ต้องตรวจ (ดู services/FrameRemote.php)
 *
 * หน้าเว็บทุกจอถาม /status ทุกนาทีเมื่อเปิดใช้ — การถามนั้นเองคือ "ตัวส่งใหม่อัตโนมัติ"
 * (เว้นอย่างน้อย 30 วินาทีต่อรอบ) เพราะ Hostinger ไม่มีโปรเซสค้างให้รอคิว · cron
 * api/cli/frame-remote-flush.php ทำซ้ำอีกชั้นเผื่อไม่มีใครเปิดเว็บ
 */
declare(strict_types=1);

function frameRemoteStatus(bool $flushNow): array
{
    if (!FrameRemote::enabled()) {
        return ['enabled' => false];
    }
    $stamp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'frame-remote-flush-' . md5(__DIR__) . '.ts';
    $last  = is_file($stamp) ? (int) @file_get_contents($stamp) : 0;
    $hasOpen = FrameRemote::counts()['pending'] > 0;
    if ($hasOpen && ($flushNow || time() - $last >= 30)) {
        @file_put_contents($stamp, (string) time());
        FrameRemote::flush();
    }
    return [
        'enabled' => true,
        'label'   => FrameRemote::label(),
        'from'    => FrameRemote::from(),
        'items'   => FrameRemote::open(),
    ] + FrameRemote::counts();
}

GET('/api/frame-remote/status', fn() => frameRemoteStatus(false));

POST('/api/frame-remote/retry', fn() => frameRemoteStatus(true));

GET('/api/frame-remote/ping', function () {
    if (!FrameRemote::enabled()) {
        return ['ok' => false, 'error' => 'ยังไม่ได้ตั้งค่าการเชื่อมคลังกรอบ (FRAME_STOCK_* ใน .env)'];
    }
    return FrameRemote::ping();
});

/** รายการที่คลังอีกสาขาปฏิเสธ — คนไปปรับยอดที่นั่นเองแล้ว กดปิดรายการ (แอดมิน/เจ้าของร้าน) */
POST('/api/frame-remote/:id/resolve', function (array $req) {
    $actor = StockModule::actor();
    if (!$actor || !\Optic\Roles::systemZone($actor['roles'] ?? [])) {
        throw new HttpError(403, 'ปิดรายการได้เฉพาะแอดมินหรือเจ้าของร้าน', ['reason' => 'forbidden']);
    }
    FrameRemote::resolve(int_or($req['params']['id']), (string) ($actor['displayName'] ?? $actor['username'] ?? ''));
    return frameRemoteStatus(false);
});
