<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\ApiError;
use Optic\Auth;
use Optic\Db;
use Optic\Roles;

/**
 * The shop's people.
 *
 * `admins` holds everyone, whether or not they sign in: a technician's work is
 * recorded against them even if they never touch the app. So a row here is an
 * employee's identity, not an account — `employees` is the master, and every
 * row in this table is required to point back at one (`employee_id NOT NULL`,
 * FK `fk_admins_employee`). `username` and `password_hash` stay optional on
 * top of that identity: granting a login is a separate act (`grantAccount()`)
 * from the person existing, and taking it away (`revokeAccount()`) is separate
 * from the person leaving.
 *
 * Rows here are never deleted. `inventory_logs.created_by` and the other
 * ledger tables point at these ids, and a movement whose author has vanished
 * is a movement nobody can account for — so there is no `delete()`. What
 * closes is the account (`revokeAccount()`) or the employee themselves, at
 * the employee screen, which `syncFromEmployee()` mirrors back here.
 *
 * ── บทบาทอยู่ที่ `admin_roles` ไม่ใช่คอลัมน์ในตารางนี้ ────────────────────
 * หนึ่งคนถือได้หลายบทบาท และสิทธิ์ที่ได้คือยูเนียน (ดู `Optic\Roles`) · ทุกทาง
 * ที่เปลี่ยนบทบาทเดินผ่าน `setRoles()` ที่เดียว ซึ่งเป็นที่เดียวที่รู้ว่าต้องเก็บ
 * `granted_at` ของบทบาทที่ถืออยู่แล้วไว้ ไม่ใช่ลบทิ้งแล้วเขียนใหม่ทั้งชุด
 */
final class Users
{
    private const MIN_PASSWORD = 10;

    /**
     * ตัวอักษรของรหัสที่ระบบสุ่มให้ — ตัด l/I/1 และ o/O/0 ออก
     *
     * รหัสนี้ถูกอ่านออกเสียงหรือจดใส่กระดาษส่งให้กันเสมอ ตัวที่แยกไม่ออกด้วยตา
     * จบลงที่ "ล็อกอินไม่ได้" ซึ่งอ่านไม่ออกว่าเพราะพิมพ์ผิดหรือเพราะระบบพัง
     */
    private const SAFE_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

    /* ──────────────────────────────────────────────────────────── อ่าน */

