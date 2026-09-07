'use client';
/**
 * เลือกเดือน/ปี — หัวเรื่องที่กดได้ ไม่ใช่ช่อง <select>
 *
 * `<select>` เปิดรายการที่ระบบปฏิบัติการเป็นคนวาด แต่งไม่ได้สักบรรทัด (เหตุผล
 * เดียวกับที่ DateField.jsx ไม่ใช้ `<input type="date">") และรายการเดือนที่ยาว
 * สิบสองแถวก็ต้องเลื่อนหาทั้งที่เดือนมีแค่สิบสองตัว · ตรงนี้จึงวาดเอง เป็นตาราง
 * 3×4 ที่เห็นครบทั้งปีในครั้งเดียว และอ่านเป็นไตรมาสได้ทีละแถว
 *
 * สถานะสองแบบใช้ไวยากรณ์เดียวกับปฏิทินใน DateField — เดือนที่เลือกเป็นพื้นทึบ
 * เดือนปัจจุบันจริงเป็นเส้นขอบบาง ๆ · สองอย่างนี้เกิดพร้อมกันได้ ถ้าใช้พื้นสีทั้งคู่
 * จะแยกไม่ออกว่าอันไหนคืออันที่เลือกอยู่
 *
 *   <MonthPicker value={month} onChange={setMonth} />   // value เป็น 'YYYY-MM'
 *
 * ปีแสดงเป็น พ.ศ. ตามที่ร้านใช้ ส่วนค่าที่ส่งออกยังเป็น ค.ศ. เหมือนที่อื่นทั้งระบบ
 */
import { useEffect, useRef, useState } from 'react';
import { TH_MONTHS, TH_MONTHS_ABBR } from '../lib/constants.js';
import { todayISO } from '../lib/format.js';

export function MonthPicker({ value, onChange, minYear, maxYear }) {
  const [y, m] = String(value).split('-').map(Number);
  const [open, setOpen] = useState(false);
  /* ปีในกล่องเดินได้เองโดยที่ปฏิทินข้างหลังยังไม่ขยับ — เปิดดูปีอื่นแล้วเปลี่ยนใจ
     ปิดทิ้งไป ปฏิทินต้องอยู่ที่เดิม ไม่ใช่ถูกลากตามไปด้วย */
  const [yearShown, setYearShown] = useState(y);
  const box = useRef(null);
  const trigger = useRef(null);

  const now = todayISO();
  const nowYear = Number(now.slice(0, 4));
  const nowMonth = Number(now.slice(5, 7));

  const lo = minYear ?? Math.min(nowYear - 5, y);
  const hi = maxYear ?? Math.max(nowYear + 5, y);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const pick = (mm) => {
    onChange(`${yearShown}-${String(mm).padStart(2, '0')}`);
    setOpen(false);
    trigger.current?.focus();
  };

  const stepYear = (delta) => setYearShown((prev) => Math.min(hi, Math.max(lo, prev + delta)));

  return (
    <div className={`mpick ${open ? 'open' : ''}`.trim()} ref={box}>
      <button
        type="button"
        ref={trigger}
        className="mpick-title"
        aria-haspopup="dialog"
        aria-expanded={open}
        /* เปิดทีไรกลับมาที่ปีที่ปฏิทินแสดงอยู่จริงเสมอ ไม่ใช่ปีที่ค้างจากการเปิดครั้งก่อน */
        onClick={() => { setYearShown(y); setOpen((o) => !o); }}
      >
        {`${TH_MONTHS[m - 1]} ${y + 543}`}
        {/* ลูกศรตัวเดียวกับที่ Selects.jsx ใช้ — เป็นเส้น ไม่ใช่สามเหลี่ยมทึบ
            จะได้ไม่มีลูกศรกางรายการสองแบบในระบบ */}
        <svg className="mpick-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="mpick-pop" role="dialog" aria-label="เลือกเดือนและปี">
          <div className="mpick-year">
            <button
              type="button"
              className="mpick-nav"
              aria-label="ปีก่อนหน้า"
              disabled={yearShown <= lo || undefined}
              onClick={() => stepYear(-1)}
            >
              ‹
            </button>
            <b>{yearShown + 543}</b>
            <button
              type="button"
              className="mpick-nav"
              aria-label="ปีถัดไป"
              disabled={yearShown >= hi || undefined}
              onClick={() => stepYear(1)}
            >
              ›
            </button>
          </div>

          <div className="mpick-grid">
            {TH_MONTHS_ABBR.map((label, i) => {
              const mm = i + 1;
              const isSel = yearShown === y && mm === m;
              const isNow = yearShown === nowYear && mm === nowMonth;
              return (
                <button
                  type="button"
                  key={label}
                  className={`mpick-m ${isSel ? 'sel' : ''} ${isNow ? 'now' : ''}`.trim()}
                  aria-pressed={isSel}
                  title={`${TH_MONTHS[i]} ${yearShown + 543}`}
                  onClick={() => pick(mm)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
