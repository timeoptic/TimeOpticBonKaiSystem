<?php

declare(strict_types=1);

namespace Optic;

/**
 * Reads the repo-root .env once.
 *
 * The Next frontend and this API share a single .env so they can never disagree
 * about which database they are talking to.
 */
final class Env
{
    /** @var array<string,string>|null */
    private static ?array $values = null;

    public static function load(?string $path = null): void
    {
        $path ??= dirname(__DIR__, 2) . '/.env';

        $values = [];
        if (is_readable($path)) {
            foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#')) {
                    continue;
                }
                $eq = strpos($line, '=');
                if ($eq === false) {
                    continue;
                }
                $key = trim(substr($line, 0, $eq));
                $val = trim(substr($line, $eq + 1));
                // Strip one layer of surrounding quotes, if present.
                if (strlen($val) >= 2 && ($val[0] === '"' || $val[0] === "'") && $val[-1] === $val[0]) {
                    $val = substr($val, 1, -1);
                }
                $values[$key] = $val;
            }
        }

        self::$values = $values;
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        if (self::$values === null) {
            self::load();
        }

        // A real environment variable always wins over the file, so a deployment
        // can override without editing anything on disk.
        $fromEnv = getenv($key);
        if ($fromEnv !== false && $fromEnv !== '') {
            return $fromEnv;
        }

        return self::$values[$key] ?? $default;
    }

    public static function require(string $key): string
    {
        $v = self::get($key);
        if ($v === null || $v === '') {
            throw new \RuntimeException("ไม่พบค่า {$key} ใน .env");
        }
        return $v;
    }

    /**
     * Splits the mysql:// URL that Prisma and this API share.
     *
     * @return array{host:string,port:int,user:string,pass:string,name:string}
     */
    public static function database(): array
    {
        $url = self::require('DATABASE_URL');
        $p = parse_url($url);
        if ($p === false || !isset($p['host'], $p['user'], $p['path'])) {
            throw new \RuntimeException('DATABASE_URL อ่านไม่ออก — ต้องเป็น mysql://user:pass@host:port/dbname');
        }

        return [
            'host' => $p['host'],
            'port' => $p['port'] ?? 3306,
            'user' => rawurldecode($p['user']),
            // Percent-encoded passwords are normal here; @ and # must be escaped.
            'pass' => rawurldecode($p['pass'] ?? ''),
            'name' => ltrim($p['path'], '/'),
        ];
    }
}