    /**
     * รายชื่อผู้ใช้ + พนักงานที่ยังไม่มีบัญชี
     *
     * คืนสองก้อน เพราะหน้าจอถามสองคำถามคนละเรื่อง: ตารางถามว่า "ใครเข้าระบบได้บ้าง"
     * ส่วนช่องแรกของฟอร์มเพิ่มผู้ใช้ถามว่า "ยังเหลือใครที่ยังไม่มีบัญชี" · ตอบด้วย
     * รายการเดียวแปลว่าหน้าจอต้องกรองเอง แล้วกฎว่าแถวไหนคือ "ผู้ใช้" จะมีสองชุด
     *
     * `users`      แถวที่ล็อกอินได้ หรือถือบทบาทอยู่แม้ยังไม่มีบัญชี
     * `candidates` พนักงานที่ยังใช้งานอยู่ ยังไม่มีทั้งบัญชีและบทบาท
     *
     * @param list<string> $actorRoles
     * @return array{users: list<array<string,mixed>>, candidates: list<array<string,mixed>>}
     */
    public static function list(array $actorRoles): array
    {
        Roles::require(Roles::manageAdmins($actorRoles), 'ดูรายชื่อผู้ใช้');

        $rows = Db::all(
            'SELECT a.*, e.active AS employee_active,
                    (SELECT COUNT(*) FROM inventory_logs g WHERE g.created_by = a.id) AS movements,
                    (SELECT GROUP_CONCAT(r.role) FROM admin_roles r WHERE r.admin_id = a.id) AS role_csv
               FROM admins a
               JOIN employees e ON e.id = a.employee_id
              ORDER BY a.is_active DESC, a.display_name ASC'
        );

        $users = [];
        $candidates = [];
        $ceiling = Roles::rank($actorRoles);

        foreach ($rows as $r) {
            $roles = Roles::clean(explode(',', (string) ($r['role_csv'] ?? '')));

            if ($r['username'] === null && $roles === []) {
                /* ยังไม่มีทั้งบัญชีและบทบาท — เป็นแค่ตัวตนไว้ให้ประวัติอ้างถึง
                   คนที่ลาออกไปแล้วไม่ควรโผล่ในช่องเลือกของฟอร์มเพิ่มผู้ใช้ */
                if ((bool) $r['employee_active']) {
                    $candidates[] = [
                        'id'          => (int) $r['id'],
                        'employeeId'  => (int) $r['employee_id'],
                        'displayName' => $r['display_name'],
                        'jobTitle'    => $r['job_title'],
                    ];
                }
                continue;
            }

            /* บัญชีที่สูงกว่าคนดูไม่โผล่ในรายชื่อ — บัญชีผู้ดูแลระบบไม่ใช่เรื่องของร้าน
               และรายชื่อที่แก้ไม่ได้อยู่ดีมีไว้ก็ชวนให้กดแล้วเจอข้อความปฏิเสธ */
            if (Roles::rank($roles) > $ceiling) {
                continue;
            }

            $users[] = [
                'id'          => (int) $r['id'],
                'employeeId'  => (int) $r['employee_id'],
                'username'    => $r['username'],
                'displayName' => $r['display_name'],
                'jobTitle'    => $r['job_title'],
                'email'       => $r['email'],
                'roles'       => $roles,
                'roleNames'   => Roles::namesOf($roles),
                'roleText'    => Roles::text($roles),
                'isActive'    => (bool) $r['is_active'],
                'employeeActive' => (bool) $r['employee_active'],
                'canSignIn'   => $r['password_hash'] !== null && $r['username'] !== null,
                'mustChangePassword' => (bool) $r['must_change_password'],
                'lastLoginAt' => $r['last_login_at'],
                'movements'   => (int) $r['movements'],
            ];
        }

        /* ใช้งานอยู่ก่อน · สิทธิ์สูงก่อน · แล้วเรียงชื่อ — เรียงที่นี่ไม่ใช่ใน SQL
           เพราะ "สิทธิ์สูง" คือยศสูงสุดของบทบาทที่ถือ ซึ่งเป็นกฎในโค้ด ไม่ใช่ในฐาน */
        usort($users, static fn(array $a, array $b) => ($b['isActive'] <=> $a['isActive'])
            ?: (Roles::rank($b['roles']) <=> Roles::rank($a['roles']))
            ?: strcmp((string) $a['displayName'], (string) $b['displayName']));

        return ['users' => $users, 'candidates' => $candidates];
    }

    /**
     * Just the names, for the "who took this" picker.
     *
     * Open to every signed-in role, unlike list() above. It carries no account
     * detail — no username, no role, no last sign-in — and the same names are
     * already printed against every row of the ledger, so withholding them would
     * protect nothing while making it impossible to record who took the stock.
     *
     * @return list<array<string,mixed>>
     */
    public static function pickable(): array
    {
        return array_map(
            static fn($r) => [
                'id'          => (int) $r['id'],
                'displayName' => $r['display_name'],
                'jobTitle'    => $r['job_title'],
            ],
            Db::all(
                'SELECT id, display_name, job_title FROM admins
                 WHERE is_active = 1
                 ORDER BY display_name ASC'
            ),
        );
    }

    /* ────────────────────────────────────────────────────────── ตัวตน */

    /**
     * แถวใน `admins` ของพนักงานคนนี้ — สร้างให้ถ้ายังไม่มี
     *
     * เรียกซ้ำได้โดยไม่เปลี่ยนอะไร เพราะมันตอบคำถาม "คนนี้มีตัวตนในระบบบัญชีหรือยัง"
     * ไม่ใช่ "เอาค่าพวกนี้ไปเขียนทับ" — การเขียนทับเป็นงานของ syncFromEmployee()
     *
     * ไม่ตรวจสิทธิ์ เพราะแถวที่มันสร้างเข้าระบบไม่ได้ (ไม่มี username ไม่มีรหัสผ่าน
     * และตอนนี้ไม่มีบทบาทด้วย) การเพิ่มพนักงานจึงไม่ใช่การให้สิทธิ์ · ด่านสิทธิ์อยู่ที่
     * เส้นทางที่เรียกมัน
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
            'INSERT INTO admins (employee_id, display_name, job_title, is_active) VALUES (?, ?, ?, ?)',
            [
                $employeeId,
                mb_substr(trim($displayName), 0, 255),
                self::jobTitleOf($jobTitle),
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
        $wasActive = (bool) Db::value('SELECT is_active FROM admins WHERE id = ?', [$id]);

        if (!$active && $wasActive) {
            self::requireNotSelf($id, $actorId, 'ปิดใช้งานพนักงานที่เป็นบัญชีของตัวเองไม่ได้');
            self::requireOwnerRemains($id, self::rolesOf($id));
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

    /* ────────────────────────────────────────────────────────── บัญชี */

