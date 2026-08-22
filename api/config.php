<?php
/**
 * TimeOptic API — configuration.
 * Values come from the environment first so nothing secret has to live in git.
 * Defaults match a stock XAMPP install.
 */
declare(strict_types=1);

function env(string $key, ?string $default = null): ?string
{
    $v = getenv($key);
    if ($v === false || $v === '') {
        return $default;
    }
    return $v;
}

// .env support (same file the Node version used)
$envFile = dirname(__DIR__) . '/.env';
if (is_readable($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v, " \t\"'");
        if (getenv($k) === false) {
            putenv("$k=$v");
        }
    }
}

return [
    'db' => [
        'host'     => env('DB_HOST', '127.0.0.1'),
        'port'     => (int) env('DB_PORT', '3306'),
        'user'     => env('DB_USER', 'root'),
        'password' => env('DB_PASS', ''),
        'database' => env('DB_NAME', 'timeoptic'),
        'charset'  => 'utf8mb4',
    ],
    'telegram' => [
        // env always wins over the app_settings table
        'bot_token' => env('TELEGRAM_BOT_TOKEN'),
        'chat_id'   => env('TELEGRAM_CHAT_ID'),
    ],
    // origins allowed to call the API (the Vite dev server)
    'cors_origins' => [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ],
];
