# Employee เป็นข้อมูลหลักของบัญชีเข้าใช้งาน — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ตาราง `employees` เป็นข้อมูลหลักของคนในระบบ และบัญชีเข้าใช้งานทุกใบใน `admins` ต้องผูกกับพนักงานหนึ่งคนเสมอ โดยฐานข้อมูลเป็นผู้บังคับกฎ

**Architecture:** `admins` กับ `employees` ผูกกัน 1:1 ผ่าน `admins.employee_id` ที่เปลี่ยนเป็น NOT NULL + FOREIGN KEY · เพิ่มพนักงานหนึ่งคนได้แถวเงาใน `admins` ทันที ("ยังไม่มีบัญชี") · การให้สิทธิ์เข้าใช้งานคือการเติม `username` + `password_hash` ลงแถวที่มีอยู่แล้ว ไม่ใช่การสร้างแถวใหม่ · ตรรกะทั้งหมดอยู่ใน `Optic\Service\Users` ที่เดียว ทั้งสอง API เรียกเข้าไป

**Tech Stack:** PHP 8.4 (ไม่มี Composer · autoload มือ) · MySQL/MariaDB (XAMPP) · Next.js 15 App Router (static export) · Playwright · ชุดเทสต์ PHP เขียนเองที่ `stock/api/tests/harness.php`

**Spec:** `docs/superpowers/specs/2026-09-08-employee-master-users-design.md`

## Global Constraints

- **PHP ต้องเป็น 8.1+** — path ของ PHP 8.4 ในเครื่องนี้คือ
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe`
  XAMPP PHP 8.0 ใช้ไม่ได้ (`stock/api/src/Errors.php` ใช้ `public readonly`)
- **ห้ามเขียนข้อความไทยลงฐานผ่าน `mysql.exe -e` โดยไม่ใส่ `--default-character-set=utf8mb4`** —
  client จะแปลงไทยเป็น `?` โดยไม่มี error · คำสั่งอ่านอย่างเดียวก็ให้ใส่ไว้เสมอเพื่อให้ผลอ่านออก
- **สำรองฐานก่อนรัน migration**:
  `mysqldump --default-character-set=utf8mb4 --single-transaction -h127.0.0.1 -uroot timeoptic > backup-before-027.sql`
- ฐานข้อมูลเดียวกันทั้งสองระบบ: `127.0.0.1:3306/timeoptic` · `Optic\Db` กับ `Db` (หน้าร้าน)
  ใช้ PDO ตัวเดียวกัน (ดู `api/core/StockModule.php:38`) ทรานแซกชันจึงครอบทั้งสองฝั่ง
- คำสั่งรันเทสต์ฝั่ง API: `cd stock; .\run.ps1 test users` (ทุกไฟล์: `.\run.ps1 test`)
- คำสั่งรัน migration: `cd stock; .\run.ps1 migrate` (ดูรายการค้าง: `.\run.ps1 migrate --dry`)
- ข้อความบนหน้าจอและใน API เป็นภาษาไทย · ชื่อตัวแปร ฟังก์ชัน คอลัมน์ เป็นภาษาอังกฤษ
- คอมเมนต์ในโค้ดอธิบาย **ทำไม** ไม่ใช่ **ทำอะไร** ตามแบบไฟล์ข้างเคียง
- ทุกคอมมิตต้องลงท้ายด้วย:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW
  ```

## File Structure

| ไฟล์ | หน้าที่หลังงานนี้ |
|---|---|
| `stock/api/migrations/027_employee_is_master.sql` | **สร้างใหม่** — backfill + ปิดกฎที่ฐาน |
| `stock/api/src/Service/Users.php` | **แก้** — ที่เดียวที่ตัดสินเรื่องบัญชีและสิทธิ์ |
| `stock/api/public/index.php` | **แก้** — เส้นทางของฝั่งคลัง (บล็อก `users` บรรทัด 566–612) |
| `stock/api/tests/50-users.test.php` | **แก้** — เทสต์ของกฎทั้งชุด |
| `api/routes/employees.php` | **แก้** — CRUD พนักงาน + ด่านสิทธิ์ + เรียก `Users` |
| `api/cli/import-access.php` | **แก้** — รักษาการผูกบัญชี↔พนักงานตอนนำเข้าใหม่ |
| `frontend-next/app/(frontdesk)/users/page.jsx` | **แก้** — ตารางมาจากพนักงาน ไม่มีปุ่มเพิ่มผู้ใช้ |
| `frontend-next/app/(frontdesk)/employees/page.jsx` | **แก้** — คอลัมน์บัญชี + คำเตือนตอนปิดใช้งาน |
| `frontend-next/e2e/routes.js` | **แก้** — เพิ่ม `/users/` เข้าชุดตรวจมือถือ |
| `frontend-next/e2e/users.spec.js` | **สร้างใหม่** — ตรวจกฎบนหน้าจอ |

## ลำดับที่ต้องทำตาม

Task 1–2 เพิ่มเมธอดใหม่โดยไม่แตะของเดิม ชุดเทสต์เขียวตลอด · Task 3 คือจุดที่กฎถูกปิดที่ฐาน
และโค้ดที่ละเมิดกฎถูกลบทิ้งพร้อมกัน **ต้องอยู่ในคอมมิตเดียวกัน** ไม่งั้นระหว่างสองคอมมิตจะมี
ช่วงที่ `Users::create()` ยิง SQL ที่ฐานปฏิเสธ

---

### Task 1: `Users::ensureFor()` และ `Users::syncFromEmployee()`

**Files:**
- Modify: `stock/api/src/Service/Users.php`
- Test: `stock/api/tests/50-users.test.php`

**Interfaces:**
- Consumes: `Optic\Db`, `Optic\Roles`, `Optic\ApiError` (มีอยู่แล้วใน `use` ของไฟล์)
- Produces:
  - `Users::ensureFor(int $employeeId, string $displayName, ?string $jobTitle, bool $active): int` — คืน `admins.id`
  - `Users::syncFromEmployee(int $employeeId, string $displayName, ?string $jobTitle, bool $active, int $actorId): void`
  - helper ส่วนตัว `Users::jobTitleOf(?string $v): ?string`, `Users::requireNotSelf(int $id, int $actorId, string $why): void`, `Users::requireOwnerRemains(int $id, string $role, bool $signInOnly = false): void`
  - helper ของเทสต์ `anEmployee(string $name, bool $active = true, ?string $roles = null): int`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

เพิ่มที่ท้ายไฟล์ `stock/api/tests/50-users.test.php`:

```php
/**
 * พนักงานหนึ่งคนสำหรับเคสที่ต้องมีตัวตนรองรับบัญชี
 *
 * สร้างใหม่ทุกครั้งแทนการหยิบแถวแรกจากฐาน — เคสที่แก้พนักงานที่มีอยู่จริงจะ
 * ทำให้เคสอื่นที่หยิบแถวเดียวกันล้มแบบสลับไปมา และ withRollback() ย้อนคืนให้อยู่แล้ว
 */
function anEmployee(string $name, bool $active = true, ?string $roles = null): int
{
    Db::run(
        'INSERT INTO employees (employee_name, roles, active) VALUES (?, ?, ?)',
        [$name, $roles, $active ? 1 : 0],
    );
    return (int) Db::value('SELECT LAST_INSERT_ID()');
}

group('พนักงานคือข้อมูลหลัก');

test('เพิ่มพนักงานแล้วได้แถวบัญชีที่ยังเข้าระบบไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ช่างใหม่', true, 'technician');
        $id = Users::ensureFor($emp, 'ช่างใหม่', 'technician', true);

        $row = Db::one('SELECT * FROM admins WHERE id = ?', [$id]);
        eq((int) $row['employee_id'], $emp, 'ผูกกับพนักงานคนที่สร้าง');
        eq($row['username'], null, 'ยังไม่มีชื่อผู้ใช้');
        eq($row['password_hash'], null, 'ยังไม่มีรหัสผ่าน');
        eq($row['display_name'], 'ช่างใหม่', 'ชื่อที่แสดงคัดลอกมาจากพนักงาน');
        eq($row['job_title'], 'technician', 'หน้าที่คัดลอกมาจากพนักงาน');
        eq((int) $row['is_active'], 1, 'เปิดใช้งานตามพนักงาน');
    });
});

test('เรียกซ้ำไม่สร้างแถวที่สอง', function () {
    withRollback(function () {
        $emp = anEmployee('เรียกซ้ำ');
        $first = Users::ensureFor($emp, 'เรียกซ้ำ', null, true);
        $again = Users::ensureFor($emp, 'ชื่ออื่น', 'x', false);

        eq($again, $first, 'คืน id เดิม');
        eq((int) Db::value('SELECT COUNT(*) FROM admins WHERE employee_id = ?', [$emp]), 1, 'มีแถวเดียว');
        eq(
            Db::value('SELECT display_name FROM admins WHERE id = ?', [$first]),
            'เรียกซ้ำ',
            'ไม่แก้ของเดิม — การแก้เป็นงานของ syncFromEmployee',
        );
    });
});

test('สร้างบัญชีให้พนักงานที่ไม่มีอยู่ไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'not_found',
            fn() => Users::ensureFor(999999999, 'ผี', null, true),
            'ผูกกับพนักงานที่ไม่มีอยู่',
        );
    });
});

test('ปิดพนักงานแล้วบัญชีถูกปิดตาม และล็อกอินไม่ได้ทันที', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('จะลาออก');
        $id = Users::ensureFor($emp, 'จะลาออก', null, true);
        Db::run(
            'UPDATE admins SET username = ?, password_hash = ? WHERE id = ?',
            [$u, Auth::hashPassword('a-strong-password'), $id],
        );
        Auth::login($u, 'a-strong-password');

        Users::syncFromEmployee($emp, 'จะลาออก', null, false, 1);

        eq((int) Db::value('SELECT is_active FROM admins WHERE id = ?', [$id]), 0, 'บัญชีถูกปิด');
        throwsReason('bad_credentials', fn() => Auth::login($u, 'a-strong-password'), 'ล็อกอินหลังพนักงานลาออก');
    });
});

test('รับพนักงานกลับ บัญชียังปิดอยู่ — ต้องเปิดเองที่หน้าผู้ใช้', function () {
    withRollback(function () {
        $emp = anEmployee('กลับมาทำงาน');
        $id = Users::ensureFor($emp, 'กลับมาทำงาน', null, true);

        Users::syncFromEmployee($emp, 'กลับมาทำงาน', null, false, 1);
        Users::syncFromEmployee($emp, 'กลับมาทำงาน', null, true, 1);

        eq((int) Db::value('SELECT is_active FROM admins WHERE id = ?', [$id]), 0, 'บัญชียังปิดอยู่');
    });
});

test('แก้ชื่อพนักงานแล้วชื่อในบัญชีตามไปด้วย', function () {
    withRollback(function () {
        $emp = anEmployee('ชื่อเก่า');
        $id = Users::ensureFor($emp, 'ชื่อเก่า', null, true);

        Users::syncFromEmployee($emp, 'ชื่อใหม่', 'reception', true, 1);

        $row = Db::one('SELECT display_name, job_title FROM admins WHERE id = ?', [$id]);
        eq($row['display_name'], 'ชื่อใหม่', 'ชื่อที่แสดง');
        eq($row['job_title'], 'reception', 'หน้าที่');
    });
});

test('ปิดพนักงานที่เป็นบัญชีของตัวเองไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ตัวเอง');
        $id = Users::ensureFor($emp, 'ตัวเอง', null, true);

        throwsReason(
            'self_lockout',
            fn() => Users::syncFromEmployee($emp, 'ตัวเอง', null, false, $id),
            'ปิดพนักงานที่เป็นบัญชีที่กำลังใช้อยู่',
        );
        eq((int) Db::value('SELECT is_active FROM admins WHERE id = ?', [$id]), 1, 'บัญชีต้องไม่ถูกปิด');
    });
});

test('ปิดพนักงานที่เป็นเจ้าของร้านคนสุดท้ายไม่ได้', function () {
    withRollback(function () {
        Db::run("UPDATE admins SET is_active = 0 WHERE role = 'owner' AND id <> 1");
        $emp = anEmployee('เจ้าของร้าน');
        Db::run('UPDATE admins SET employee_id = ? WHERE id = 1', [$emp]);

        throwsReason(
            'last_owner',
            fn() => Users::syncFromEmployee($emp, 'เจ้าของร้าน', null, false, 2),
            'ปิดเจ้าของร้านคนสุดท้าย',
        );
        eq((int) Db::value('SELECT is_active FROM admins WHERE id = 1'), 1, 'บัญชีต้องไม่ถูกปิด');
    });
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```
cd stock; .\run.ps1 test users
```

คาดว่า: เคสใหม่ทั้ง 7 เคสล้มด้วย `Error: Call to undefined method Optic\Service\Users::ensureFor()`
เคสเดิมทั้งหมดยังผ่าน

- [ ] **Step 3: เขียนโค้ดให้ผ่าน**

เพิ่มในส่วน `/* ----- helpers */` ของ `stock/api/src/Service/Users.php` (หลัง `requireReach()`):

```php
    /** หน้าที่ที่คัดลอกมาจาก `employees.roles` — ช่องปลายทางแคบกว่า 80 ตัว */
    private static function jobTitleOf(?string $v): ?string
    {
        $v = $v === null ? '' : trim($v);
        return $v === '' ? null : mb_substr($v, 0, 120);
    }

    /** ล็อกตัวเองออกจากระบบเป็นความผิดพลาดเดียวที่แก้จากในแอปไม่ได้ */
    private static function requireNotSelf(int $id, int $actorId, string $why): void
    {
        if ($id === $actorId) {
            throw ApiError::conflict('self_lockout', $why);
        }
    }

    /**
     * ร้านต้องเหลือเจ้าของร้านอย่างน้อยหนึ่งคนเสมอ
     *
     * `$signInOnly` แยกสองคำถามที่ไม่เหมือนกันจริง ๆ: การปิดบัญชีถามว่า "ยังเหลือ
     * เจ้าของที่ใช้งานอยู่ไหม" ส่วนการยกเลิกบัญชีถามว่า "ยังเหลือเจ้าของที่ล็อกอิน
     * เข้ามาได้ไหม" — แถวที่ is_active = 1 แต่ไม่มีรหัสผ่านนับเป็นข้อแรกแต่ไม่นับ
     * เป็นข้อหลัง และการนับผิดข้อคือการล็อกทุกคนออกจากร้านโดยที่ระบบบอกว่าผ่าน
     */
    private static function requireOwnerRemains(int $id, string $role, bool $signInOnly = false): void
    {
        if ($role !== Roles::OWNER) {
            return;
        }
        $extra = $signInOnly ? ' AND username IS NOT NULL AND password_hash IS NOT NULL' : '';
        $others = (int) Db::value(
            "SELECT COUNT(*) FROM admins WHERE role = 'owner' AND is_active = 1{$extra} AND id <> ?",
            [$id],
        );
        if ($others === 0) {
            throw ApiError::conflict(
                'last_owner',
                $signInOnly
                    ? 'ต้องเหลือเจ้าของร้านที่เข้าระบบได้อย่างน้อยหนึ่งคน'
                    : 'ต้องเหลือเจ้าของร้านที่ใช้งานได้อย่างน้อยหนึ่งคน',
            );
        }
    }
