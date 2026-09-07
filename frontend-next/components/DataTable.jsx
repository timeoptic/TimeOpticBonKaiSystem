'use client';
/**
 * The one table the whole app uses.
 *
 * columns: [{ label, key?, render?(row, i), cls?, sortKey?, mobile? }]
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
 *
 * ── บนจอโทรศัพท์ตารางกลายเป็นการ์ด ────────────────────────────────────────
 *
 * ตารางแปดคอลัมน์บนจอ 390px มีทางออกอยู่สองทาง: ย่อตัวอักษรจนอ่านไม่ออก หรือ
 * ให้เลื่อนซ้าย-ขวา ซึ่งทั้งคู่คือการยัดหน้าเดสก์ท็อปลงมือถือ · ที่นี่จึงวาด
 * แถวเดียวกันสองแบบ แล้วให้ CSS เลือกว่าจอนี้เห็นแบบไหน (`.table-wrap` กับ
 * `.dt-cards` ซ่อนสลับกันที่ 640px)
 *
 * **ทำไมถึงวาดสองแบบแทนที่จะเช็คขนาดจอด้วย JS** — เว็บนี้ build เป็น static
 * export (`output:'export'` ใน next.config.js) ตอน build ไม่มี viewport ให้ถาม
 * ถ้าเลือกด้วย JS ฝั่งเซิร์ฟเวอร์จะวาดตารางเสมอ แล้วมือถือจะเห็นตารางแวบหนึ่ง
 * ก่อนสลับเป็นการ์ด (หรือแย่กว่านั้นคือ hydration mismatch) · ต้นทุนของการวาด
 * สองรอบถูกจำกัดด้วย `page`/`perPage` ที่หั่นเหลือ ~20 แถวอยู่แล้ว
 *
 * คอลัมน์บอกบทบาทของตัวเองบนมือถือผ่าน `mobile`:
 *
 *   'title'    หัวการ์ด — ใส่ได้หลายคอลัมน์ ทุกอันอยู่บรรทัดเดียวกัน เพราะที่ที่
 *              ต้องใส่หลายอันคือชื่อที่ถูกเก็บแยกช่อง (ชื่อ · นามสกุล) ซึ่งเป็น
 *              ชื่อเดียวกัน ไม่ใช่ข้อมูลสองอย่าง
 *   'subtitle' บรรทัดรองใต้หัว — เบอร์โทร ชื่อลูกค้าของเคส สิ่งที่ตามหลังชื่อ
 *   'status'   ป้ายสถานะมุมขวาบน
 *   'body'    ตัวการ์ด แสดงเป็นคู่ ป้าย/ค่า
 *   'meta'    ซ่อนใต้ปุ่ม "ดูเพิ่มเติม" — Created At, รหัสภายใน, ข้อมูลรอง
 *   'extra'   ท้ายการ์ด ไม่มีป้ายกำกับ — ปุ่ม/ชิปที่ตัวมันเองบอกความหมายแล้ว
 *   false     ไม่แสดงบนมือถือเลย
 *
 * หน้าที่ยังไม่ได้ติดป้ายให้คอลัมน์ไหนเลยได้ค่าอัตโนมัติที่ใช้งานได้จริง:
 * คอลัมน์แรกที่มีชื่อเป็นหัวการ์ด สามอันถัดไปเป็นตัวการ์ด ที่เหลือพับเก็บ —
 * ไม่ใช่การ์ดเปล่าหรือตารางพัง · พอหน้าไหนติดป้ายแล้ว คอลัมน์ที่ไม่ได้ติดใน
 * หน้านั้นจะถูกพับเก็บเป็น 'meta' ไม่ใช่หายไป เพราะการหายไปเงียบ ๆ คือการลบ
 * ข้อมูลออกจากจอโดยที่ไม่มีใครสั่ง
 */
import { Fragment, useMemo, useState } from 'react';
import { sliceOf } from '../lib/pager.js';
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

/** จำนวนคู่ป้าย/ค่าที่การ์ดแสดงเองโดยไม่ต้องกด "ดูเพิ่มเติม" ตอนหน้ายังไม่ติดป้าย */
const AUTO_BODY = 3;

