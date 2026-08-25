'use client';
/**
 * The one table the whole app uses. Port of frontend/src/components/DataTable.jsx.
 * columns: [{ label, key?, render?(row, i), cls?, }]
 */
import { Empty } from './ui.jsx';

export function DataTable({
  columns,
  rows,
  onRowClick = null,
  empty = 'ไม่มีข้อมูล',
  footer = null,
  rowKey = (row, i) => row?.id ?? i,
}) {
  if (!rows || !rows.length) return <Empty>{empty}</Empty>;

  return (
    <div className="table-wrap">
      <table className="grid">
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
              className={onRowClick ? 'clickable' : ''}
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