```

เพิ่มสองเมธอดสาธารณะ ก่อน `create()`:

```php
    /**
     * แถวใน `admins` ของพนักงานคนนี้ — สร้างให้ถ้ายังไม่มี
     *
     * เรียกซ้ำได้โดยไม่เปลี่ยนอะไร เพราะมันตอบคำถาม "คนนี้มีตัวตนในระบบบัญชีหรือยัง"
     * ไม่ใช่ "เอาค่าพวกนี้ไปเขียนทับ" — การเขียนทับเป็นงานของ syncFromEmployee()
     *
     * ไม่ตรวจสิทธิ์ เพราะแถวที่มันสร้างเข้าระบบไม่ได้ (ไม่มี username ไม่มีรหัสผ่าน)
     * การเพิ่มพนักงานจึงไม่ใช่การให้สิทธิ์ · ด่านสิทธิ์อยู่ที่เส้นทางที่เรียกมัน
     */
    public static function ensureFor(int $employeeId, string $displayName, ?string $jobTitle, bool $active): int
    {
        $existing = Db::value('SELECT id FROM admins WHERE employee_id = ?', [$employeeId]);
        if ($existing !== null) {
            return (int) $existing;
        }

        if (Db::value('SELECT id FROM employees WHERE id = ?', [$employeeId]) === null) {
            throw ApiError::notFound('ไม่พบพนักงานที่จะผูกบัญชี');
        }

        Db::run(
            'INSERT INTO admins (employee_id, display_name, job_title, role, is_active)
             VALUES (?, ?, ?, ?, ?)',
            [
                $employeeId,
                mb_substr(trim($displayName), 0, 255),
                self::jobTitleOf($jobTitle),
                Roles::SALES,
                $active ? 1 : 0,
            ],
        );

        return (int) Db::value('SELECT LAST_INSERT_ID()');
    }

    /**
     * พนักงานถูกแก้ที่หน้าพนักงาน — บัญชีของเขาตามไปด้วย
     *
     * ทางเดียว: ปิดพนักงานปิดบัญชีตาม แต่เปิดพนักงานกลับไม่เปิดบัญชีคืน · กลับมา
     * ทำงานไม่ได้แปลว่าได้สิทธิ์เดิมคืนเงียบ ๆ — คนที่เคยเป็นแอดมินแล้วออกไป
     * กลับมาเป็นพนักงานชั่วคราวได้ และวันนั้นสิทธิ์แอดมินต้องไม่คืนมาเอง
     */
    public static function syncFromEmployee(
        int $employeeId,
        string $displayName,
        ?string $jobTitle,
        bool $active,
        int $actorId,
    ): void {
        $id = self::ensureFor($employeeId, $displayName, $jobTitle, $active);
        $row = Db::one('SELECT id, role, is_active FROM admins WHERE id = ?', [$id]);

        $wasActive = (bool) $row['is_active'];
        if (!$active && $wasActive) {
            self::requireNotSelf($id, $actorId, 'ปิดใช้งานพนักงานที่เป็นบัญชีของตัวเองไม่ได้');
            self::requireOwnerRemains($id, (string) $row['role']);
        }

        Db::run(
            'UPDATE admins SET display_name = ?, job_title = ?, is_active = ? WHERE id = ?',
            [
                mb_substr(trim($displayName), 0, 255),
                self::jobTitleOf($jobTitle),
                $active ? ($wasActive ? 1 : 0) : 0,
                $id,
            ],
        );
    }
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

```
cd stock; .\run.ps1 test users
```

คาดว่า: ผ่านทั้งหมด (เคสเดิม + 7 เคสใหม่)

- [ ] **Step 5: คอมมิต**

```bash
git add stock/api/src/Service/Users.php stock/api/tests/50-users.test.php
git commit -m "เพิ่มการผูกบัญชีกับพนักงาน: ensureFor และ syncFromEmployee

เตรียมทางให้ employees เป็นข้อมูลหลักโดยยังไม่เปลี่ยนพฤติกรรมเดิม — เมธอดสองตัวนี้
คือจุดเดียวที่แถวใน admins ถูกสร้างจากพนักงาน และเป็นจุดเดียวที่การปิดพนักงาน
กลายเป็นการปิดบัญชี · ทางกลับไม่สมมาตรโดยตั้งใจ

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

### Task 2: `Users::grantAccount()` และ `Users::revokeAccount()`

**Files:**
- Modify: `stock/api/src/Service/Users.php`
- Test: `stock/api/tests/50-users.test.php`

**Interfaces:**
- Consumes: `Users::ensureFor()`, `Users::requireNotSelf()`, `Users::requireOwnerRemains()`, `Users::requireReach()`, `Users::username()`, `Users::password()`, `Users::role()` (Task 1 + ของเดิม)
- Produces:
  - `Users::grantAccount(int $employeeId, array $req, string $actorRole): array` — คืน `['id','employeeId','username','displayName']`
  - `Users::revokeAccount(int $id, string $actorRole, int $actorId): array` — คืน `['id','displayName']`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

เพิ่มที่ท้าย `stock/api/tests/50-users.test.php`:

```php
group('สร้างและยกเลิกบัญชีเข้าใช้งาน');

test('สร้างบัญชีให้พนักงานแล้วเข้าระบบได้จริง', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('พนักงานใหม่', true, 'reception,sales');

        $out = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );

        eq($out['employeeId'], $emp, 'คืน employeeId ของคนที่ได้บัญชี');
        eq($out['username'], $u, 'คืนชื่อผู้ใช้');

        $actor = Auth::login($u, 'a-strong-password');
        eq($actor['id'], $out['id'], 'ล็อกอินได้ด้วยบัญชีที่เพิ่งสร้าง');
        eq($actor['role'], Roles::SALES, 'สิทธิ์ที่ได้');
    });
});

test('สร้างบัญชีให้พนักงานที่ไม่มีอยู่ไม่ได้', function () {
    withRollback(function () {
        throwsReason(
            'not_found',
            fn() => Users::grantAccount(
                999999999,
                ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
                Roles::OWNER,
            ),
            'สร้างบัญชีให้พนักงานที่ไม่มีอยู่',
        );
    });
});

test('สร้างบัญชีให้พนักงานที่ลาออกแล้วไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ลาออกไปแล้ว', false);
        throwsReason(
            'employee_inactive',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
                Roles::OWNER,
            ),
            'สร้างบัญชีให้คนที่ลาออกแล้ว',
        );
    });
});

test('พนักงานคนเดียวมีสองบัญชีไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('มีบัญชีแล้ว');
        Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );

        throwsReason(
            'account_exists',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
                Roles::OWNER,
            ),
            'สร้างบัญชีใบที่สองให้คนเดิม',
        );
    });
});

test('สร้างบัญชีต้องมีทั้งชื่อผู้ใช้และรหัสผ่าน', function () {
    withRollback(function () {
        $emp = anEmployee('ขาดของ');
        throwsReason(
            'missing_field',
            fn() => Users::grantAccount($emp, ['password' => 'a-strong-password', 'role' => Roles::SALES], Roles::OWNER),
            'ไม่มีชื่อผู้ใช้',
        );
        throwsReason(
            'missing_field',
            fn() => Users::grantAccount($emp, ['username' => uname(), 'role' => Roles::SALES], Roles::OWNER),
            'ไม่มีรหัสผ่าน',
        );
    });
});

test('ตั้งบทบาทสูงกว่าตัวเองตอนสร้างบัญชีไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('อยากเป็นเจ้าของ');
        throwsReason(
            'forbidden',
            fn() => Users::grantAccount(
                $emp,
                ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::OWNER],
                Roles::ADMIN,
            ),
            'แอดมินสร้างบัญชีเจ้าของร้าน',
        );
    });
});

test('ยกเลิกบัญชีแล้วเข้าระบบไม่ได้ แต่แถวยังอยู่ให้ประวัติอ่านชื่อ', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('จะถูกยกเลิกบัญชี');
        $out = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::STOCK],
            Roles::OWNER,
        );
        $product = aProduct();
        Db::run(
            'INSERT INTO inventory_logs (product_id, action_type, quantity, created_by, created_by_kind)
             VALUES (?, ?, ?, ?, ?)',
            [$product, 'ADJUST', 1, $out['id'], 'admin'],
        );

        Users::revokeAccount($out['id'], Roles::OWNER, 1);

        throwsReason('bad_credentials', fn() => Auth::login($u, 'a-strong-password'), 'ล็อกอินหลังถูกยกเลิกบัญชี');

        $row = Db::one('SELECT username, password_hash, display_name FROM admins WHERE id = ?', [$out['id']]);
        ok($row !== null, 'แถวยังอยู่');
        eq($row['username'], null, 'ชื่อผู้ใช้ถูกล้าง');
        eq($row['password_hash'], null, 'รหัสผ่านถูกล้าง');
        eq($row['display_name'], 'จะถูกยกเลิกบัญชี', 'ชื่อยังอ่านได้');
    });
});

test('ยกเลิกบัญชีที่ยังไม่มีบัญชีไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ยังไม่มีบัญชี');
        $id = Users::ensureFor($emp, 'ยังไม่มีบัญชี', null, true);

        throwsReason(
            'no_account',
            fn() => Users::revokeAccount($id, Roles::OWNER, 1),
            'ยกเลิกบัญชีที่ไม่มีอยู่',
        );
    });
});

