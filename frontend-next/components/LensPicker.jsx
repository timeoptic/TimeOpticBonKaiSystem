'use client';
/**
 * เลือกเลนส์จากคลัง — ช่องค้นหาเดิมบวกตัวกรอง Coating / SPH / CYL
 *
 * พนักงานถือค่าสายตาที่วัดได้แล้วมาหาเลนส์ในลิ้นชัก ช่องค้นหาอย่างเดียวให้ทุกตัวที่
 * "ใกล้" คำที่พิมพ์ ซึ่งสำหรับเลนส์คือของผิดชิ้น (+0.25/-0.50 ไม่ใช่ +0.25/-0.75)
 * ตัวกรองจึงเป็น AND ทุกข้อและเทียบตรงค่า — ตัวเทียบจริงอยู่ฝั่ง API (stockLensFilter)
 *
 * การเลือกยังเป็นของ StockPicker ทั้งหมด (onPick) ที่นี่แค่หาแถวให้เจอ
 * แบ่งหน้าแบบเดียวกับ Picker ของสินค้าอื่น
 */
import { useEffect, useRef, useState } from 'react';
import { useDebounced } from '../lib/hooks.js';
import { Pager } from './Pager.jsx';
import { PAGE_SIZES, sliceOf } from '../lib/pager.js';
import { Select } from './Selects.jsx';
import { Icon } from './Icon.jsx';
import {
  LENS_COATINGS, formatPower, lensChips, lensQuery, parsePower,
} from '../lib/lensFilter.js';
import s from './LensPicker.module.css';

const EMPTY = { coating: '', sph: '', cyl: '' };
const COATING_OPTIONS = [['', 'ทั้งหมด'], ...LENS_COATINGS.map((c) => [c, c])];

/**
 * fetcher(term, params) -> Promise<rows> · params คือ { coating?, sph?, cyl? } ที่กรอกครบถูกแล้ว
 * label(row) ชื่อเลนส์ · stock(row) -> { text, tone } ช่องคงเหลือ
 * nameOnly — แสดงแค่ชื่อเลนส์ ไม่มีคอลัมน์คงเหลือ / SKU (เลนส์จำลองของ Bewell ซึ่งไม่ใช่ของในคลัง)
 */