    /**
     * ให้พนักงานที่มีอยู่แล้วเข้าใช้งานระบบได้
     *
     * ไม่ได้สร้างคน — คนถูกสร้างที่หน้าพนักงานไปแล้ว ที่นี่คือการเติมชื่อผู้ใช้
     * รหัสผ่าน และบทบาทลงในแถวที่รออยู่ · แยกจากการเพิ่มพนักงานโดยตั้งใจ เพราะ
     * "รับคนเข้าทำงาน" กับ "ให้คนนั้นเปิดคอมพิวเตอร์ของร้านได้" เป็นคนละการตัดสินใจ
     *
     * @param array<string,mixed> $req
     * @param list<string> $actorRoles
     * @return array<string,mixed>
     */
    public static function grantAccount(int $employeeId, array $req, array $actorRoles, ?int $actorId = null): array
    {
        Roles::require(Roles::manageAdmins($actorRoles), 'สร้างบัญชีเข้าใช้งาน');

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
        $newRoles = self::roles($req, $actorRoles);

        if (Db::value('SELECT id FROM admins WHERE username = ?', [$username]) !== null) {
            throw ApiError::conflict('duplicate_username', "มีชื่อผู้ใช้ “{$username}” อยู่แล้ว", ['username' => $username]);
        }

        /* เปิดใช้งานทันทีเป็นค่าปริยาย แต่สร้างไว้ปิดก็ได้ — คนที่จะเริ่มงานเดือนหน้า
           ควรมีบัญชีรออยู่ได้โดยที่ยังเข้าระบบไม่ได้ · แถวที่ ensureFor() เพิ่งสร้าง
           เปิดอยู่เสมอ จึงต้องเขียนค่านี้ทับ ไม่ใช่ปล่อยตามเดิม */
        $isActive = (bool) ($req['is_active'] ?? true);

        Db::run(
            'UPDATE admins SET username = ?, password_hash = ?, is_active = ?, must_change_password = 0
              WHERE id = ?',
            [$username, Auth::hashPassword($password), $isActive ? 1 : 0, $id],
        );
        self::setRoles($id, $newRoles, $actorId);

        return [
            'id'          => $id,
            'employeeId'  => $employeeId,
            'username'    => $username,
            'displayName' => (string) $employee['employee_name'],
            'roles'       => $newRoles,
            'isActive'    => $isActive,
        ];
    }

