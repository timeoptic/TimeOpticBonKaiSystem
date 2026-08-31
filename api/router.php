<?php
/**
 * Router for the PHP built-in dev server:
 *
 *   php -S 127.0.0.1:8080 -t api api/router.php
 *
 * Apache does not use this file — it uses .htaccess.
 */
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// let the built-in server serve a real file if one exists
$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
    return false;
}

require __DIR__ . '/index.php';
