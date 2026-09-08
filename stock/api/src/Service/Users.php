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
 * identity first and an account second — `username` and `password_hash` are both
 * optional, and granting a login is a separate act from creating the person.
 *
 * Accounts that have done work are deactivated, never deleted.
 * `inventory_logs.created_by` points at these ids, and a movement whose author
 * has vanished is a movement nobody can account for. `delete()` below is for the
 * other case only — the row keyed in twice, the person who never started — where
 * deactivating leaves a name in the list forever for no reason at all.
 */
final class Users
{
    private const MIN_PASSWORD = 10;

    /**
     * ทุกที่ที่ชี้กลับมาที่ admins.id — ใช้ตอบคำถามเดียว: คนนี้ทิ้งร่องรอยไว้ไหม
     *
     * Only the two pos_* tables carry a real foreign key (ON DELETE RESTRICT);
     * the rest point at these ids by convention alone, on purpose — the ledger
     * has to keep writing while the people table is being migrated. That split
     * is exactly why the check lives here: left to the database, half of these
     * would refuse the delete and the other half would quietly be orphaned.
     */
    private const TRACES = [
        // created_by = ใครเป็นคนคีย์ · issued_to_admin_id = ใครเป็นคนรับของไป
        'inventory_logs' => ['created_by', 'issued_to_admin_id'],
        'branch_issues'  => ['issued_by', 'settled_by'],
        'pos_sales'      => ['created_by', 'void_by'],
        'pos_payments'   => ['created_by', 'cancelled_by'],
        'stock_requests' => ['actor_id'],
    ];

