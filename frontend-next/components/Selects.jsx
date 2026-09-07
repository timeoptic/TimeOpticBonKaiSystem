'use client';
/** Dropdowns fed from /api/meta. Port of frontend/src/components/Selects.jsx. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMeta } from '../contexts/MetaContext.jsx';
import { typeaheadIndex } from '../lib/typeahead.js';

/* พิมพ์ติด ๆ กันภายในเวลานี้นับเป็นคำเดียว เกินนี้ถือว่าเริ่มพิมพ์ใหม่ — ตัวเลขเดียวกับ
   ที่เบราว์เซอร์ใช้กับ <select> ของมันเอง สั้นกว่านี้แล้วพิมพ์ชื่อยาว ๆ ไม่ทัน */
const TYPE_GAP = 1000;

/**
 * ช่องเลือกหนึ่งค่าจากรายการ
 *
 * รายการวาดเองทั้งหมด เพราะรายการที่ `<select>` กางออกมาเป็นของระบบปฏิบัติการ —
 * CSS แต่งไม่ได้เลยสักบรรทัด มันเลยมาเป็นกล่องคนละฟอนต์คนละสีกับทั้งแอป และหน้าตา
 * ไม่เหมือนกันในแต่ละเบราว์เซอร์ (เหตุผลเดียวกับ DateField.jsx และ MultiSelect.jsx)
 *
 * `options` รับ ['a', 'b'] หรือ [[value, label], …]
 * ไม่ส่ง `value` = ฟอร์มอ่านค่าเอง (defaultValue + readForm) · ส่ง `value` = หน้าคุมค่าเอง
 *
 * **สัญญาเหมือน `<select>` เดิมทุกอย่าง** เพื่อไม่ต้องแก้ที่เรียกใช้สิบกว่าไฟล์:
 *   - `onChange` ได้ event ที่มี `e.target.value` เป็นสตริง
 *   - ค่าที่ไม่ตรงกับตัวเลือกไหนเลย ตกไปเป็นตัวเลือกแรก เหมือนที่ `<select>` ทำ
 *     (สำคัญกับ readForm — ไม่งั้นฟอร์มจะส่งค่าที่ไม่มีในรายการออกไปเงียบ ๆ)
 *   - อยู่ใน `<fieldset disabled>` แล้วถูกปิดตามและหลุดจาก readForm เหมือนกัน
 *     เพราะทั้งปุ่มและ input ที่ซ่อนอยู่เป็น form control ที่ fieldset ปิดได้
 */