/**
 * คอลัมน์ไหนไปอยู่ตรงไหนของการ์ด
 *
 * แยกออกมาเป็นฟังก์ชันล้วนเพื่อให้อ่านออกว่ากติกาคืออะไรโดยไม่ต้องอ่าน JSX และ
 * เพื่อให้เทสต์ได้โดยไม่ต้อง render
 */
export function planCards(columns) {
  const tagged = columns.some((c) => 'mobile' in c);
  if (tagged) {
    return columns.map((c) => ({ col: c, role: 'mobile' in c ? c.mobile : 'meta' }));
  }
  let hasTitle = false;
  let body = 0;
  return columns.map((c) => {
    /* คอลัมน์ไม่มีชื่อมักเป็นปุ่มประจำแถว — ป้ายกำกับว่างเปล่าเหนือปุ่มไม่ได้
       บอกอะไร ให้ไปต่อท้ายการ์ดแบบไม่มีป้ายแทน และอย่าทิ้ง เพราะบางหน้ามีแต่
       ปุ่มนั้นที่ทำงานนั้นได้ */
    if (!c.label) return { col: c, role: 'extra' };
    if (!hasTitle) { hasTitle = true; return { col: c, role: 'title' }; }
    if (body < AUTO_BODY) { body += 1; return { col: c, role: 'body' }; }
    return { col: c, role: 'meta' };
  });
}

/** ค่าของช่องหนึ่ง — ตารางกับการ์ดต้องผ่านทางนี้ทั้งคู่ ผลจะได้ตรงกันเสมอ */
const cellOf = (c, row, i) => (c.render ? c.render(row, i) : (row[c.key] ?? ''));

