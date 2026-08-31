<?php

declare(strict_types=1);

namespace Optic\Service;

use Optic\Auth;
use Optic\Roles;

/**
 * The one door into stock, for callers already inside this process.
 *
 * `Stock` itself takes an actor id and asks no questions about it — that is
 * correct for a service, and wrong for anything that calls it. Between a caller
 * and `Stock` there are three rules that have to hold every single time:
 *
 *   1. the actor is whoever is signed in, never whoever the caller names;
 *   2. that actor is allowed to move stock;
 *   3. the request carries a source and an idempotency key.
 *
 * Those rules used to live in the HTTP route, which was fine while the route was
 * the only caller. Now the shop-floor code sits in the same project and calls
 * this directly, and a second copy of the rules is a second place for them to
 * drift — the sort of drift nobody notices until the ledger says a sale was made
 * by nobody. So the rules moved here, and the route goes through this door too.
 *
 * What is deliberately *not* here: the cost redaction the HTTP layer does. That
 * trims the answer to what a browser caller may see, and an in-process caller is
 * not a browser — it is the shop's own code, already holding the database.
 */
final class StockGate
{
    /** Goods leaving the shelf — sold, used, or handed to a branch. */
    public static function issue(array $req): array
    {
        return Stock::issue(self::stamped($req));
    }

    /** Several products leaving on one errand, in one transaction. */
    public static function issueMany(array $req): array
    {
        return Stock::issueMany(self::stamped($req));
    }

    /** A basket of ruined material, written off together. */
    public static function scrapMany(array $req): array
    {
        return Stock::scrapMany(self::stamped($req));
    }

    /** Goods destroyed. Kept apart from `issue` so waste never inflates COGS. */
    public static function scrap(array $req): array
    {
        return Stock::scrap(self::stamped($req));
    }

    /** Goods coming back, against the request that took them out. */
    public static function returnStock(array $req): array
    {
        return Stock::returnStock(self::stamped($req));
    }

    /**
     * What is on the shelf, before promising it to anyone.
     *
     * Reading needs a session but not the stock-moving permission — checking
     * whether something is in stock is not moving it.
     */
    public static function availability(string $sku): array
    {
        Auth::require();
        return Stock::availability($sku);
    }

    /**
     * The signed-in actor, stamped onto the request, replacing anything the
     * caller put there.
     *
     * @param array<string,mixed> $req
     * @return array<string,mixed>
     */
    private static function stamped(array $req): array
    {
        $actor = Auth::require();
        Roles::require(Roles::moveStock($actor['role']), 'บันทึกความเคลื่อนไหวสต็อก');

        // Assigned after the merge, not merged in — `+` keeps the left-hand key
        // when both sides have one, which would let a caller name someone else.
        $req['source'] = $req['source'] ?? 'web';
        $req['actor_id'] = $actor['id'];

        return $req;
    }
}
