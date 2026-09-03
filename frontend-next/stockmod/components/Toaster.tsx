"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconAlert, IconCheck, IconClose, IconInfo } from "./Icon";
import { stockHref } from "@/stockmod/lib/paths";

/**
 * สี่โทน กับกฎว่าเมื่อไหร่ใช้อันไหน
 *
 * ถ้าไม่มีกฎ สี่สีจะกลายเป็นสี่สีที่ใครเลือกก็ได้ แล้วสีก็จะเลิกมีความหมายภายใน
 * สองเดือน · กฎคือ **โทนบอกว่าคนอ่านต้องทำอะไรต่อ** ไม่ใช่บอกว่าเรื่องนี้ดีหรือแย่:
 *
 *   success  งานเสร็จตามที่ตั้งใจ — ไม่ต้องทำอะไรต่อ
 *   info     เกิดขึ้นแล้วแต่ไม่มีอะไรเปลี่ยน — ให้รู้ไว้ว่ากดไปแล้วไม่ต้องกดซ้ำ
 *            (API ตอบ `changed: false` หรือ `replayed: true`)
 *   warning  บันทึกสำเร็จ แต่มีเรื่องค้างที่ต้องรู้ — ของติดลบ ยังไม่ลงต้นทุน
 *            ยังมีชิ้นที่ไม่รู้ราคาทุน · งานเดินต่อได้ แต่มีใบที่ต้องตามเก็บ
 *   error    ทำไม่สำเร็จ
 *
 * ค่าพวกนี้ไม่ได้แต่งขึ้นให้ครบสี — `changed`, `replayed`, `costUnknownQty`,
 * `wasOutOfStock` เป็นสิ่งที่ API ตอบกลับมาอยู่แล้ว แค่หน้าจอเคยทิ้งไปเฉย ๆ
 */
type Tone = "success" | "info" | "warning" | "error";

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

const ToastContext = createContext<Record<Tone, Say> | null>(null);

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
 * **ข้อผิดพลาดที่เป็นของช่องกรอก ยังอยู่ใต้ช่องเหมือนเดิม ไม่ย้ายมาที่นี่** —
 * toast หายไปเองใน 6 วิ ส่วนคำว่า "ยอดเงินติดลบไม่ได้" ต้องค้างอยู่ตรงช่องนั้น
 * จนกว่าจะแก้ · `error` ที่นี่มีไว้สำหรับงานที่ไม่มีฟอร์มอยู่บนจอให้แปะ เช่น
 * กดลบจากในแถวของตาราง
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error("useToast ต้องอยู่ภายใต้ ToastProvider");
  }
  return ctx;
}

/**
 * Long enough to read a lot number and a cost, short enough not to pile up.
 *
 * เรื่องที่มีอะไรค้างให้ตามเก็บอยู่นานกว่า — ข้อความที่บอกว่า "ยังไม่ได้ลงต้นทุน"
 * มีประโยชน์ก็ต่อเมื่อคนอ่านทัน ต่างจาก "บันทึกแล้ว" ที่อ่านไม่ทันก็ไม่เสียอะไร
 */
const LIFETIME_MS: Record<Tone, number> = {
  success: 6000,
  info: 6000,
  warning: 10000,
  error: 10000,
};

/** เรื่องที่ต้องขัดจังหวะโปรแกรมอ่านหน้าจอ ไม่ใช่รอให้อ่านถึงคิว */
const LOUD: Record<Tone, boolean> = {
  success: false,
  info: false,
  warning: true,
  error: true,
};

const MARK: Record<Tone, () => React.ReactElement> = {
  success: IconCheck,
  info: IconInfo,
  warning: IconAlert,
  error: IconAlert,
};

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

  const say = useRef<Record<Tone, Say>>({
    success: (t) => push("success", t),
    info: (t) => push("info", t),
    warning: (t) => push("warning", t),
    error: (t) => push("error", t),
  });
  say.current = {
    success: (t) => push("success", t),
    info: (t) => push("info", t),
    warning: (t) => push("warning", t),
    error: (t) => push("error", t),
  };

  /* สองภาชนะ ไม่ใช่ใบเดียว — `aria-live` ตั้งได้ทีเดียวต่อภาชนะ และเรื่องที่ต้อง
     ขัดจังหวะกับเรื่องที่รอคิวได้ต้องอยู่คนละใบ ไม่งั้นทุกข้อความจะดังเท่ากัน
     ซึ่งจบลงที่ไม่มีข้อความไหนดังเลย */
  const quiet = toasts.filter((t) => !LOUD[t.tone]);
  const loud = toasts.filter((t) => LOUD[t.tone]);

  return (
    <ToastContext.Provider value={say.current}>
      {children}
      <div className="toaster">
        <div role="status" aria-live="polite" className="toaster__lane">
          {quiet.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="toaster__lane">
          {loud.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
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
    const t = setTimeout(onDismiss, LIFETIME_MS[toast.tone]);
    return () => clearTimeout(t);
  }, [hovered, onDismiss, toast.tone]);

  const Mark = MARK[toast.tone];

  return (
    <div
      className={`toast toast--${toast.tone}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Shape first, colour second. A green bar and a red bar are the same bar
          to anyone who cannot tell them apart, so the tick, the circle and the
          triangle do the telling and the colour only agrees with them. The word
          next to it is the third way of saying it, for a glance that catches
          none of the other two. */}
      <span className="toast__mark" aria-hidden="true">
        <Mark />
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
