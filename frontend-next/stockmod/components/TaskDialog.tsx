"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { IconClose } from "./Icon";
import backdropClose from "./backdrop";
import useScrollLock from "@/stockmod/lib/scrollLock";

/**
 * The form for the product just picked, over the list it was picked from.
 *
 * These screens are a list and a form, and the form only exists once a row is
 * chosen. Inline, that form pushed the list off the bottom of the screen: the
 * shelf you were reading disappeared the moment you chose from it, and picking
 * the next thing meant scrolling back up past a form you had finished with. In
 * a dialog the list stays where it was — closing this puts you back on the same
 * row, in the same place, which is the whole point when the next lens of the
 * pair is three rows down.
 *
 * Closing is the caller's business: `onClose` fires for the button, for Escape
 * and for a click on the backdrop alike, so a page has one place to decide what
 * "never mind" means.
 */
export default function TaskDialog({
  eyebrow,
  title,
  head,
  wide = false,
  onClose,
  children,
}: {
  /** Wide enough for a table inside — a picker, rather than a form. */
  wide?: boolean;
  /** The task, in small type above the name. */
  eyebrow: string;
  /** Usually the product's name — what this form is about. */
  title: ReactNode;
  /** Optional line under the title: the spec, the stock, whatever identifies it. */
  head?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  /* กล่องนี้ถูกวาดก็ต่อเมื่อมันเปิด — ล็อกได้ตลอดอายุของคอมโพเนนต์ */
  useScrollLock(true);

  return (
    <dialog
      className={wide ? "drawer drawer--wide" : "drawer"}
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={backdropClose}
    >
      <div className="drawer__inner">
        <header className="drawer__head">
          <div>
            <p className="drawer__eyebrow">{eyebrow}</p>
            <h2 className="drawer__title">{title}</h2>
          </div>
          <button
            type="button"
            className="btn btn--quiet btn--icon drawer__close"
            onClick={() => ref.current?.close()}
          >
            <IconClose />
            ปิด
          </button>
        </header>
        {head ? <div className="drawer__lede">{head}</div> : null}
        <section className="drawer__section">{children}</section>
      </div>
    </dialog>
  );
}
