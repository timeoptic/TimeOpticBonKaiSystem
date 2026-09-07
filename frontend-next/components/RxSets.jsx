'use client';
/**
 * The three prescriptions of one round, shown the same way everywhere they are
 * read — the exam history, the order form, anywhere else that needs them:
 *
 *   ค่าสายตาเดิม          what the customer came in wearing
 *   ค่าสายตาที่วัดครั้งนี้   what was measured
 *   ★ ค่าสายตาที่ใช้ใน Case  what this case is built from
 *
 * A blank stays blank: 0.00 is a real power, so it can never stand in for
 * "ไม่มีข้อมูล".
 */
import { Badge } from './ui.jsx';
import { fmtDate, power } from '../lib/format.js';

export const RX_SOURCE_LABEL = {
  history: 'ดึงจากประวัติ',
  lensmeter: 'วัดจากแว่นเดิม',
  external_rx: 'ใบจากภายนอก',
  adjusted: 'ปรับค่าเอง',
  refraction: 'จากการตรวจวัด',
  autorefractor: 'เครื่องวัดอัตโนมัติ',
  contact_lens: 'จากคอนแทคเลนส์',
};

const COLS = [['sphere', 'SPH'], ['cylinder', 'CYL'], ['axis', 'AXIS'], ['add', 'ADD'],
  ['pd', 'PD'], ['va', 'VA']];

const cell = (row, k, f) => {
  const v = row?.[`${k}_${f}`];
  if (v === null || v === undefined || v === '') return '—';
  return f === 'sphere' || f === 'cylinder' || f === 'add' ? power(v) : String(v);
};

export function RxSetBlock({ row, title, sub, star = false }) {
  return (
    <div className="exam-set">
      <div className="exam-set-head">
        <b>{star ? `★ ${title}` : title}</b>
        <span className="muted">{sub}</span>
        {row?.source ? <Badge kind="gray">{RX_SOURCE_LABEL[row.source] || row.source}</Badge> : null}
      </div>
      {row ? (
        <div className="rx-grid-wrap">
          <table className="rx-grid">
            <thead>
              <tr><th />{COLS.map(([f, label]) => <th key={f}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {[['r', 'R / ขวา'], ['l', 'L / ซ้าย']].map(([k, label]) => (
                <tr key={k}>
                  <th scope="row">{label}</th>
                  {COLS.map(([f, colLabel]) => <td key={f} data-col={colLabel}><span>{cell(row, k, f)}</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">— ไม่มีข้อมูล</p>}
      {row?.adjust_reason ? <p className="hint">{`เหตุผลที่ปรับ: ${row.adjust_reason}`}</p> : null}
      {row?.external_place
        ? <p className="hint">{`จาก ${row.external_place}${row.external_date ? ` · ${fmtDate(row.external_date)}` : ''}`}</p>
        : null}
    </div>
  );
}

/** all three, in the order the shop reads them: เดิม → วัดได้ → ใช้จริง */
export function RxSets({ old: oldRx, measured, final: finalRx }) {
  return (
    <div className="exam-round-detail" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
      <RxSetBlock row={oldRx} title="ค่าสายตาเดิม" sub="Old Glasses" />
      <RxSetBlock row={measured} title="ค่าสายตาที่วัดครั้งนี้" sub="Measured Prescription" />
      <RxSetBlock row={finalRx} title="ค่าสายตาที่ใช้ใน Case" sub="Final Prescription" star />
    </div>
  );
}