    /**
     * เอาสิทธิ์เข้าใช้งานคืน โดยที่คนยังอยู่ในระบบ
     *
     * แทนที่ `delete()` เดิมทั้งหมด — แถวใน admins ไม่ใช่ "บัญชี" อีกต่อไปแล้ว
     * มันคือตัวตนของพนักงานคนหนึ่ง ซึ่งลบไม่ได้เพราะ ledger เขียนชื่อจากมัน
     * สิ่งที่ยกเลิกได้คือชื่อผู้ใช้กับรหัสผ่าน และพรุ่งนี้เปิดใหม่ให้คนเดิมได้เลย
     *
     * บทบาทถูกถอดไปพร้อมกัน — บัญชีที่เข้าไม่ได้แต่ยังถือสิทธิ์แอดมินค้างอยู่ คือ
     * สิทธิ์ที่จะคืนมาเองในวันที่มีคนเปิดบัญชีให้ใหม่ โดยไม่มีใครตั้งใจให้คืน
     *
     * @param list<string> $actorRoles
     * @return array<string,mixed>
     */
    public static function revokeAccount(int $id, array $actorRoles, int $actorId): array
    {
        Roles::require(Roles::manageAdmins($actorRoles), 'ยกเลิกบัญชีเข้าใช้งาน');

        $target = Db::one('SELECT id, username, display_name FROM admins WHERE id = ?', [$id]);
        if ($target === null) {
            throw ApiError::notFound('ไม่พบผู้ใช้');
        }
        $roles = self::rolesOf($id);
        self::requireReach($actorRoles, $roles, 'ยกเลิกบัญชีนี้');

        if ($target['username'] === null) {
            throw ApiError::conflict('no_account', 'คนนี้ยังไม่มีบัญชีเข้าใช้งานอยู่แล้ว');
        }

        self::requireNotSelf($id, $actorId, 'ยกเลิกบัญชีที่กำลังใช้อยู่ไม่ได้');
        self::requireOwnerRemains($id, $roles, signInOnly: true);

        Db::run(
            'UPDATE admins SET username = NULL, password_hash = NULL, must_change_password = 0 WHERE id = ?',
            [$id],
        );
        self::setRoles($id, [], $actorId);

        return ['id' => $id, 'displayName' => $target['display_name']];
    }

    /**
     * แก้บัญชีเข้าใช้งาน — ไม่ใช่แก้คน
     *
     * ชื่อที่แสดงกับหน้าที่หายไปจากเมธอดนี้โดยตั้งใจ ทั้งสองอย่างมาจาก `employees`
     * และแก้ได้ที่หน้าพนักงานที่เดียว · ถ้ารับที่นี่ด้วย จะมีสองที่ที่ตั้งชื่อคนคนเดียวกัน
     * แล้ววันหนึ่งใบเสร็จกับรายงานจะพิมพ์คนละชื่อ
     *
     * @param array<string,mixed> $req
     * @param list<string> $actorRoles
     * @return array<string,mixed>
     */
    public static function update(int $id, array $req, array $actorRoles, int $actorId): array
    {
        Roles::require(Roles::manageAdmins($actorRoles), 'แก้ไขผู้ใช้');

        $target = Db::one(
            'SELECT a.*, e.employee_name, e.active AS employee_active
               FROM admins a JOIN employees e ON e.id = a.employee_id
              WHERE a.id = ?',
            [$id],
        );
        if ($target === null) {
            throw ApiError::notFound('ไม่พบผู้ใช้');
        }
        $was = self::rolesOf($id);
        self::requireReach($actorRoles, $was, 'แก้ไขบัญชีนี้');

        $newRoles = self::roles($req, $actorRoles);
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

        /* บัญชีที่เข้าระบบได้ต้องมีอย่างน้อยหนึ่งบทบาท — ไม่งั้นล็อกอินผ่านแล้วทุกหน้า
           ตอบว่าไม่มีสิทธิ์ ซึ่งคนที่เจอจะอ่านว่าระบบพัง (Auth::login กันไว้อีกชั้น) */
        if ($username !== null && $newRoles === []) {
            throw ApiError::badRequest('ต้องเลือกสิทธิ์อย่างน้อยหนึ่งอย่าง', 'no_roles');
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
            if (Roles::rank($newRoles) < Roles::rank($actorRoles)) {
                throw ApiError::conflict('self_lockout', 'ลดสิทธิ์ตัวเองไม่ได้ — ให้คนที่สิทธิ์สูงกว่าทำให้');
            }
        }

        /* ถอดเจ้าของร้านคนสุดท้ายออก ไม่ว่าจะด้วยการเอาบทบาทออกหรือปิดบัญชี */
        if (in_array(Roles::OWNER, $was, true)
            && (!in_array(Roles::OWNER, $newRoles, true) || !$isActive)
        ) {
            self::requireOwnerRemains($id, $was);
        }

        Db::run(
            'UPDATE admins SET username = ?, is_active = ? WHERE id = ?',
            [$username, $isActive ? 1 : 0, $id],
        );
        self::setRoles($id, $newRoles, $actorId);

        return [
            'id'          => $id,
            'displayName' => $target['employee_name'],
            'roles'       => $newRoles,
            'isActive'    => $isActive,
        ];
    }

