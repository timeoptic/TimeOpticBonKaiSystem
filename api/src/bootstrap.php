<?php

declare(strict_types=1);

/**
 * PSR-4 autoloader for the `Optic\` namespace, hand-written on purpose.
 *
 * The project has no Composer dependency, so there is nothing to install before
 * it runs — `php public/index.php` and `php tests/run.php` work on a clean
 * machine. When this merges into a framework that already uses Composer, delete
 * this file and add `"Optic\\": "api/src/"` to that project's autoload map;
 * nothing else changes.
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'Optic\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';

    if (is_file($path)) {
        require $path;
    }
});

require_once __DIR__ . '/Errors.php';

\Optic\Env::load();
