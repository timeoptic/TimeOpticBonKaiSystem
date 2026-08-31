"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A figure you can correct where it is written.
 *
 * Built because the alternative had spread: a price lived on one screen, a
 * lot's cost on a second, its count on a third, and each had grown its own
 * form. One number, one place, one control — click it, type, save. Nothing
 * moves on the page while you do, so the row you were reading is still the row
 * you are reading.
 *
 * Saving is the caller's job. This only knows how to ask for a value and get
 * out of the way.
 */
export default function InlineEdit({
  value,
  display,
  onSave,
  label,
  placeholder,
  suffix,
  empty = "—",
  disabled = false,
  numeric = true,
  /** Refuse to save the same thing again — a no-op write is still a write. */
  allowSame = false,
}: {
  /** What is stored now, as text — and what the field is seeded with. */
  value: string;
  /** How it reads when not being edited. Defaults to `value`. */
  display?: string;
  onSave: (next: string) => Promise<void>;
  /** Read out to screen readers in place of the pencil. */
  label: string;
  placeholder?: string;
  suffix?: string;
  empty?: string;
  disabled?: boolean;
  numeric?: boolean;
  allowSame?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  // A value corrected elsewhere — another row, another tab — must not be
  // overwritten by a draft this field was still holding from before.
  useEffect(() => {
    if (!open) setDraft(value);
  }, [open, value]);

  async function save() {
    if (!allowSame && draft.trim() === value.trim()) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onSave(draft.trim());
      setOpen(false);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <span className="inline-edit">
        <span className={value === "" ? "inline-edit__empty" : "inline-edit__value"}>
          {value === "" ? empty : (display ?? value)}
          {value !== "" && suffix ? ` ${suffix}` : ""}
        </span>
        {disabled ? null : (
          <button
            type="button"
            className="inline-edit__pen"
            onClick={() => setOpen(true)}
            aria-label={`แก้ ${label}`}
            title={`แก้ ${label}`}
          >
            ✎
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="inline-edit inline-edit--open">
      <input
        ref={box}
        className="input input--inline"
        inputMode={numeric ? "decimal" : undefined}
        value={draft}
        placeholder={placeholder}
        disabled={busy}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(value);
            setOpen(false);
          }
        }}
      />
      <button type="button" className="inline-edit__ok" onClick={save} disabled={busy}>
        {busy ? "…" : "✓"}
      </button>
      <button
        type="button"
        className="inline-edit__no"
        onClick={() => {
          setDraft(value);
          setOpen(false);
        }}
        disabled={busy}
      >
        ✕
      </button>
      {problem ? <span className="inline-edit__problem">{problem}</span> : null}
    </span>
  );
}