test('ยกเลิกบัญชีตัวเองไม่ได้', function () {
    withRollback(function () {
        $emp = anEmployee('ยกเลิกตัวเอง');
        $out = Users::grantAccount(
            $emp,
            ['username' => uname(), 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );

        throwsReason(
            'self_lockout',
            fn() => Users::revokeAccount($out['id'], Roles::OWNER, $out['id']),
            'ยกเลิกบัญชีที่กำลังใช้อยู่',
        );
    });
});

test('ยกเลิกบัญชีเจ้าของร้านที่เข้าระบบได้คนสุดท้ายไม่ได้', function () {
    withRollback(function () {
        Db::run("UPDATE admins SET is_active = 0 WHERE role = 'owner' AND id <> 1");

        throwsReason(
            'last_owner',
            fn() => Users::revokeAccount(1, Roles::OWNER, 2),
            'ยกเลิกบัญชีเจ้าของร้านคนสุดท้าย',
        );
    });
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```
cd stock; .\run.ps1 test users
```

คาดว่า: 10 เคสใหม่ล้มด้วย `Call to undefined method Optic\Service\Users::grantAccount()`

- [ ] **Step 3: เขียนโค้ดให้ผ่าน**

เพิ่มสองเมธอดใน `stock/api/src/Service/Users.php` (วางต่อจาก `syncFromEmployee()`):

```php
    /**
     * ให้พนักงานที่มีอยู่แล้วเข้าใช้งานระบบได้
     *
     * ไม่ได้สร้างคน — คนถูกสร้างที่หน้าพนักงานไปแล้ว ที่นี่คือการเติมชื่อผู้ใช้กับ
     * รหัสผ่านลงในแถวที่รออยู่ · แยกจากการเพิ่มพนักงานโดยตั้งใจ เพราะ "รับคนเข้า
     * ทำงาน" กับ "ให้คนนั้นเปิดคอมพิวเตอร์ของร้านได้" เป็นคนละการตัดสินใจ
     *
     * @param array<string,mixed> $req @return array<string,mixed>
     */
    public static function grantAccount(int $employeeId, array $req, string $actorRole): array
    {
        Roles::require(Roles::manageAdmins($actorRole), 'สร้างบัญชีเข้าใช้งาน');

        $employee = Db::one('SELECT id, employee_name, roles, active FROM employees WHERE id = ?', [$employeeId]);
        if ($employee === null) {
            throw ApiError::notFound('ไม่พบพนักงานคนนี้');
        }
        if (!(bool) $employee['active']) {
            throw ApiError::conflict(
                'employee_inactive',
                'พนักงานคนนี้ถูกปิดใช้งานอยู่ — เปิดใช้งานที่หน้าพนักงานก่อนจึงจะสร้างบัญชีได้',
            );
        }

        $id = self::ensureFor(
            $employeeId,
            (string) $employee['employee_name'],
            $employee['roles'] === null ? null : (string) $employee['roles'],
            true,
        );

        if (Db::value('SELECT username FROM admins WHERE id = ?', [$id]) !== null) {
            throw ApiError::conflict(
                'account_exists',
                'พนักงานคนนี้มีบัญชีเข้าใช้งานอยู่แล้ว — แก้ที่บัญชีเดิมแทน',
            );
        }

        $username = self::username($req);
        if ($username === null) {
            throw ApiError::badRequest('ต้องระบุชื่อผู้ใช้', 'missing_field');
        }
        $password = (string) self::password($req, required: true);
        $newRole = self::role($req, $actorRole);

        if (Db::value('SELECT id FROM admins WHERE username = ?', [$username]) !== null) {
            throw ApiError::conflict('duplicate_username', "มีชื่อผู้ใช้ “{$username}” อยู่แล้ว", ['username' => $username]);
        }

        Db::run(
            'UPDATE admins SET username = ?, password_hash = ?, role = ?, is_active = 1 WHERE id = ?',
            [$username, Auth::hashPassword($password), $newRole, $id],
        );

        return [
            'id'          => $id,
            'employeeId'  => $employeeId,
            'username'    => $username,
            'displayName' => (string) $employee['employee_name'],
        ];
    }

    /**
     * เอาสิทธิ์เข้าใช้งานคืน โดยที่คนยังอยู่ในระบบ
     *
     * แทนที่ `delete()` เดิมทั้งหมด — แถวใน admins ไม่ใช่ "บัญชี" อีกต่อไปแล้ว
     * มันคือตัวตนของพนักงานคนหนึ่ง ซึ่งลบไม่ได้เพราะ ledger เขียนชื่อจากมัน
     * สิ่งที่ยกเลิกได้คือชื่อผู้ใช้กับรหัสผ่าน และพรุ่งนี้เปิดใหม่ให้คนเดิมได้เลย
     *
     * @return array<string,mixed>
     */
    public static function revokeAccount(int $id, string $actorRole, int $actorId): array
    {
        Roles::require(Roles::manageAdmins($actorRole), 'ยกเลิกบัญชีเข้าใช้งาน');

        $target = Db::one('SELECT id, username, display_name, role FROM admins WHERE id = ?', [$id]);
        if ($target === null) {
            throw ApiError::notFound('ไม่พบผู้ใช้');
        }
        self::requireReach($actorRole, (string) $target['role'], 'ยกเลิกบัญชีนี้');

        if ($target['username'] === null) {
            throw ApiError::conflict('no_account', 'คนนี้ยังไม่มีบัญชีเข้าใช้งานอยู่แล้ว');
        }

        self::requireNotSelf($id, $actorId, 'ยกเลิกบัญชีที่กำลังใช้อยู่ไม่ได้');
        self::requireOwnerRemains($id, (string) $target['role'], signInOnly: true);

        Db::run('UPDATE admins SET username = NULL, password_hash = NULL WHERE id = ?', [$id]);

        return ['id' => $id, 'displayName' => $target['display_name']];
    }
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

```
cd stock; .\run.ps1 test users
```

คาดว่า: ผ่านทั้งหมด

- [ ] **Step 5: คอมมิต**

```bash
git add stock/api/src/Service/Users.php stock/api/tests/50-users.test.php
git commit -m "แยกการให้สิทธิ์เข้าใช้งานออกจากการสร้างคน

grantAccount เติมชื่อผู้ใช้กับรหัสผ่านลงแถวที่รออยู่ · revokeAccount ล้างสองช่องนั้น
คืนโดยไม่ลบแถว เพราะ ledger เขียนชื่อจากแถวนี้ · กฎเจ้าของร้านคนสุดท้ายแยกสองแบบ
ตามคำถามที่ต่างกันจริง: ยังใช้งานอยู่ไหม กับ ยังล็อกอินเข้ามาได้ไหม

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

### Task 3: ปิดกฎที่ฐานข้อมูล และลบทางที่ละเมิดกฎ

ทั้ง migration และการลบ `create()`/`delete()` ต้องอยู่ในคอมมิตเดียวกัน — ระหว่างสองคอมมิต
จะมีช่วงที่ `Users::create()` ยิง INSERT ที่ฐานปฏิเสธ

**Files:**
- Create: `stock/api/migrations/027_employee_is_master.sql`
- Modify: `stock/api/src/Service/Users.php`
- Test: `stock/api/tests/50-users.test.php`

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 1–2
- Produces:
  - `admins.employee_id` เป็น `INT UNSIGNED NOT NULL` + FK `fk_admins_employee` → `employees(id)`
  - `Users::update(int $id, array $req, string $role, int $actorId): array` — รับเฉพาะ `username` `role` `is_active`
  - `Users::create()` และ `Users::delete()` **ไม่มีอีกต่อไป**

- [ ] **Step 1: สำรองฐานข้อมูล**

```
& "C:\xampp\mysql\bin\mysqldump.exe" --default-character-set=utf8mb4 --single-transaction -h127.0.0.1 -uroot timeoptic > backup-before-027.sql
```

ยืนยันว่าไฟล์มีขนาดมากกว่า 0 ก่อนไปต่อ · view `v_sale_history` พังอยู่ dump จะหยุดตรงส่วน
views แต่ข้อมูลตารางครบแล้ว ถือว่าใช้ได้

- [ ] **Step 2: บันทึกสภาพก่อนย้าย ไว้เทียบผลทีหลัง**

```
& "C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -h127.0.0.1 -uroot timeoptic -e "SELECT COUNT(*) admins, SUM(employee_id IS NOT NULL) linked FROM admins; SELECT COUNT(*) employees FROM employees; SELECT * FROM admins WHERE id = 163\G"
```

คาดว่า: `admins 12 / linked 0` · `employees 13` · แถว 163 มีอยู่จริง (username `employees`)
คัดลอกผลของแถว 163 ทั้งแถวไว้ใส่เป็น comment ในไฟล์ migration ขั้นถัดไป

- [ ] **Step 3: เขียนไฟล์ migration**

สร้าง `stock/api/migrations/027_employee_is_master.sql`:

```sql
-- พนักงานคือข้อมูลหลัก · บัญชีทุกใบต้องมีพนักงานรองรับ
--
-- `admins` กับ `employees` เก็บ "คน" ไว้คนละที่มาตลอด และคอลัมน์ที่มีไว้เชื่อมกลับ
-- (`admins.employee_id`, UNIQUE ตั้งแต่แรก) ว่างทั้งตาราง — รายงานผลงานพนักงานจึงเท
-- งานฝั่ง POS ลงแถว "ไม่ระบุพนักงาน" ทั้งหมด และการรับหรือปิดคนหนึ่งคนต้องทำสองที่
--
-- ไฟล์นี้เติมการผูกให้ครบทุกแถวแล้วปิดกฎด้วย NOT NULL + FOREIGN KEY เพื่อให้ฐาน
-- เป็นผู้ปฏิเสธ ไม่ใช่โค้ดที่ลืมเช็คได้

-- ── 0 · แถวที่หลุดมาจากการทดลอง ─────────────────────────────────────────────
-- id 163 · username 'employees' · display_name 'employees' · job_title 'employees'
-- role 'sales' · is_active 1 · มี password_hash (เข้าระบบได้จริง) · created_at
-- 2026-08-26 14:58:20 · created_by NULL · ไม่มีร่องรอยในตารางไหนเลย
-- ปล่อยไว้จะกลายเป็นพนักงานชื่อ "employees" ในขั้นถัดไป และมันคือช่องทางเข้าที่ไม่มีเจ้าของ
-- เงื่อนไขครบทั้งสี่ช่องเพื่อไม่ให้ไปโดนบัญชีจริงในฐานอื่นที่บังเอิญมี id ตรงกัน
DELETE FROM admins
 WHERE id = 163 AND username = 'employees' AND display_name = 'employees' AND created_by IS NULL;

-- ── 1 · บัญชีที่ยังไม่มีพนักงาน — สร้างพนักงานให้ ───────────────────────────
-- ผูกกลับด้วยคอลัมน์ชั่วคราว ไม่ใช่ด้วยชื่อ: ชื่อซ้ำกันได้ และ INSERT…SELECT
-- ไม่คืน id ของแต่ละแถวออกมาให้จับคู่
ALTER TABLE employees ADD COLUMN _from_admin INT UNSIGNED NULL;

INSERT INTO employees (employee_name, roles, active, _from_admin)
SELECT LEFT(a.display_name, 120), LEFT(a.job_title, 200), a.is_active, a.id
  FROM admins a
 WHERE a.employee_id IS NULL;

UPDATE admins a JOIN employees e ON e._from_admin = a.id
   SET a.employee_id = e.id;

ALTER TABLE employees DROP COLUMN _from_admin;

-- ── 2 · พนักงานที่ยังไม่มีแถวในบัญชี — สร้างแถวเงาให้ ───────────────────────
-- role 'sales' ไม่มีความหมายจนกว่าจะมีการสร้างบัญชี: แถวที่ไม่มี username เข้าระบบ
-- ไม่ได้ไม่ว่าจะถือ role อะไร (Auth::login ปฏิเสธทั้ง password_hash NULL และ is_active 0)
-- หน้าจอจึงไม่แสดงคอลัมน์สิทธิ์ของแถวพวกนี้
INSERT INTO admins (employee_id, display_name, job_title, role, is_active)
SELECT e.id, e.employee_name, LEFT(e.roles, 120), 'sales', e.active
  FROM employees e
  LEFT JOIN admins a ON a.employee_id = e.id
 WHERE a.id IS NULL;

-- ── 3 · ปิดกฎ ───────────────────────────────────────────────────────────────
ALTER TABLE admins
  MODIFY employee_id INT UNSIGNED NOT NULL
    COMMENT 'employees.id — บัญชีทุกใบต้องมีพนักงานรองรับ ห้าม NULL';

ALTER TABLE admins
  ADD CONSTRAINT fk_admins_employee FOREIGN KEY (employee_id) REFERENCES employees (id);

-- ── ย้อนกลับ (ถ้าจำเป็น รันด้วยมือ) ─────────────────────────────────────────
-- ALTER TABLE admins DROP FOREIGN KEY fk_admins_employee;
-- ALTER TABLE admins MODIFY employee_id INT UNSIGNED NULL;
-- DELETE FROM employees WHERE id IN (SELECT employee_id FROM admins WHERE username IS NULL);
-- แล้วกู้จาก backup-before-027.sql ถ้าผลไม่ตรงกับที่คาด
```

- [ ] **Step 4: รัน migration**

```
cd stock; .\run.ps1 migrate
```

คาดว่า: `รัน 027_employee_is_master.sql แล้ว`

- [ ] **Step 5: ตรวจผลก่อนไปต่อ**

```
& "C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -h127.0.0.1 -uroot timeoptic -e "SELECT (SELECT COUNT(*) FROM admins) admins, (SELECT COUNT(*) FROM employees) employees, (SELECT COUNT(*) FROM admins WHERE employee_id IS NULL) orphan, (SELECT COUNT(*) FROM admins WHERE username IS NOT NULL AND password_hash IS NOT NULL) with_account;"
```

คาดว่า: `admins 24 · employees 24 · orphan 0 · with_account 6`
ถ้าตัวเลขไม่ตรง **หยุด** แล้วกู้จาก `backup-before-027.sql` ก่อนวิเคราะห์ต่อ

- [ ] **Step 6: แก้ `Users.php` — ลบ `create()` และ `delete()` แล้วทำ `update()` ให้แคบลง**

ลบเมธอด `create()` และ `delete()` ทั้งสองตัวออกจาก `stock/api/src/Service/Users.php`
พร้อมค่าคงที่ `TRACES` ที่มีไว้ให้ `delete()` ใช้ตัวเดียว และแก้ doc comment ของคลาส
ให้ตรงกับความจริงใหม่ แทนที่ `update()` ทั้งเมธอดด้วย:

```php
    /**
     * แก้บัญชีเข้าใช้งาน — ไม่ใช่แก้คน
     *
     * ชื่อที่แสดงกับหน้าที่หายไปจากเมธอดนี้โดยตั้งใจ ทั้งสองอย่างมาจาก `employees`
     * และแก้ได้ที่หน้าพนักงานที่เดียว · ถ้ารับที่นี่ด้วย จะมีสองที่ที่ตั้งชื่อคนคนเดียวกัน
     * แล้ววันหนึ่งใบเสร็จกับรายงานจะพิมพ์คนละชื่อ
     *
     * @param array<string,mixed> $req @return array<string,mixed>
     */
    public static function update(int $id, array $req, string $role, int $actorId): array
    {
        Roles::require(Roles::manageAdmins($role), 'แก้ไขผู้ใช้');

        $target = Db::one(
            'SELECT a.*, e.employee_name, e.active AS employee_active
               FROM admins a JOIN employees e ON e.id = a.employee_id
              WHERE a.id = ?',
            [$id],
        );
        if ($target === null) {
            throw ApiError::notFound('ไม่พบผู้ใช้');
        }
        self::requireReach($role, (string) $target['role'], 'แก้ไขบัญชีนี้');

        $newRole = self::role($req, $role);
        $isActive = (bool) ($req['is_active'] ?? true);
        $username = self::username($req);

        /* เปิดบัญชีของคนที่ลาออกไปแล้วไม่ได้ ไม่งั้นกฎ "ปิดพนักงาน = ปิดบัญชี"
           ถูกเดินอ้อมได้ในสองคลิกจากหน้าถัดไป */
        if ($isActive && !(bool) $target['employee_active']) {
            throw ApiError::conflict(
                'employee_inactive',
                'พนักงานคนนี้ถูกปิดใช้งานอยู่ — เปิดใช้งานที่หน้าพนักงานก่อน',
            );
        }

        /* ล้างชื่อผู้ใช้ทิ้งแต่เก็บรหัสผ่านไว้ = แถวที่ล็อกอินไม่ได้แต่ยังถือรหัสอยู่
           ซึ่งไม่ใช่สถานะที่ใครตั้งใจ · ทางที่ตั้งใจคือ revokeAccount() */
        if ($username === null && $target['password_hash'] !== null) {
            throw ApiError::conflict(
                'no_account',
                'ลบชื่อผู้ใช้เฉย ๆ ไม่ได้ — ใช้ "ยกเลิกบัญชีเข้าใช้งาน" เพื่อเก็บรหัสผ่านคืนไปด้วย',
            );
        }

        if ($username !== null) {
            $clash = Db::value('SELECT id FROM admins WHERE username = ? AND id <> ?', [$username, $id]);
            if ($clash !== null) {
                throw ApiError::conflict('duplicate_username', "มีชื่อผู้ใช้ “{$username}” อยู่แล้ว", ['username' => $username]);
            }
        }

        // ล็อกตัวเองออกเป็นความผิดพลาดเดียวที่แก้จากในแอปไม่ได้ จึงปฏิเสธ ไม่ใช่ถามยืนยัน
        if ($id === $actorId) {
            if (!$isActive) {
                throw ApiError::conflict('self_lockout', 'ปิดใช้งานบัญชีตัวเองไม่ได้');
            }
            if (Roles::rank($newRole) < Roles::rank($role)) {
                throw ApiError::conflict('self_lockout', 'ลดสิทธิ์ตัวเองไม่ได้ — ให้คนที่สิทธิ์สูงกว่าทำให้');
            }
        }

        if ($target['role'] === Roles::OWNER && ($newRole !== Roles::OWNER || !$isActive)) {
            self::requireOwnerRemains($id, Roles::OWNER);
        }

        Db::run(
            'UPDATE admins SET username = ?, role = ?, is_active = ? WHERE id = ?',
            [$username, $newRole, $isActive ? 1 : 0, $id],
        );

        return ['id' => $id, 'displayName' => $target['employee_name'], 'role' => $newRole, 'isActive' => $isActive];
    }
```

- [ ] **Step 7: แก้เทสต์เดิมที่เรียก `create()` / `delete()`**

ในเทสต์ทั้งหมดของ `stock/api/tests/50-users.test.php` ที่เขียนไว้ก่อน Task 1 ให้แทน

```php
$made = Users::create(['display_name' => 'ชื่อ', 'role' => Roles::SALES], Roles::OWNER);
```

ด้วยรูปแบบนี้ (คนที่ยังไม่มีบัญชี):

```php
$emp = anEmployee('ชื่อ');
$made = ['id' => Users::ensureFor($emp, 'ชื่อ', null, true)];
```

และแทน

```php
$made = Users::create(
    ['display_name' => 'ชื่อ', 'role' => Roles::ADMIN, 'username' => $u, 'password' => 'a-strong-password'],
    Roles::OWNER,
);
```

ด้วย (คนที่มีบัญชี):

```php
$emp = anEmployee('ชื่อ');
$made = Users::grantAccount(
    $emp,
    ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::ADMIN],
    Roles::OWNER,
);
```

การเรียก `Users::update()` ทุกจุดให้ตัด `'display_name' => …` และ `'job_title' => …` ออกจาก
array ที่ส่งไป · ลบสามเคสในกลุ่ม `ลบผู้ใช้` (`ลบคนที่ยังไม่เคยทำอะไรในระบบได้`,
`คนที่เคยคีย์รายการแล้ว ลบไม่ได้ — ประวัติต้องอ่านย้อนหลังได้`,
`คนที่เคยรับของไป ลบไม่ได้ ถึงจะไม่เคยคีย์อะไรเลย`) และสองเคส `ลบบัญชีตัวเองไม่ได้`,
`ลบเจ้าของร้านคนสุดท้ายไม่ได้` — สิ่งที่เคสพวกนี้ปกป้องถูกแทนด้วยกฎที่แข็งกว่า คือลบไม่ได้เลย
ย้ายกลุ่ม `ลบผู้ใช้` ทั้งกลุ่มออกและเพิ่มเคสใหม่แทน:

```php
group('ลบผู้ใช้ไม่ได้อีกแล้ว');

test('เมธอดลบผู้ใช้ไม่มีอยู่แล้ว', function () {
    ok(!method_exists(Users::class, 'delete'), 'Users::delete ต้องถูกถอดออก');
    ok(!method_exists(Users::class, 'create'), 'Users::create ต้องถูกถอดออก');
});

test('ฐานข้อมูลปฏิเสธบัญชีที่ไม่มีพนักงานรองรับ', function () {
    withRollback(function () {
        $threw = false;
        try {
            Db::run("INSERT INTO admins (display_name, role, is_active) VALUES ('ไม่มีพนักงาน', 'sales', 1)");
        } catch (\PDOException $e) {
            $threw = true;
        }
        ok($threw, 'INSERT ที่ไม่ใส่ employee_id ต้องถูกฐานปฏิเสธ');
    });
});

test('บัญชีที่ชี้ไปยังพนักงานที่ไม่มีอยู่ ฐานปฏิเสธ', function () {
    withRollback(function () {
        $threw = false;
        try {
            Db::run("INSERT INTO admins (employee_id, display_name, role, is_active) VALUES (999999999, 'ผี', 'sales', 1)");
        } catch (\PDOException $e) {
            $threw = true;
        }
        ok($threw, 'foreign key ต้องปฏิเสธ employee_id ที่ไม่มีจริง');
    });
});

test('เปิดบัญชีของคนที่ลาออกไปแล้วไม่ได้', function () {
    withRollback(function () {
        $u = uname();
        $emp = anEmployee('ลาออกแล้วแต่อยากกลับ');
        $made = Users::grantAccount(
            $emp,
            ['username' => $u, 'password' => 'a-strong-password', 'role' => Roles::SALES],
            Roles::OWNER,
        );
        Users::syncFromEmployee($emp, 'ลาออกแล้วแต่อยากกลับ', null, false, 1);

        throwsReason(
            'employee_inactive',
            fn() => Users::update($made['id'], ['username' => $u, 'role' => Roles::SALES, 'is_active' => true], Roles::OWNER, 1),
            'เปิดบัญชีของคนที่ลาออกแล้ว',
        );
    });
});
```

- [ ] **Step 8: รันเทสต์ทั้งชุด**

```
cd stock; .\run.ps1 test
```

คาดว่า: ผ่านทั้งหมดทุกไฟล์ · ถ้าไฟล์อื่น (เช่น `00-foundation`, `10-stock`) ล้มเพราะสร้าง
`admins` เอง ให้แก้จุดนั้นด้วย `anEmployee()` + `Users::ensureFor()` แบบเดียวกัน

- [ ] **Step 9: คอมมิต**

```bash
git add stock/api/migrations/027_employee_is_master.sql stock/api/src/Service/Users.php stock/api/tests/50-users.test.php
git commit -m "บังคับที่ฐาน: บัญชีทุกใบต้องมีพนักงานรองรับ

migration 027 เติมการผูกให้ครบทั้ง 24 แถวแล้วปิดกฎด้วย NOT NULL + FOREIGN KEY
ลบแถว id 163 ที่หลุดมาจากการทดลอง (username employees เข้าระบบได้จริง ไม่มีร่องรอย)

Users::create กับ Users::delete ถูกถอดออกในคอมมิตเดียวกัน ไม่ใช่คอมมิตถัดไป —
ทั้งสองตัวยิง SQL ที่ฐานปฏิเสธแล้ว การแยกคอมมิตคือการจงใจทิ้งช่วงที่ระบบพัง
update() เลิกรับชื่อและหน้าที่ ทั้งสองอย่างมาจากหน้าพนักงานที่เดียว

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

### Task 4: `Users::list()` คืนข้อมูลพนักงานมาด้วย

**Files:**
- Modify: `stock/api/src/Service/Users.php`
- Test: `stock/api/tests/50-users.test.php`

**Interfaces:**
- Consumes: FK ที่ Task 3 สร้าง
- Produces: `Users::list(string $role)` คืน list ของ
  `['id','employeeId','employeeName','jobTitle','username','role','roleLabel','hasAccount','isActive','employeeActive','lastLoginAt','movements']`
  · คีย์ `displayName` และ `canSignIn` **หายไป** (หน้าเว็บถูกแก้ตามใน Task 8)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

เพิ่มท้าย `stock/api/tests/50-users.test.php`:

```php
group('รายชื่อผู้ใช้มาจากพนักงาน');

test('ทุกแถวมีพนักงานกำกับ และบอกได้ว่าใครยังไม่มีบัญชี', function () {
    withRollback(function () {
        $emp = anEmployee('ยังไม่มีบัญชีเลย', true, 'technician');
        Users::ensureFor($emp, 'ยังไม่มีบัญชีเลย', 'technician', true);

        $rows = Users::list(Roles::OWNER);
        ok(count($rows) > 0, 'ต้องมีรายชื่อ');
        foreach ($rows as $r) {
            ok($r['employeeId'] > 0, 'ทุกแถวต้องมี employeeId');
            ok($r['employeeName'] !== null, 'ทุกแถวต้องมีชื่อพนักงาน');
        }

        $mine = array_values(array_filter($rows, fn($r) => $r['employeeId'] === $emp))[0] ?? null;
        ok($mine !== null, 'คนที่เพิ่งเพิ่มต้องอยู่ในรายชื่อ');
        eq($mine['hasAccount'], false, 'ยังไม่มีบัญชี');
        eq($mine['username'], null, 'ยังไม่มีชื่อผู้ใช้');
        eq($mine['jobTitle'], 'technician', 'หน้าที่มาจาก employees.roles');
        eq($mine['employeeActive'], true, 'พนักงานยังทำงานอยู่');
    });
});

test('ชื่อในรายชื่อมาจากตารางพนักงาน ไม่ใช่สำเนาในบัญชี', function () {
    withRollback(function () {
        $emp = anEmployee('ชื่อจากพนักงาน');
        $id = Users::ensureFor($emp, 'ชื่อจากพนักงาน', null, true);
        // แก้เฉพาะสำเนา เลียนแบบกรณีที่ sync พลาดไปรอบหนึ่ง
        Db::run('UPDATE admins SET display_name = ? WHERE id = ?', ['สำเนาที่ค้างเก่า', $id]);

        $rows = Users::list(Roles::OWNER);
        $mine = array_values(array_filter($rows, fn($r) => $r['employeeId'] === $emp))[0];
        eq($mine['employeeName'], 'ชื่อจากพนักงาน', 'อ่านจาก employees เสมอ');
    });
});

test('พนักงานที่ลาออกแล้วยังอยู่ในรายชื่อ แต่ถูกทำเครื่องหมายไว้', function () {
    withRollback(function () {
        $emp = anEmployee('ลาออกแล้ว', false);
        Users::ensureFor($emp, 'ลาออกแล้ว', null, false);

        $rows = Users::list(Roles::OWNER);
        $mine = array_values(array_filter($rows, fn($r) => $r['employeeId'] === $emp))[0] ?? null;
        ok($mine !== null, 'คนที่ลาออกยังต้องอยู่ในรายชื่อ — ประวัติชี้มาที่ชื่อนี้');
        eq($mine['employeeActive'], false, 'ทำเครื่องหมายว่าลาออกแล้ว');
    });
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```
cd stock; .\run.ps1 test users
```

คาดว่า: สามเคสใหม่ล้มด้วย `Undefined array key "employeeId"`

- [ ] **Step 3: เขียนโค้ดให้ผ่าน**

แทน `return array_map(...)` ทั้งบล็อกใน `Users::list()` ด้วย:

```php
        return array_map(
            static fn($r) => [
                'id'             => (int) $r['id'],
                'employeeId'     => (int) $r['employee_id'],
                'employeeName'   => $r['employee_name'],
                'jobTitle'       => $r['job_roles'],
                'username'       => $r['username'],
                'role'           => $r['role'],
                'roleLabel'      => Roles::LABEL[$r['role']] ?? $r['role'],
                /* "มีบัญชี" ต้องครบทั้งสองช่อง — Auth::login ปฏิเสธแถวที่ขาดช่องใด
                   ช่องหนึ่ง การบอกว่ามีบัญชีทั้งที่ล็อกอินไม่ได้คือการโกหกที่หน้าจอ */
                'hasAccount'     => $r['username'] !== null && $r['password_hash'] !== null,
                'isActive'       => (bool) $r['is_active'],
                'employeeActive' => (bool) $r['employee_active'],
                'lastLoginAt'    => $r['last_login_at'],
                'movements'      => (int) $r['movements'],
            ],
            Db::all(
                'SELECT a.*, e.employee_name, e.roles AS job_roles, e.active AS employee_active,
                        (SELECT COUNT(*) FROM inventory_logs g WHERE g.created_by = a.id) AS movements
                   FROM admins a
                   JOIN employees e ON e.id = a.employee_id
                  WHERE a.role IN (' . implode(', ', array_fill(0, count($visible), '?')) . ')
                  ORDER BY e.active DESC, (a.username IS NULL), a.role ASC, e.employee_name ASC',
                $visible,
            ),
        );
```

แก้ doc comment เหนือ `$visible` ให้บอกด้วยว่าลำดับคือ ทำงานอยู่ก่อน · มีบัญชีก่อน ·
สิทธิ์สูงก่อน · แล้วเรียงชื่อ

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

```
cd stock; .\run.ps1 test
```

คาดว่า: ผ่านทั้งหมด · เคสเดิม `รายชื่อบอกว่าใครล็อกอินได้บ้าง` ใช้คีย์ `canSignIn` อยู่
ให้เปลี่ยนเป็น `hasAccount` ในขั้นนี้

- [ ] **Step 5: คอมมิต**

```bash
git add stock/api/src/Service/Users.php stock/api/tests/50-users.test.php
git commit -m "รายชื่อผู้ใช้อ่านชื่อจากตารางพนักงาน

ชื่อกับหน้าที่มาจาก employees ตรง ๆ ไม่ใช่จากสำเนาใน admins — สำเนามีไว้ให้ ledger
กับใบเสร็จเก่าอ่าน ส่วนหน้าจอที่คนใช้ตัดสินใจต้องอ่านจากต้นทาง ไม่งั้น sync ที่พลาด
ไปรอบหนึ่งจะกลายเป็นชื่อผิดที่ไม่มีใครรู้ว่าผิด

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

### Task 5: เส้นทางฝั่งคลัง

**Files:**
- Modify: `stock/api/public/index.php:566-612` (บล็อก `/* ----- users */`)
- Modify: `api/services/ActivityLog.php:72-86` (`ENTITIES`) และ `:111-131` (`ACTION_LABEL`)

**Interfaces:**
- Consumes: `Users::grantAccount()`, `Users::revokeAccount()`, `Users::update()`, `Users::setPassword()`, `Users::list()`
- Produces: `POST /api/employees/{id}/account` และ `POST /api/users/{id}/revoke` (ทั้งคู่ถูกเรียก
  จากหน้าเว็บด้วย prefix `/stock-api`) · `POST /api/users` และ `POST /api/users/{id}/delete` หายไป

- [ ] **Step 1: แก้เส้นทาง**

ใน `stock/api/public/index.php` แทน `Http::post('/api/users', …)` ด้วย:

```php
/**
 * ให้พนักงานคนหนึ่งเข้าใช้งานระบบได้
 *
 * เส้นทางอยู่ใต้ /api/employees ไม่ใช่ /api/users เพราะสิ่งที่ถูกสร้างไม่ใช่คนใหม่
 * แต่เป็นสิทธิ์ของคนที่มีอยู่แล้ว · URL ที่อ่านว่า "สร้างผู้ใช้" จะชวนให้เขียนหน้าจอ
 * ที่สร้างคนจากที่นี่ ซึ่งเป็นสิ่งที่กฎห้ามไว้
 */
Http::post('/api/employees/{id}/account', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return ['user' => Users::grantAccount($numericId($p), Http::body(), $actor['role'])];
});
```

และแทน `Http::post('/api/users/{id}/delete', …)` ด้วย:

```php
/** ยกเลิกสิทธิ์เข้าใช้งาน — แถวยังอยู่เสมอ ประวัติอ่านชื่อจากมัน */
Http::post('/api/users/{id}/revoke', static function (array $p) use ($numericId): array {
    $actor = Auth::require();
    return Users::revokeAccount($numericId($p), $actor['role'], $actor['id']);
});
```

- [ ] **Step 2: ให้บันทึกการใช้งานรู้จักเส้นทางใหม่**

`ActivityLog` จับคู่ path แบบ prefix ที่ยาวที่สุด — `/stock-api/users/5/revoke` ยังตรงกับ
`/stock-api/users` ที่มีอยู่แล้ว แต่ `/stock-api/employees/5/account` ไม่ตรงกับอะไรเลย
การให้สิทธิ์เข้าใช้งานจึงจะไม่ถูกบันทึกชื่อตาราง ซึ่งเป็นเหตุการณ์ที่ล็อกต้องเห็นที่สุด
อย่างหนึ่ง เพิ่มใน `api/services/ActivityLog.php` ต่อจากบรรทัด `'/stock-api/users' => 'admins',`:

```php
        /* การให้สิทธิ์เข้าใช้งานเกิดที่เส้นทางใต้ /employees เพราะสิ่งที่ถูกสร้างคือ
           สิทธิ์ของพนักงานที่มีอยู่แล้ว แต่สิ่งที่ถูกแก้คือตาราง admins — ล็อกต้อง
           อ่านตามตารางที่เปลี่ยน ไม่ใช่ตาม URL ที่เรียก */
        '/stock-api/employees' => 'admins',
```

และเพิ่มใน `ACTION_LABEL` (ถ้ายังไม่มีคำไหนอยู่แล้ว):

```php
        'account'      => 'สร้างบัญชีเข้าใช้งาน',
        'revoke'       => 'ยกเลิกบัญชีเข้าใช้งาน',
        'password'     => 'ตั้งรหัสผ่าน',
```

- [ ] **Step 3: ตรวจว่าไม่มีอะไรเรียกเส้นทางเก่าอยู่**

```
grep -rn "users/[^/]*/delete\|api/users'" --include=*.php --include=*.jsx --include=*.js . | grep -v node_modules | grep -v "\.next"
```

คาดว่า: เหลือแค่ `frontend-next/app/(frontdesk)/users/page.jsx` ซึ่งจะแก้ใน Task 8

- [ ] **Step 4: ยิงเส้นทางจริงเพื่อดูว่าตอบถูก**

เปิด API ฝั่งคลังตามวิธีปกติ แล้ว:

```
curl -s -X POST http://127.0.0.1:8080/api/users/1/delete -H "Content-Type: application/json" -d "{}"
```

คาดว่า: 404 (เส้นทางหายแล้ว) ไม่ใช่ 401/500

- [ ] **Step 5: รันเทสต์ทั้งชุด**

```
cd stock; .\run.ps1 test
```

คาดว่า: ผ่านทั้งหมด (เส้นทางไม่มีเทสต์ตรง ๆ · ขั้นนี้กันการพิมพ์ผิดที่ทำให้ไฟล์ parse ไม่ผ่าน)

- [ ] **Step 6: คอมมิต**

```bash
git add stock/api/public/index.php api/services/ActivityLog.php
git commit -m "เส้นทาง: สร้างบัญชีอยู่ใต้พนักงาน ยกเลิกบัญชีแทนการลบ

POST /api/employees/{id}/account แทน POST /api/users — สิ่งที่สร้างคือสิทธิ์ของคน
ที่มีอยู่แล้ว ไม่ใช่คนใหม่ และ URL ที่อ่านผิดจะชวนให้เขียนหน้าจอที่ผิดตาม
POST /api/users/{id}/revoke แทน /delete

ActivityLog จับคู่ path แบบ prefix ยาวที่สุด เส้นทางใหม่จึงต้องลงทะเบียนด้วย
ไม่งั้นการให้สิทธิ์เข้าใช้งานจะไม่ถูกบันทึกชื่อตาราง ทั้งที่เป็นเหตุการณ์ที่ล็อกต้องเห็นที่สุด

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

### Task 6: `api/routes/employees.php` — ด่านสิทธิ์ และการสร้าง/ซิงก์แถวเงา

**Files:**
- Modify: `api/routes/employees.php` (ทั้งไฟล์)

**Interfaces:**
- Consumes: `Optic\Auth::require()`, `Optic\Roles::manageAdmins()`, `Optic\Service\Users::ensureFor()`, `Optic\Service\Users::syncFromEmployee()` · `StockModule::boot()` · `Db::tx()` ที่ส่ง `Tx $q` เข้า callback
- Produces: `GET /api/employees` เพิ่มคีย์ `account_id` `account_username` `account_role` `account_active` ในแต่ละแถว

- [ ] **Step 1: เขียนไฟล์ใหม่ทั้งไฟล์**

แทน `api/routes/employees.php` ทั้งไฟล์ด้วย:

```php
<?php
/**
 * พนักงานร้าน — ข้อมูลหลักของคนในระบบ
 *
 * ไม่เคยถูกลบ ปิดใช้งานแทน เพื่อให้ระเบียนเก่ายังอ่านชื่อได้ · ตั้งแต่ migration 027
 * ทุกแถวที่นี่มีแถวคู่ใน `admins` หนึ่งแถวเสมอ ซึ่งเป็นตัวตนที่ ledger กับ POS ชี้มา
 * และเป็นที่ที่ชื่อผู้ใช้กับรหัสผ่านไปอยู่เมื่อคนคนนั้นได้สิทธิ์เข้าใช้งาน
 *
 * ── ทำไมไฟล์นี้ไม่เขียนตาราง `admins` เอง ────────────────────────────────
 * เขียนเองได้ในทางเทคนิค (ฐานเดียวกัน คอนเนกชันเดียวกัน) แต่กฎว่าบัญชีไหนปิดได้
 * ปิดไม่ได้อยู่ใน `Optic\Service\Users` ที่เดียว · สองที่ที่ตัดสินเรื่องเดียวกันคือ
 * สองที่ที่จะขัดกันวันที่แก้ที่เดียว
 */
declare(strict_types=1);

use Optic\Auth;
use Optic\Roles;
use Optic\Service\Users;

/**
 * ด่านของเส้นทางที่เขียนข้อมูล
 *
 * เดิมทั้งไฟล์ไม่มีด่านเลย — `AdminOnly` ฝั่งหน้าเว็บซ่อนแค่เมนู ใครยิงตรงมาก็แก้ได้
 * ตอนที่แก้ได้แค่ชื่อในรายชื่อ ความเสียหายจำกัด แต่ตอนนี้การปิดพนักงานหนึ่งคน
 * คือการตัดสิทธิ์เข้าระบบของเขา
 */
function employeeWriter(): array
{
    StockModule::boot();
    $actor = Auth::require();
    Roles::require(Roles::manageAdmins((string) $actor['role']), 'จัดการพนักงาน');
    return $actor;
}

GET('/api/employees', function () {
    StockModule::boot();
    Auth::require();

    /* LEFT JOIN ทั้งที่ FK บังคับให้มีคู่เสมอ — ระเบียนที่หลุดกฎ (นำเข้าค้างกลางคัน
       ฐานที่ยังไม่ผ่าน 027) ต้องยังโผล่ในรายชื่อพร้อมช่องบัญชีว่าง ดีกว่าหายไปเงียบ ๆ */
    return Db::all(
        'SELECT e.*, a.id AS account_id, a.username AS account_username,
                a.role AS account_role, a.is_active AS account_active
           FROM employees e
           LEFT JOIN admins a ON a.employee_id = e.id
          ORDER BY e.active DESC, e.employee_name'
    );
});

POST('/api/employees', function (array $req) {
    employeeWriter();
    $body = $req['body'];
    if (str_or($body['employee_name'] ?? null) === '') {
        bad('กรุณากรอกชื่อเล่นพนักงาน');
    }

    /* ทรานแซกชันเดียวกับการสร้างแถวเงา — พนักงานที่ไม่มีแถวคู่คือพนักงานที่รับของ
       ไม่ได้และให้บัญชีไม่ได้ ครึ่งทางจึงแย่กว่าไม่สำเร็จเลย */
    return Db::tx(function ($q) use ($body) {
        $r = $q->run(
            'INSERT INTO employees (employee_name, first_name, last_name, sex, birth_date, roles, active)
             VALUES (?,?,?,?,?,?,1)',
            str_or($body['employee_name']),
            nul($body['first_name'] ?? null),
            nul($body['last_name'] ?? null),
            nul($body['sex'] ?? null),
            nul($body['birth_date'] ?? null),
            nul($body['roles'] ?? null)
        );
        $id = (int) $r['insertId'];

        Users::ensureFor($id, str_or($body['employee_name']), nul($body['roles'] ?? null), true);

        return $q->get('SELECT * FROM employees WHERE id = ?', $id);
    });
});

PUT('/api/employees/:id', function (array $req) {
    $actor = employeeWriter();
    $id    = int_or($req['params']['id']);
    $body  = $req['body'];
    if (!Db::get('SELECT id FROM employees WHERE id = ?', $id)) {
        missing();
    }

    $name   = str_or($body['employee_name'] ?? null);
    $roles  = nul($body['roles'] ?? null);
    $active = boolInt($body['active'] ?? null);

    return Db::tx(function ($q) use ($id, $body, $name, $roles, $active, $actor) {
        $q->run(
            'UPDATE employees SET employee_name=?, first_name=?, last_name=?, sex=?,
               birth_date=?, roles=?, active=? WHERE id=?',
            $name,
            nul($body['first_name'] ?? null),
            nul($body['last_name'] ?? null),
            nul($body['sex'] ?? null),
            nul($body['birth_date'] ?? null),
            $roles,
            $active,
            $id
        );

        /* โยนออกมาจากในทรานแซกชันได้ — Db::tx ย้อนทั้งชุดให้ พนักงานที่ปิดไม่ได้
           เพราะบัญชีเขาเป็นเจ้าของร้านคนสุดท้าย จึงต้องไม่ถูกปิดครึ่งทาง */
        Users::syncFromEmployee($id, $name, $roles, $active === 1, (int) $actor['id']);

        return $q->get('SELECT * FROM employees WHERE id = ?', $id);
    });
});
```

- [ ] **Step 2: ยิงเส้นทางโดยไม่ล็อกอิน เพื่อดูว่าด่านทำงาน**

รัน API หน้าร้านบนพอร์ต 8095 ตามวิธีปกติ แล้ว:

```
curl -s -o - -w "\n%{http_code}\n" -X PUT http://127.0.0.1:8095/api/employees/12 -H "Content-Type: application/json" -d "{\"employee_name\":\"hack\",\"active\":0}"
```

คาดว่า: HTTP 401 พร้อม JSON บอกว่ายังไม่ได้ล็อกอิน — **ไม่ใช่** 200

```
curl -s -o - -w "\n%{http_code}\n" http://127.0.0.1:8095/api/employees
```

คาดว่า: HTTP 401 เช่นกัน

- [ ] **Step 3: ยิงด้วยคุกกี้ของเจ้าของร้าน เพื่อดูว่าใช้งานได้จริง**

**ต้องขอรหัสผ่านของ `test.owner` จากผู้ใช้ก่อน** — รหัสของบัญชี `test.*` เป็นสตริงสุ่ม
แบบ `xxxx-xxxx-xxxx-xxxx` ตั้งแต่ 2026-09-03 ไม่ใช่ `1234` และ **ห้ามรัน
`stock/api/bin/seed-test-accounts.php` เพื่อ "แก้" การล็อกอินที่ล้ม** สคริปต์นั้นรีเซ็ตรหัส
ทั้งห้าบัญชีกลับเป็น `1234` = ล้มการปิดช่องโหว่ที่ผู้ใช้ตั้งใจทำ ถ้ารหัสถูกพิมพ์ลงในบทสนทนา
ให้เตือนผู้ใช้เปลี่ยนรหัสหลังงานเสร็จ

```
curl -s -c cookies.txt -X POST http://127.0.0.1:8095/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"test.owner\",\"password\":\"<รหัสที่ผู้ใช้ให้มา>\"}"
curl -s -b cookies.txt http://127.0.0.1:8095/api/employees | head -c 400
```

คาดว่า: JSON ของพนักงาน แต่ละแถวมีคีย์ `account_id` `account_username` `account_role`
`account_active`

- [ ] **Step 4: ทดสอบวงจรเต็มด้วยมือ**

```
curl -s -b cookies.txt -X POST http://127.0.0.1:8095/api/employees -H "Content-Type: application/json" -d "{\"employee_name\":\"ทดสอบวงจร\",\"roles\":\"technician\"}"
```

จดเลข `id` ที่ได้ แล้วตรวจว่ามีแถวเงาเกิดขึ้น:

```
& "C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -h127.0.0.1 -uroot timeoptic -e "SELECT a.id, a.employee_id, a.display_name, a.job_title, a.username, a.is_active FROM admins a WHERE a.employee_id = <id ที่ได้>;"
```

คาดว่า: หนึ่งแถว · `display_name` = `ทดสอบวงจร` · `job_title` = `technician` ·
`username` = NULL · `is_active` = 1

ปิดพนักงานคนนั้นแล้วดูว่าบัญชีปิดตาม:

```
curl -s -b cookies.txt -X PUT http://127.0.0.1:8095/api/employees/<id> -H "Content-Type: application/json" -d "{\"employee_name\":\"ทดสอบวงจร\",\"roles\":\"technician\",\"active\":0}"
& "C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -h127.0.0.1 -uroot timeoptic -e "SELECT is_active FROM admins WHERE employee_id = <id>;"
```

คาดว่า: `is_active` = 0

เก็บกวาดแถวทดสอบ:

```
& "C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -h127.0.0.1 -uroot timeoptic -e "DELETE FROM admins WHERE employee_id = <id>; DELETE FROM employees WHERE id = <id>;"
```

- [ ] **Step 5: คอมมิต**

```bash
git add api/routes/employees.php
git commit -m "หน้าพนักงาน: ใส่ด่านสิทธิ์ และสร้างแถวบัญชีให้ทุกคนที่เพิ่มเข้ามา

สามเส้นทางนี้ไม่มีด่านตรวจสิทธิ์เลยมาตลอด — AdminOnly ฝั่งหน้าเว็บซ่อนแค่เมนู
ตอนที่แก้ได้แค่ชื่อในรายชื่อ ความเสียหายจำกัด แต่ตอนนี้การปิดพนักงานคือการตัดสิทธิ์
เข้าระบบของเขา จึงต้องมีด่านจริง

การสร้างพนักงานกับการสร้างแถวคู่ใน admins อยู่ในทรานแซกชันเดียว พนักงานที่ไม่มี
แถวคู่คือพนักงานที่รับของไม่ได้และให้บัญชีไม่ได้ ครึ่งทางแย่กว่าไม่สำเร็จเลย

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

### Task 7: ตัวนำเข้าจาก Access

**Files:**
- Modify: `api/cli/import-access.php:300-305` และ `:752-760`

**Interfaces:**
- Consumes: FK `fk_admins_employee` จาก Task 3
- Produces: `--dry-run` ผ่านโดยไม่มีแถวกำพร้า

- [ ] **Step 1: เก็บ snapshot ก่อนล้างข้อมูล**

ใน `api/cli/import-access.php` แทนสามบรรทัดนี้ (ราว ๆ บรรทัด 300–303):

```php
    /* บัญชีผู้ใช้ที่ผูกกับพนักงานเดิมต้องปลดก่อน — พนักงานชุดใหม่จาก Access เป็น
       คนละคนคนละ id การปล่อยไว้คือลิงก์ที่ชี้ไปยังคนที่ไม่มีอยู่ */
    $pdo->exec('UPDATE admins SET employee_id = NULL');
```

ด้วย:

```php
    /* ตั้งแต่ migration 027 `admins.employee_id` เป็น NOT NULL — ปลดเป็น NULL ไม่ได้
       อีกแล้ว และไม่ควรปลดด้วย เพราะแถวนั้นคือตัวตนของคนที่ ledger ชี้มา
       สิ่งที่ทำแทนคือจำไว้ว่าบัญชีไหนเป็นของพนักงานชื่ออะไร แล้วผูกกลับหลังนำเข้า */
    $keepLinks = $pdo->query(
        'SELECT a.id, e.employee_name, e.first_name, e.last_name, e.sex, e.birth_date, e.roles, e.active
           FROM admins a JOIN employees e ON e.id = a.employee_id'
    )->fetchAll(PDO::FETCH_ASSOC);
    $note(sprintf('จำการผูกบัญชีกับพนักงานไว้ %d รายการ', count($keepLinks)));
```

- [ ] **Step 2: ผูกกลับหลังใส่พนักงานชุดใหม่**

แทนบล็อก `// ---- ผูกบัญชีผู้ใช้กับพนักงาน` (ราว ๆ บรรทัด 752–760) ทั้งบล็อกด้วย:

```php
    // ------------------------------------------ ผูกบัญชีผู้ใช้กับพนักงานคืน
    /* สามชั้นตามลำดับความมั่นใจ: ชื่อที่ตรงกับพนักงานชุดใหม่ → สร้างพนักงานคืน
       จาก snapshot → แถวเงาให้พนักงานที่ Access นำเข้ามาแต่ยังไม่มีบัญชี
       เดาผิดแล้วยอดขายไปโผล่ชื่อคนอื่น จึงเดาแค่ชั้นแรกและเดาแบบตรงตัวอักษรเท่านั้น */
    $relink = $pdo->prepare('UPDATE admins SET employee_id = ? WHERE id = ?');
    $findEmp = $pdo->prepare('SELECT id FROM employees WHERE employee_name = ? LIMIT 1');
    $newEmp = $pdo->prepare(
        'INSERT INTO employees (employee_name, first_name, last_name, sex, birth_date, roles, active)
         VALUES (?,?,?,?,?,?,?)'
    );

    $matched = 0;
    $recreated = 0;
    foreach ($keepLinks as $link) {
        $findEmp->execute([$link['employee_name']]);
        $empId = $findEmp->fetchColumn();

        if ($empId === false) {
            $newEmp->execute([
                $link['employee_name'], $link['first_name'], $link['last_name'],
                $link['sex'], $link['birth_date'], $link['roles'], $link['active'],
            ]);
            $empId = (int) $pdo->lastInsertId();
            $recreated++;
        } else {
            $empId = (int) $empId;
            $matched++;
        }

        $relink->execute([$empId, (int) $link['id']]);
    }
    $note(sprintf('  ผูกบัญชีคืน %d บัญชี (สร้างพนักงานคืนให้ %d คนที่ Access ไม่มีแล้ว)', $matched, $recreated));

    /* พนักงานจาก Access ที่ยังไม่มีแถวในบัญชี — สร้างแถวเงาให้ คำสั่งเดียวกับ
       ขั้นที่ 2 ของ migration 027 เพราะเป็นกฎเดียวกัน ไม่ใช่เรื่องบังเอิญคล้ายกัน */
    $shadows = $pdo->exec(
        "INSERT INTO admins (employee_id, display_name, job_title, role, is_active)
         SELECT e.id, e.employee_name, LEFT(e.roles, 120), 'sales', e.active
           FROM employees e LEFT JOIN admins a ON a.employee_id = e.id
          WHERE a.id IS NULL"
    );
    $note(sprintf('  สร้างแถวบัญชีให้พนักงานที่ยังไม่มี %d คน', (int) $shadows));

    /* ด่านสุดท้ายก่อน commit — ถ้าเหลือแถวกำพร้าแม้แถวเดียว ทั้งการนำเข้าต้องล้ม
       ไม่ใช่ผ่านแล้วค่อยไปพบทีหลังว่ารายงานผลงานพนักงานว่างเปล่า */
    $orphans = (int) $pdo->query(
        'SELECT COUNT(*) FROM admins a LEFT JOIN employees e ON e.id = a.employee_id WHERE e.id IS NULL'
    )->fetchColumn();
    if ($orphans > 0) {
        throw new RuntimeException("เหลือบัญชีที่ไม่มีพนักงานรองรับ {$orphans} แถว — ย้อนกลับทั้งชุด");
    }
```

- [ ] **Step 3: รัน dry-run กับข้อมูลจริง**

ตัวนำเข้าอ่าน **CSV ที่ export มาจาก .accdb** ไม่ใช่ไฟล์ .accdb ตรง ๆ (PHP บน Windows
ต้องการ ODBC driver ที่ bitness ตรงกัน การ export จึงอยู่ใน `api/cli/export-access.ps1`)
ขั้นตอนเต็มอยู่ในสกิล `timeoptic-access-import` — **เรียกสกิลนั้นแทนการเดาคำสั่งเอง**
ถ้ามีโฟลเดอร์ CSV ที่ export ไว้แล้ว รันตรงได้ด้วย:

```
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe" api/cli/import-access.php --csv=<โฟลเดอร์ CSV> --dry-run
```

ไฟล์ต้นทางคือ `C:\Users\USER\Downloads\TimeOptic3.9_Backend\TimeOptic3.9_Backend.accdb`
และต้องอ่านผ่าน **สำเนา** เท่านั้น

คาดว่า: จบด้วย `*** DRY RUN — ย้อนกลับทั้งหมดแล้ว ฐานข้อมูลไม่ถูกแก้ ***`
และในผลลัพธ์ต้องเห็นทั้งสามบรรทัด: `จำการผูกบัญชีกับพนักงานไว้ 24 รายการ` ·
`ผูกบัญชีคืน …` · `สร้างแถวบัญชีให้พนักงานที่ยังไม่มี …`
**ต้องไม่มี** `เหลือบัญชีที่ไม่มีพนักงานรองรับ`

- [ ] **Step 4: ยืนยันว่าฐานไม่ถูกแตะ**

```
& "C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -h127.0.0.1 -uroot timeoptic -e "SELECT (SELECT COUNT(*) FROM admins) admins, (SELECT COUNT(*) FROM employees) employees, (SELECT COUNT(*) FROM admins WHERE employee_id IS NULL) orphan;"
```

คาดว่า: ตัวเลขเท่ากับหลัง Task 3 ทุกช่อง

- [ ] **Step 5: คอมมิต**

```bash
git add api/cli/import-access.php
git commit -m "ตัวนำเข้า Access: รักษาการผูกบัญชีกับพนักงานข้ามการนำเข้า

UPDATE admins SET employee_id = NULL ล้มทันทีที่คอลัมน์เป็น NOT NULL และไม่ควรทำ
อยู่แล้ว เพราะแถวนั้นคือตัวตนที่ ledger ชี้มา แทนด้วยการจำชื่อพนักงานของแต่ละบัญชี
ไว้ก่อนล้าง แล้วผูกกลับสามชั้น: ชื่อที่ตรงกัน → สร้างพนักงานคืนจากที่จำไว้ →
แถวเงาให้คนที่ Access นำเข้ามาใหม่ · ด่านนับแถวกำพร้าก่อน commit

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

### Task 8: หน้า `/users`

**Files:**
- Modify: `frontend-next/app/(frontdesk)/users/page.jsx` (ทั้งไฟล์ ยกเว้น `PolicyCard`)

**Interfaces:**
- Consumes: `GET /stock-api/users` (รูปแบบใหม่จาก Task 4) · `POST /stock-api/employees/{employeeId}/account` ·
  `POST /stock-api/users/{id}/update` · `POST /stock-api/users/{id}/password` · `POST /stock-api/users/{id}/revoke`
- Produces: หน้าจอที่ไม่มีปุ่มเพิ่มผู้ใช้ · ปุ่ม `สร้างบัญชีเข้าใช้งาน` บนแถวที่ยังไม่มีบัญชี

- [ ] **Step 1: แก้ `UsersInner` — ตัวกรอง ตาราง และการ์ด**

แทนตัว `function UsersInner()` เดิมด้วย:

```jsx
/* สามสถานะที่คนดูหน้านี้อยากกรอง — ตัวเลขบนปุ่มนับจากรายชื่อทั้งหมด ไม่ใช่จากผลค้นหา
   แบบเดียวกับหน้าพนักงาน ไม่งั้นตัวเลขจะกระโดดทุกตัวอักษรที่พิมพ์ */
const HAS = [
  ['', 'ทั้งหมด'],
  ['yes', 'มีบัญชี'],
  ['no', 'ยังไม่มีบัญชี'],
];

function UsersInner() {
  const { actor } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.get('/stock-api/users'), []);
  const [editing, setEditing] = useState(null);
  const [granting, setGranting] = useState(null);
  const [term, setTerm] = useState('');
  const [has, setHas] = useState('');

  const rows = data?.users || [];

  const counts = useMemo(() => ({
    '': rows.length,
    yes: rows.filter((r) => r.hasAccount).length,
    no: rows.filter((r) => !r.hasAccount).length,
  }), [rows]);

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (has === 'yes' && !r.hasAccount) return false;
      if (has === 'no' && r.hasAccount) return false;
      if (!q) return true;
      return [r.employeeName, r.username, r.jobTitle, r.roleLabel]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [rows, term, has]);

  if (loading) return <Loading />;

  return (
    <>
      <PageHead icon="lock" title="Users & Roles" subtitle="ผู้ใช้และสิทธิ์" />

      {error && (
        <Card>
          <p className="muted">{error.message}</p>
          <button type="button" className="btn" onClick={reload}>ลองใหม่</button>
        </Card>
      )}

      {!error && (
        <>
          <Toolbar className="crud-tools">
            <Field label="ค้นหา" className="grow crud-search">
              <input
                type="search"
                placeholder="ค้นหา ชื่อพนักงาน / ชื่อผู้ใช้ / หน้าที่ / สิทธิ์"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </Field>
            <div className="seg seg-sm">
              {HAS.map(([value, label]) => (
                <button
                  type="button"
                  key={value || 'all'}
                  className={has === value ? 'active' : ''}
                  aria-pressed={has === value}
                  onClick={() => setHas(value)}
                >
                  {label}
                  <Badge kind="gray">{counts[value] ?? 0}</Badge>
                </button>
              ))}
            </div>
          </Toolbar>

          <Card
            title="รายชื่อพนักงานและบัญชี"
            badge={<Badge kind="gray">{`${shown.length} คน`}</Badge>}
            tight
          >
            {/* ไม่มีปุ่มเพิ่มบนหัวการ์ดนี้อีกแล้ว — ปุ่มที่หายไปอธิบายตัวเองไม่ได้
                ประโยคนี้จึงบอกแทนว่าคนใหม่เพิ่มที่ไหน */}
            <p className="muted" style={{ margin: '0 0 10px' }}>
              รายชื่อนี้คือพนักงานทุกคนในร้าน — เพิ่มคนใหม่ที่
              {' '}<a href="/employees/">หน้าพนักงาน</a>{' '}
              แล้วกลับมาสร้างบัญชีให้ที่นี่ · บัญชีเข้าใช้งานที่ไม่มีพนักงานรองรับ สร้างไม่ได้
            </p>

            <DataTable
              className="data-grid"
              /* คนที่ลาออกแล้วยังต้องอ่านได้ (ประวัติชี้มาที่ชื่อนี้) แต่ไม่ควรอ่าน
                 เท่ากับคนที่ยังทำงานอยู่ — แถบซ้ายสีเทาบอกโดยไม่ต้องอ่านคอลัมน์สถานะ */
              rowClass={(u) => (u.employeeActive ? '' : 'row-gray')}
              sortable
              columns={[
                { label: 'ชื่อพนักงาน', key: 'employeeName', mobile: 'title' },
                { label: 'หน้าที่', key: 'jobTitle', mobile: 'meta' },
                {
                  label: 'ชื่อผู้ใช้',
                  sortKey: 'username',
                  cls: 'mono',
                  mobile: 'subtitle',
                  render: (u) => (u.username || <span className="muted">—</span>),
                },
                {
                  label: 'สิทธิ์',
                  sortKey: 'role',
                  mobile: 'body',
                  /* บทบาทของแถวที่ยังไม่มีบัญชีเป็นค่าตั้งต้นที่ไม่มีผลกับอะไรเลย
                     แสดงไปก็มีแต่คนเชื่อว่าคนนี้ถือสิทธิ์นั้นอยู่ */
                  render: (u) => (u.hasAccount ? <Badge kind="blue">{u.roleLabel}</Badge> : null),
                },
                {
                  label: 'สถานะ',
                  sortKey: (u) => (u.employeeActive ? (u.hasAccount ? (u.isActive ? 3 : 2) : 1) : 0),
                  mobile: 'status',
                  render: (u) => {
                    if (!u.employeeActive) return <Badge kind="gray">ลาออกแล้ว</Badge>;
                    if (!u.hasAccount) return <Badge kind="warn">ยังไม่มีบัญชี</Badge>;
                    return u.isActive
                      ? <Badge kind="ok">ล็อกอินได้</Badge>
                      : <Badge kind="gray">บัญชีปิดใช้งาน</Badge>;
                  },
                },
                {
                  label: 'รายการที่ทำ',
                  sortKey: 'movements',
                  cls: 'num',
                  mobile: 'body',
                  render: (u) => count(u.movements),
                },
                {
                  label: 'เข้าล่าสุด',
                  sortKey: 'lastLoginAt',
                  cls: 'nowrap',
                  mobile: 'body',
                  render: (u) => (u.lastLoginAt
                    ? fmtDateTime(u.lastLoginAt)
                    : <span className="muted">ยังไม่เคยเข้า</span>),
                },
                {
                  label: '',
                  cls: 'nowrap',
                  mobile: 'extra',
                  /* คนที่ลาออกแล้วไม่มีปุ่มสร้าง — API ปฏิเสธอยู่แล้ว การโชว์ปุ่มที่
                     จะถูกปฏิเสธแน่ ๆ คือการหลอกให้กดแล้วไปเจอข้อความปฏิเสธ */
                  render: (u) => {
                    if (u.hasAccount) {
                      return (
                        <button type="button" className="btn btn-sm btn-light" onClick={() => setEditing(u)}>
                          <Icon name="pencil" /> แก้ไข
                        </button>
                      );
                    }
                    if (!u.employeeActive) return null;
                    return (
                      <button type="button" className="btn btn-sm" onClick={() => setGranting(u)}>
                        <Icon name="userCheck" /> สร้างบัญชีเข้าใช้งาน
                      </button>
                    );
                  },
                },
              ]}
              rows={shown}
              empty={term.trim() || has ? 'ไม่พบคนที่ตรงกับที่ค้นหา' : 'ยังไม่มีพนักงานในระบบ'}
            />
          </Card>
        </>
      )}

      <PolicyCard />

      {granting && (
        <GrantDialog
          key={`grant-${granting.employeeId}`}
          user={granting}
          actor={actor}
          onClose={() => setGranting(null)}
          onSaved={() => { setGranting(null); reload(); }}
        />
      )}

      {editing && (
        <AccountDialog
          key={`edit-${editing.id}`}
          user={editing}
          actor={actor}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}
```

แก้บรรทัด import ที่หัวไฟล์เป็น:

```jsx
import { useEffect, useMemo, useState } from 'react';
```

และเพิ่ม `Toolbar` เข้าไปใน import จาก `ui.jsx`:

```jsx
import { Badge, Card, Field, Fieldset, FormGrid, Loading, PageHead, Toolbar } from '../../../components/ui.jsx';
```

- [ ] **Step 2: แทน `UserDialog` ด้วยสองกล่อง**

ลบ `function UserDialog(...)` ทั้งฟังก์ชัน แล้วใส่แทนด้วย:

```jsx
/* Esc ปิดกล่อง — ทางออกเดียวกับป๊อปอัปอื่นทั้งระบบ · สองกล่องข้างล่างใช้ร่วมกัน */
function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/* ชื่อกับหน้าที่ไม่ใช่ช่องกรอกในสองกล่องนี้ — มันมาจากหน้าพนักงาน แสดงไว้ให้รู้ว่า
   กำลังทำให้ใคร พร้อมทางไปแก้ ถ้าชื่อผิด */
function WhoIsThis({ user }) {
  return (
    <div className="note" style={{ marginBottom: 12 }}>
      <b>{user.employeeName}</b>
      {user.jobTitle ? <span className="muted"> · {user.jobTitle}</span> : null}
      <div className="muted">
        ชื่อและหน้าที่แก้ได้ที่ <a href="/employees/">หน้าพนักงาน</a> ที่เดียว
      </div>
    </div>
  );
}

/**
 * กล่องสร้างบัญชีเข้าใช้งานให้พนักงานที่มีอยู่แล้ว
 *
 * แยกจากกล่องแก้ไขเพราะสองงานนี้กรอกคนละชุด: ตอนสร้างต้องมีรหัสผ่านเสมอ ตอนแก้
 * ต้องไม่มีช่องรหัสผ่านปนอยู่กับช่องอื่น (กดบันทึกแล้วรหัสเปลี่ยนโดยไม่ตั้งใจ)
 */
function GrantDialog({ user, actor, onClose, onSaved }) {
  const { ok } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('sales');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const grantable = ROLES.filter((r) => r.rank <= (RANK_OF[actor?.role] ?? 0));

  useEscape(onClose);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/stock-api/employees/${user.employeeId}/account`, {
        username: username.trim(),
        password,
        role,
      });
      ok(`สร้างบัญชีให้ ${user.employeeName} แล้ว — เข้าระบบด้วยชื่อผู้ใช้ ${username.trim()}`);
      onSaved();
    } catch (ex) {
      setProblem(ex.message || 'สร้างบัญชีไม่สำเร็จ');
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <h3>สร้างบัญชีเข้าใช้งานให้ {user.employeeName}</h3>
        <form onSubmit={save} noValidate>
          <div className="m-body">
            <WhoIsThis user={user} />
            <div className="form-2col">
              <FormGrid>
                <Field label="ชื่อผู้ใช้" hint="a–z 0–9 . - _ ยาว 3–64 ตัว">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={busy}
                    autoFocus
                    autoComplete="off"
                  />
                </Field>
                <Field label="สิทธิ์" hint={ROLES.find((r) => r.key === role)?.note}>
                  <Select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={busy}
                    options={grantable.map((r) => [r.key, r.label])}
                  />
                </Field>
                <Field label="รหัสผ่าน" className="full" hint="อย่างน้อย 10 ตัวอักษร">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    autoComplete="new-password"
                  />
                </Field>
              </FormGrid>
            </div>
            {problem && <div className="note danger" role="alert">{problem}</div>}
          </div>
          <div className="m-foot">
            <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className="btn" type="submit" disabled={busy || !username.trim() || !password}>
              <Icon name="userCheck" /> {busy ? 'กำลังสร้าง…' : 'สร้างบัญชี'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * กล่องแก้บัญชีที่มีอยู่แล้ว
 *
 * สามส่วนเรียงลงมา: ข้อมูลบัญชี · ตั้งรหัสผ่านใหม่ · ยกเลิกบัญชี — เรียงตามความ
 * ย้อนกลับไม่ได้ จากน้อยไปมาก ปุ่มยกเลิกบัญชีจึงไม่อยู่ในระยะที่นิ้วที่เล็งปุ่ม
 * "บันทึก" จะโดน
 */
function AccountDialog({ user, actor, onClose, onSaved }) {
  const isSelf = user?.id === actor?.id;
  const { ok } = useToast();

  const [username, setUsername] = useState(user?.username ?? '');
  const [role, setRole] = useState(user?.role ?? 'sales');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  /* แยกจาก `problem` เพราะข้อความของฟอร์มอยู่เหนือกล่องนี้ขึ้นไปสองบล็อก
     เหตุผลที่ยกเลิกไม่ได้คือสิ่งที่ต้องอ่าน — วางไว้ตรงปุ่มที่เพิ่งกด */
  const [revokeProblem, setRevokeProblem] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const grantable = ROLES.filter((r) => r.rank <= (RANK_OF[actor?.role] ?? 0));

  useEscape(onClose);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/stock-api/users/${user.id}/update`, {
        username: username.trim(),
        role,
        is_active: isActive,
      });
      ok(isActive
        ? `แก้บัญชีของ ${user.employeeName} แล้ว`
        : `แก้บัญชีของ ${user.employeeName} แล้ว — บัญชีนี้ปิดใช้งานอยู่ เข้าระบบไม่ได้`);
      onSaved();
    } catch (ex) {
      setProblem(ex.message || 'บันทึกไม่สำเร็จ');
      setBusy(false);
    }
  }

  async function setPasswordOnly() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/stock-api/users/${user.id}/password`, { password });
      ok(`ตั้งรหัสผ่านใหม่ให้ ${user.employeeName} แล้ว`);
      setPassword('');
    } catch (ex) {
      setProblem(ex.message || 'ตั้งรหัสผ่านไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setRevokeProblem(null);
    try {
      await api.post(`/stock-api/users/${user.id}/revoke`, {});
      ok(`ยกเลิกบัญชีของ ${user.employeeName} แล้ว — ชื่อยังอยู่ในประวัติครบ`);
      onSaved();
    } catch (ex) {
      setRevokeProblem(ex.message || 'ยกเลิกบัญชีไม่สำเร็จ');
      setConfirmRevoke(false);
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <h3>บัญชีของ {user.employeeName}</h3>
        <form onSubmit={save} noValidate>
          <div className="m-body">
            <WhoIsThis user={user} />
            <div className="form-2col">
              <FormGrid>
                <Field label="ชื่อผู้ใช้">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={busy}
                    autoFocus
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label="สิทธิ์"
                  hint={isSelf ? 'ลดสิทธิ์ตัวเองไม่ได้' : ROLES.find((r) => r.key === role)?.note}
                >
                  <Select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={busy || isSelf}
                    options={grantable.map((r) => [r.key, r.label])}
                  />
                </Field>
                <Field
                  label="สถานะ"
                  className="full"
                  hint={isSelf
                    ? 'ปิดบัญชีตัวเองไม่ได้'
                    : 'ปิดบัญชีชั่วคราวโดยที่คนยังเป็นพนักงานอยู่ — คนที่ลาออกให้ปิดที่หน้าพนักงาน บัญชีจะปิดตามเอง'}
                >
                  <Select
                    value={isActive ? '1' : '0'}
                    onChange={(e) => setIsActive(e.target.value === '1')}
                    disabled={busy || isSelf}
                    options={[['1', 'ใช้งานอยู่'], ['0', 'ปิดใช้งาน']]}
                  />
                </Field>
              </FormGrid>
            </div>

            {problem && <div className="note danger" role="alert">{problem}</div>}

            <Fieldset legend="ตั้งรหัสผ่านใหม่">
              <Field label="รหัสผ่านใหม่">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="อย่างน้อย 10 ตัวอักษร"
                  disabled={busy}
                  autoComplete="new-password"
                />
              </Field>
              <button
                type="button"
                className="btn btn-sm btn-light"
                onClick={setPasswordOnly}
                disabled={busy || !password}
              >
                <Icon name="lock" /> ตั้งรหัสผ่าน
              </button>
            </Fieldset>

            {!isSelf && (
              <Fieldset legend="ยกเลิกบัญชีเข้าใช้งาน">
                {revokeProblem && <div className="note danger" role="alert">{revokeProblem}</div>}
                {confirmRevoke ? (
                  <>
                    <p className="muted">
                      {user.employeeName} จะเข้าระบบไม่ได้อีก — ชื่อยังอยู่ในทุกรายการที่เขาเคยคีย์
                      และเปิดบัญชีใหม่ให้เขาได้ทุกเมื่อ
                    </p>
                    <div className="row">
                      <button type="button" className="btn btn-sm btn-danger" onClick={revoke} disabled={busy}>
                        <Icon name="userX" /> ยืนยันยกเลิกบัญชี
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        onClick={() => setConfirmRevoke(false)}
                        disabled={busy}
                      >
                        ไม่ยกเลิก
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-light"
                      onClick={() => setConfirmRevoke(true)}
                      disabled={busy}
                    >
                      <Icon name="userX" /> ยกเลิกบัญชีนี้
                    </button>
                    <p className="muted" style={{ marginBottom: 0 }}>
                      เอาชื่อผู้ใช้กับรหัสผ่านคืน โดยที่คนยังเป็นพนักงานอยู่ — ต่างจากการปิดใช้งาน
                      ตรงที่ต้องตั้งรหัสใหม่ถ้าจะให้กลับเข้ามา
                    </p>
                  </>
                )}
              </Fieldset>
            )}
          </div>

          <div className="m-foot">
            <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className="btn" type="submit" disabled={busy || !username.trim()}>
              <Icon name="check" /> {busy ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: แก้คอมเมนต์หัวไฟล์ให้ตรงกับความจริงใหม่**

แทนบล็อกคอมเมนต์หัวไฟล์ด้วย:

```jsx
/**
 * ผู้ใช้และสิทธิ์ — พนักงานทุกคน กับบัญชีเข้าใช้งานของแต่ละคน
 *
 * ── แถวในตารางนี้คือพนักงาน ไม่ใช่บัญชี ────────────────────────────────────
 * ตั้งแต่ migration 027 ทุกแถวใน `admins` ต้องผูกกับ `employees` หนึ่งแถวเสมอ
 * (NOT NULL + FOREIGN KEY) หน้านี้จึงไม่มีปุ่มเพิ่มผู้ใช้ — คนใหม่เพิ่มที่หน้าพนักงาน
 * แล้วกลับมาที่นี่เพื่อให้สิทธิ์เข้าใช้งาน · สองงานนี้แยกกันเพราะ "รับคนเข้าทำงาน"
 * กับ "ให้คนนั้นเปิดคอมพิวเตอร์ของร้านได้" เป็นคนละการตัดสินใจของคนละวัน
 *
 * ── ทำไม path ของ API ยังขึ้นต้นด้วย /stock-api ──────────────────────────
 * กฎสิทธิ์ทั้งชุดอยู่ในโค้ดฝั่งคลัง (`stock/api/src/Service/Users.php`, `Roles.php`)
 * และเส้นทางของมันลงทะเบียนไว้ใต้ `/stock-api` · ที่ย้ายคือหน้าจอ ไม่ใช่ API —
 * ย้าย API ตามด้วยแปลว่าต้องมีสองที่ที่ตัดสินเรื่องสิทธิ์ ซึ่งเป็นสิ่งเดียวที่ห้ามมีสองที่
 *
 * ── สิ่งที่หน้านี้ไม่ได้ตัดสินเอง ────────────────────────────────────────
 * `AdminOnly` เป็นแค่คำอธิบายให้คนอ่าน · ด่านจริงคือ `Roles::require()` ใน API
 * ซึ่งตรวจทุกคำขอไม่ว่าหน้าเว็บจะวาดอะไร
 */
```

- [ ] **Step 4: รันหน้าเว็บแล้วดูด้วยตา**

เปิด `next dev` ตามวิธีปกติแล้วเข้า `http://localhost:3010/users/` ด้วยบัญชีเจ้าของร้าน
ตรวจว่า:
- ไม่มีปุ่ม "+ เพิ่มผู้ใช้" ที่มุมขวาบนของการ์ด
- มีชื่อพนักงานจาก Access ครบ (Tik, Pom, Gee, Meaw, Bow, Yean, Ja, New, Kaning, BukBank, Mild, Khaw, Ray)
- แถวพวกนั้นขึ้น `ยังไม่มีบัญชี` และมีปุ่ม `สร้างบัญชีเข้าใช้งาน`
- แถว `owner` ขึ้น `ล็อกอินได้` และมีปุ่ม `แก้ไข`
- ปุ่มกรอง `ยังไม่มีบัญชี` ขึ้นตัวเลข 18

- [ ] **Step 5: ทดสอบวงจรสร้าง–ยกเลิกบนหน้าจอ**

กด `สร้างบัญชีเข้าใช้งาน` ที่แถวของ `Ray` → กรอกชื่อผู้ใช้ `ray.test` รหัส `a-strong-password`
สิทธิ์ `พนักงานขาย` → บันทึก · คาดว่าแถวเปลี่ยนเป็น `ล็อกอินได้` ทันที
จากนั้นกด `แก้ไข` → `ยกเลิกบัญชีนี้` → `ยืนยันยกเลิกบัญชี` · คาดว่าแถวกลับไปเป็น `ยังไม่มีบัญชี`

- [ ] **Step 6: คอมมิต**

```bash
git add "frontend-next/app/(frontdesk)/users/page.jsx"
git commit -m "หน้าผู้ใช้และสิทธิ์: แถวคือพนักงาน ไม่ใช่บัญชี

ปุ่มเพิ่มผู้ใช้หายไปเพราะสร้างผู้ใช้ลอย ๆ ไม่ได้อีกแล้ว — ประโยคใต้หัวการ์ดบอกแทน
ว่าคนใหม่เพิ่มที่ไหน ปุ่มที่หายไปอธิบายตัวเองไม่ได้

กล่องเดียวถูกแยกเป็นสอง: สร้างบัญชีต้องมีรหัสผ่านเสมอ ส่วนกล่องแก้ไขต้องไม่มีช่อง
รหัสผ่านปนอยู่กับช่องอื่น ไม่งั้นกดบันทึกแล้วรหัสเปลี่ยนโดยไม่ได้ตั้งใจ
คอลัมน์สิทธิ์ว่างสำหรับคนที่ยังไม่มีบัญชี ค่านั้นไม่มีผลกับอะไร แสดงไปมีแต่คนเชื่อ

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

### Task 9: หน้า `/employees`

**Files:**
- Modify: `frontend-next/app/(frontdesk)/employees/page.jsx`

**Interfaces:**
- Consumes: `GET /api/employees` รูปแบบใหม่จาก Task 6 (`account_username`, `account_role`, `account_active`)

- [ ] **Step 1: เพิ่มคอลัมน์บัญชี**

ใน `columns` ของ `DataTable` แทรกคอลัมน์นี้ก่อนคอลัมน์ `สถานะ`:

```jsx
            {
              label: 'บัญชีเข้าใช้งาน',
              sortKey: 'account_username',
              mobile: 'body',
              render: (r) => (r.account_username
                ? (
                  <>
                    <span className="mono">{r.account_username}</span>
                    {Number(r.account_active) ? null : <Badge kind="gray">ปิดอยู่</Badge>}
                  </>
                )
                : <Badge kind="warn">ยังไม่มีบัญชี</Badge>),
            },
```

- [ ] **Step 2: เพิ่มลิงก์ไปหน้าผู้ใช้บนหัวการ์ด**

แทน prop `right` ของ `<Card title="รายชื่อพนักงาน" …>` ด้วย:

```jsx
        right={(
          <>
            {/* ทางไปให้สิทธิ์ อยู่ติดกับปุ่มรับคนเข้าทำงาน เพราะสองงานนี้มักเกิดต่อกัน
                แต่ไม่ใช่งานเดียวกัน — การรับคนไม่ได้แปลว่าให้เขาเปิดคอมของร้านได้ */}
            <a className="btn btn-sm btn-light" href="/users/">
              <Icon name="lock" /> ผู้ใช้และสิทธิ์
            </a>
            <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
              <Icon name="plus" /> เพิ่มพนักงาน
            </button>
          </>
        )}
```

- [ ] **Step 3: แก้ข้อความยืนยันตอนปิดใช้งาน**

แทนฟังก์ชัน `toggle` ด้วย:

```jsx
  /* ปิดใช้งาน = เอาชื่อออกจากช่องเลือกพนักงานทุกหน้า **และ** ปิดบัญชีเข้าใช้งานของ
     คนนั้นไปด้วย ซึ่งเป็นผลที่คนกดต้องรู้ก่อนกด · เปิดกลับไม่ปิดอะไร แต่ก็ไม่คืน
     บัญชีให้เอง จึงต้องบอกว่าไปเปิดต่อที่ไหน */
  const toggle = async (r) => {
    const who = r.employee_name || r.first_name || `ID ${r.id}`;
    if (Number(r.active) && !await confirm(
      'ปิดใช้งานพนักงาน',
      r.account_username
        ? `${who} จะหายจากช่องเลือกพนักงานทุกหน้า และบัญชี ${r.account_username} จะถูกปิดตามทันที — ประวัติเดิมยังอยู่ครบ`
        : `${who} จะหายจากช่องเลือกพนักงานทุกหน้า — ประวัติเดิมยังอยู่ครบ`,
      { confirmText: 'ปิดใช้งาน', danger: true },
    )) return;

    try {
      await api.put('/api/employees/' + r.id, { ...r, active: Number(r.active) ? 0 : 1 });
      await reloadMeta();
      if (!Number(r.active) && r.account_username) {
        ok(`เปิดใช้งาน ${who} แล้ว — บัญชี ${r.account_username} ยังปิดอยู่ เปิดต่อที่หน้าผู้ใช้และสิทธิ์`);
      }
      reload();
    } catch (ex) {
      err(ex);
    }
  };
```

- [ ] **Step 4: ดูด้วยตา**

เข้า `http://localhost:3010/employees/` ตรวจว่า:
- ทุกแถวมีคอลัมน์ `บัญชีเข้าใช้งาน` · แถวของพนักงาน Access ขึ้น `ยังไม่มีบัญชี`
- กด `ปิดใช้งาน` ที่คนที่มีบัญชี → ข้อความยืนยันเอ่ยชื่อบัญชีที่จะถูกปิด
- ยืนยันแล้วไปดูที่ `/users/` → แถวนั้นขึ้น `ลาออกแล้ว`
- กลับมากด `เปิดใช้งาน` → toast บอกว่าบัญชียังปิดอยู่ · ที่ `/users/` แถวนั้นขึ้น `บัญชีปิดใช้งาน`

- [ ] **Step 5: คอมมิต**

```bash
git add "frontend-next/app/(frontdesk)/employees/page.jsx"
git commit -m "หน้าพนักงาน: บอกว่าใครเข้าระบบได้ และบอกก่อนกดปิด

การปิดพนักงานปิดบัญชีของเขาไปด้วย ซึ่งเป็นผลที่คนกดต้องรู้ก่อนกด ไม่ใช่หลังกด
ข้อความยืนยันจึงเอ่ยชื่อบัญชีที่จะถูกปิด และตอนเปิดกลับก็บอกว่าบัญชียังไม่คืน

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

### Task 10: e2e

**Files:**
- Modify: `frontend-next/e2e/routes.js`
- Create: `frontend-next/e2e/users.spec.js`

**Interfaces:**
- Consumes: หน้า `/users/` จาก Task 8 · `auth.setup.js` ที่ให้ storageState ของบัญชีที่ล็อกอินแล้ว

- [ ] **Step 1: เพิ่มหน้าเข้าชุดตรวจมือถือ**

ใน `frontend-next/e2e/routes.js` เพิ่มบรรทัดนี้ต่อจาก `['/employees/', 'พนักงาน'],`:

```js
  ['/users/', 'ผู้ใช้และสิทธิ์'],
```

- [ ] **Step 2: เขียนสไปรต์ที่ยังไม่ผ่าน**

สร้าง `frontend-next/e2e/users.spec.js`:

```js
/**
 * หน้าผู้ใช้และสิทธิ์ — กฎที่ต้องมองเห็นได้จากหน้าจอ ไม่ใช่แค่จาก API
 *
 * เทสต์ฝั่ง PHP พิสูจน์แล้วว่าสร้างผู้ใช้ลอย ๆ ไม่ได้ · ที่นี่พิสูจน์ว่าหน้าจอไม่ได้
 * เสนอทางที่ API จะปฏิเสธ ซึ่งเป็นคนละเรื่องกัน — ปุ่มที่กดแล้วเจอ error คือกับดัก
 */
import { test, expect } from '@playwright/test';

test.describe('ผู้ใช้และสิทธิ์', () => {
  test('ไม่มีปุ่มเพิ่มผู้ใช้ — คนใหม่เพิ่มที่หน้าพนักงาน', async ({ page }) => {
    await page.goto('/users/');
    await page.getByRole('heading', { name: 'Users & Roles' }).waitFor();

    await expect(page.getByRole('button', { name: 'เพิ่มผู้ใช้' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'หน้าพนักงาน' })).toBeVisible();
  });

  test('พนักงานที่ยังไม่มีบัญชี มีปุ่มสร้างบัญชีให้', async ({ page }) => {
    await page.goto('/users/');
    await page.getByRole('heading', { name: 'Users & Roles' }).waitFor();

    await page.getByRole('button', { name: /^ยังไม่มีบัญชี/ }).click();

    const grant = page.getByRole('button', { name: 'สร้างบัญชีเข้าใช้งาน' });
    await expect(grant.first()).toBeVisible();
  });

  test('กล่องสร้างบัญชีไม่ให้แก้ชื่อพนักงาน', async ({ page }) => {
    await page.goto('/users/');
    await page.getByRole('heading', { name: 'Users & Roles' }).waitFor();
    await page.getByRole('button', { name: /^ยังไม่มีบัญชี/ }).click();
    await page.getByRole('button', { name: 'สร้างบัญชีเข้าใช้งาน' }).first().click();

    const box = page.getByRole('dialog');
    await expect(box.getByLabel('ชื่อผู้ใช้')).toBeVisible();
    await expect(box.getByLabel('รหัสผ่าน')).toBeVisible();
    /* ชื่อกับหน้าที่เป็นข้อความ ไม่ใช่ช่องกรอก — ถ้ามีช่องพวกนี้โผล่มา แปลว่าใครสัก
       คนเปิดทางให้ตั้งชื่อคนจากสองที่อีกครั้ง */
    await expect(box.getByLabel('ชื่อที่แสดง')).toHaveCount(0);
    await expect(box.getByLabel('ตำแหน่งงาน')).toHaveCount(0);
  });
});
```

- [ ] **Step 3: รันสไปรต์**

```
cd frontend-next; npx playwright test e2e/users.spec.js
```

คาดว่า: ผ่านทั้งสามเคส · ถ้า `getByLabel` หาไม่เจอ ให้ตรวจว่า `<Field label="…">` ผูก
`<label for>` กับ input จริงหรือไม่ (ดู `components/ui.jsx:71`) แล้วแก้ selector ให้ตรงกับ
โครงที่มีจริง ไม่ใช่แก้หน้าเว็บให้เข้ากับเทสต์

- [ ] **Step 4: รันชุดตรวจมือถือทั้งหมด**

```
cd frontend-next; npx playwright test
```

คาดว่า: ผ่านทั้งหมดรวมหน้า `/users/` ที่เพิ่งเพิ่มเข้าชุด · ถ้าตารางล้นจอบนมือถือ
ให้แก้ที่คอลัมน์ `mobile:` ของ `DataTable` ในหน้า `/users/` (ย้ายคอลัมน์ที่ยาวไปเป็น
`meta` หรือ `extra`) ไม่ใช่ปิดเกณฑ์

- [ ] **Step 5: คอมมิต**

```bash
git add frontend-next/e2e/routes.js frontend-next/e2e/users.spec.js
git commit -m "e2e: หน้าผู้ใช้และสิทธิ์เข้าชุดตรวจ พร้อมกฎที่ต้องเห็นจากหน้าจอ

เทสต์ฝั่ง PHP พิสูจน์ว่าสร้างผู้ใช้ลอย ๆ ไม่ได้ · ที่นี่พิสูจน์ว่าหน้าจอไม่ได้เสนอทาง
ที่ API จะปฏิเสธ ซึ่งเป็นคนละเรื่องกัน — ปุ่มที่กดแล้วเจอ error คือกับดัก

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BFKzxdiY3ESMChZwf499dW"
```

---

## ตรวจครั้งสุดท้ายก่อนปิดงาน

- [ ] `cd stock; .\run.ps1 test` — ผ่านทุกไฟล์
- [ ] `cd frontend-next; npx playwright test` — ผ่านทุกหน้า
- [ ] SQL: `SELECT COUNT(*) FROM admins WHERE employee_id IS NULL;` = 0
- [ ] SQL: `SELECT COUNT(*) FROM admins a LEFT JOIN employees e ON e.id = a.employee_id WHERE e.id IS NULL;` = 0
- [ ] `php api/cli/import-access.php --dry-run` — ผ่าน ไม่มีแถวกำพร้า
- [ ] เปิด `/reports/employees/` แล้วดูว่ายอด POS ไม่ได้ตกอยู่ในแถว "ไม่ระบุพนักงาน" ทั้งหมด
      อีกต่อไป (นี่คือผลลัพธ์ปลายทางที่งานทั้งหมดนี้มีไว้เพื่อมัน)
- [ ] ลบไฟล์ `backup-before-027.sql` ออกจาก working tree หรือย้ายไป `backups/`
      (`.gitignore` ไม่ได้กันไฟล์ชื่อนี้ไว้ — อย่าให้ dump ที่มี hash รหัสผ่านหลุดเข้า git)
