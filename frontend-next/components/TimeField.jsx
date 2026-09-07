'use client';
/**
 * ช่องเวลาที่หน้าตาเป็นของแอปนี้
 *
 * `<input type="time">` เอากล่องเวลาของเบราว์เซอร์มาให้ ซึ่งระบบปฏิบัติการเป็นคนวาด —
 * CSS แต่งไม่ได้เลยสักบรรทัด และคนละเบราว์เซอร์ก็คนละหน้าตา (เหตุผลเดียวกับที่
 * DateField.jsx ไม่ใช้ `<input type="date">` และ Selects.jsx ไม่ใช้ `<datalist>`)
 *
 * ยังพิมพ์เวลาเองได้ ไม่ได้บังคับให้เลือกจากรายการ — รายการเดินทีละ 15 นาทีเพราะ
 * นัดที่ร้านลงตัวแบบนั้นเกือบทั้งหมด แต่ค่าที่ "เกิดขึ้นจริง" อย่างเวลาที่วัดหรือเวลารับเงิน
 * เป็นนาทีอะไรก็ได้ ถ้าปัดให้เป็นช่วงคือบันทึกเวลาผิดโดยไม่มีอะไรเตือน (ดู parseTypedTime)
 *
 * ใช้ได้สองแบบเหมือน DateField:
 *   <TimeField name="booking_time" defaultValue="10:00" required />   ฟอร์มอ่านเอง
 *   <TimeField value={t} onChange={setT} />                          หน้าคุมค่าเอง
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { minutesOf, parseTypedTime, timeOptions } from '../lib/calendar.js';
import { Icon } from './Icon.jsx';

export function TimeField({
  name,
  value,
  defaultValue = '',
  onChange,
  required = false,
  disabled = false,
  readOnly = false,
  step = 15,
  placeholder = 'ชช:นน',
  className = '',
  id,
}) {
  /* แก้ไม่ได้ก็กางรายการไม่ได้ — รายการที่กดแล้วไม่มีอะไรเกิดขึ้นแย่กว่าไม่มีรายการให้กด */
  const locked = disabled || readOnly;
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const hhmm = controlled ? (value || '') : inner;

  const [text, setText] = useState(hhmm);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef(null);
  const field = useRef(null);
  const list = useRef(null);

  const options = useMemo(() => timeOptions(step), [step]);

  /* ค่าถูกเปลี่ยนจากข้างนอก ช่องต้องตามไปด้วย — เทียบกับค่าที่ตีความจากตัวหนังสือปัจจุบัน
     ไม่ใช่กับตัวหนังสือตรง ๆ ไม่งั้นตัวที่คนกำลังพิมพ์ค้างไว้จะถูกเขียนทับทุกครั้งที่วาดใหม่ */
  useEffect(() => {
    if (parseTypedTime(text) === (hhmm || null)) return;
    setText(hhmm);
  }, [hhmm]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  const closeAndFocus = () => { setOpen(false); field.current?.focus(); };

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

  /** ตัวเลือกที่ใกล้เวลาปัจจุบันในช่องที่สุด — รายการยาว 96 แถว ถ้าเปิดมาที่เที่ยงคืนทุกครั้ง
      คนที่นัดบ่ายต้องเลื่อนผ่านทั้งเช้าก่อนเสมอ */
  const nearest = useMemo(() => {
    const want = minutesOf(hhmm);
    if (want === null) return -1;
    let best = 0;
    for (let i = 1; i < options.length; i++) {
      if (Math.abs(minutesOf(options[i]) - want) < Math.abs(minutesOf(options[best]) - want)) best = i;
    }
    return best;
  }, [hhmm, options]);

  /* เลื่อนรายการไปที่ตัวที่กำลังชี้อยู่ ทั้งตอนเพิ่งกางและตอนเดินด้วยลูกศร — ตัวที่ถูกเลือก
     อยู่นอกจอแล้วกด Enter คือเลือกของที่มองไม่เห็น */
  useEffect(() => {
    if (!open || !list.current) return;
    const el = list.current.querySelector('[data-on="1"]') || list.current.querySelector('[data-near="1"]');
    el?.scrollIntoView({ block: 'center' });
  }, [open, active]);

  /** ออกจากช่องแล้วค่อยตีความ — ตีความทุกตัวอักษรจะแย่งแก้ค่าตอนพิมพ์ยังไม่จบ */
  const settle = () => {
    const parsed = parseTypedTime(text);
    if (parsed) { commit(parsed); setText(parsed); return; }
    /* ล้างช่องจนว่าง = ตั้งใจล้างค่า ซึ่งเป็นคนละเรื่องกับพิมพ์ผิด */
    if (!text.trim()) { commit(''); return; }
    setText(hhmm);
  };

  const pick = (t) => {
    commit(t);
    setText(t);
    closeAndFocus();
  };

  const onKey = (e) => {
    if (locked) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(nearest); return; }
      const step2 = e.key === 'ArrowDown' ? 1 : -1;
      const from = active < 0 ? nearest : active;
      setActive((from + step2 + options.length) % options.length);
      return;
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (active >= 0) pick(options[active]); else closeAndFocus();
    }
  };

  return (
    <div className={`timef ${open ? 'open' : ''}`.trim()} ref={box}>
      {name ? <input type="hidden" name={name} value={hhmm} /> : null}
      <input
        ref={field}
        id={id}
        className={`timef-input ${className}`.trim()}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={locked ? '' : placeholder}
        disabled={disabled || undefined}
        readOnly={readOnly || undefined}
        value={text}
        /* ช่องจริงที่ส่งค่าคือ hidden ข้างบน required ตรงนี้มีไว้ให้เบราว์เซอร์เตือนตรงช่อง
           ที่คนมองเห็น ไม่ใช่ช่องที่ซ่อนอยู่ซึ่งเลื่อนไปหาไม่เจอ */
        required={required && !hhmm}
        onChange={(e) => { setText(e.target.value); setActive(-1); }}
        onBlur={settle}
        onKeyDown={onKey}
      />
      {!locked && (
        <button
          type="button"
          className="timef-open"
          tabIndex={-1}
          aria-label="เปิดรายการเวลา"
          onClick={() => { setActive(nearest); setOpen((o) => !o); }}
        >
          <Icon name="clock" />
        </button>
      )}

      {open && !locked && (
        <ul className="timef-list" role="listbox" ref={list}>
          {options.map((t, i) => (
            <li key={t}>
              <button
                type="button"
                role="option"
                aria-selected={t === hhmm}
                data-on={i === active ? '1' : undefined}
                data-near={i === nearest ? '1' : undefined}
                className={`timef-opt ${t === hhmm ? 'sel' : ''} ${i === active ? 'on' : ''}`.trim()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(t)}
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
