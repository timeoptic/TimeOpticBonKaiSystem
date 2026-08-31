import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Machines on the shop network that may load this dev server.
   *
   * `next dev` refuses cross-origin requests to `/_next/*` — its chunks, its
   * hot-reload socket — and answers 403 unless the origin is listed here. Open
   * the app by the server's IP without this and the page shell renders, every
   * script behind it fails, and the app hangs on "กำลังตรวจสอบสิทธิ์".
   *
   * Matched by splitting on dots, so `192.168.*.*` covers the whole private
   * range and survives the router handing out a different lease. Only private
   * ranges are listed: a public address cannot reach this machine anyway, and
   * the guard is worth keeping for every other origin.
   *
   * Development only. `next build && next start` has no such block, and is what
   * this should run under once it is more than a trial.
   */
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],

  env: {
    // Left unset on purpose. With no value, lib/api.ts asks the API for the
    // same host that served the page — which is what lets a tablet open
    // http://192.168.1.108:3000 and reach the API on the same machine without
    // anyone editing a config file. Set this only to point somewhere else.
    ...(process.env.NEXT_PUBLIC_API_BASE
      ? { NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE }
      : {}),
  },
};

export default nextConfig;
