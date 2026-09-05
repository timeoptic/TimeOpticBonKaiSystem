"use client";

import { useEffect, useRef, useState } from "react";
import useDropBox from "./dropbox";

/**
 * เลือกได้หลายอย่างจากรายการเดียว — ดรอปดาวน์ที่ข้างในเป็นช่องติ๊ก
 *
 * ต่างจาก `Select` ตรงที่คำตอบไม่ใช่ค่าเดียว · ใช้กับคำถามแบบ "เอาอะไรบ้าง"
 * ซึ่งชิปทำได้เหมือนกันแต่กินพื้นที่เท่าจำนวนตัวเลือก และคำถามแบบนี้มักมีสิบ
 * ตัวเลือกขึ้นไป
 *
 * หน้าปุ่มบอกจำนวนที่เลือก ไม่ใช่รายชื่อ — รายชื่อแปดอย่างต่อกันด้วยจุลภาคยาว
 * เกินกว่าจะอยู่ในปุ่มเดียว และตัดท้ายด้วย … ก็ไม่ได้บอกอะไรมากกว่าจำนวน
 * ยกเว้นตอนเลือกครบหรือเลือกอันเดียว ซึ่งพูดออกมาตรง ๆ ได้
 */
export type Item = { value: string; label: string; hint?: string };

export default function PickList({
  id,
  items,
  chosen,
  onChange,
  allLabel = "ทั้งหมด",
  disabled = false,
}: {
  id?: string;
  items: readonly Item[];
  chosen: readonly string[];
  onChange: (next: string[]) => void;
  /** คำที่ใช้เรียก "ครบทุกอย่าง" บนหน้าปุ่ม */
  allLabel?: string;
  disabled?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const box = useDropBox(open, face, 280, 340);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const has = (v: string) => chosen.includes(v);
  const toggle = (v: string) =>
    onChange(has(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);

  const face$ =
    chosen.length === 0
      ? "ยังไม่ได้เลือก"
      : chosen.length === items.length
        ? allLabel
        : chosen.length === 1
          ? (items.find((i) => i.value === chosen[0])?.label ?? "1 อย่าง")
          : `เลือกไว้ ${chosen.length} จาก ${items.length}`;

  return (
    <div className="picklist" ref={wrap}>
      <button
        type="button"
        id={id}
        ref={face}
        className="input picklist__face"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {face$}
      </button>

      {open ? (
        <div className="picklist__pop" style={box} role="dialog" aria-label="เลือกรายการ">
          {/* สองปุ่มนี้อยู่บนสุดเพราะคนส่วนใหญ่มาที่นี่เพื่อ "เอาเกือบทั้งหมด"
              หรือ "เอาอันเดียว" — ทั้งสองแบบเริ่มจากกดปุ่มใดปุ่มหนึ่งก่อน */}
          <div className="picklist__tools">
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => onChange(items.map((i) => i.value))}
            >
              เลือกทั้งหมด
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => onChange([])}
            >
              ล้าง
            </button>
          </div>

          <ul className="picklist__list">
            {items.map((it) => (
              <li key={it.value}>
                <label className="picklist__row">
                  <input
                    type="checkbox"
                    checked={has(it.value)}
                    onChange={() => toggle(it.value)}
                  />
                  <span className="picklist__text">
                    <span className="picklist__label">{it.label}</span>
                    {it.hint ? <span className="picklist__hint">{it.hint}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
