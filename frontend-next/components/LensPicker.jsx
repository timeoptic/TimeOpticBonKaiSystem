'use client';
/**
 * เลือกเลนส์จากคลัง — ช่องค้นหาเดิม บวกชิป Index / ชนิดเลนส์ / Coating และช่วง SPH / CYL
 *
 * พนักงานถือค่าสายตาที่วัดได้แล้วมาหาเลนส์ในลิ้นชัก · ชิปเลือกได้หลายตัว ("1.56 หรือ 1.60 ก็ได้")
 * ช่องต่างกันเป็น AND · ค่าสายตาเป็นช่วงตั้งแต่–ถึง ที่ดึงจากเลนส์ที่มีจริง ตัวเทียบจริงอยู่ฝั่ง API
 * (stockLensFilter) · ตัวเลือกพร้อมจำนวนมาจาก optionsFetcher ชิปที่นับได้ศูนย์ไม่ถูกวาด
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
import { EMPTY_LENS, formatPower, lensParams, toggleLens } from '../lib/lensFilter.js';
import s from './LensPicker.module.css';

const CHIP_GROUPS = [
  ['index', 'indexes', 'Index'],
  ['design', 'designs', 'ชนิดเลนส์'],
  ['coating', 'coatings', 'Coating'],
];

/**
 * fetcher(term, params) -> Promise<rows> · params คือ query ของตัวกรอง (lensParams)
 * optionsFetcher(term, params) -> Promise<{ indexes, designs, coatings, sphs, cyls }>
 * label(row) ชื่อเลนส์ · stock(row) -> { text, tone } ช่องคงเหลือ
 */
