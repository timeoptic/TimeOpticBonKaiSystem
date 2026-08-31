/**
 * A random UUID, on every browser the shop actually uses.
 *
 * `crypto.randomUUID()` exists only in a secure context — HTTPS, or localhost.
 * The shop opens this app over plain http at the server's LAN address, which is
 * not one, so on every machine except the server itself that function is simply
 * missing and calling it throws.
 *
 * `crypto.getRandomValues` has no such restriction, so the fallback is a real
 * version-4 UUID built from it rather than something derived from `Math.random`.
 * That distinction matters here more than it looks: this is what mints the
 * idempotency key for a stock movement. Two withdrawals that collide on a key
 * would have the second silently replayed as the first — the screen would say
 * the stock was cut and the stock would not move.
 */
export function uuid(): string {
  const c = globalThis.crypto;

  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }

  if (typeof c?.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    // Version 4, variant 1, per RFC 4122 — the two fields that say how the
    // other 122 bits were chosen.
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;

    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return (
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
      `${hex.slice(16, 20)}-${hex.slice(20)}`
    );
  }

  // No Web Crypto at all. Every browser released this decade has it, so rather
  // than inventing a weak key and letting a duplicate slip through, say what is
  // wrong — the caller is about to move stock.
  throw new Error("เบราว์เซอร์นี้ไม่รองรับการสุ่มที่ปลอดภัย — อัปเดตเบราว์เซอร์ก่อนใช้งาน");
}
