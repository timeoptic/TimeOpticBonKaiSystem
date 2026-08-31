<?php

declare(strict_types=1);

namespace Optic;

/**
 * The thin layer between HTTP and everything else.
 *
 * Handlers take arrays and return arrays; this file is the only place that
 * knows about status codes, headers and JSON. That is what lets the same
 * handlers be called directly once this merges into the shop-floor project and
 * the HTTP hop disappears.
 */
final class Http
{
    /** @var list<array{method:string,parts:list<string>,handler:callable}> */
    private static array $routes = [];

    /**
     * The URL prefix this API answers on when a host application owns the port.
     *
     * Empty when it runs as its own server, which is how it was written and how
     * `api/public/index.php` still starts on its own. Mounted inside the
     * shop-floor API, both halves sit behind one origin and both would like to
     * be called `/api`, so this half moves aside: `/stock-api/products` on the
     * wire, `/api/products` in the route table. The routes themselves do not
     * change, so neither does anything that calls a handler directly.
     */
    private static string $mount = '';

    /**
     * Whether this class answers CORS itself.
     *
     * The host application already did when mounted, and two
     * `Access-Control-Allow-Origin` headers are worse than none — browsers
     * reject the pair outright, which reads as the API being down.
     */
    private static bool $ownsCors = true;

    public static function mountUnder(string $prefix): void
    {
        self::$mount = rtrim($prefix, '/');
        self::$ownsCors = false;
    }

    public static function route(string $method, string $path, callable $handler): void
    {
        self::$routes[] = [
            'method'  => strtoupper($method),
            'parts'   => array_values(array_filter(explode('/', trim($path, '/')), strlen(...))),
            'handler' => $handler,
        ];
    }

    public static function get(string $path, callable $h): void { self::route('GET', $path, $h); }
    public static function post(string $path, callable $h): void { self::route('POST', $path, $h); }

    /** @return array<string,mixed> */
    public static function body(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw ApiError::badRequest('เนื้อหาของคำขอไม่ใช่ JSON ที่ถูกต้อง', 'bad_json');
        }
        return $data;
    }

    public static function query(string $key, ?string $default = null): ?string
    {
        $v = $_GET[$key] ?? null;
        if (!is_string($v)) {
            return $default;
        }
        $v = trim($v);
        return $v === '' ? $default : mb_substr($v, 0, 200);
    }

    /**
     * The browser sends the session cookie cross-origin only when the response
     * names the exact origin and allows credentials — a wildcard will not do.
     */
    private static function cors(): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allowed = array_map(
            trim(...),
            explode(',', Env::get('API_ALLOWED_ORIGINS', 'http://localhost:3000') ?? ''),
        );

        $ok = $origin !== ''
            && (in_array($origin, $allowed, true) || self::isLanOrigin($origin));

        if ($ok) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Credentials: true');
            header('Vary: Origin');
        }
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
    }

    /**
     * Whether an origin is a machine on the shop's own network.
     *
     * Off unless `API_ALLOW_LAN=1` says otherwise. With it on, any browser on a
     * private address may call the API, which is what lets the till, the tablet
     * and the back-office PC all open the app by the server's IP without anyone
     * maintaining a list of them — the address changes when a device reconnects,
     * and a stale list is a support call.
     *
     * Only private ranges, never a public address, and only over plain http —
     * a machine on the internet can neither hold one of these addresses nor
     * reach the server, so widening this does not widen the way in. The session
     * cookie is still what decides whether a caller sees anything at all.
     */
    public static function isLanOrigin(string $origin): bool
    {
        if (Env::get('API_ALLOW_LAN', '0') !== '1') {
            return false;
        }

        $parts = parse_url($origin);
        $host = $parts['host'] ?? '';
        if (($parts['scheme'] ?? '') !== 'http' || $host === '') {
            return false;
        }

        // localhost keeps working whatever the list says — that is the machine
        // the server is running on.
        if ($host === 'localhost' || $host === '127.0.0.1' || $host === '::1') {
            return true;
        }

        return filter_var(
            $host,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
        ) === false && filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
    }

    /** @param array<string,mixed>|list<mixed> $data */
    public static function json(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function dispatch(): void
    {
        if (self::$ownsCors) {
            self::cors();

            if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
                http_response_code(204);
                exit;
            }
        }

        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

        // Mounted: the prefix comes off and `/api` goes on, so the route table
        // reads the same whether this is a server or a guest inside one.
        if (self::$mount !== '' && str_starts_with($path, self::$mount)) {
            $path = '/api' . substr($path, strlen(self::$mount));
        }

        $parts = array_values(array_filter(explode('/', trim($path, '/')), strlen(...)));

        try {
            // Two passes, because a wildcard segment can shadow a literal one:
            // `/api/stock/{sku}` has the same shape as `/api/stock/issue`, so
            // deciding on the first path match would answer 405 for a POST that
            // has a perfectly good route further down the list. Method first,
            // and only fall back to 405 when the path matched but no verb did.
            $pathMatched = false;

            foreach (self::$routes as $r) {
                $params = self::match($r['parts'], $parts);
                if ($params === null) {
                    continue;
                }
                $pathMatched = true;
                if ($r['method'] === $method) {
                    self::json(($r['handler'])($params));
                }
            }

            if ($pathMatched) {
                throw new ApiError(405, 'method_not_allowed', "เส้นทางนี้ไม่รองรับ {$method}");
            }

            throw ApiError::notFound("ไม่พบเส้นทาง {$path}");
        } catch (ApiError $e) {
            self::json($e->payload(), $e->status);
        } catch (\Throwable $e) {
            // Never leak a stack trace or a query to the caller. The log keeps
            // the detail; the response says only that it was our fault.
            error_log('[api] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            self::json([
                'reason'  => 'server_error',
                'message' => 'ระบบขัดข้อง ลองใหม่อีกครั้ง หรือแจ้งผู้ดูแลระบบ',
            ], 500);
        }
    }

    /**
     * @param list<string> $pattern
     * @param list<string> $actual
     * @return array<string,string>|null
     */
    private static function match(array $pattern, array $actual): ?array
    {
        if (count($pattern) !== count($actual)) {
            return null;
        }

        $params = [];
        foreach ($pattern as $i => $seg) {
            if (str_starts_with($seg, '{') && str_ends_with($seg, '}')) {
                $params[trim($seg, '{}')] = rawurldecode($actual[$i]);
                continue;
            }
            if ($seg !== $actual[$i]) {
                return null;
            }
        }
        return $params;
    }
}
