"use client";

import { useEffect, useRef, useState } from "react";
import useDropBox from "./dropbox";

/**
 * เลือกทั้งเดือน — ปฏิทินเดือนของแอปเอง ไม่ใช่ `<input type="month">`
 *
 * ตัวของเบราว์เซอร์ทำงานถูกทุกอย่าง แต่มันเป็นหน้าตาของเบราว์เซอร์ ไม่ใช่ของ
 * ที่นี่: เดือนเป็นภาษาอังกฤษทั้งที่ทั้งหน้าเป็นไทย ปีเป็น ค.ศ. ทั้งที่ทั้งระบบ
 * อ่านเป็น พ.ศ. สีที่เน้นเป็นสีน้ำเงินของระบบปฏิบัติการ ไม่ใช่สีของร้าน และ
 * ปุ่ม Clear/This month เป็นคำที่ไม่มีใครแปลให้ · บนวินโดวส์กับบนแท็บเล็ตยัง
 * หน้าตาคนละอย่างกันอีก
 *
 * ที่นี่จึงวาดเอง สิบสองปุ่มกับปีหนึ่งบรรทัด — ไม่มีอะไรให้พิมพ์ เพราะเดือนมี
 * สิบสองค่าและกดถูกกว่าพิมพ์เสมอ
 */

const MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
const FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export default function MonthField({
  id,
  /** `2026-09` */
  value,
  onChange,
  disabled = false,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLButtonElement>(null);

  const [open, setOpen] = useState(false);
  const chosenYear = Number(value.slice(0, 4)) || new Date().getFullYear();
  const chosenMonth = Number(value.slice(5, 7)) || new Date().getMonth() + 1;
  /** ปีที่กำลังดูอยู่ ซึ่งไม่จำเป็นต้องเป็นปีที่เลือกไว้ */
  const [year, setYear] = useState(chosenYear);

  const box = useDropBox(open, face, 260, 300);

  // เปิดทีไรกลับมาที่ปีที่เลือกอยู่ — ปีที่ค้างจากการเปิดครั้งก่อนคือปีที่ต้อง
  // กดย้อนกลับมาทุกครั้ง
  useEffect(() => {
    if (open) setYear(chosenYear);
  }, [open, chosenYear]);

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

  function pick(m: number) {
    onChange(`${year}-${String(m).padStart(2, "0")}`);
    setOpen(false);
  }

  return (
    <div className="monthpick" ref={wrap}>
      <button
        type="button"
        id={id}
        ref={face}
        className="input monthpick__face"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {FULL[chosenMonth - 1]} {chosenYear + 543}
      </button>

      {open ? (
        <div className="monthpick__pop" style={box} role="dialog" aria-label="เลือกเดือน">
          <div className="monthpick__head">
            <button
              type="button"
              className="daterange__step"
              aria-label="ปีก่อนหน้า"
              onClick={() => setYear(year - 1)}
            >
              ‹
            </button>
            <span className="daterange__title">{year + 543}</span>
            <button
              type="button"
              className="daterange__step"
              aria-label="ปีถัดไป"
              onClick={() => setYear(year + 1)}
            >
              ›
            </button>
          </div>

          <div className="monthpick__grid">
            {MONTHS.map((m, i) => {
              const on = year === chosenYear && i + 1 === chosenMonth;
              return (
                <button
                  key={m}
                  type="button"
                  className={on ? "monthpick__m monthpick__m--on" : "monthpick__m"}
                  aria-pressed={on}
                  onClick={() => pick(i + 1)}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* ทางลัดเดียวที่คุ้มพื้นที่ — เดือนนี้คือคำตอบของคนส่วนใหญ่ที่กดเข้ามา
              และมันอยู่คนละปีกับที่กำลังดูอยู่ได้ ปุ่มจึงต้องพาไปเองทั้งปีและเดือน */}
          <div className="monthpick__foot">
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => {
                const now = new Date();
                setYear(now.getFullYear());
                onChange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
                setOpen(false);
              }}
            >
              เดือนนี้
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
