"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

type State<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

/**
 * GET a path and keep the three states a screen actually has to render.
 *
 * The distinction that matters: an empty result and a failed request look the
 * same if you only track `data`, and a screen that renders "ไม่มีข้อมูล" when the
 * API is down tells the user a comfortable lie.
 */
export function useApi<T>(path: string | null): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ status: "loading", data: null, error: null });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (path === null) return;

    let alive = true;
    setState({ status: "loading", data: null, error: null });

    api
      .get<T>(path)
      .then((data) => {
        if (alive) setState({ status: "ready", data, error: null });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // 401 is handled by the shell, which redirects. Rendering our own error
        // here would flash a message on the way to the sign-in screen.
        if (ApiError.is(e) && e.isAuth) return;
        setState({
          status: "error",
          data: null,
          error: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ",
        });
      });

    return () => {
      alive = false;
    };
  }, [path, nonce]);

  return { ...state, reload };
}

/** Builds a query string, leaving out anything empty. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
