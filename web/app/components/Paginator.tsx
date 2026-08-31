"use client";

import { count } from "@/lib/format";

/**
 * Page controls for a list.
 *
 * Deliberately plain: first / previous / next / last plus "หน้า 3 จาก 12".
 * A numbered strip would look busier and buy nothing here — nobody knows which
 * page a given SKU is on, so they either step through or search instead.
 *
 * Renders nothing at all when everything fits on one page. A disabled control
 * that can never do anything is noise on a screen meant to be scanned.
 */
export default function Paginator({
  page,
  perPage,
  total,
  onPage,
  label,
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (next: number) => void;
  /** Plural noun for the count, e.g. "รายการ" or "ล็อต". */
  label: string;
}) {
  const last = Math.max(1, Math.ceil(total / perPage));
  if (last <= 1) {
    return (
      <p className="pager__only" role="status">
        {count(total)} {label}
      </p>
    );
  }

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <nav className="pager" aria-label="แบ่งหน้ารายการ">
      <p className="pager__count" role="status">
        {count(from)}–{count(to)} จาก {count(total)} {label}
      </p>

      <div className="pager__controls">
        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={() => onPage(1)}
          disabled={page <= 1}
        >
          หน้าแรก
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          ก่อนหน้า
        </button>

        <span className="pager__here">
          หน้า {count(page)} จาก {count(last)}
        </span>

        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={() => onPage(page + 1)}
          disabled={page >= last}
        >
          ถัดไป
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={() => onPage(last)}
          disabled={page >= last}
        >
          หน้าสุดท้าย
        </button>
      </div>
    </nav>
  );
}
