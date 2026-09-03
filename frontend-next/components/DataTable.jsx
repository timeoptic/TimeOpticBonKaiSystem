'use client';
/**
 * The one table the whole app uses.
 *
 * columns: [{ label, key?, render?(row, i), cls?, sortKey? }]
 * A row click is ignored when it lands on a control, so buttons inside cells
 * keep working.
 *
 * `className` and `rowClass` exist for screens that colour rows by state (the
 * production board's left status stripe). Both are optional — leaving them out
 * renders exactly the table every other screen already gets.
 *
 * `sortable` is opt-in and off by default: หน้ารายงานต้องเรียงคอลัมน์ได้
 * (ยอดขายมากไปน้อย · วันที่ใหม่ไปเก่า) ส่วนอีกยี่สิบกว่าหน้าที่ใช้ตารางนี้อยู่แล้ว
 * ไม่ได้ขอ และไม่ควรเปลี่ยนหน้าตาเพราะหน้าใหม่หนึ่งหน้า · ไม่ส่ง prop นี้มา =
 * ได้ตารางเดิมเป๊ะทุกพิกเซล
 */
import { useMemo, useState } from 'react';
import { Empty } from './ui.jsx';

/**
 * ค่าที่เอาไปเรียง — ตัวเลขเรียงแบบตัวเลข ข้อความเรียงแบบไทย
 *
 * ตัวเลขที่มาจาก API เป็นสตริงได้ (PDO คืน DECIMAL เป็นสตริง) ถ้าเรียงแบบข้อความ
 * จะได้ '9' > '10' ซึ่งเป็นบั๊กที่มองไม่ออกจนกว่ายอดจะข้ามหลัก
 */
function compare(a, b) {
  const na = typeof a === 'number' ? a : (a === '' || a === null || a === undefined ? null : Number(a));
  const nb = typeof b === 'number' ? b : (b === '' || b === null || b === undefined ? null : Number(b));
  const numeric = na !== null && nb !== null && !Number.isNaN(na) && !Number.isNaN(nb);
  if (numeric) return na - nb;
  /* ค่าว่างไปท้ายเสมอ ไม่ว่าจะเรียงขึ้นหรือลง — แถวที่ยังไม่มีข้อมูลไม่ควรแย่ง
     ที่หัวตารางจากแถวที่มี */
  const sa = a === null || a === undefined ? '' : String(a);
  const sb = b === null || b === undefined ? '' : String(b);
  if (sa === '' && sb !== '') return 1;
  if (sb === '' && sa !== '') return -1;
  return sa.localeCompare(sb, 'th');
}

export function DataTable({
  columns,
  rows,
  onRowClick = null,
  empty = 'ไม่มีข้อมูล',
  footer = null,
  rowKey = (row, i) => row?.id ?? i,
  className = '',
  rowClass = null,
  sortable = false,
  defaultSort = null,
}) {
  const [sort, setSort] = useState(defaultSort);

  const pick = (col) => {
    if (!sortable) return null;
    if (col.sortKey === false) return null;
    if (typeof col.sortKey === 'function') return col.sortKey;
    if (typeof col.sortKey === 'string') return (row) => row[col.sortKey];
    if (col.key) return (row) => row[col.key];
    return null;
  };

  const sorted = useMemo(() => {
    if (!sortable || !sort || !rows) return rows;
    const col = columns.find((c) => (c.sortKey ?? c.key ?? c.label) === sort.key);
    const get = col && pick(col);
    if (!get) return rows;
    /* คัดลอกก่อนเรียง — sort() แก้อาเรย์ต้นทาง ซึ่งเป็น state ของหน้าที่เรียกมา */
    const out = [...rows].sort((a, b) => compare(get(a), get(b)));
    return sort.dir === 'desc' ? out.reverse() : out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, sortable, columns]);

  if (!rows || !rows.length) return <Empty>{empty}</Empty>;

  const toggle = (col) => {
    const key = col.sortKey ?? col.key ?? col.label;
    setSort((s) => (s && s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }));
  };

  return (
    <div className="table-wrap">
      <table className={`grid ${className}`.trim()}>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const can = !!pick(c);
              const key = c.sortKey ?? c.key ?? c.label;
              const on = sort && sort.key === key;
              return (
                <th key={c.label + i} className={`${c.cls || ''} ${can ? 'sortable' : ''}`.trim()}>
                  {can ? (
                    <button
                      type="button"
                      className={`th-sort ${on ? 'on' : ''}`}
                      onClick={() => toggle(c)}
                      aria-label={`เรียงตาม ${c.label}`}
                    >
                      {c.label}
                      <span className="th-caret" aria-hidden="true">
                        {on ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {(sorted || rows).map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={`${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(row, i) : ''}`.trim()}
              onClick={(e) => {
                if (!onRowClick) return;
                if (e.target.closest('a,button,input,select,textarea')) return;
                onRowClick(row);
              }}
            >
              {columns.map((c, j) => (
                <td key={c.label + j} className={c.cls || ''}>
                  {c.render ? c.render(row, i) : (row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
