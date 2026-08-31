"use client";

import { useEffect, useRef, useState } from "react";
import useDropBox from "./dropbox";
import { date as readable } from "@/stockmod/lib/format";

const pad = (n: number) => String(n).padStart(2, "0");

/** The wire format, which is also what the DATE columns hold. */
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Read a stored date as a *local* date.
 *
 * `new Date("2026-08-29")` is parsed as UTC and, seven hours east of it, comes
 * back as the 28th. Building it from the parts keeps the day that was stored.
 */
function parse(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const shift = (d: Date, days: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

const month = (d: Date, by: number) => new Date(d.getFullYear(), d.getMonth() + by, 1);

/** "สิงหาคม 2569" — Thai months and the Buddhist year, as the shop writes them. */
const heading = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" });

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/**
 * A date field with a calendar, instead of the browser's own.
 *
 * The native `<input type="date">` renders differently in every browser, shows
 * the date in whatever order the OS is set to, and — the part that actually
 * costs time here — puts the Gregorian year in front of people who read
 * Buddhist ones. This picker shows the month the way the shop says it, marks
 * today, and lets a whole date be chosen in one tap rather than three spinners.
 *
 * The value stays exactly what it was: a `YYYY-MM-DD` string, the same thing
 * the DATE columns hold, so nothing downstream has to know this changed.
 */
export default function DateField({
  id,
  value,
  onChange,
  disabled = false,
  className = "",
  placeholder = "เลือกวันที่",
  /** Offer a "ล้าง" button — hidden where the date is required. */
  clearable = true,
  min,
  max,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  clearable?: boolean;
  /** `YYYY-MM-DD` bounds, the same ones `<input type="date">` took. */
  min?: string;
  max?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const box = useDropBox(open, face, 300, 420);

  const today = new Date();
  const picked = parse(value);

  /** The month on show, and the day the keyboard is on. */
  const [cursor, setCursor] = useState<Date>(picked ?? today);

  // Opening on a field that already has a date should land on that date's
  // month, not on wherever the calendar was left last time.
  useEffect(() => {
    if (open) setCursor(parse(value) ?? new Date());
  }, [open, value]);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = shift(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => shift(start, i));

  // ISO dates sort as strings, so a range check needs nothing cleverer.
  const outOfRange = (d: Date) => {
    const s = iso(d);
    return (min !== undefined && min !== "" && s < min) || (max !== undefined && max !== "" && s > max);
  };

  function choose(d: Date) {
    if (outOfRange(d)) return;
    onChange(iso(d));
    setOpen(false);
  }

  function keys(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    const by: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in by) {
      e.preventDefault();
      setCursor((c) => shift(c, by[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      setCursor((c) => month(c, e.key === "PageUp" ? -1 : 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(cursor);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const same = (a: Date, b: Date | null) => b !== null && iso(a) === iso(b);

  return (
    <div
      className="datefield"
      ref={wrap}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOpen(false);
      }}
    >
      <button
        ref={face}
        id={id}
        type="button"
        className={`input datefield__face ${className}`.trim()}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={keys}
      >
        <span className={picked ? "" : "datefield__hint"}>
          {picked ? readable(value) : placeholder}
        </span>
        <span className="datefield__icon" aria-hidden="true">
          ▦
        </span>
      </button>

      {open ? (
        <div
          className="cal"
          style={box}
          role="dialog"
          aria-label="เลือกวันที่"
          // Keeps focus on the field, so the blur above never races the click.
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="cal__head">
            <button
              type="button"
              className="cal__nav"
              aria-label="เดือนก่อนหน้า"
              onClick={() => setCursor((c) => month(c, -1))}
            >
              ‹
            </button>
            <span className="cal__month">{heading.format(first)}</span>
            <button
              type="button"
              className="cal__nav"
              aria-label="เดือนถัดไป"
              onClick={() => setCursor((c) => month(c, 1))}
            >
              ›
            </button>
          </div>

          <div className="cal__week" aria-hidden="true">
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="cal__wd">
                {w}
              </span>
            ))}
          </div>

          <div className="cal__grid">
            {days.map((d) => {
              const outside = d.getMonth() !== cursor.getMonth();
              return (
                <button
                  key={iso(d)}
                  type="button"
                  className="cal__day"
                  data-outside={outside ? "true" : undefined}
                  data-today={same(d, today) ? "true" : undefined}
                  data-on={same(d, picked) ? "true" : undefined}
                  data-at={same(d, cursor) ? "true" : undefined}
                  aria-pressed={same(d, picked)}
                  disabled={outOfRange(d)}
                  onClick={() => choose(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="cal__foot">
            <button type="button" className="btn btn--quiet btn--small" onClick={() => choose(new Date())}>
              วันนี้
            </button>
            {clearable && value !== "" ? (
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                ล้างวันที่
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
