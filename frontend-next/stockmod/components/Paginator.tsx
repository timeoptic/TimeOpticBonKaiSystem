"use client";

import { useEffect, useState } from "react";
import { count } from "@/stockmod/lib/format";

/**
 * Page controls for a list — แบบที่ร้านส่งมา 27 ต.ค. 2026
 *
 *   หน้า [ 1 ] จาก 10   « ‹ 1 2 3 … 8 9 10 › »   แถวต่อหน้า [ 25 ▾ ]
 *
 * ช่องเลขหน้าพิมพ์กระโดดได้ (Enter หรือออกจากช่อง) · ตัวเลขหน้าแสดงหัว ท้าย และรอบหน้าปัจจุบัน
 * ที่เหลือย่อเป็น … · "แถวต่อหน้า" ขึ้นเฉพาะรายการที่ส่ง `onPerPage` มา เพราะ API บางเส้น
 * ยังรับขนาดหน้าไม่ได้ — ปุ่มที่กดแล้วไม่มีอะไรเปลี่ยนแย่กว่าไม่มีปุ่ม
 *
 * Renders only the count when everything fits on one page and the size cannot
 * be changed. A disabled control that can never do anything is noise.
 */

/** ขนาดหน้าที่เลือกได้ — API ตัดที่ 100 (`Inventory::PER_PAGE_MAX`) */
const SIZES = [10, 25, 50, 100];

/**
 * ขนาดหน้าที่คนนี้เลือกไว้สำหรับรายการนี้ จำในเบราว์เซอร์ (เปิดหน้าใหม่ไม่ต้องเลือกซ้ำ)
 *
 * `null` = ยังไม่เคยเลือก ใช้ค่าปกติของ API
 */
export function usePerPage(key: string): [number | null, (n: number) => void] {
  const storeKey = `pager-per:${key}`;
  const [per, setPer] = useState<number | null>(null);

  useEffect(() => {
    try {
      const n = Number(localStorage.getItem(storeKey));
      if (SIZES.includes(n)) setPer(n);
    } catch {
      /* อ่านไม่ได้ก็ใช้ค่าปกติ */
    }
  }, [storeKey]);

  function choose(n: number) {
    setPer(n);
    try {
      localStorage.setItem(storeKey, String(n));
    } catch {
      /* เก็บไม่ได้ก็แค่ไม่จำ */
    }
  }

  return [per, choose];
}

/** หน้าที่จะแสดงเป็นตัวเลข — `0` คือ … */
function pages(page: number, last: number): number[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const keep = new Set([1, 2, 3, last - 2, last - 1, last, page - 1, page, page + 1]);
  const list = [...keep].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const out: number[] = [];
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) out.push(0);
    out.push(n);
  });
  return out;
}

const Chevron = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export default function Paginator({
  page,
  perPage,
  total,
  onPage,
  onPerPage,
  label,
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (next: number) => void;
  /** เปลี่ยนจำนวนแถวต่อหน้า — ไม่ส่งมา = ไม่มีช่องนี้ */
  onPerPage?: (n: number) => void;
  /** Plural noun for the count, e.g. "รายการ" or "ล็อต". */
  label: string;
}) {
  const last = Math.max(1, Math.ceil(total / perPage));
  const [typed, setTyped] = useState(String(page));
  useEffect(() => setTyped(String(page)), [page]);

  if (last <= 1 && (!onPerPage || total <= SIZES[0])) {
    return (
      <p className="pager__only" role="status">
        {count(total)} {label}
      </p>
    );
  }

  function jump() {
    const n = Number.parseInt(typed, 10);
    if (Number.isFinite(n) && n >= 1 && n <= last && n !== page) onPage(n);
    else setTyped(String(page));
  }

  const sizes = SIZES.includes(perPage) ? SIZES : [...SIZES, perPage].sort((a, b) => a - b);

  return (
    <nav className="pager" aria-label="แบ่งหน้ารายการ">
      <div className="pager__where">
        <label htmlFor={`pg-${label}`}>หน้า</label>
        <input
          id={`pg-${label}`}
          className="pager__input"
          inputMode="numeric"
          value={typed}
          onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
          onBlur={jump}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              jump();
            }
          }}
          aria-label="เลขหน้า"
        />
        <span>
          จาก {count(last)} <span className="pager__total">· {count(total)} {label}</span>
        </span>
      </div>

      <div className="pager__controls">
        <button type="button" className="pager__btn pager__btn--edge" onClick={() => onPage(1)} disabled={page <= 1} aria-label="หน้าแรก" title="หน้าแรก">
          <Chevron d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
        </button>
        <button type="button" className="pager__btn pager__btn--edge" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="ก่อนหน้า" title="ก่อนหน้า">
          <Chevron d="m15 18-6-6 6-6" />
        </button>

        <span className="pager__nums">
          {pages(page, last).map((n, i) =>
            n === 0 ? (
              <span key={`gap-${i}`} className="pager__gap" aria-hidden="true">…</span>
            ) : (
              <button
                key={n}
                type="button"
                className="pager__btn pager__num"
                aria-current={n === page ? "page" : undefined}
                onClick={() => onPage(n)}
              >
                {count(n)}
              </button>
            ),
          )}
        </span>

        <button type="button" className="pager__btn pager__btn--edge" onClick={() => onPage(page + 1)} disabled={page >= last} aria-label="ถัดไป" title="ถัดไป">
          <Chevron d="m9 18 6-6-6-6" />
        </button>
        <button type="button" className="pager__btn pager__btn--edge" onClick={() => onPage(last)} disabled={page >= last} aria-label="หน้าสุดท้าย" title="หน้าสุดท้าย">
          <Chevron d="m13 17 5-5-5-5M6 17l5-5-5-5" />
        </button>
      </div>

      {onPerPage ? (
        <div className="pager__size">
          <label htmlFor={`pp-${label}`}>แถวต่อหน้า</label>
          <select
            id={`pp-${label}`}
            className="pager__select"
            value={perPage}
            onChange={(e) => onPerPage(Number(e.target.value))}
          >
            {sizes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      ) : (
        <span className="pager__size" aria-hidden="true" />
      )}
    </nav>
  );
}
