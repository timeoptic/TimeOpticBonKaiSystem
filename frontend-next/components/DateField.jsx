'use client';
/**
 * ช่องวันที่ที่หน้าตาเป็นของแอปนี้
 *
 * `<input type="date">` เอาปฏิทินของเบราว์เซอร์มาให้ ซึ่งระบบปฏิบัติการเป็นคนวาด —
 * CSS แต่งไม่ได้เลยสักบรรทัด และคนละเบราว์เซอร์ก็คนละหน้าตา ตัวนี้จึงวาดปฏิทินเอง
 * ด้วยเลขเดือน/วันชุดเดียวกับปฏิทินจองคิว (lib/calendar.js, TH_DOW, TH_MONTHS)
 * จะได้ไม่มีปฏิทินแบบที่สามในระบบ
 *
 * ยังพิมพ์วันที่เองได้ ไม่ได้บังคับให้จิ้มปฏิทินอย่างเดียว — คนกรอกใบเสร็จรัวๆ พิมพ์
 * เร็วกว่าจิ้มมาก และรับ พ.ศ. ด้วยเพราะใบเสร็จที่ร้านเขียนแบบนั้น (ดู parseTypedDate)
 *
 * ใช้ได้สองแบบ:
 *   <DateField name="cf_date" defaultValue={todayISO()} required />   ฟอร์มอ่านเอง
 *   <DateField value={from} onChange={setFrom} />                     หน้าคุมค่าเอง
 *
 * แบบแรกซ่อน <input type="hidden"> ไว้ให้ readForm() เก็บค่าไปได้เหมือนช่องอื่น
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  daysInMonth, leadOffset, parseTypedDate, shiftMonth, toDisplayDate,
} from '../lib/calendar.js';
import { TH_DOW, TH_MONTHS } from '../lib/constants.js';
import { todayISO } from '../lib/format.js';
import { Icon } from './Icon.jsx';

const monthOf = (iso) => (iso ? String(iso).slice(0, 7) : todayISO().slice(0, 7));

export function DateField({
  name,
  value,
  defaultValue = '',
  onChange,
  required = false,
  disabled = false,
  readOnly = false,
  min = '',
  max = '',
  placeholder = 'วว/ดด/ปปปป',
  className = '',
  id,
}) {
  /* แก้ไม่ได้ก็เปิดปฏิทินไม่ได้ — ปฏิทินที่กางออกมาแล้วกดวันไหนก็ไม่มีอะไรเกิดขึ้น
     แย่กว่าไม่มีปฏิทินให้กด */
  const locked = disabled || readOnly;
  /* นอกช่วงที่อนุญาต — ใช้ทั้งกับปุ่มวันในปฏิทินและกับวันที่พิมพ์เอง สองทางเข้าต้องกันเท่ากัน */
  const outOfRange = (d) => (!!min && d < min) || (!!max && d > max);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const iso = controlled ? (value || '') : inner;

  const [text, setText] = useState(() => toDisplayDate(iso));
  const [open, setOpen] = useState(false);
  const [edge, setEdge] = useState(false);
  const [month, setMonth] = useState(() => monthOf(iso));
  const box = useRef(null);
  const field = useRef(null);

  /* ค่าถูกเปลี่ยนจากข้างนอก (กด "เดือนนี้" หรือ "ล้างช่วงวันที่") ช่องต้องตามไปด้วย
     — เทียบกับ iso ที่ตีความจากตัวหนังสือปัจจุบัน ไม่ใช่กับตัวหนังสือตรง ๆ ไม่งั้น
     ตัวที่คนกำลังพิมพ์ค้างไว้จะถูกเขียนทับทุกครั้งที่ component วาดใหม่ */
  useEffect(() => {
    if (parseTypedDate(text) === (iso || null)) return;
    setText(toDisplayDate(iso));
  }, [iso]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  const closeAndFocus = () => { setOpen(false); field.current?.focus(); };

  /* ช่องที่อยู่ท้ายแถวตัวกรองมีที่ทางขวาไม่พอ ให้ปฏิทินกางเข้าหาจอแทนที่จะล้นออกไป
     วัดตอนกางเท่านั้น เพราะก่อนกางยังไม่มีอะไรให้วัด */
  useEffect(() => {
    if (!open || !box.current) return;
    const POP = 268;
    const left = box.current.getBoundingClientRect().left;
    setEdge(left + POP > window.innerWidth - 12);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAndFocus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  /** ออกจากช่องแล้วค่อยตีความ — ตีความทุกตัวอักษรที่พิมพ์จะแย่งแก้ค่าตอนพิมพ์ยังไม่จบ */
  const settle = () => {
    const parsed = parseTypedDate(text);
    if (parsed && !outOfRange(parsed)) {
      commit(parsed);
      setText(toDisplayDate(parsed));
      setMonth(parsed.slice(0, 7));
      return;
    }
    /* พิมพ์อะไรที่อ่านไม่ออกไว้ ให้กลับไปเป็นค่าที่ยังใช้ได้ ไม่ใช่ค้างข้อความมั่วไว้ในช่อง
       ล้างช่องจนว่าง = ตั้งใจล้างค่า ซึ่งเป็นคนละเรื่องกับพิมพ์ผิด */
    if (!text.trim()) { commit(''); return; }
    setText(toDisplayDate(iso));
  };

  const pick = (nextIso) => {
    commit(nextIso);
    setText(toDisplayDate(nextIso));
    setMonth(nextIso.slice(0, 7));
    closeAndFocus();
  };

  const [y, m] = month.split('-').map(Number);
  const today = todayISO();
  const cells = useMemo(() => {
    const lead = leadOffset(y, m);
    const out = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return out;
  }, [y, m]);

  return (
    <div className={`datef ${open ? 'open' : ''} ${edge ? 'edge' : ''}`.trim()} ref={box}>
      {name ? <input type="hidden" name={name} value={iso} /> : null}
      <input
        ref={field}
        id={id}
        className={`datef-input ${className}`.trim()}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={locked ? '' : placeholder}
        disabled={disabled || undefined}
        readOnly={readOnly || undefined}
        value={text}
        /* ช่องจริงที่ส่งค่าคือ hidden ข้างบน required ตรงนี้มีไว้ให้เบราว์เซอร์เตือน
           ตรงช่องที่คนมองเห็น ไม่ใช่ช่องที่ซ่อนอยู่ซึ่งเลื่อนไปหาไม่เจอ */
        required={required && !iso}
        onChange={(e) => setText(e.target.value)}
        onBlur={settle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && open) { e.preventDefault(); closeAndFocus(); }
          if (e.key === 'ArrowDown' && !open && !locked) { e.preventDefault(); setOpen(true); }
        }}
      />
      {!locked && (
        <button
          type="button"
          className="datef-open"
          tabIndex={-1}
          aria-label="เปิดปฏิทิน"
          onClick={() => { setMonth(monthOf(iso)); setOpen((o) => !o); }}
        >
          <Icon name="calendar" />
        </button>
      )}

      {open && !locked && (
        <div className="datef-pop" role="dialog" aria-label="เลือกวันที่">
          {/* ปีเดินทีละ 12 เดือนต่างหาก — วันเกิดลูกค้าอยู่ห่างจากวันนี้หลายสิบปี
              ถ้ามีแต่ปุ่มเดือนต้องกดสามร้อยกว่าครั้งกว่าจะถึง */}
          <div className="datef-head">
            <button type="button" className="datef-nav" aria-label="ปีก่อนหน้า" onClick={() => setMonth(shiftMonth(month, -12))}>«</button>
            <button type="button" className="datef-nav" aria-label="เดือนก่อนหน้า" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
            <b>{`${TH_MONTHS[m - 1]} ${y}`}</b>
            <button type="button" className="datef-nav" aria-label="เดือนถัดไป" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
            <button type="button" className="datef-nav" aria-label="ปีถัดไป" onClick={() => setMonth(shiftMonth(month, 12))}>»</button>
          </div>

          <div className="datef-dow">
            {TH_DOW.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="datef-grid">
            {cells.map((cell, i) => (cell ? (
              <button
                type="button"
                key={cell}
                className={`datef-day ${cell === iso ? 'sel' : ''} ${cell === today ? 'today' : ''}`.trim()}
                aria-current={cell === today ? 'date' : undefined}
                aria-pressed={cell === iso}
                disabled={outOfRange(cell) || undefined}
                onClick={() => pick(cell)}
              >
                {Number(cell.slice(8))}
              </button>
            ) : <span key={`b${i}`} />))}
          </div>

          <div className="datef-foot">
            <button
              type="button"
              className="datef-link"
              onClick={() => { commit(''); setText(''); closeAndFocus(); }}
            >
              ล้าง
            </button>
            {!outOfRange(today) && (
              <button type="button" className="datef-link now" onClick={() => pick(today)}>วันนี้</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