    /* ─────────────────────────────────────────────────────── รหัสผ่าน */

    /**
     * แอดมินตั้งรหัสผ่านให้คนอื่น
     *
     * ตั้งธงบังคับเปลี่ยนไว้ด้วยเสมอ — รหัสที่คนอื่นเป็นคนตั้งคือรหัสที่มีคนที่สอง
     * รู้อยู่แล้ว การปล่อยให้มันเป็นรหัสถาวรแปลว่าบัญชีนั้นมีเจ้าของสองคนตลอดไป
     *
     * @param array<string,mixed> $req
     * @param list<string> $actorRoles
     * @return array<string,mixed>
     */
    public static function setPassword(int $id, array $req, array $actorRoles): array
    {
        $target = self::passwordTarget($id, $actorRoles);
        $password = (string) self::password($req, required: true);

        Db::run(
            'UPDATE admins SET password_hash = ?, must_change_password = 1 WHERE id = ?',
            [Auth::hashPassword($password), $id],
        );

        return ['id' => $id, 'displayName' => $target['display_name']];
    }

    /**
     * ปุ่มรีเซ็ต — ระบบสุ่มรหัสให้ แล้วคืนออกไปครั้งเดียว
     *
     * ไม่เก็บรหัสดิบไว้ที่ไหนเลย ทั้งในฐานและในบันทึกการใช้งาน (`ActivityLog`
     * ปิดทุกช่องที่ชื่อมีคำว่า password อยู่แล้ว) · ปิดหน้าต่างไปก่อนคัดลอกแปลว่า
     * ต้องกดรีเซ็ตใหม่ ซึ่งถูกแล้ว — รหัสที่ยังอ่านย้อนหลังได้ ไม่ใช่รหัสชั่วคราว
     *
     * @param list<string> $actorRoles
     * @return array<string,mixed>
     */
    public static function resetPassword(int $id, array $actorRoles): array
    {
        $target = self::passwordTarget($id, $actorRoles);
        $password = self::generatePassword();

        Db::run(
            'UPDATE admins SET password_hash = ?, must_change_password = 1 WHERE id = ?',
            [Auth::hashPassword($password), $id],
        );

        return [
            'id'          => $id,
            'displayName' => $target['display_name'],
            'username'    => $target['username'],
            'password'    => $password,
        ];
    }

    /**
     * เจ้าตัวเปลี่ยนรหัสของตัวเอง — และเป็นทางเดียวที่ปลดธงบังคับเปลี่ยนได้
     *
     * ถามรหัสเดิมด้วย แม้จะรู้อยู่แล้วว่าใครล็อกอินอยู่ — เครื่องที่ร้านถูกเปิดค้าง
     * ไว้ทั้งวัน คนที่เดินผ่านมาแล้วตั้งรหัสใหม่ได้ในสองคลิกคือคนที่ยึดบัญชีไปได้เลย
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    public static function changeOwnPassword(int $id, array $req): array
    {
        $row = Db::one('SELECT id, display_name, password_hash FROM admins WHERE id = ?', [$id]);
        if ($row === null || $row['password_hash'] === null) {
            throw ApiError::notFound('ไม่พบบัญชีนี้');
        }

        $current = (string) ($req['current_password'] ?? '');
        if ($current === '' || !Auth::verifyPassword($current, (string) $row['password_hash'])) {
            throw ApiError::badRequest('รหัสผ่านเดิมไม่ถูกต้อง', 'bad_credentials');
        }

        $password = (string) self::password($req, required: true);
        if (Auth::verifyPassword($password, (string) $row['password_hash'])) {
            throw ApiError::badRequest('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม', 'same_password');
        }

        Db::run(
            'UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?',
            [Auth::hashPassword($password), $id],
        );

        return ['id' => $id, 'displayName' => $row['display_name']];
    }

    /** รหัสชั่วคราวที่อ่านออกเสียงให้กันฟังได้ เช่น `TO2026@k7rtqm` */
    public static function generatePassword(): string
    {
        $tail = '';
        for ($i = 0; $i < 6; $i++) {
            $tail .= self::SAFE_CHARS[random_int(0, strlen(self::SAFE_CHARS) - 1)];
        }
        return 'TO' . date('Y') . '@' . $tail;
    }