/** คู่ป้าย/ค่า ที่การ์ดใช้ทั้งส่วนที่เห็นและส่วนที่พับไว้ */
function CardRows({ items, row, i }) {
  if (!items.length) return null;
  return (
    <dl className="dtc-rows">
      {items.map(({ col }, n) => (
        <Fragment key={col.label + n}>
          <dt>{col.label}</dt>
          <dd className={col.cls || ''}>{cellOf(col, row, i)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * แถวหนึ่งในร่างการ์ด
 *
 * "ดูเพิ่มเติม" เป็น state ของการ์ดใบนั้นใบเดียว จึงต้องเป็นคอมโพเนนต์ของตัวเอง —
 * ถ้าเก็บไว้ที่ <DataTable> จะกลายเป็นกางทุกใบพร้อมกัน
 */
function Card({ plan, row, i, rowClass, onRowClick, cardAction }) {
  const [more, setMore] = useState(false);
  const pick = (role) => plan.filter((p) => p.role === role);
  const titles = pick('title');
  const subs = pick('subtitle');
  const status = pick('status');
  const body = pick('body');
  const meta = pick('meta');
  const extra = pick('extra');

  return (
    <li className={`dt-card ${rowClass ? rowClass(row, i) : ''}`.trim()}>
      {titles.length || subs.length || status.length ? (
        <div className="dtc-head">
          <div className="dtc-headmain">
            {titles.length ? (
              <div className="dtc-title">
                {titles.map(({ col }, n) => (
                  <span key={col.label + n} className={col.cls || ''}>{cellOf(col, row, i)}</span>
                ))}
              </div>
            ) : null}
            {subs.length ? (
              <div className="dtc-sub">
                {subs.map(({ col }, n) => (
                  <span key={col.label + n} className={col.cls || ''}>{cellOf(col, row, i)}</span>
                ))}
              </div>
            ) : null}
          </div>
          {status.length ? (
            <div className="dtc-status">
              {status.map(({ col }, n) => (
                <Fragment key={col.label + n}>{cellOf(col, row, i)}</Fragment>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <CardRows items={body} row={row} i={i} />

      {meta.length ? (
        <>
          <button
            type="button"
            className="dtc-more"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
          >
            {more ? 'ย่อกลับ' : 'ดูเพิ่มเติม'}
            <span className={`fold-caret ${more ? 'open' : ''}`} aria-hidden="true" />
          </button>
          {more ? <CardRows items={meta} row={row} i={i} /> : null}
        </>
      ) : null}

      {extra.length ? (
        <div className="dtc-extra">
          {extra.map(({ col }, n) => (
            <Fragment key={col.label + n}>{cellOf(col, row, i)}</Fragment>
          ))}
        </div>
      ) : null}

      {/* แถวที่คลิกได้บนเดสก์ท็อปกลายเป็นปุ่มเต็มความกว้างบนมือถือ — การ์ดทั้งใบ
          กดได้ทำให้กดปุ่มข้างในไม่โดน และไม่มีอะไรบอกว่ากดแล้วจะไปไหน */}
      {onRowClick ? (
        <button type="button" className="btn btn-primary dtc-go" onClick={() => onRowClick(row)}>
          {cardAction}
        </button>
      ) : null}
    </li>
  );
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
  page = 0,
  perPage = 0,
  cardAction = 'ดูรายละเอียด',
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

  /* ตัดหน้า *หลัง* เรียง — ถ้าคนเรียกหั่นหน้ามาเองก่อนส่งเข้ามา ปุ่มเรียงหัวคอลัมน์
     จะเรียงแค่สิบแถวที่เห็นอยู่ กด "ยอดมากไปน้อย" แล้วได้ยอดมากที่สุด *ของหน้านี้*
     ซึ่งอ่านไม่ออกว่าผิด · แถบเลขหน้ายังเป็นของคนเรียก (<Pager>) ที่นี่รับแค่ว่า
     ตอนนี้อยู่หน้าไหน — ไม่ส่งมา = ได้ตารางเดิมทั้งใบเหมือนเดิมทุกพิกเซล */
  const shown = page && perPage ? sliceOf(sorted || rows, page, perPage) : (sorted || rows);

  const plan = useMemo(() => planCards(columns), [columns]);

  if (!rows || !rows.length) return <Empty>{empty}</Empty>;

  const toggle = (col) => {
    const key = col.sortKey ?? col.key ?? col.label;
    setSort((s) => (s && s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }));
  };

  /* หัวคอลัมน์ที่กดเรียงได้อยู่ใน <thead> ซึ่งการ์ดไม่มี — ถ้าปล่อยไว้เฉย ๆ
     การเรียงจะหายไปทั้งฟังก์ชันบนมือถือ ยกมาเป็นกล่องเลือกหนึ่งช่องแทน */
  const sortCols = sortable ? columns.filter((c) => pick(c)) : [];
  const sortValue = sort ? `${sort.key}|${sort.dir}` : '';

  return (
    <>
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
            {shown.map((row, i) => (
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
                    {cellOf(c, row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>

      {/* ร่างมือถือของแถวชุดเดียวกัน — `shown` ตัวเดียวกัน เรียงเหมือนกัน
          หน้าเดียวกัน ต่างกันแค่วิธีวาง */}
      <div className="dt-mobile">
        {sortCols.length ? (
          <label className="dt-sort">
            เรียงตาม
            <select
              value={sortValue}
              onChange={(e) => {
                const [key, dir] = e.target.value.split('|');
                setSort(key ? { key, dir } : null);
              }}
            >
              <option value="">ตามลำดับเดิม</option>
              {sortCols.map((c, i) => {
                const key = c.sortKey ?? c.key ?? c.label;
                return (
                  <Fragment key={c.label + i}>
                    <option value={`${key}|asc`}>{`${c.label} น้อย → มาก`}</option>
                    <option value={`${key}|desc`}>{`${c.label} มาก → น้อย`}</option>
                  </Fragment>
                );
              })}
            </select>
          </label>
        ) : null}

        <ul className="dt-cards">
          {shown.map((row, i) => (
            <Card
              key={rowKey(row, i)}
              plan={plan}
              row={row}
              i={i}
              rowClass={rowClass}
              onRowClick={onRowClick}
              cardAction={cardAction}
            />
          ))}
        </ul>

        {/* ยอดรวมท้ายตารางเป็นข้อมูล ไม่ใช่เครื่องประดับ — ถ้าไม่วาดต่อ มือถือจะ
            อ่านยอดรวมไม่ได้เลย ซึ่งเป็นการลบข้อมูลออกจากจอ · ใช้ JSX ก้อนเดิม
            ในตารางเล็กของมันเอง เพราะ <tr> อยู่นอก <table> ไม่ได้ */}
        {footer ? (
          <table className="grid dt-cards-foot"><tfoot>{footer}</tfoot></table>
        ) : null}
      </div>
    </>
  );
}
