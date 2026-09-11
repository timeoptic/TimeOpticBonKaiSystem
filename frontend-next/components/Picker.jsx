'use client';
/**
 * Search box + result list. Used to choose a customer or a stock item.
 * fetcher(term) -> Promise<rows>, label(row) -> string, sub(row) -> string
 * Port of frontend/src/components/Picker.jsx.
 */
import { useEffect, useRef, useState } from 'react';
import { useDebounced } from '../lib/hooks.js';
import { Pager } from './Pager.jsx';
import { PAGE_SIZES, sliceOf } from '../lib/pager.js';

export function Picker({ placeholder, fetcher, label, sub, onPick, autoLoad = true, selectedId = null }) {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState([]);
  /* รายชื่อที่ยังไม่ได้ค้นอะไรเลยคือลูกค้าสี่สิบคนแรก ซึ่งบนจอเป็นกล่องที่ต้อง
     ไถอีกกล่องซ้อนอยู่ในหน้าที่ไถอยู่แล้ว · แบ่งหน้าทีละห้าเหมือนตารางอื่นทั้งแอป
     คนที่รู้ว่าจะหาใครพิมพ์ค้นอยู่แล้ว ส่วนคนที่ไล่ดูก็ได้ปุ่มหน้าถัดไปที่อยู่กับที่ */
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);
  const [state, setState] = useState(autoLoad ? 'loading' : 'idle');
  const [error, setError] = useState(null);
  const debounced = useDebounced(term, 220);
  const runId = useRef(0);

  useEffect(() => {
    if (!autoLoad && debounced === '') return undefined;
    const my = ++runId.current;
    let alive = true;
    setState('loading');
    fetcher(debounced)
      .then((data) => {
        if (!alive || my !== runId.current) return;
        setRows(data || []);
        /* ผลชุดใหม่เริ่มที่หน้าหนึ่งเสมอ — ค้างอยู่หน้า 3 ของคำค้นก่อนหน้า
           คือกล่องเปล่าที่อ่านเหมือนไม่พบข้อมูล */
        setPage(1);
        setState('done');
      })
      .catch((e) => {
        if (!alive || my !== runId.current) return;
        setError(e.message);
        setState('error');
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, autoLoad]);

  return (
    <div className="stack">
      <input
        type="search"
        placeholder={placeholder}
        autoComplete="off"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <div className="picker">
        {state === 'loading' && <div className="p-row"><span className="spin" /> กำลังค้นหา…</div>}
        {state === 'error' && <div className="p-row">{error}</div>}
        {state === 'done' && rows.length === 0 && <div className="p-row muted">ไม่พบข้อมูล</div>}
        {state === 'done' && sliceOf(rows, page, perPage).map((r, i) => (
          <div
            key={`${r.id}-${i}`}
            className={`p-row ${String(r.id) === String(selectedId) ? 'sel' : ''}`}
            onClick={() => onPick(r)}
          >
            <span className="p-main">
              <b>{label(r)}</b>
              {sub ? <span className="muted">{'  ' + sub(r)}</span> : null}
            </span>
            {/* สินค้าที่ยังไม่มีล็อตไม่มีเลขให้โชว์ — ไม่ขึ้น "#null" */}
            {r.id != null ? <span className="p-id">#{r.id}</span> : null}
          </div>
        ))}
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
