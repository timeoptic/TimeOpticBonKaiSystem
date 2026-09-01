/**
 * Where this module sits inside the merged web app.
 *
 * The stock module used to be its own Next app rooted at `/`, and its own code
 * still names routes that way: "/products", "/movements", "/lots?state=nocost".
 * Rewriting every literal would mean touching every page for no gain, so the
 * prefix is added in the few places an href is actually handed to Next - the
 * rail, the command palette, the toaster, the drawer - and the literals stay
 * readable as the module's own routes.
 *
 * Note this is not Next's `basePath`: that would move the storefront half too.
 */
export const STOCK_BASE = "/stock";

/** A route named from the module's own root, as a route in the merged app. */
export function stockHref(path: string): string {
  return path === "/" ? `${STOCK_BASE}/` : `${STOCK_BASE}${path}`;
}

/** Trailing slashes are on in next.config.js, so compare paths without one. */
export const trimSlash = (path: string) => path.replace(/\/+$/, "") || "/";
