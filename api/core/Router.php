<?php
/**
 * Tiny pattern router. Same shape as the Node one: patterns use :name for
 * a path segment, and handlers get ['params' => …, 'query' => …, 'body' => …].
 */
declare(strict_types=1);

final class Router
{
    /** @var array<int, array{method:string, rx:string, keys:string[], handler:callable}> */
    private static array $routes = [];

    public static function add(string $method, string $pattern, callable $handler): void
    {
        $keys = [];
        $rx = preg_replace_callback(
            '/:([a-z_]+)/i',
            function (array $m) use (&$keys): string {
                $keys[] = $m[1];
                return '([^/]+)';
            },
            $pattern
        );
        self::$routes[] = [
            'method'  => $method,
            'rx'      => '#^' . $rx . '$#',
            'keys'    => $keys,
            'handler' => $handler,
        ];
    }

    /**
     * Dispatch a request. Routes call this on themselves to reuse another
     * endpoint's response, exactly as the Node version did.
     */
    public static function dispatch(string $method, string $path, array $query = [], array $body = []): mixed
    {
        foreach (self::$routes as $r) {
            if ($r['method'] !== $method) {
                continue;
            }
            if (!preg_match($r['rx'], $path, $m)) {
                continue;
            }
            $params = [];
            foreach ($r['keys'] as $i => $k) {
                $params[$k] = urldecode($m[$i + 1]);
            }
            return ($r['handler'])([
                'params' => $params,
                'query'  => $query,
                'body'   => $body,
            ]);
        }
        throw new HttpError(404, "No route for $method $path");
    }

    public static function count(): int
    {
        return count(self::$routes);
    }

    /** Every registered route, for the /api/_routes listing. */
    public static function listing(): array
    {
        $out = [];
        foreach (self::$routes as $r) {
            $out[] = $r['method'] . ' ' . preg_replace('/^\#\^|\$\#$/', '', $r['rx']);
        }
        return $out;
    }
}

/* short registration helpers, mirroring the original route table */
function GET(string $p, callable $h): void
{
    Router::add('GET', $p, $h);
}

function POST(string $p, callable $h): void
{
    Router::add('POST', $p, $h);
}

function PUT(string $p, callable $h): void
{
    Router::add('PUT', $p, $h);
}

function DELETE(string $p, callable $h): void
{
    Router::add('DELETE', $p, $h);
}
