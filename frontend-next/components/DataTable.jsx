'use client';
/**
 * The one table the whole app uses.
 *
 * columns: [{ label, key?, render?(row, i), cls?, }]
 * A row click is ignored when it lands on a control, so buttons inside cells
 * keep working.
 *
 * `className` and `rowClass` exist for screens that colour rows by state (the
 * production board's left status stripe). Both are optional — leaving them out
 * renders exactly the table every other screen already gets.
 */
import { Empty } from './ui.jsx';

export function DataTable({
  columns,
  rows,
  onRowClick = null,
  empty = 'ไม่มีข้อมูล',
  footer = null,
  rowKey = (row, i) => row?.id ?? i,
  className = '',
  rowClass = null,
}) {
  if (!rows || !rows.length) return <Empty>{empty}</Empty>;

  return (
    <div className="table-wrap">
      <table className={`grid ${className}`.trim()}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.label + i} className={c.cls || ''}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
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
