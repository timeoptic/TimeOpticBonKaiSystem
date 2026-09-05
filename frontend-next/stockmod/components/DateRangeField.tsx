"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useDropBox from "./dropbox";
import { IconCalendar } from "./Icon";

/**
 * ช่วงวันที่ เลือกจากปฏิทินสองเดือนที่วางเรียงกัน
 *
 * เดิมเป็นช่องวันที่สองช่องแยกกัน ซึ่งตอบคำถาม "วันไหนถึงวันไหน" ได้ก็จริง แต่
 * ไม่ได้ตอบคำถามที่คนถามจริง ๆ ตอนเลือกช่วง — "ช่วงนี้กินกี่วัน และคร่อมสุด
 * สัปดาห์ไหนบ้าง" · สองช่องแยกกันยังปล่อยให้เกิดสถานะที่ต้นทางอยู่หลังปลายทาง
 * ระหว่างพิมพ์ ซึ่งหน้าจอต้องเดาว่าจะแสดงอะไรระหว่างนั้น
 *
 * ปฏิทินสองเดือนเพราะช่วงที่คนเลือกส่วนใหญ่คร่อมเดือน — "ตั้งแต่กลางเดือนที่แล้ว
 * ถึงวันนี้" คือคำขอที่พบบ่อยที่สุด และปฏิทินเดือนเดียวบังคับให้กดเปลี่ยนเดือน
 * กลางคัน โดยที่ปลายทางที่เพิ่งเลือกไปหายจากจอ
 *
 * กดครั้งแรก = ต้นทาง กดครั้งที่สอง = ปลายทาง · กดวันที่อยู่ก่อนต้นทาง ระบบ
 * ถือว่าเริ่มเลือกใหม่ ไม่ใช่ error — คนที่กดผิดต้องการเริ่มใหม่ ไม่ได้ต้องการ
 * คำเตือน · ยังไม่มีผลจนกว่าจะกด "ใช้ช่วงนี้" เพราะทุกครั้งที่ช่วงเปลี่ยน หน้า
 * ข้างหลังต้องยิงถามข้อมูลใหม่ทั้งหน้า และการยิงระหว่างเลือกครึ่งทางคือการยิงทิ้ง
 */

const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** `2026-09-04` — วันตามเวลาท้องถิ่น ไม่ใช่ UTC ซึ่งเลื่อนไปหนึ่งวันตอนหัวค่ำ */
const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parse = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/* ตัวย่อเดือนไทยตัดตามตัวอักษรไม่ได้ — "สิงหาคม" สามตัวแรกได้ "สิง" ซึ่งไม่ใช่
   ตัวย่อของอะไร · ตัวย่อจริงคือ ส.ค. และไม่มีกฎที่คำนวณได้ จึงเขียนไว้ทั้งสิบสอง */
const SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** วันที่อย่างที่คนอ่าน — 4 ก.ย. 2569 */
const readable = (s: string): string => {
  const d = parse(s);
  return `${d.getDate()} ${SHORT[d.getMonth()]} ${d.getFullYear() + 543}`;
};

