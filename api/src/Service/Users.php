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
 * Accounts are deactivated, never deleted. `inventory_logs.created_by` points at
 * these ids, and a movement whose author has vanished is a movement nobody can
 * account for.
 */
final class Users
{
    private const MIN_PASSWORD = 10;

    /** @return list<array<string,mixed>> */
    public static function list(string $role): array
    {
        Roles::require(Roles::manageAdmins($role), 'ดูรายชื่อผู้ใช้');

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
                 ORDER BY a.is_active DESC, a.role ASC, a.display_name ASC'
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

    /** @param array<string,mixed> $req @return array<string,mixed> */
    public static function create(array $req, string $role): array
    {
        Roles::require(Roles::manageAdmins($role), 'เพิ่มผู้ใช้');

        $displayName = self::required($req, 'display_name', 255);
        $newRole = self::role($req);
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

        $displayName = self::required($req, 'display_name', 255);
        $newRole = self::role($req);
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
            if ($newRole !== Roles::OWNER) {
                throw ApiError::conflict('self_lockout', 'ลดสิทธิ์ตัวเองไม่ได้ — ให้เจ้าของร้านอีกคนทำให้');
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

        $target = Db::one('SELECT id, username, display_name FROM admins WHERE id = ?', [$id]);
        if ($target === null) {
            throw ApiError::notFound('ไม่พบผู้ใช้');
        }
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

    /* -------------------------------------------------------------- helpers */

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
    private static function role(array $req): string
    {
        $v = (string) ($req['role'] ?? '');
        if (!Roles::isRole($v)) {
            throw ApiError::badRequest('บทบาทต้องเป็น owner, accountant หรือ staff', 'bad_role');
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
