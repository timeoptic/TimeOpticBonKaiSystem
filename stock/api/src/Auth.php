<?php

declare(strict_types=1);

namespace Optic;

/**
 * Sign-in and the current actor.
 *
 * Sessions are PHP's own, so when this merges into the shop-floor project both
 * halves share one login rather than each holding its own idea of who is here.
 */
final class Auth
{
    private const KEY = 'optic_actor';

    /** @var array<string,mixed>|null */
    private static ?array $override = null;

    public static function start(): void
    {
        if (php_sapi_name() === 'cli' || session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        /*
         * How long someone stays signed in.
         *
         * PHP's default is 1440 seconds — 24 minutes of inactivity and the
         * session file is collected. On a shop till that is wrong in a way that
         * is hard to diagnose from the outside: someone serves a customer, comes
         * back, fills a form, presses save, and the save fails. The stock is
         * fine and the form looks fine; only the session is gone.
         *
         * A working day is the right unit, so the default here is twelve hours.
         * The cookie is given the same life, otherwise closing the browser would
         * still sign them out however long the server was willing to wait.
         */
        $life = (int) (Env::get('SESSION_LIFETIME', '43200') ?? '43200');

        /*
         * A save path of our own, because the lifetime above cannot hold without
         * one. PHP's collector sweeps the whole directory against whatever
         * gc_maxlifetime the *sweeping* process has, so leaving these in the
         * shared temp directory means any other PHP on this machine running the
         * 24-minute default deletes our sessions on our behalf.
         */
        $store = Env::get('SESSION_PATH') ?: __DIR__ . '/../var/sessions';
        if (!is_dir($store)) {
            @mkdir($store, 0770, true);
        }
        if (is_dir($store) && is_writable($store)) {
            session_save_path($store);
        }

        ini_set('session.gc_maxlifetime', (string) $life);

        /*
         * SameSite decides whether the browser attaches this cookie to a fetch
         * the frontend makes. In development both halves sit on localhost, which
         * is one site however the ports differ, so Lax is enough. Put the API on
         * a different domain and Lax silently stops sending the cookie: the user
         * signs in, and every request after that answers 401 for no visible
         * reason. That deployment needs SameSite=None, which browsers only honour
         * together with Secure — meaning HTTPS.
         *
         * Once the two halves are merged behind one origin, the whole question
         * disappears and Lax is right again.
         */
        session_set_cookie_params([
            'lifetime' => $life,
            'path'     => '/',
            'httponly' => true,
            'samesite' => Env::get('SESSION_SAMESITE', 'Lax') ?? 'Lax',
            'secure'   => Env::get('SESSION_SECURE', '0') === '1',
        ]);

        session_name('optic_session');
        session_start();
    }

    /**
     * bcrypt hashes in this database were written by Node's bcryptjs and carry
     * the `$2b$` prefix. PHP's own hashes use `$2y$`. The two are the same
     * algorithm — the prefix was a spec clarification, not a format change — but
     * some PHP builds refuse to verify a `$2b$` string outright, which would lock
     * every existing account out on the day this ships. Normalising the prefix
     * costs nothing and removes the whole class of problem.
     */
    public static function verifyPassword(string $plain, string $hash): bool
    {
        if (password_verify($plain, $hash)) {
            return true;
        }

        if (str_starts_with($hash, '$2b$')) {
            return password_verify($plain, '$2y$' . substr($hash, 4));
        }

        return false;
    }

    public static function hashPassword(string $plain): string
    {
        return password_hash($plain, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    /**
     * @return array<string,mixed> the signed-in actor
     * @throws ApiError on bad credentials or a disabled account
     */
    public static function login(string $username, string $password): array
    {
        $username = trim($username);

        $row = Db::one(
            'SELECT id, username, display_name, job_title, is_active, password_hash, employee_id,
                    must_change_password
             FROM admins WHERE username = ?',
            [$username],
        );

        // Compare even when the account is missing or has no password, so a
        // wrong username and a wrong password take the same time to answer.
        $hash = $row['password_hash']
            ?? '$2y$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
        $ok = self::verifyPassword($password, (string) $hash);

        if ($row === null || !$ok || !(bool) $row['is_active'] || $row['password_hash'] === null) {
            throw new ApiError(
                401,
                'bad_credentials',
                'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีนี้ถูกปิดใช้งาน',
            );
        }

        /* บัญชีที่ไม่มีบทบาทเลยเข้ามาได้ก็ทำอะไรไม่ได้สักอย่าง — ทุกหน้าตอบว่าไม่มี
           สิทธิ์ ซึ่งอ่านได้ว่าระบบพัง · บอกความจริงตั้งแต่หน้าล็อกอินดีกว่า
           (การให้สิทธิ์กันไว้ทางฝั่ง Users อยู่แล้ว ตรงนี้เป็นตาข่ายชั้นสอง เผื่อ
           แถวที่ถูกแก้จากนอกแอป) */
        $roles = self::rolesOf((int) $row['id']);
        if ($roles === []) {
            throw new ApiError(
                403,
                'no_roles',
                'บัญชีนี้ยังไม่ได้กำหนดสิทธิ์ — ให้ผู้ดูแลระบบกำหนดก่อนจึงจะเข้าใช้งานได้',
            );
        }

        Db::run('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [$row['id']]);

        $actor = self::shape($row, $roles);
        self::start();
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
            $_SESSION[self::KEY] = $actor;
        }

        return $actor;
    }

    public static function logout(): void
    {
        self::start();
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION = [];
            session_destroy();
        }
        self::$override = null;
    }

    /** @return array<string,mixed>|null */
    public static function actor(): ?array
    {
        if (self::$override !== null) {
            return self::$override;
        }

        self::start();
        $actor = $_SESSION[self::KEY] ?? null;
        if (!is_array($actor)) {
            return null;
        }

        // The session is a cache of a row that can change underneath it — a role
        // downgrade or a deactivation has to take effect on the next request,
        // not whenever the person happens to sign out.
        $row = Db::one(
            'SELECT id, username, display_name, job_title, is_active, employee_id,
                    must_change_password
             FROM admins WHERE id = ?',
            [$actor['id']],
        );
        if ($row === null || !(bool) $row['is_active']) {
            self::logout();
            return null;
        }

        return $_SESSION[self::KEY] = self::shape($row);
    }

    /** @return array<string,mixed> */
    public static function require(): array
    {
        $actor = self::actor();
        if ($actor === null) {
            throw ApiError::unauthorized();
        }
        return $actor;
    }

    /** Test seam — runs $fn as the given actor, then restores. */
    public static function as(?array $actor, callable $fn): mixed
    {
        $previous = self::$override;
        self::$override = $actor;
        try {
            return $fn();
        } finally {
            self::$override = $previous;
        }
    }

    /**
     * บทบาทของบัญชีหนึ่งใบ เรียงจากสิทธิ์มากไปน้อย
     *
     * ผ่าน `Roles::clean()` เสมอ ไม่ได้เชื่อค่าที่อ่านจากฐานตรง ๆ — ค่าที่ ENUM
     * ยอมรับวันนี้อาจเป็นค่าที่โค้ดเลิกรู้จักไปแล้ว และบทบาทที่ไม่มีนิยามคือสิทธิ์
     * ที่ไม่มีใครตอบได้ว่าคืออะไร
     *
     * @return list<string>
     */
    public static function rolesOf(int $adminId): array
    {
        return Roles::clean(array_column(
            Db::all('SELECT role FROM admin_roles WHERE admin_id = ?', [$adminId]),
            'role',
        ));
    }

    /**
     * @param array<string,mixed> $row
     * @param list<string>|null $roles อ่านให้เองถ้าไม่ส่งมา
     * @return array<string,mixed>
     */
    private static function shape(array $row, ?array $roles = null): array
    {
        $roles ??= self::rolesOf((int) $row['id']);

        return [
            'id'          => (int) $row['id'],
            'username'    => $row['username'],
            'displayName' => $row['display_name'],
            'jobTitle'    => $row['job_title'],
            /* บทบาทเป็นรายการเสมอ แม้จะมีใบเดียว — ที่เรียกใช้จะได้ไม่มีสองทาง
               ให้เขียน แล้ววันหนึ่งทางหนึ่งลืมรองรับใบที่สอง */
            'roles'       => $roles,
            'roleNames'   => Roles::namesOf($roles),
            'roleText'    => Roles::text($roles),
            /* สิทธิ์ที่ได้จริงหลังรวมทุกบทบาท — หน้าเว็บใช้ตัวนี้ตัดสินว่าจะวาด
               เมนูไหน แทนที่จะถือสำเนาของกฎไว้อีกชุดแล้วลืมแก้ตอนเพิ่มบทบาท */
            'perms'       => [
                ...Roles::permsOf($roles),
                ...(Roles::issueReceipt($roles, $row['username']) ? ['receipt.issue'] : []),
            ],
            /* หน้าแรกของคนนี้ ตอบจากที่เดียวกับที่ตัดสินสิทธิ์ */
            'home'        => Roles::home($roles),
            'employeeId'  => $row['employee_id'] === null ? null : (int) $row['employee_id'],
            'mustChangePassword' => (bool) ($row['must_change_password'] ?? false),
        ];
    }
}