    /** @return list<array<string,mixed>> */
    public static function list(string $role): array
    {
        Roles::require(Roles::manageAdmins($role), 'ดูรายชื่อผู้ใช้');

        /* บัญชีที่สูงกว่าคนดูไม่โผล่ในรายชื่อ — บัญชีผู้ดูแลระบบไม่ใช่เรื่องของร้าน
           และรายชื่อที่แก้ไม่ได้อยู่ดีมีไว้ก็ชวนให้กดแล้วเจอข้อความปฏิเสธ */
        $visible = array_values(array_filter(
            Roles::ALL,
            static fn(string $r): bool => Roles::rank($r) <= Roles::rank($role),
        ));

        return array_map(
            static fn($r) => [
                'id'          => (int) $r['id'],
                'username'    => $r['username'],
                'displayName' => $r['display_name'],
                'jobTitle'    => $r['job_title'],
                'email'       => $r['email'],
                'role'        => $r['role'],
                'roleLabel'   => Roles::LABEL[$r['role']] ?? $r['role'],
                'isActive'    => (bool) $r['is_active'],
                'canSignIn'   => $r['password_hash'] !== null && $r['username'] !== null,
                'employeeId'  => $r['employee_id'] === null ? null : (int) $r['employee_id'],
                'lastLoginAt' => $r['last_login_at'],
                'movements'   => (int) $r['movements'],
            ],
            Db::all(
                'SELECT a.*, (SELECT COUNT(*) FROM inventory_logs g WHERE g.created_by = a.id) AS movements
                 FROM admins a
                 WHERE a.role IN (' . implode(', ', array_fill(0, count($visible), '?')) . ')
                 ORDER BY a.is_active DESC, a.role ASC, a.display_name ASC',
                $visible,
            ),
        );
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

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function create(array $req, string $role): array
    {
        Roles::require(Roles::manageAdmins($role), 'เพิ่มผู้ใช้');

        $displayName = self::required($req, 'display_name', 255);
        $newRole = self::role($req, $role);
        $jobTitle = self::optional($req, 'job_title', 120);
        $username = self::username($req);
        $password = self::password($req, required: $username !== null);

        if ($username !== null && Db::value('SELECT id FROM admins WHERE username = ?', [$username]) !== null) {
            throw ApiError::conflict('duplicate_username', "มีชื่อผู้ใช้ “{$username}” อยู่แล้ว", ['username' => $username]);
        }

        Db::run(
            'INSERT INTO admins (username, display_name, job_title, password_hash, role, is_active)
             VALUES (?, ?, ?, ?, ?, 1)',
            [$username, $displayName, $jobTitle, $password === null ? null : Auth::hashPassword($password), $newRole],
        );

        $id = (int) Db::value('SELECT LAST_INSERT_ID()');
        return ['id' => $id, 'displayName' => $displayName, 'canSignIn' => $username !== null];
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function update(int $id, array $req, string $role, int $actorId): array
    {
        Roles::require(Roles::manageAdmins($role), 'แก้ไขผู้ใช้');

        $target = Db::one('SELECT * FROM admins WHERE id = ?', [$id]);
        if ($target === null) {
            throw ApiError::notFound('ไม่พบผู้ใช้');
        }
        self::requireReach($role, (string) $target['role'], 'แก้ไขบัญชีนี้');

        $displayName = self::required($req, 'display_name', 255);
        $newRole = self::role($req, $role);
        $jobTitle = self::optional($req, 'job_title', 120);
        $isActive = (bool) ($req['is_active'] ?? true);
        $username = self::username($req);

        if ($username !== null) {
            $clash = Db::value('SELECT id FROM admins WHERE username = ? AND id <> ?', [$username, $id]);
            if ($clash !== null) {
                throw ApiError::conflict('duplicate_username', "มีชื่อผู้ใช้ “{$username}” อยู่แล้ว", ['username' => $username]);
            }
        }

        // Locking yourself out is the one mistake nobody can undo from inside the
        // app, so it is refused rather than confirmed.
        if ($id === $actorId) {
            if (!$isActive) {
                throw ApiError::conflict('self_lockout', 'ปิดใช้งานบัญชีตัวเองไม่ได้');
            }
            if (Roles::rank($newRole) < Roles::rank($role)) {
                throw ApiError::conflict('self_lockout', 'ลดสิทธิ์ตัวเองไม่ได้ — ให้คนที่สิทธิ์สูงกว่าทำให้');
            }
        }

        // The same applies to the shop as a whole: at least one active owner has
        // to remain, or nobody can manage accounts again.
        if ($target['role'] === Roles::OWNER && ($newRole !== Roles::OWNER || !$isActive)) {
            $others = (int) Db::value(
                "SELECT COUNT(*) FROM admins WHERE role = 'owner' AND is_active = 1 AND id <> ?",
                [$id],
            );
            if ($others === 0) {
                throw ApiError::conflict('last_owner', 'ต้องเหลือเจ้าของร้านที่ใช้งานได้อย่างน้อยหนึ่งคน');
            }
        }

        Db::run(
            'UPDATE admins SET username = ?, display_name = ?, job_title = ?, role = ?, is_active = ? WHERE id = ?',
            [$username, $displayName, $jobTitle, $newRole, $isActive ? 1 : 0, $id],
        );

        return ['id' => $id, 'displayName' => $displayName, 'role' => $newRole, 'isActive' => $isActive];
    }

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function setPassword(int $id, array $req, string $role): array
    {
        Roles::require(Roles::manageAdmins($role), 'ตั้งรหัสผ่าน');

        $target = Db::one('SELECT id, username, display_name, role FROM admins WHERE id = ?', [$id]);
        if ($target === null) {
            throw ApiError::notFound('ไม่พบผู้ใช้');
        }
        /* ตั้งรหัสผ่านให้บัญชีที่สูงกว่าตัวเอง = เข้าใช้บัญชีนั้นได้ทันที
           จึงเป็นทางลัดไปสู่สิทธิ์ที่สูงกว่า และถูกปิดด้วยกฎเดียวกับการตั้งบทบาท */
        self::requireReach($role, (string) $target['role'], 'ตั้งรหัสผ่านให้บัญชีนี้');
        if ($target['username'] === null) {
            throw ApiError::conflict(
                'no_username',
                'คนนี้ยังไม่มีชื่อผู้ใช้ — ตั้งชื่อผู้ใช้ก่อนจึงจะตั้งรหัสผ่านได้',
            );
        }

        $password = self::password($req, required: true);

        Db::run('UPDATE admins SET password_hash = ? WHERE id = ?', [Auth::hashPassword((string) $password), $id]);

        return ['id' => $id, 'displayName' => $target['display_name']];
    }

    /**
     * ลบคนที่ยังไม่เคยทำอะไรในระบบ — ที่เหลือให้ปิดใช้งานแทน
     *
     * The gate is not "who is senior enough to delete" but "is there anything
     * left that points at this person": one movement, one branch withdrawal,
     * one sale keyed in, and the account stays so the history can still be read
     * back with a name on it. The refusal says how many, because "ลบไม่ได้" on
     * its own leaves the manager guessing which record to go looking for.
     *
     * @return array<string,mixed>
     */
    public static function delete(int $id, string $role, int $actorId): array
    {
        Roles::require(Roles::manageAdmins($role), 'ลบผู้ใช้');

        $target = Db::one('SELECT id, display_name, role FROM admins WHERE id = ?', [$id]);
        if ($target === null) {
            throw ApiError::notFound('ไม่พบผู้ใช้');
        }
        self::requireReach($role, (string) $target['role'], 'ลบบัญชีนี้');

        // Same two locks as update(): the account you are signed in as, and the
        // last owner. Deleting is the harder-to-undo way of making either
        // mistake, so neither is offered as a confirmable warning.
        if ($id === $actorId) {
            throw ApiError::conflict('self_lockout', 'ลบบัญชีตัวเองไม่ได้');
        }
        if ($target['role'] === Roles::OWNER) {
            $others = (int) Db::value(
                "SELECT COUNT(*) FROM admins WHERE role = 'owner' AND is_active = 1 AND id <> ?",
                [$id],
            );
            if ($others === 0) {
                throw ApiError::conflict('last_owner', 'ต้องเหลือเจ้าของร้านที่ใช้งานได้อย่างน้อยหนึ่งคน');
            }
        }

        $traces = 0;
        foreach (self::TRACES as $table => $columns) {
            $where = implode(' OR ', array_map(static fn(string $c): string => "{$c} = ?", $columns));
            $traces += (int) Db::value(
                "SELECT COUNT(*) FROM {$table} WHERE {$where}",
                array_fill(0, count($columns), $id),
            );
        }
        if ($traces > 0) {
            throw ApiError::conflict(
                'user_has_history',
                "ลบไม่ได้ — {$target['display_name']} มีประวัติในระบบแล้ว {$traces} รายการ "
                . 'ประวัติต้องอ่านย้อนหลังได้ · ปิดใช้งานแทนได้',
                ['traces' => $traces],
            );
        }

        // admins.created_by points here with ON DELETE SET NULL, so the accounts
        // this person opened stay; only the note of who opened them goes.
        Db::run('DELETE FROM admins WHERE id = ?', [$id]);

        return ['id' => $id, 'displayName' => $target['display_name']];
    }

    /* -------------------------------------------------------------- helpers */

    /**
     * บัญชีที่มีบทบาทสูงกว่าตัวเอง แตะไม่ได้เลย ไม่ว่าจะแก้อะไร
     *
     * `manageAdmins` ตอบแค่ว่า "จัดการผู้ใช้ได้ไหม" ซึ่งจริงสำหรับแอดมินด้วย
     * ถ้าหยุดแค่นั้น แอดมินจะแก้บัญชีเจ้าของร้านได้ — เปลี่ยนชื่อผู้ใช้แล้วตั้ง
     * รหัสผ่านใหม่ก็เข้าเป็นเจ้าของร้านได้เลย
     */
    private static function requireReach(string $actorRole, string $targetRole, string $what): void
    {
        Roles::require(Roles::rank($targetRole) <= Roles::rank($actorRole), $what);
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

    /** @param array<string,mixed> $req */
    private static function required(array $req, string $field, int $max): string
    {
        $v = trim((string) ($req[$field] ?? ''));
        if ($v === '') {
            throw ApiError::badRequest("ต้องระบุ {$field}", 'missing_field');
        }
        return mb_substr($v, 0, $max);
    }

    /** @param array<string,mixed> $req */
    private static function optional(array $req, string $field, int $max): ?string
    {
        $v = $req[$field] ?? null;
        if ($v === null || trim((string) $v) === '') {
            return null;
        }
        return mb_substr(trim((string) $v), 0, $max);
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

    /** @param array<string,mixed> $req */
    private static function role(array $req, string $actorRole): string
    {
        $v = (string) ($req['role'] ?? '');
        if (!Roles::isRole($v)) {
            throw ApiError::badRequest(
                'บทบาทต้องเป็นหนึ่งใน ' . implode(', ', Roles::ALL),
                'bad_role',
            );
        }
        /* ตั้งบทบาทที่สูงกว่าตัวเองไม่ได้ ไม่งั้นสิทธิ์ "จัดการผู้ใช้" จะกลายเป็น
           สิทธิ์ "เป็นอะไรก็ได้" — แอดมินสร้างบัญชีเจ้าของร้านแล้วล็อกอินเข้าไป */
        if (!Roles::canGrant($actorRole, $v)) {
            throw ApiError::forbidden(
                'ตั้งบทบาทที่สูงกว่าบทบาทของตัวเองไม่ได้ — ให้' . Roles::LABEL[Roles::OWNER] . 'ทำให้',
            );
        }
        return $v;
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