    /* -------------------------------------------------------------- helpers */

    /** @return list<string> */
    public static function rolesOf(int $id): array
    {
        return Roles::clean(array_column(
            Db::all('SELECT role FROM admin_roles WHERE admin_id = ?', [$id]),
            'role',
        ));
    }

    /**
     * เขียนชุดบทบาทของบัญชีหนึ่งใบให้ตรงกับที่ขอมา
     *
     * เติมกับถอดเฉพาะส่วนต่าง ไม่ใช่ลบทั้งชุดแล้วเขียนใหม่ — `granted_at` กับ
     * `granted_by` ของบทบาทที่ถืออยู่ก่อนแล้วคือคำตอบว่า "ใครให้สิทธิ์นี้และเมื่อไหร่"
     * ซึ่งจะถูกเขียนทับด้วยชื่อคนที่เผลอกดบันทึกโดยไม่ได้แก้อะไร
     *
     * `$actorId` เป็น null ได้ = ไม่รู้ว่าใครให้ (สคริปต์ · เทสต์) — คอลัมน์
     * `granted_by` ยอมให้ว่างอยู่แล้วด้วยเหตุผลเดียวกันกับที่ migration ทิ้งไว้ว่าง
     *
     * @param list<string> $roles
     */
    private static function setRoles(int $id, array $roles, ?int $actorId): void
    {
        $roles = Roles::clean($roles);
        $now   = self::rolesOf($id);

        foreach (array_diff($now, $roles) as $gone) {
            Db::run('DELETE FROM admin_roles WHERE admin_id = ? AND role = ?', [$id, $gone]);
        }
        foreach (array_diff($roles, $now) as $added) {
            Db::run(
                'INSERT INTO admin_roles (admin_id, role, granted_by) VALUES (?, ?, ?)',
                [$id, $added, $actorId],
            );
        }
    }

    /**
     * บัญชีที่มีบทบาทสูงกว่าตัวเอง แตะไม่ได้เลย ไม่ว่าจะแก้อะไร
     *
     * `manageAdmins` ตอบแค่ว่า "จัดการผู้ใช้ได้ไหม" ซึ่งจริงสำหรับแอดมินด้วย
     * ถ้าหยุดแค่นั้น แอดมินจะแก้บัญชีเจ้าของร้านได้ — เปลี่ยนชื่อผู้ใช้แล้วตั้ง
     * รหัสผ่านใหม่ก็เข้าเป็นเจ้าของร้านได้เลย
     *
     * @param list<string> $actorRoles @param list<string> $targetRoles
     */
    private static function requireReach(array $actorRoles, array $targetRoles, string $what): void
    {
        Roles::require(Roles::rank($targetRoles) <= Roles::rank($actorRoles), $what);
    }

    /**
     * ด่านร่วมของทั้งสองทางที่ตั้งรหัสผ่านให้คนอื่น
     *
     * ตั้งรหัสผ่านให้บัญชีที่สูงกว่าตัวเอง = เข้าใช้บัญชีนั้นได้ทันที จึงเป็นทางลัด
     * ไปสู่สิทธิ์ที่สูงกว่า และถูกปิดด้วยกฎเดียวกับการตั้งบทบาท
     *
     * @param list<string> $actorRoles
     * @return array<string,mixed>
     */
    private static function passwordTarget(int $id, array $actorRoles): array
    {
        Roles::require(Roles::manageAdmins($actorRoles), 'ตั้งรหัสผ่าน');

        $target = Db::one('SELECT id, username, display_name FROM admins WHERE id = ?', [$id]);
        if ($target === null) {
            throw ApiError::notFound('ไม่พบผู้ใช้');
        }
        self::requireReach($actorRoles, self::rolesOf($id), 'ตั้งรหัสผ่านให้บัญชีนี้');

        if ($target['username'] === null) {
            throw ApiError::conflict(
                'no_username',
                'คนนี้ยังไม่มีชื่อผู้ใช้ — สร้างบัญชีเข้าใช้งานก่อนจึงจะตั้งรหัสผ่านได้',
            );
        }
        return $target;
    }

