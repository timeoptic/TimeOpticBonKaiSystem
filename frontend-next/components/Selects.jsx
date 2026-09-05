'use client';
/** Dropdowns fed from /api/meta. Port of frontend/src/components/Selects.jsx. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMeta } from '../contexts/MetaContext.jsx';

/**
 * `options` accepts ['a', 'b'] or [[value, label], …].
 * Uncontrolled by default (defaultValue) so forms can be read with readForm().
 */
export function Select({ name, options, value, defaultValue, onChange, ...rest }) {
  const norm = (options || []).map((o) => (Array.isArray(o) ? o : [o, o]));
  const controlled = value !== undefined;
  return (
    <select
      name={name}
      {...(controlled
        ? { value: value ?? '', onChange }
        : { defaultValue: defaultValue ?? '', onChange })}
      {...rest}
    >
      {norm.map(([v, label]) => (
        <option key={String(v)} value={v}>{label}</option>
      ))}
    </select>
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