export function LensPicker({ placeholder, fetcher, optionsFetcher, label, stock, onPick, selectedId = null }) {
  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState(EMPTY_LENS);
  const [rows, setRows] = useState([]);
  const [facets, setFacets] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState(null);
  /* ผลที่อยู่บนจอมาจากการค้นที่มีเงื่อนไขไหม — กล่องว่างของสองแบบพูดไม่เหมือนกัน */
  const [narrowed, setNarrowed] = useState(false);
  const runId = useRef(0);
  const lastKey = useRef(null);

  /* debounce ทั้งชุดเป็นสตริงเดียว — อ็อบเจกต์ใหม่ทุกรอบวาดจะทำให้ตัวจับเวลาไม่เคยครบ */
  const key = JSON.stringify([term, lensParams(filters)]);
  const debouncedKey = useDebounced(key, 220);

  const load = (k, force = false) => {
    if (!force && k === lastKey.current) return;
    lastKey.current = k;
    const [t, params] = JSON.parse(k);
    const my = ++runId.current;
    setState('loading');
    fetcher(t, params)
      .then((data) => {
        if (my !== runId.current) return;
        setRows(data || []);
        setNarrowed(Object.keys(params).length > 0 || t.trim() !== '');
        setPage(1);
        setState('done');
      })
      .catch((e) => {
        if (my !== runId.current) return;
        setError(e.message);
        setState('error');
      });
    /* ตัวเลขบนชิปถามแยก ผลที่ช้ากว่าไม่ทับรายการ · ระหว่างรอ ชิปชุดเดิมยังอยู่
       ไม่งั้นทั้งแถวหายแล้วโผล่กลับทุกครั้งที่กด · ถามไม่สำเร็จก็แค่ใช้ชุดเดิม */
    optionsFetcher?.(t, params)
      .then((data) => { if (my === runId.current) setFacets(data); })
      .catch(() => {});
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(debouncedKey); }, [debouncedKey]);
  /* ถอดออกแล้วผลที่ค้างมาทีหลังต้องไม่ถูกเขียนลง · ล้าง lastKey ด้วย ไม่งั้น StrictMode
     ที่วาดซ้ำจะข้ามการโหลดรอบจริงเพราะคิดว่าค้นคำนี้ไปแล้ว */
  useEffect(() => () => { runId.current += 1; lastKey.current = null; }, []);

  const setF = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const clearAll = () => { setTerm(''); setFilters(EMPTY_LENS); };
  const active = Object.keys(lensParams(filters)).length > 0;

  /* ทั้งหน้าเป็นฟอร์มออเดอร์ — Enter ในช่องค้นหาต้องค้นทันที ไม่ใช่ส่งฟอร์ม */
  const enter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      load(key, true);
    }
  };

  /* ชิปที่นับได้ศูนย์ถูกซ่อน เว้นตัวที่เลือกอยู่ — ไม่งั้นมันหายไปทั้งที่ยังกรองอยู่ และกดเอาออกไม่ได้ */
  const chipsOf = (k, list) => (list || []).filter((f) => f.count > 0 || filters[k].includes(f.value));

  /* ค่าที่เลือกไว้แต่ไม่อยู่ในลิสต์แล้ว (ตัวกรองอื่นเปลี่ยน) ยังต้องอ่านได้บนหน้าปุ่ม */
  const rangeOptions = (list, from, to, all) => {
    const values = [...new Set([...(list || []).map((f) => f.value), from, to].filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b));
    return [['', all], ...values.map((v) => [v, formatPower(v)])];
  };

  const range = (k, text) => {
    const from = filters[`${k}From`];
    const to = filters[`${k}To`];
    const list = facets?.[`${k}s`];
    if (!list?.length && !from && !to) return null;
    return (
      <div className={s.range}>
        <span className={s.label}>{text}</span>
        <div className={s.pair}>
          <Select
            value={from}
            onChange={(e) => setF({ [`${k}From`]: e.target.value })}
            options={rangeOptions(list, from, to, 'ตั้งแต่')}
            aria-label={`${text} ตั้งแต่`}
          />
          <span className={s.slash} aria-hidden="true">–</span>
          <Select
            value={to}
            onChange={(e) => setF({ [`${k}To`]: e.target.value })}
            options={rangeOptions(list, from, to, 'ถึง')}
            aria-label={`${text} ถึง`}
          />
        </div>
      </div>
    );
  };

  const groups = CHIP_GROUPS
    .map(([k, list, text]) => ({ k, text, chips: chipsOf(k, facets?.[list]) }))
    .filter((g) => g.chips.length > 0);

  return (
    <div className="stack">
      <div className={s.bar}>
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
        {range('sph', 'SPH')}
        {range('cyl', 'CYL')}

        {groups.length ? (
          <div className={s.facets}>
            {groups.map((g) => (
              <div key={g.k} className={s.facet} role="group" aria-label={g.text}>
                <span className={s.facetLabel}>{g.text}</span>
                {g.chips.map((f) => {
                  const on = filters[g.k].includes(f.value);
                  return (
                    <button
                      type="button"
                      key={f.value}
                      className={`${s.chip} ${on ? s.chipOn : ''}`}
                      aria-pressed={on}
                      onClick={() => setFilters((cur) => toggleLens(cur, g.k, f.value))}
                    >
                      {f.value} <span className={s.count}>{f.count.toLocaleString('th-TH')}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {active ? (
              <button type="button" className={s.clearAll} onClick={clearAll}>
                <Icon name="trash" /> ล้างตัวกรอง
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={s.list} role="radiogroup" aria-label="เลือกเลนส์">
        <div className={s.head} aria-hidden="true">
          <span />
          <span>ชื่อเลนส์</span>
          <span>คงเหลือ</span>
          <span>SKU</span>
          <span />
        </div>
        {state === 'loading' && <div className={s.msg}><span className="spin" /> กำลังค้นหา…</div>}
        {state === 'error' && <div className={s.msg}>{error}</div>}
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
          const st = stock(r);
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
              <span className={`${s.stock} ${s[st.tone] || ''}`}>{st.text}</span>
              <span className={s.sku}>{r.sku || '—'}</span>
              <span className={s.id}>{r.id != null ? `#${r.id}` : ''}</span>
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