    /** หน้าที่ที่คัดลอกมาจาก `employees.roles` — ช่องปลายทางแคบกว่า 120 ตัว */
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
     *
     * @param list<string> $targetRoles บทบาทที่บัญชีนี้ถืออยู่ *ก่อน* การแก้
     */
    private static function requireOwnerRemains(int $id, array $targetRoles, bool $signInOnly = false): void
    {
        if (!in_array(Roles::OWNER, $targetRoles, true)) {
            return;
        }
        $extra = $signInOnly ? ' AND a.username IS NOT NULL AND a.password_hash IS NOT NULL' : '';
        $others = (int) Db::value(
            "SELECT COUNT(*) FROM admin_roles r JOIN admins a ON a.id = r.admin_id
              WHERE r.role = 'owner' AND a.is_active = 1{$extra} AND a.id <> ?",
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

    /** @param array<string,mixed> $req */
    private static function username(array $req): ?string
    {
        $v = $req['username'] ?? null;
        if ($v === null || trim((string) $v) === '') {
            return null;
        }
        $v = trim((string) $v);
        if (!preg_match('/^[a-zA-Z0-9._-]{3,64}$/', $v)) {
            throw ApiError::badRequest('ชื่อผู้ใช้ยาว 3–64 ตัว ใช้ได้เฉพาะ a–z 0–9 . - _', 'bad_username');
        }
        return $v;
    }

    /**
     * บทบาทที่ขอมา — ตรวจทีละใบว่าคนที่กำลังกดตั้งให้ได้จริง
     *
     * ตั้งบทบาทที่สูงกว่าตัวเองไม่ได้ ไม่งั้นสิทธิ์ "จัดการผู้ใช้" จะกลายเป็นสิทธิ์
     * "เป็นอะไรก็ได้" — แอดมินสร้างบัญชีเจ้าของร้านแล้วล็อกอินเข้าไป
     *
     * รับรายการว่างได้ (แถวที่ยังไม่ให้เข้าระบบ) · คนที่เรียกเป็นคนตัดสินว่าว่าง
     * แล้วโอเคไหม เพราะกฎต่างกันระหว่างการสร้างบัญชีกับการแก้แถวที่ยังไม่มีบัญชี
     *
     * @param array<string,mixed> $req @param list<string> $actorRoles @return list<string>
     */
    private static function roles(array $req, array $actorRoles): array
    {
        $raw = $req['roles'] ?? null;
        if (!is_array($raw)) {
            throw ApiError::badRequest('ต้องส่งสิทธิ์มาเป็นรายการ', 'bad_role');
        }

        $wanted = [];
        foreach ($raw as $r) {
            if (!Roles::isRole($r)) {
                throw ApiError::badRequest(
                    'สิทธิ์ต้องเป็นหนึ่งใน ' . implode(', ', Roles::ALL),
                    'bad_role',
                );
            }
            if (!Roles::canGrant($actorRoles, (string) $r)) {
                throw ApiError::forbidden(
                    'ตั้งสิทธิ์ ' . (Roles::NAME[$r] ?? $r) . ' ที่สูงกว่าสิทธิ์ของตัวเองไม่ได้ — ให้'
                    . Roles::LABEL[Roles::OWNER] . 'ทำให้',
                );
            }
            $wanted[] = (string) $r;
        }

        return Roles::clean($wanted);
    }

    /** @param array<string,mixed> $req */
    private static function password(array $req, bool $required): ?string
    {
        $v = $req['password'] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                throw ApiError::badRequest('ต้องระบุรหัสผ่าน', 'missing_field');
            }
            return null;
        }

        $s = (string) $v;
        if (mb_strlen($s) < self::MIN_PASSWORD) {
            throw ApiError::badRequest(
                'รหัสผ่านต้องยาวอย่างน้อย ' . self::MIN_PASSWORD . ' ตัวอักษร',
                'weak_password',
            );
        }
        // bcrypt silently truncates past 72 bytes, which would make part of a
        // long password meaningless without anyone being told.
        if (strlen($s) > 72) {
            throw ApiError::badRequest('รหัสผ่านยาวเกิน 72 ไบต์ ซึ่งเป็นขีดจำกัดของ bcrypt', 'long_password');
        }
        return $s;
    }
}
