'use client';
/**
 * ช่องที่เลือกได้หลายอย่างพร้อมกัน
 *
 * `<select multiple>` ของเบราว์เซอร์กลายเป็นกล่องสูงหลายบรรทัดที่ต้องกด Ctrl ค้าง
 * ถึงจะเลือกทีละหลายตัว ซึ่งแทบไม่มีใครรู้ และระบบปฏิบัติการเป็นคนวาด แต่งไม่ได้เลย
 * (เหตุผลเดียวกับที่ DateField.jsx ไม่ใช้ `<input type="date">`) ตรงนี้จึงวาดเอง
 *
 * ปุ่มปิดแสดงของที่เลือกเป็นป้ายเรียงกัน ถอดออกได้ทีละป้ายโดยไม่ต้องกางรายการ —
 * แก้ผิดทีละตัวคือสิ่งที่เกิดบ่อยกว่าเลือกใหม่ทั้งชุด · รายการที่กางออกมาไม่ปิดตัวเอง
 * ตอนติ๊ก เพราะคนที่ติ๊ก "เบาหวาน" มักจะติ๊ก "ความดัน" ต่อในจังหวะเดียวกัน
 *
 *   <MultiSelect options={[['a', 'ก'], …]} value={['a']} onChange={setSel} />
 *
 * `options` รับ ['a', 'b'] หรือ [[value, label], …] เหมือน Select ใน Selects.jsx
 * `value` เป็น array ของ value ที่เลือกอยู่ · onChange ได้ array ชุดใหม่ทั้งชุด
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

export function MultiSelect({
  options,
  value = [],
  onChange,
  placeholder = '— ไม่ได้เลือก —',
  disabled = false,
  className = '',
  id,
}) {
  const norm = useMemo(
    () => (options || []).map((o) => (Array.isArray(o) ? o : [o, o])),
    [options],
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef(null);
  const trigger = useRef(null);

  /* เทียบด้วย String เพราะ value ของตัวเลือกเป็นตัวเลขได้ (id พนักงาน) แต่ค่าที่ถือไว้
     อาจเดินทางผ่าน URL หรือฟอร์มมาเป็นตัวหนังสือ ถ้าเทียบตรง ๆ จะไม่ตรงกันเงียบ ๆ */
  const picked = useMemo(() => new Set((value || []).map(String)), [value]);
  const chips = norm.filter(([v]) => picked.has(String(v)));

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

  /** ส่งชุดใหม่ออกไปตามลำดับของ options เสมอ ไม่ใช่ตามลำดับที่คนกด — ป้ายที่สลับที่
      ทุกครั้งที่ติ๊กจะอ่านยากกว่าป้ายที่อยู่ที่เดิม */
  const toggle = (v) => {
    const next = new Set(picked);
    if (next.has(String(v))) next.delete(String(v)); else next.add(String(v));
    onChange?.(norm.filter(([o]) => next.has(String(o))).map(([o]) => o));
  };

  const onKey = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      if (!norm.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + norm.length) % norm.length);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && open && active >= 0 && norm[active]) {
      /* Enter ที่ตั้งใจว่า "เอาตัวนี้" ต้องไม่กลายเป็นการส่งฟอร์มทั้งใบ */
      e.preventDefault();
      toggle(norm[active][0]);
    }
  };

  return (
    <div className={`msel ${open ? 'open' : ''} ${className}`.trim()} ref={box}>
      <button
        type="button"
        id={id}
        ref={trigger}
        className="msel-trigger"
        disabled={disabled || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setActive(-1); }}
        onKeyDown={onKey}
      >
        <span className="msel-chips">
          {chips.length === 0
            ? <span className="msel-ph">{placeholder}</span>
            : chips.map(([v, label]) => (
              <span key={String(v)} className="msel-chip">
                {label}
                {/* ปุ่มจริงซ้อนในปุ่มไม่ได้ตามกติกา HTML — ป้ายกากบาทจึงเป็น span ที่
                    ดักคลิกไว้เอง ไม่ให้ทะลุไปเปิด/ปิดรายการตามปุ่มที่ครอบอยู่ */}
                <span
                  role="button"
                  tabIndex={-1}
                  className="msel-x"
                  aria-label={`เอา ${label} ออก`}
                  onClick={(e) => { e.stopPropagation(); toggle(v); }}
                >
                  ×
                </span>
              </span>
            ))}
        </span>
        {/* ลูกศรตัวเดียวกับ Selects.jsx และ MonthPicker — เป็นเส้น ไม่ใช่สามเหลี่ยมทึบ */}
        <svg className="msel-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && !disabled && (
        <ul className="msel-list" role="listbox" aria-multiselectable="true">
          {norm.map(([v, label], i) => {
            const on = picked.has(String(v));
            return (
              <li key={String(v)}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`msel-opt ${on ? 'sel' : ''} ${i === active ? 'on' : ''}`.trim()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(v)}
                >
                  <span className="msel-box" aria-hidden="true">
                    {/* เครื่องหมายถูกเป็นรูปจากชุดไอคอนของแอป ไม่ใช่ตัวอักษร '✓' —
                        ฟอนต์บางตัวเปลี่ยนอักขระนั้นเป็นอีโมจิสี ซึ่งอ่านเป็นของคนละชุด */}
                    {on ? <Icon name="check" /> : null}
                  </span>
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