export function Select({
  name, options, value, defaultValue, onChange, className = '', disabled = false, id, ...rest
}) {
  const norm = useMemo(
    () => (options || []).map((o) => (Array.isArray(o) ? o : [o, o])),
    [options],
  );
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? '');
  const raw = controlled ? (value ?? '') : inner;

  /* หาจากรายการทุกครั้งที่วาด ไม่ใช่จำไว้ตอน mount — รายการของ EmployeeSelect /
     ListSelect มาจาก /api/meta ซึ่งตอนแรกยังว่าง ถ้าปักค่าไว้ตั้งแต่ตอนนั้นจะได้
     ค่าที่ตัดสินจากรายการเปล่า แล้วไม่มีอะไรมาแก้ทีหลัง */
  const at = norm.findIndex(([v]) => String(v) === String(raw));
  const sel = at >= 0 ? at : (norm.length ? 0 : -1);
  const current = sel >= 0 ? String(norm[sel][0]) : '';
  const label = sel >= 0 ? norm[sel][1] : '';

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const typed = useRef({ buf: '', at: 0 });

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

  /* เลื่อนไปที่ตัวที่กำลังชี้อยู่ ทั้งตอนเพิ่งกางและตอนเดินด้วยลูกศรหรือพิมพ์ —
     รายการพนักงานยาวเกินกล่อง ตัวที่เลือกอยู่จะอยู่นอกจอถ้าไม่เลื่อนให้ */
  useEffect(() => {
    if (!open || !list.current) return;
    const el = list.current.querySelector('[data-on="1"]') || list.current.querySelector('[data-sel="1"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  /** ส่งออกเป็น event หน้าตาเหมือนที่ `<select>` ส่ง — ที่เรียกใช้ทุกที่อ่าน e.target.value */
  const pick = (v) => {
    const next = String(v);
    if (!controlled) setInner(next);
    const target = { name, value: next };
    onChange?.({ target, currentTarget: target });
    setOpen(false);
    trigger.current?.focus();
  };

  const jump = (ch) => {
    const now = Date.now();
    typed.current.buf = now - typed.current.at > TYPE_GAP ? ch : typed.current.buf + ch;
    typed.current.at = now;
    const from = open ? (active < 0 ? sel : active) : sel;
    const hit = typeaheadIndex(norm.map(([, l]) => l), typed.current.buf, from);
    if (hit < 0) return;
    /* ยังไม่กางก็เลือกไปเลย เหมือน `<select>` ที่ปิดอยู่แล้วพิมพ์ตัวอักษร */
    if (open) setActive(hit); else pick(norm[hit][0]);
  };

  const onKey = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (!norm.length) return;
      if (!open) { setOpen(true); setActive(sel); return; }
      const from = active < 0 ? sel : active;
      if (e.key === 'Home') setActive(0);
      else if (e.key === 'End') setActive(norm.length - 1);
      else setActive((from + (e.key === 'ArrowDown' ? 1 : -1) + norm.length) % norm.length);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open && active >= 0 && norm[active]) pick(norm[active][0]);
      else if (!open) { setOpen(true); setActive(sel); }
      return;
    }
    /* ตัวอักษรตัวเดียวคือการพิมพ์เพื่อกระโดด — ปุ่มอย่าง Tab/Shift ยาวกว่าหนึ่งตัว
       จึงไม่ถูกนับ และ Ctrl+อะไรก็ตามเป็นคำสั่ง ไม่ใช่ตัวอักษรที่พิมพ์ */
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      jump(e.key);
    }
  };

  return (
    /* className ของที่เรียกใช้ไปอยู่ที่กล่องห่อ ไม่ใช่ที่ปุ่ม — คลาสพวกนี้เป็นคลาสจัดวาง
       (.bf-stage กว้าง 150px) และตัวที่เป็นลูกของ flex/grid ข้างนอกคือกล่องห่อ
       เหตุผลเดียวกับที่ .datef รับความกว้างไว้ที่กล่องห่อแทนที่จะเป็น <input> ข้างใน */
    <div className={`sel ${open ? 'open' : ''} ${className}`.trim()} ref={box}>
      {name ? <input type="hidden" name={name} value={current} disabled={disabled || undefined} /> : null}
      <button
        {...rest}
        type="button"
        id={id}
        ref={trigger}
        className="sel-trigger"
        disabled={disabled || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setActive(sel); setOpen((o) => !o); }}
        onKeyDown={onKey}
      >
        <span className="sel-label">{label}</span>
        {/* ลูกศรตัวเดียวกับ ComboList / MonthPicker / MultiSelect — เป็นเส้น ไม่ใช่สามเหลี่ยมทึบ */}
        <svg className="sel-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && !disabled && (
        <ul className="sel-list" role="listbox" ref={list}>
          {norm.map(([v, text], i) => (
            <li key={String(v)}>
              <button
                type="button"
                role="option"
                aria-selected={i === sel}
                data-on={i === active ? '1' : undefined}
                data-sel={i === sel ? '1' : undefined}
                className={`sel-opt ${i === sel ? 'sel' : ''} ${i === active ? 'on' : ''}`.trim()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(v)}
              >
                {text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EmployeeSelect({ name, value, defaultValue, onChange, blank = '— เลือกพนักงาน —', ...rest }) {
  const { meta } = useMeta();
  const options = [['', blank], ...meta.employees.map((e) => [e.id, e.employee_name])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}

export function ListSelect({ name, kind, value, defaultValue, onChange, blank = null, ...rest }) {
  const { meta } = useMeta();
  const options = [...(blank ? [['', blank]] : []), ...(meta.lists[kind] || [])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}

/**
 * ช่องที่เลือกจากรายการเดิมก็ได้ พิมพ์ของใหม่เองก็ได้
 *
 * เขียนรายการเองแทนที่จะใช้ <datalist> ของเบราว์เซอร์ เพราะกล่องของ <datalist>
 * ระบบปฏิบัติการเป็นคนวาด — CSS แต่งไม่ได้สักบรรทัด มันเลยมาเป็นกล่องคนละฟอนต์
 * คนละสีกับทั้งแอป และหน้าตาไม่เหมือนกันในแต่ละเบราว์เซอร์
 *
 * ค่าที่ส่งไปกับฟอร์มคือสิ่งที่อยู่ในช่องพิมพ์เสมอ ไม่ใช่ตัวที่ถูกเลือก — ประเภทรายรับ/
 * รายจ่ายงอกใหม่ได้เรื่อย ๆ ตามบิลที่เข้ามา ถ้าบังคับให้เลือกจากลิสต์ คนที่ถือบิลค่าอะไร
 * ที่ไม่เคยมีมาก่อนจะบันทึกไม่ได้จนกว่าจะมีคนไปเพิ่มประเภทให้ และรายการที่พิมพ์วันนี้
 * จะกลายเป็นตัวเลือกของคนถัดไปเอง เพราะลิสต์ที่ /api/meta อ่านจาก DISTINCT ของตารางนั้น
 */
export function ComboList({ name, kind, defaultValue = '', placeholder = '', ...rest }) {
  const { meta } = useMeta();
  const all = useMemo(
    () => (meta.lists[kind] || []).map((o) => String(Array.isArray(o) ? o[0] : o)),
    [meta.lists, kind],
  );

  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef(null);
  const field = useRef(null);

  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return all;
    const hit = all.filter((o) => o.toLowerCase().includes(q));
    /* พิมพ์ตรงกับตัวเลือกเดิมเป๊ะแล้ว ไม่ต้องเสนอตัวเดิมซ้ำให้เกะกะ */
    return hit.length === 1 && hit[0].toLowerCase() === q ? [] : hit;
  }, [all, value]);

  /* คลิกที่อื่นแล้วปิด — ฟังที่ mousedown ไม่ใช่ click เพราะ click บนตัวเลือกจะยิงหลัง
     ตัวเลือกถูกถอดออกไปแล้ว ถ้าปิดตอน mousedown นอกกล่องเท่านั้นจึงเลือกได้ตามปกติ */
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const pick = (v) => {
    setValue(v);
    setOpen(false);
    setActive(-1);
    field.current?.focus();
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      if (!shown.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + shown.length) % shown.length);
      return;
    }
    if (e.key === 'Enter' && open && active >= 0 && shown[active] !== undefined) {
      /* Enter ที่ตั้งใจว่า "เอาตัวนี้" ต้องไม่กลายเป็นการส่งฟอร์มทั้งใบ */
      e.preventDefault();
      pick(shown[active]);
      return;
    }
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className={`combo ${open ? 'open' : ''}`.trim()} ref={box}>
      <input
        {...rest}
        ref={field}
        className="combo-input"
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => { setValue(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      <button
        type="button"
        className="combo-caret"
        tabIndex={-1}
        aria-label={open ? 'ปิดรายการ' : 'เปิดรายการ'}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && shown.length > 0 && (
        <ul className="combo-list" role="listbox">
          {shown.map((o, i) => (
            <li key={o}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`combo-opt ${i === active ? 'on' : ''}`.trim()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SupplierSelect({ name, value, defaultValue, onChange, blank = '— ไม่ระบุ —', ...rest }) {
  const { meta } = useMeta();
  const options = [['', blank], ...(meta.suppliers || []).map((s) => [s.id, s.name])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}

export function StatusSelect({ name, value, defaultValue, onChange, openOnly = false, ...rest }) {
  const { meta } = useMeta();
  const options = (meta.statuses || [])
    .filter((s) => !openOnly || !Number(s.is_terminal))
    .map((s) => [s.code, `${s.stage_no} ${s.label_th}`]);
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}