export function LensPicker({ placeholder, fetcher, label, stock, onPick, selectedId = null, nameOnly = false }) {
  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  /* ผลที่อยู่บนจอมาจากการค้นที่มีเงื่อนไขไหม — กล่องว่างของสองแบบพูดไม่เหมือนกัน */
  const [narrowed, setNarrowed] = useState(false);
  const runId = useRef(0);
  const lastKey = useRef(null);

  /* debounce ทั้งชุดเป็นสตริงเดียว — อ็อบเจกต์ใหม่ทุกรอบวาดจะทำให้ตัวจับเวลาไม่เคยครบ */
  const key = JSON.stringify([term, filters.coating, filters.sph, filters.cyl]);
  const debouncedKey = useDebounced(key, 220);

  const load = (k, force = false) => {
    if (!force && k === lastKey.current) return;
    lastKey.current = k;
    const [t, coating, sph, cyl] = JSON.parse(k);
    const q = lensQuery({ coating, sph, cyl });
    const my = ++runId.current;
    /* ช่องค่าสายตาพิมพ์ผิด — ไม่ค้นด้วยเงื่อนไขที่เหลือครึ่งเดียว ผลแบบนั้นอ่านเหมือนตรงค่าที่พิมพ์ */
    if (q.invalid.length) {
      setState('invalid');
      return;
    }
    setState('loading');
    fetcher(t, q.params)
      .then((data) => {
        if (my !== runId.current) return;
        setRows(data || []);
        setNarrowed(q.active || t.trim() !== '');
        setPage(1);
        setState('done');
      })
      .catch((e) => {
        if (my !== runId.current) return;
        setError(e.message);
        setState('error');
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(debouncedKey); }, [debouncedKey]);
  /* ถอดออกแล้วผลที่ค้างมาทีหลังต้องไม่ถูกเขียนลง · ล้าง lastKey ด้วย ไม่งั้น StrictMode
     ที่วาดซ้ำจะข้ามการโหลดรอบจริงเพราะคิดว่าค้นคำนี้ไปแล้ว */
  useEffect(() => () => { runId.current += 1; lastKey.current = null; }, []);

  const setF = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const clearAll = () => { setTerm(''); setFilters(EMPTY); };
  const bad = lensQuery(filters).invalid;
  const chips = lensChips(filters);

  /* ออกจากช่องแล้วเขียนค่าแบบใบสั่ง "-2" → "-2.00" ให้เห็นว่าระบบอ่านว่าอะไร */
  const tidy = (k) => {
    const { value, error: wrong } = parsePower(filters[k]);
    if (!wrong && value !== null) setF({ [k]: formatPower(value) });
  };
  /* ทั้งหน้าเป็นฟอร์มออเดอร์ — Enter ในช่องกรองต้องค้นทันที ไม่ใช่ส่งฟอร์ม */
  const enter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      load(key, true);
    }
  };

  const powerInput = (k, text) => (
    <input
      className={s.power}
      placeholder="0.00"
      aria-label={text}
      aria-invalid={bad.includes(k) || undefined}
      autoComplete="off"
      value={filters[k]}
      onChange={(e) => setF({ [k]: e.target.value })}
      onBlur={() => tidy(k)}
      onKeyDown={enter}
    />
  );

  return (
    <div className="stack">
      <div className={s.bar}>
        <div className={s.coating}>
          <span className={s.label}>Coating</span>
          <Select
            value={filters.coating}
            onChange={(e) => setF({ coating: e.target.value })}
            options={COATING_OPTIONS}
            aria-label="Coating"
          />
        </div>
        <div className={s.powers}>
          <span className={s.label}>ค่าสายตา (SPH / CYL)</span>
          <div className={s.pair}>
            {powerInput('sph', 'SPH')}
            <span className={s.slash} aria-hidden="true">/</span>
            {powerInput('cyl', 'CYL')}
          </div>
        </div>
        <div className={s.search}>
          <span className={s.label}>ค้นหาเลนส์ / ยี่ห้อ / SKU</span>
          <div className={s.searchRow}>
            <label className={s.term}>
              <Icon name="search" />
              <input
                type="search"
                placeholder={placeholder}
                aria-label="ค้นหาเลนส์ / ยี่ห้อ / SKU"
                autoComplete="off"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={enter}
              />
            </label>
            <button type="button" className="btn" onClick={() => load(key, true)}>ค้นหา</button>
          </div>
        </div>
      </div>

      {bad.length ? (
        <p className={s.badHint} role="alert">
          {bad.map((k) => k.toUpperCase()).join(' และ ')} ต้องเป็นตัวเลข เช่น -0.25 หรือ +1.50
        </p>
      ) : null}

      {chips.length ? (
        <div className={s.chips}>
          {chips.map((c) => (
            <button
              type="button"
              key={c.key}
              className={s.chip}
              onClick={() => setF({ [c.key]: '' })}
              aria-label={`เอา ${c.label} ออก`}
            >
              {c.label} <Icon name="x" />
            </button>
          ))}
          <button type="button" className={s.clearAll} onClick={clearAll}>
            <Icon name="trash" /> ล้างทั้งหมด
          </button>
        </div>
      ) : null}

      <div className={`${s.list} ${nameOnly ? s.nameOnly : ''}`} role="radiogroup" aria-label="เลือกเลนส์">
        <div className={s.head} aria-hidden="true">
          <span />
          <span>ชื่อเลนส์</span>
          {nameOnly ? null : (
            <>
              <span>คงเหลือ</span>
              <span>SKU</span>
              <span />
            </>
          )}
        </div>
        {state === 'loading' && <div className={s.msg}><span className="spin" /> กำลังค้นหา…</div>}
        {state === 'error' && <div className={s.msg}>{error}</div>}
        {state === 'invalid' && <div className={s.msg}>แก้ค่าสายตาให้เป็นตัวเลขก่อน แล้วรายการจะขึ้นตามเงื่อนไข</div>}
        {state === 'done' && rows.length === 0 && (narrowed ? (
          <div className={`${s.msg} ${s.empty}`}>
            <span>ไม่พบเลนส์ที่ตรงกับเงื่อนไข</span>
            <button type="button" className="btn btn-sm btn-light" onClick={clearAll}>ล้างตัวกรอง</button>
          </div>
        ) : (
          <div className={`${s.msg} muted`}>ไม่พบข้อมูล</div>
        ))}
        {state === 'done' && sliceOf(rows, page, perPage).map((r, i) => {
          /* สินค้าที่ยังไม่มีล็อต id เป็น null — ต้องไม่ถูกนับว่าเลือกอยู่ตอนยังไม่ได้เลือกอะไร */
          const sel = r.id != null && String(r.id) === String(selectedId);
          const st = nameOnly ? null : stock(r);
          return (
            <div
              key={`${r.id}-${r.sku}-${i}`}
              role="radio"
              aria-checked={sel}
              tabIndex={0}
              className={`${s.row} ${sel ? s.sel : ''}`}
              onClick={() => onPick(r)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPick(r);
                }
              }}
            >
              <span className={s.radio} aria-hidden="true" />
              <span className={s.name}>
                <b title={label(r)}>{label(r)}</b>
                {r.coating ? <span className="badge blue">{r.coating}</span> : null}
              </span>
              {nameOnly ? null : (
                <>
                  <span className={`${s.stock} ${s[st.tone] || ''}`}>{st.text}</span>
                  <span className={s.sku}>{r.sku || '—'}</span>
                  <span className={s.id}>{r.id != null ? `#${r.id}` : ''}</span>
                </>
              )}
            </div>
          );
        })}
      </div>

      {state === 'done' ? (
        <Pager
          total={rows.length}
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={setPerPage}
          hideWhenFits
        />
      ) : null}
    </div>
  );
}