/** ตารางหกสัปดาห์ของเดือนนั้น เริ่มวันอาทิตย์ · null คือช่องที่ไม่ใช่เดือนนี้ */
function grid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = first.getDay();
  const cells: (Date | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function DateRangeField({
  id,
  from,
  to,
  onApply,
  disabled = false,
  split = false,
}: {
  id?: string;
  from: string;
  to: string;
  onApply: (range: { from: string; to: string }) => void;
  disabled?: boolean;
  /** สองช่อง "จาก"/"ถึง" แทนช่องเดียวที่เขียนทั้งช่วง — ปฏิทินยังเป็นใบเดียวกัน */
  split?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLButtonElement>(null);

  const [open, setOpen] = useState(false);
  /** ต้นทางที่เลือกไว้ระหว่างกำลังเลือก · ว่างแปลว่ายังไม่ได้เริ่มรอบใหม่ */
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  /** วันที่เมาส์อยู่ ใช้ทาแถบระหว่างกำลังลากสายตาไปหาปลายทาง */
  const [hover, setHover] = useState("");
  /** เดือนซ้ายของสองเดือนที่วาดอยู่ */
  const [at, setAt] = useState(() => parse(from));

  // กว้างพอวางปฏิทินสองเดือนคู่กัน ไม่ใช่กว้างเท่าช่อง · สูงกว่าค่าปริยาย
  // เพราะหกสัปดาห์สองชุดสูงกว่าดรอปดาวน์ทั่วไปเกือบเท่าตัว
  const box = useDropBox(open, face, 620, 420);

  // เปิดทีไรเริ่มจากช่วงที่ใช้อยู่ — ปฏิทินที่เปิดมาที่เดือนอื่นทุกครั้งคือ
  // ปฏิทินที่ต้องกดหาเดือนเดิมก่อนทุกครั้ง
  useEffect(() => {
    if (open) {
      setStart(from);
      setEnd(to);
      setHover("");
      setAt(parse(from));
    }
  }, [open, from, to]);

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

  const months = useMemo(
    () => [
      { y: at.getFullYear(), m: at.getMonth() },
      { y: new Date(at.getFullYear(), at.getMonth() + 1, 1).getFullYear(),
        m: new Date(at.getFullYear(), at.getMonth() + 1, 1).getMonth() },
    ],
    [at],
  );

  /** ปลายทางที่ใช้ทาแถบ — ระหว่างเลือกคือวันที่เมาส์อยู่ */
  const edge = end || hover;
  const lo = start && edge ? (start <= edge ? start : edge) : "";
  const hi = start && edge ? (start <= edge ? edge : start) : "";

  function pick(d: Date) {
    const v = iso(d);
    // เลือกครบคู่แล้ว หรือกดก่อนต้นทาง — ทั้งสองกรณีคือเริ่มรอบใหม่
    if (!start || end || v < start) {
      setStart(v);
      setEnd("");
      return;
    }
    setEnd(v);
  }

  const today = iso(new Date());
  const ready = start !== "" && end !== "";
  const label = `${readable(from)} – ${readable(to)}`;

  return (
    <div className={split ? "daterange daterange--split" : "daterange"} ref={wrap}>
      {/* สองช่อง "จาก" กับ "ถึง" ที่เปิดปฏิทินใบเดียวกัน — หน้าตาแบบที่คนคุ้น
          จากรายงานทั่วไป โดยไม่ต้องกลับไปกรอกวันทีละช่องซึ่งปล่อยให้ต้นทางอยู่
          หลังปลายทางได้ · ปฏิทินยังเป็นตัวเดียวกัน กติกาเดียวกัน */}
      {split ? (
        <>
          <span className="toolbar__lead">จาก</span>
          <button
            type="button"
            id={id}
            ref={face}
            className="input daterange__slot"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span>{readable(from)}</span>
            <IconCalendar />
          </button>
          <span className="toolbar__lead">ถึง</span>
          <button
            type="button"
            className="input daterange__slot"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span>{readable(to)}</span>
            <IconCalendar />
          </button>
        </>
      ) : (
        <button
          type="button"
          id={id}
          ref={face}
          className="input daterange__face"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {label}
        </button>
      )}
      {open ? (
        <div className="daterange__pop" style={box} role="dialog" aria-label="เลือกช่วงวันที่">
          <div className="daterange__months">
            {months.map((mo, i) => (
              <div className="daterange__cal" key={`${mo.y}-${mo.m}`}>
                <div className="daterange__head">
                  {i === 0 ? (
                    <button
                      type="button"
                      className="daterange__step"
                      aria-label="เดือนก่อนหน้า"
                      onClick={() => setAt(new Date(at.getFullYear(), at.getMonth() - 1, 1))}
                    >
                      ‹
                    </button>
                  ) : (
                    <span className="daterange__step daterange__step--ghost" aria-hidden="true" />
                  )}

                  <span className="daterange__title">
                    {MONTHS[mo.m]} {mo.y + 543}
                  </span>

                  {i === 1 ? (
                    <button
                      type="button"
                      className="daterange__step"
                      aria-label="เดือนถัดไป"
                      onClick={() => setAt(new Date(at.getFullYear(), at.getMonth() + 1, 1))}
                    >
                      ›
                    </button>
                  ) : (
                    <span className="daterange__step daterange__step--ghost" aria-hidden="true" />
                  )}
                </div>

                <div className="daterange__dow">
                  {DAYS.map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>

                <div className="daterange__grid" onMouseLeave={() => setHover("")}>
                  {grid(mo.y, mo.m).map((d, n) => {
                    if (d === null) return <span key={n} className="daterange__pad" />;
                    const v = iso(d);
                    /* ปลายสองข้างของช่วงมนคนละด้าน ตรงกลางเป็นเหลี่ยม — แถบที่มน
                       ทุกช่องอ่านเป็นวันที่แยกกันหลายวัน ไม่ใช่ช่วงเดียวที่ต่อกัน */
                    const isStart = v === lo && lo !== hi;
                    const isEnd = v === hi && lo !== hi;
                    const on = v === start || v === end;
                    const between = lo !== "" && v > lo && v < hi;
                    const cls = [
                      "daterange__day",
                      on ? "daterange__day--on" : "",
                      between ? "daterange__day--in" : "",
                      isStart ? "daterange__day--start" : "",
                      isEnd ? "daterange__day--end" : "",
                      v === today ? "daterange__day--today" : "",
                      d.getDay() === 0 || d.getDay() === 6 ? "daterange__day--rest" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <button
                        key={n}
                        type="button"
                        className={cls}
                        aria-pressed={on}
                        onMouseEnter={() => setHover(v)}
                        onClick={() => pick(d)}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="daterange__foot">
            <span className="daterange__read">
              {start === ""
                ? "เลือกวันเริ่ม"
                : end === ""
                  ? `${readable(start)} – เลือกวันสิ้นสุด`
                  : `${readable(start)} – ${readable(end)}`}
            </span>
            <div className="chips">
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => setOpen(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn btn--primary btn--small"
                disabled={!ready}
                onClick={() => {
                  onApply({ from: start, to: end });
                  setOpen(false);
                }}
              >
                ใช้ช่วงนี้
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
