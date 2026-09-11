'use client';
/** Dropdowns fed from /api/meta (และรายการคงที่ใน lib/constants.js).
 *  Port of frontend/src/components/Selects.jsx. */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useMeta } from '../contexts/MetaContext.jsx';
import { NATIONALITY_BY_VALUE, NATIONALITY_COMMON, NATIONALITY_ROWS } from '../lib/nationalities.js';
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
  name, options, value, defaultValue, onChange, className = '', disabled = false, id,
  search = false, emptyText = 'ไม่พบตัวเลือกที่ตรงกับที่พิมพ์', ...rest
}) {
  /* หนึ่งตัวเลือกคือ [ค่า, ป้าย, ส่วนเสริม] · ส่วนเสริมมีได้สามอย่าง ไม่ใส่ก็ได้:
       hint     บรรทัดรองใต้ป้าย (ชื่อไทยของสัญชาติ)
       keywords คำที่ค้นเจอได้แต่ไม่ต้องแสดง (ชื่อประเทศ คำที่เคยสะกดผิดกันมา)
       group    หัวข้อคั่นรายการ ('ใช้บ่อย' / 'ทั้งหมด') */
  const norm = useMemo(
    () => (options || []).map((o) => (Array.isArray(o) ? [o[0], o[1], o[2] || null] : [o, o, null])),
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
  const [q, setQ] = useState('');
  const box = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const find = useRef(null);
  const typed = useRef({ buf: '', at: 0 });

  /**
   * รายการที่โชว์อยู่จริง เก็บเป็นเลขลำดับที่ชี้กลับไปที่ `norm` ไม่ใช่ตัวเลือกที่ก๊อบมา
   * — ค่าที่เลือกอยู่ (`sel`) กับตัวที่กำลังชี้ (`active`) อ้างลำดับของ `norm` ทั้งคู่
   * ถ้ากรองแล้วเปลี่ยนเลขลำดับ ค่าที่บันทึกจะเพี้ยนตามคำที่ค้างอยู่ในช่องค้นหา
   *
   * ตัวที่ขึ้นต้นด้วยคำที่พิมพ์มาก่อนตัวที่มีคำนั้นอยู่กลางคำ — พิมพ์ "th" ต้องได้ Thai
   * ก่อน Lithuanian ไม่งั้นคำค้นสั้น ๆ ที่ใช้บ่อยที่สุดกลับเป็นคำที่หายากที่สุด
   */
  const view = useMemo(() => {
    const all = norm.map((_, i) => i);
    const needle = q.trim().toLowerCase();
    if (!search || !needle) return all;
    const scored = [];
    all.forEach((i) => {
      const [v, text, extra] = norm[i];
      /* ช่องว่าง ("— ไม่ระบุ —") ไม่ใช่คำตอบของการค้นหา ซ่อนไปตอนพิมพ์ */
      if (String(v) === '') return;
      const hay = `${text} ${extra?.hint || ''} ${extra?.keywords || ''}`.toLowerCase();
      if (!hay.includes(needle)) return;
      const lead = hay.split(/\s+/).some((w) => w.startsWith(needle)) ? 0 : 1;
      scored.push([lead, i]);
    });
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return scored.map(([, i]) => i);
  }, [norm, q, search]);

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

  /* ปิดแล้วล้างคำค้นเสมอ — เปิดครั้งหน้าต้องเห็นรายการเต็ม ไม่ใช่ผลค้นหาของเมื่อกี้
     ที่คนกดเปิดจำไม่ได้แล้วว่าเคยพิมพ์อะไรค้างไว้ · เปิดแล้วโฟกัสที่ช่องค้นหาเลย
     คนที่กดเปิดรายการร้อยกว่าบรรทัดตั้งใจจะพิมพ์หา ไม่ได้ตั้งใจจะไล่เลื่อน */
  useEffect(() => {
    if (open) find.current?.focus();
    else setQ('');
  }, [open]);

  /* พิมพ์แล้วรายการเปลี่ยน ตัวที่ชี้อยู่เดิมอาจถูกกรองออกไปแล้ว — ย้ายไปตัวแรกที่
     ยังเหลืออยู่ กด Enter ทันทีหลังพิมพ์จึงได้ตัวบนสุดตามที่ตาเห็น */
  useEffect(() => {
    if (!open || !search) return;
    setActive((a) => (view.includes(a) ? a : (view[0] ?? -1)));
  }, [open, search, view]);

  /**
   * ตำแหน่งของรายการ — คำนวณเองแล้ววางแบบ fixed ไม่ใช่ absolute ใต้ปุ่ม
   *
   * รายการตัวกรองบนมือถืออยู่ในแผ่นที่ขอบล่างจอ ซึ่งเป็นกล่อง `overflow-y:auto`
   * รายการที่กางแบบ absolute จึงถูกกล่องนั้นตัดหายไปทั้งอัน (เห็นแต่ปุ่ม ไม่เห็น
   * ตัวเลือก) และการที่มันไปเพิ่มความสูงข้างในทำให้แผ่นกระตุกตอนกาง
   *
   * fixed อ้างอิงจอ ไม่ใช่กล่องแม่ จึงไม่ถูกตัด · ทิศทางเลือกจากที่ว่างจริง: ใต้ปุ่ม
   * ไม่พอเมื่อไหร่ก็กางขึ้นข้างบนแทน ซึ่งเป็นกรณีปกติของแผ่นที่ติดขอบล่างจอ
   */
  const [drop, setDrop] = useState(null);

  useEffect(() => {
    if (!open) { setDrop(null); return undefined; }

    const place = () => {
      const t = trigger.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const gap = 5;
      const below = window.innerHeight - r.bottom - gap;
      const above = r.top - gap;
      /* รายการที่ค้นหาได้ขอสูงกว่านิดหน่อย เพราะแถวบนสุดถูกช่องค้นหากินไปแถวหนึ่ง */
      const cap = search ? 340 : 288;
      /* สูงเท่าที่รายการอยากได้จริง แต่ไม่เกินเพดานเดิมของ .sel-list */
      const want = Math.min(cap, (list.current?.scrollHeight ?? 0) + 8 || cap);
      /* กางขึ้นเมื่อข้างบนมีที่มากกว่าและพอสำหรับสามสี่บรรทัด — ในแผ่นตัวกรองที่
         ติดขอบล่างจอ ใต้ปุ่มมักเหลืออยู่บ้างแต่ไม่พอ รายการจึงไปทับปุ่มท้ายแผ่น
         ส่วนช่องที่อยู่ครึ่งบนของจอยังกางลงตามปกติ เพราะข้างบนแคบกว่า */
      const up = above > below && above >= 140;
      setDrop({
        up,
        left: r.left,
        width: r.width,
        maxHeight: Math.max(120, Math.min(want, up ? above : below)),
        top: up ? undefined : r.bottom + gap,
        bottom: up ? window.innerHeight - r.top + gap : undefined,
      });
    };

    place();
    /* เลื่อนหน้าหรือหมุนจอแล้วปุ่มย้ายที่ รายการที่ค้างอยู่ที่เดิมคือรายการที่ชี้ผิดช่อง */
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, search]);

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
      if (!view.length) return;
      if (!open) { setOpen(true); setActive(sel); return; }
      /* เดินตามลำดับที่ "เห็นอยู่" ไม่ใช่ลำดับของรายการเต็ม — กรองจนเหลือสามตัวแล้ว
         กดลูกศรลงต้องไปตัวถัดไปในสามตัวนั้น ไม่ใช่ตัวที่ถูกกรองออกไปแล้ว */
      const here = view.indexOf(active < 0 ? sel : active);
      const from = here < 0 ? 0 : here;
      if (e.key === 'Home') setActive(view[0]);
      else if (e.key === 'End') setActive(view[view.length - 1]);
      else setActive(view[(from + (e.key === 'ArrowDown' ? 1 : -1) + view.length) % view.length]);
      return;
    }
    if (e.key === 'Enter' || (e.key === ' ' && !search)) {
      e.preventDefault();
      if (open && active >= 0 && norm[active]) pick(norm[active][0]);
      else if (!open) { setOpen(true); setActive(sel); }
      return;
    }
    /* ตัวอักษรตัวเดียวคือการพิมพ์เพื่อกระโดด — ปุ่มอย่าง Tab/Shift ยาวกว่าหนึ่งตัว
       จึงไม่ถูกนับ และ Ctrl+อะไรก็ตามเป็นคำสั่ง ไม่ใช่ตัวอักษรที่พิมพ์
       ช่องที่มีช่องค้นหาไม่ต้องกระโดด เพราะตัวอักษรที่พิมพ์ลงช่องค้นหาแทนอยู่แล้ว */
    if (!search && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      jump(e.key);
    }
  };

  /* หัวข้อคั่นโผล่เมื่อกลุ่มเปลี่ยน และเฉพาะตอนที่ยังไม่ได้พิมพ์ค้นหา — ผลการค้นหา
     เรียงตามความตรงของคำ ไม่ได้เรียงตามกลุ่มแล้ว หัวข้อจึงชี้ผิดถ้ายังโชว์อยู่ */
  let lastGroup = null;

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
        <ul
          className={`sel-list ${search ? 'sel-list--search' : ''} ${drop ? 'sel-list--fixed' : ''} ${drop?.up ? 'up' : ''}`.trim()}
          role="listbox"
          ref={list}
          style={drop ? {
            left: drop.left,
            width: drop.width,
            top: drop.top,
            bottom: drop.bottom,
            maxHeight: drop.maxHeight,
          } : undefined}
        >
          {search ? (
            /* ช่องค้นหาติดหัวรายการไว้ ไม่เลื่อนหายไปพร้อมตัวเลือก — คนที่พิมพ์ผิด
               จนรายการว่างต้องเห็นคำที่ตัวเองพิมพ์อยู่ตรงหน้าถึงจะรู้ว่าต้องแก้ตรงไหน */
            <li className="sel-find" role="presentation">
              <input
                ref={find}
                className="sel-find-input"
                type="text"
                value={q}
                placeholder={typeof search === 'string' ? search : 'พิมพ์เพื่อค้นหา'}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                autoComplete="off"
                aria-label="ค้นหาในรายการ"
              />
            </li>
          ) : null}

          {view.map((i) => {
            const [v, text, extra] = norm[i];
            const group = q.trim() ? null : (extra?.group || null);
            const head = group && group !== lastGroup ? group : null;
            lastGroup = group;
            return (
              <Fragment key={String(v)}>
                {head ? <li className="sel-head" role="presentation">{head}</li> : null}
                <li>
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
                    <span className="sel-opt-text">{text}</span>
                    {extra?.hint ? <span className="sel-opt-hint">{extra.hint}</span> : null}
                  </button>
                </li>
              </Fragment>
            );
          })}

          {view.length ? null : <li className="sel-empty" role="presentation">{emptyText}</li>}
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
 * ช่องสัญชาติ
 *
 * รายการเต็มมี 185 สัญชาติ ซึ่งยาวเกินกว่าจะไล่หาด้วยตา จึงมีของสามอย่างช่วย:
 *
 *  1. **ช่องค้นหา** — พิมพ์ได้ทั้งคำสัญชาติ ('German') ชื่อไทย ('เยอรมัน') และชื่อ
 *     ประเทศ ('Germany') · ที่ต้องรับชื่อประเทศด้วยเพราะข้อมูลเดิมสามปีในฐานเก็บ
 *     เป็นชื่อประเทศเกือบทั้งหมด (England, Switzerland, Holland) คนที่ชินกับคำเดิม
 *     จะพิมพ์คำเดิม · คำที่เคยสะกดผิดกันมาจริง ๆ (Isreal, Denish, Newzeland) ก็ค้นเจอ
 *  2. **กลุ่ม "ใช้บ่อย"** — สิบสี่สัญชาติที่กินไป ~98% ของลูกค้าทั้งร้าน ลอยไว้หัวรายการ
 *     ไทยอยู่บนสุดเพราะเป็น 3,408 ใบจาก 4,100 ใบ · A→Z ล้วน ๆ แปลว่าตัวที่ใช้บ่อย
 *     ที่สุดอยู่บรรทัดที่ 165 ซึ่งไม่มีเหตุผลอะไรมารองรับนอกจากตัวอักษร
 *  3. **ชื่อไทยบรรทัดรอง** — คนกรอกคิดเป็น 'เยอรมัน' ไม่ใช่ 'German'
 *
 * ค่าที่บันทึกยังเป็นอังกฤษเหมือนเดิม ชื่อไทยมีไว้อ่านอย่างเดียว
 *
 * ค่าที่บันทึกไว้แล้วแต่ไม่ตรงกับรายการ (ใบเก่าที่เก็บว่า 'Switzerland' หรือคำที่พิมพ์
 * มั่วไว้) ถูกพ่วงเป็นตัวเลือกบนสุดให้ด้วย — `Select` ตกไปที่ตัวเลือกแรกเมื่อหาค่า
 * ไม่เจอ ซึ่งแปลว่าแค่เปิดใบเก่าขึ้นมาแก้เบอร์โทรแล้วกดบันทึก สัญชาติเดิมก็หายไปเงียบ ๆ
 */
