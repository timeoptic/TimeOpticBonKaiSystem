"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconAlert, IconCheck, IconClose } from "./Icon";
import { stockHref } from "@/stockmod/lib/paths";

type Tone = "ok" | "error";

export type Toast = {
  id: number;
  tone: Tone;
  /** The one line someone reads while already looking at the next thing. */
  text: string;
  /** The detail under it — what was cut, from which lot, at what cost. */
  detail?: string;
  /** Optional way back to what just happened. */
  link?: { href: string; label: string };
};

type Say = (t: Omit<Toast, "id" | "tone">) => void;

const ToastContext = createContext<{ ok: Say; error: Say } | null>(null);

/**
 * Telling someone what happened without making them acknowledge it.
 *
 * The forms used to answer a save by growing a green panel and staying open.
 * That is fine the first time and wrong by the tenth: the work is finished, the
 * next customer is waiting, and the screen is still showing the last one's
 * details with a notice above them that has to be read around. Closing the form
 * and saying it in a corner returns the screen to the next job immediately, and
 * still says what happened for as long as it takes to read it.
 *
 * Failures do not come through here. An error is not news to glance at — it
 * needs the field it belongs to and it has to stay until it is dealt with, so
 * the forms keep showing those inline.
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error("useToast ต้องอยู่ภายใต้ ToastProvider");
  }
  return ctx;
}

/** Long enough to read a lot number and a cost, short enough not to pile up. */
const LIFETIME_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((tone: Tone, t: Omit<Toast, "id" | "tone">) => {
    const id = next.current++;
    // Newest on top, and never more than a handful: a stack taller than the
    // screen is a log, and a log belongs on the movements page.
    setToasts((list) => [{ ...t, id, tone }, ...list].slice(0, 4));
  }, []);

  const say = useRef({
    ok: (t: Omit<Toast, "id" | "tone">) => push("ok", t),
    error: (t: Omit<Toast, "id" | "tone">) => push("error", t),
  });
  say.current = {
    ok: (t) => push("ok", t),
    error: (t) => push("error", t),
  };

  return (
    <ToastContext.Provider value={say.current}>
      {children}
      <div className="toaster" role="status" aria-live="polite">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    // Reading it should not race the timer. Pointing at a toast holds it open,
    // which is the only way to follow a link inside one on a slow read.
    if (hovered) return;
    const t = setTimeout(onDismiss, LIFETIME_MS);
    return () => clearTimeout(t);
  }, [hovered, onDismiss]);

  return (
    <div
      className={toast.tone === "ok" ? "toast toast--ok" : "toast toast--error"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Shape first, colour second. A green bar and a red bar are the same bar
          to anyone who cannot tell them apart, so the tick and the triangle do
          the telling and the colour only agrees with them. The word next to it
          is the third way of saying it, for a glance that catches none of the
          other two. */}
      <span className="toast__mark" aria-hidden="true">
        {toast.tone === "ok" ? <IconCheck /> : <IconAlert />}
      </span>
      <div className="toast__body">
        <p className="toast__text">{toast.text}</p>
        {toast.detail ? <p className="toast__detail">{toast.detail}</p> : null}
        {toast.link ? (
          <Link href={stockHref(toast.link.href)} className="toast__link" onClick={onDismiss}>
            {toast.link.label}
          </Link>
        ) : null}
      </div>
      <button type="button" className="toast__close" onClick={onDismiss} aria-label="ปิดข้อความ">
        <IconClose />
      </button>
    </div>
  );
}
