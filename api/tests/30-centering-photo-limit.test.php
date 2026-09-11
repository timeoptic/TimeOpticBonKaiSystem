<?php

declare(strict_types=1);

/**
 * รูปภาพการวัดศูนย์เลนส์แนบได้ไม่เกิน 10 รูปต่อเคส
 *
 * โควตานับ "ต่อเคส + kind = centering" ให้ตรงกับสิ่งที่พนักงานเห็นจริงในกล่อง
 * "รูปภาพการวัด" — กล่องนั้นดึงรูปด้วย case_id + kind ไม่ได้กรองด้วย
 * centering_id (ดูเหตุผลใน routes/uploads.php: รูปที่อัปโหลดตอนยังไม่มีแถว
 * centerings จะมี centering_id เป็น NULL) ถ้านับด้วย centering_id ตัวเลขบนจอ
 * กับตัวเลขที่ระบบบังคับจะไม่ตรงกัน
 *
 * เส้นทาง POST /api/uploads เทสต์ตรง ๆ ไม่ได้เพราะมันอ่าน $_FILES แล้วเรียก
 * move_uploaded_file() ซึ่งปฏิเสธไฟล์ที่ไม่ได้มาจาก HTTP upload จริง ตัวด่านจึง
 * ถูกแยกออกมาเป็น centeringPhotoRoom() และเทสต์ที่ฟังก์ชันนั้น
 *
 * ของทดสอบทุกชิ้นอยู่ใน transaction ที่ roll back เสมอ (ดู rollback() ใน harness.php)
 */

group('รูปการวัดศูนย์เลนส์ไม่เกิน 10 รูปต่อเคส');

/** เคสเปล่าหนึ่งใบ คืน id มาให้ผูกรูป */
function photoLimitCase(Tx $q): int
{
    $cust = $q->run(
        'INSERT INTO customers (first_name, last_name, phone) VALUES (?,?,?)',
        'ทดสอบ',
        'โควตารูป',
        '0000000000'
    )['insertId'];

    return $q->run(
        'INSERT INTO cases (case_code, customer_id, status, case_type) VALUES (?,?,?,?)',
        'TEST-PHOTO-' . bin2hex(random_bytes(4)),
        $cust,
        'centering',
        'new_glasses'
    )['insertId'];
}

/** แนบรูปปลอม $n ใบเข้าเคส — เขียนแค่แถวในตาราง ไม่แตะดิสก์ */
function photoRows(Tx $q, int $caseId, string $kind, int $n): void
{
    for ($i = 0; $i < $n; $i++) {
        $q->run(
            'INSERT INTO case_photos (case_id, kind, file_name, mime_type) VALUES (?,?,?,?)',
            $caseId,
            $kind,
            "test_{$kind}_{$i}.jpg",
            'image/jpeg'
        );
    }
}

test('เคสที่ยังไม่มีรูป แนบได้เต็ม 10 ใบ', function () {
    rollback(function (Tx $q) {
        $case = photoLimitCase($q);
        eq(centeringPhotoRoom($case), 10, 'โควตาของเคสเปล่า');
    });
});

test('แนบไปแล้ว 7 ใบ เหลือโควตา 3 ใบ', function () {
    rollback(function (Tx $q) {
        $case = photoLimitCase($q);
        photoRows($q, $case, 'centering', 7);
        eq(centeringPhotoRoom($case), 3, 'โควตาที่เหลือ');
    });
});

test('ครบ 10 ใบแล้วแนบเพิ่มไม่ได้', function () {
    rollback(function (Tx $q) {
        $case = photoLimitCase($q);
        photoRows($q, $case, 'centering', 10);
        eq(centeringPhotoRoom($case), 0, 'โควตาเมื่อครบ');
    });
});

/* เคสเก่าที่มีรูปเกิน 10 ใบมาก่อนวันบังคับลิมิต ต้องได้ 0 ไม่ใช่เลขติดลบ —
   ถ้าปล่อยติดลบ ตัวเลข "0/10" บนหน้าจอจะกลายเป็น "-2" และเงื่อนไข > 0 ที่
   ฝั่งหน้าเว็บใช้ตัดสินใจก็ยังทำงาน แต่ตัวนับที่โชว์จะอ่านไม่รู้เรื่อง */
test('เคสเก่าที่มีรูปเกิน 10 ใบอยู่แล้ว โควตาเป็น 0 ไม่ติดลบ', function () {
    rollback(function (Tx $q) {
        $case = photoLimitCase($q);
        photoRows($q, $case, 'centering', 13);
        eq(centeringPhotoRoom($case), 0, 'โควตาเมื่อเกินลิมิต');
    });
});

/* สลิปโอนเงินกับไฟล์ส่งมอบยิงเข้า /api/uploads เส้นเดียวกัน ถ้าลิมิตไม่ได้แยก
   ตาม kind สลิปใบที่ 11 ของเคสจะแนบไม่ได้ทั้งที่ไม่เกี่ยวกับการวัดศูนย์เลนส์ */
test('สลิปชำระเงินกับไฟล์ส่งมอบไม่กินโควตารูปการวัด', function () {
    rollback(function (Tx $q) {
        $case = photoLimitCase($q);
        photoRows($q, $case, 'payment', 20);
        photoRows($q, $case, 'delivery', 5);
        eq(centeringPhotoRoom($case), 10, 'โควตาเมื่อมีแต่ไฟล์ kind อื่น');
    });
});

test('รูปของเคสอื่นไม่กินโควตาของเคสนี้', function () {
    rollback(function (Tx $q) {
        $mine  = photoLimitCase($q);
        $other = photoLimitCase($q);
        photoRows($q, $other, 'centering', 10);
        eq(centeringPhotoRoom($mine), 10, 'โควตาของเคสที่ยังไม่มีรูป');
    });
});
