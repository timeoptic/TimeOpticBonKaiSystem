'use client';
/**
 * Search box + result list. Used to choose a customer or a stock item.
 * fetcher(term) -> Promise<rows>, label(row) -> string, sub(row) -> string
 * Port of frontend/src/components/Picker.jsx.
 */
import { useEffect, useRef, useState } from 'react';
import { useDebounced } from '../lib/hooks.js';

export function Picker({ placeholder, fetcher, label, sub, onPick, autoLoad = true, selectedId = null }) {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState([]);
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
        {state === 'done' && rows.map((r) => (
          <div
            key={r.id}
            className={`p-row ${String(r.id) === String(selectedId) ? 'sel' : ''}`}
            onClick={() => onPick(r)}
          >
            <span className="p-main">
              <b>{label(r)}</b>
              {sub ? <span className="muted">{'  ' + sub(r)}</span> : null}
            </span>
            <span className="p-id">#{r.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