export function NationalitySelect({ value, defaultValue = '', blank = '— ไม่ระบุ —', ...rest }) {
  const current = String((value !== undefined ? value : defaultValue) ?? '');

  const options = useMemo(() => {
    const row = (en) => {
      const m = NATIONALITY_BY_VALUE[en];
      return [en, en, { hint: m.th, keywords: `${m.th} ${m.aka}` }];
    };
    const common = NATIONALITY_COMMON.map((en) => {
      const [v, text, extra] = row(en);
      return [v, text, { ...extra, group: 'ใช้บ่อย' }];
    });
    const rest2 = NATIONALITY_ROWS
      .filter(([en]) => !NATIONALITY_COMMON.includes(en))
      .map(([en]) => {
        const [v, text, extra] = row(en);
        return [v, text, { ...extra, group: 'ทั้งหมด (A→Z)' }];
      });
    /* ค่าเดิมของใบนี้วางบนสุด ไม่ใช่ท้ายรายการ — คนแก้ใบเก่าต้องเห็นทันทีว่าตอนนี้
       ในใบเก็บคำว่าอะไรอยู่ ก่อนจะตัดสินใจว่าจะเปลี่ยนเป็นคำในรายการไหม */
    const legacy = current && !NATIONALITY_BY_VALUE[current]
      ? [[current, current, { hint: 'ไม่มีในรายการ', group: 'ค่าเดิมในใบนี้' }]]
      : [];

    return [...legacy, ['', blank], ...common, ...rest2];
  }, [blank, current]);

  return (
    <Select
      options={options}
      value={value}
      defaultValue={defaultValue}
      search="ค้นหา — ไทย, Thai หรือ Thailand"
      emptyText="ไม่พบสัญชาตินี้ — ลองพิมพ์ชื่อประเทศแทน"
      {...rest}
    />
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
