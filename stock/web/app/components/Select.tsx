"use client";

import { useEffect, useRef, useState } from "react";
import useDropBox from "./dropbox";

/**
 * One line in the list.
 *
 * `value` is what the form keeps and `label` is what is read — kept short,
 * because a list of long lines is a list nobody scans. `keywords` is searched
 * as well but never shown, which is how a product stays findable by its code
 * without that code sitting on screen beside every name.
 */
export type Choice = { value: string; label: string; keywords?: string };

/**
 * A `<select>` you can type into — and, with `free`, a text field that offers
 * back what the catalogue already says.
 *
 * Nearly every list in here is a list of things the shop owns — suppliers,
 * branches, staff, powers — and those lists only grow. A native select answers
 * "which one?" by making someone scroll past all the others, which is fine at
 * five entries and useless at eighty. So the picker is a combobox instead:
 * closed it reads exactly like the select it replaced, focused it filters as
 * you type. Short lists lose nothing — the search is the field itself, not an
 * extra box bolted on top — so the same control can be used everywhere and the
 * screens stay consistent.
 *
 * `free` flips which side is in charge. A closed picker refuses anything not on
 * the list, which is right for a branch and wrong for a product name: the first
 * Zeiss frame has to be enterable on the day it arrives. In free mode whatever
 * is typed *is* the value and the list is only a set of suggestions — it exists
 * so the same frame does not get typed three different ways, not to rule out a
 * fourth.
 *
 * The list is positioned `fixed` and left inside the component rather than
 * portalled to `<body>`. Most of these sit in a `<dialog>`, and the dialog is
 * in the top layer: a portal into the body would render *underneath* it. A
 * fixed child of the dialog still escapes the drawer's own scroll clipping,
 * which is the only thing the portal was ever wanted for.
 */
export default function Select({
  id,
  value,
  onChange,
  options,
  disabled = false,
  className = "",
  placeholder = "— ไม่ระบุ —",
  free = false,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly Choice[];
  disabled?: boolean;
  /** Extra classes for the field, e.g. `input--inline`. */
  className?: string;
  /** Shown when nothing is chosen yet. */
  placeholder?: string;
  /** Take anything typed, and treat the options as suggestions. */
  free?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * Which row the keyboard is on, or -1 for none.
   *
   * A picker starts on the current choice, so Enter repeats it. A free field
   * starts on nothing, because there Enter means "keep what I typed" — landing
   * it on the nearest suggestion would rewrite a new product's name into an old
   * one at the last keystroke.
   */
  const [at, setAt] = useState(-1);
  const box = useDropBox(open, face);

  const chosen = options.find((o) => o.value === value);

  // In free mode the field's own text is the filter; there is no separate query
  // to keep, and none of the suggestions is "current" until one is picked.
  const typed = free ? value : query;
  const q = typed.trim().toLowerCase();
  const shown =
    q === ""
      ? options
      : options.filter((o) => `${o.label} ${o.keywords ?? ""}`.toLowerCase().includes(q));

  // Keyboard moves the highlight; the highlight has to stay on screen for that
  // to mean anything once the list is longer than its own box.
  useEffect(() => {
    if (!open || at < 0) return;
    list.current?.children[at]?.scrollIntoView({ block: "nearest" });
  }, [open, at]);

  function show() {
    if (disabled || open) return;
    setQuery("");
    setAt(free ? -1 : options.findIndex((o) => o.value === value));
    setOpen(true);
  }

  function hide() {
    setOpen(false);
    setQuery("");
  }

  function pick(o: Choice) {
    onChange(o.value);
    hide();
  }

  function keys(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        show();
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setAt((i) => {
        if (shown.length === 0) return -1;
        // A free field has one extra stop below the first row: the text the
        // person typed, which they must be able to arrow back to.
        const first = free ? -1 : 0;
        const next = i + step;
        if (next > shown.length - 1) return first;
        if (next < first) return shown.length - 1;
        return next;
      });
    } else if (e.key === "Enter") {
      // Only when a row is actually highlighted — otherwise this is Enter in a
      // form field, which belongs to the form.
      if (open && at >= 0 && shown[at]) {
        e.preventDefault();
        pick(shown[at]);
      } else if (open) {
        hide();
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        hide();
      }
    } else if (e.key === "Tab") {
      hide();
    }
  }

  const label = chosen?.label ?? "";

  return (
    <div
      className={free ? "combo combo--free" : "combo"}
      ref={wrap}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        hide();
      }}
    >
      <input
        ref={face}
        id={id}
        className={`input combo__input ${className}`.trim()}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={id ? `${id}-list` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={free ? value : open ? query : label}
        // While a picker is open the field is empty and waiting to be typed in,
        // so it says so — the current choice is marked in the list underneath.
        placeholder={open && !free ? "พิมพ์เพื่อค้นหา…" : placeholder}
        onChange={(e) => {
          if (free) {
            onChange(e.target.value);
            setAt(-1);
          } else {
            setQuery(e.target.value);
            setAt(e.target.value.trim() === "" ? -1 : 0);
          }
          if (!open) setOpen(true);
        }}
        onMouseDown={show}
        onFocus={show}
        onKeyDown={keys}
      />
      {open || !free ? (
        <span className="combo__caret" aria-hidden="true">
          {open ? "⌕" : "▾"}
        </span>
      ) : null}

      {open ? (
        <ul
          id={id ? `${id}-list` : undefined}
          className="combo__list"
          role="listbox"
          ref={list}
          style={box}
          // Keeps focus in the field, so the blur above never races the click.
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.length === 0 ? (
            <li className="combo__empty">
              {free
                ? "ยังไม่มีในระบบ — พิมพ์ต่อได้เลย ระบบจะเก็บตามที่พิมพ์"
                : `ไม่พบตัวเลือกที่ตรงกับ “${typed.trim()}”`}
            </li>
          ) : (
            shown.map((o, i) => (
              <li
                key={o.value}
                className="combo__opt"
                role="option"
                aria-selected={o.value === value}
                data-at={i === at ? "true" : undefined}
                onMouseEnter={() => setAt(i)}
                onClick={() => pick(o)}
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
