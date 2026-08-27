'use client';
/**
 * A customer's eye-exam history, as rounds rather than a pile of rows.
 *
 * One round is one case, and it holds the three value sets that case was built
 * from — ค่าเดิม / ค่าที่วัดได้ / ค่าที่ใช้จริง. The list summarises each round by
 * its final values (that is what the customer is wearing); opening a round
 * shows all three side by side, read-only — this is a record of what happened,
 * so editing goes through the case's own วัดสายตา step.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Badge, Empty, Row } from './ui.jsx';
import { fmtDate, power } from '../lib/format.js';
import { Icon } from './Icon.jsx';

const SET_META = [
  ['old', 'OLD GLASSES', 'ค่าสายตาเดิม'],
  ['measured', 'MEASURED', 'ค่าที่วัดรอบนี้'],
  ['final', 'FINAL', 'ค่าที่ใช้จริง'],
];

const SOURCE_LABEL = {
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

/** one value set as its own small grid — missing data shows —, never 0.00 */
function SetBlock({ row, title, sub }) {
  return (
    <div className="exam-set">
      <div className="exam-set-head">
        <b>{title}</b>
        <span className="muted">{sub}</span>
        {row?.source ? <Badge kind="gray">{SOURCE_LABEL[row.source] || row.source}</Badge> : null}
      </div>
      {row ? (
        <div className="rx-grid-wrap">
          <table className="rx-grid">
            <thead>
              <tr><th />{COLS.map(([f, label]) => <th key={f}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {[['r', 'OD / ขวา'], ['l', 'OS / ซ้าย']].map(([k, label]) => (
                <tr key={k}>
                  <th scope="row">{label}</th>
                  {COLS.map(([f]) => <td key={f}><span>{cell(row, k, f)}</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">— ไม่มีข้อมูล</p>}
      {row?.adjust_reason ? <p className="hint">{`เหตุผลที่ปรับ: ${row.adjust_reason}`}</p> : null}
      {row?.external_place ? <p className="hint">{`จาก ${row.external_place}${row.external_date ? ` · ${fmtDate(row.external_date)}` : ''}`}</p> : null}
    </div>
  );
}

export function ExamHistory({ sessions }) {
  const [open, setOpen] = useState(null);
  const rounds = sessions || [];

  if (!rounds.length) return <Empty>ยังไม่มีประวัติการวัดสายตา</Empty>;

  return (
    <div className="exam-rounds">
      {rounds.map((s, i) => {
        const summary = s.final || s.measured;
        const isOpen = open === s.key;
        return (
          <div className={`exam-round ${isOpen ? 'open' : ''}`} key={s.key}>
            <div className="exam-round-head">
              <div>
                <b>{fmtDate(s.exam_date)}</b>
                {i === 0 ? <Badge kind="ok">ล่าสุด</Badge> : null}
                {s.case_code
                  ? <Link href={'/cases/detail?id=' + s.case_id + '&step=exam'}>{s.case_code}</Link>
                  : <span className="muted">ไม่ผูกเคส</span>}
                {s.examiner ? <span className="muted">{`ตรวจโดย ${s.examiner}`}</span> : null}
              </div>
              <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(isOpen ? null : s.key)}>
                {isOpen ? 'ปิด' : 'ดูรายละเอียด ›'}
              </button>
            </div>

            <Row className="exam-round-summary">
              <Badge kind={s.final ? 'ok' : 'gray'}>{s.final ? 'ค่าที่ใช้จริง' : 'ค่าที่วัดได้'}</Badge>
              <span>{`OD ${power(summary?.r_sphere)} / ${power(summary?.r_cylinder)} × ${summary?.r_axis || '—'}`}</span>
              <span>{`OS ${power(summary?.l_sphere)} / ${power(summary?.l_cylinder)} × ${summary?.l_axis || '—'}`}</span>
            </Row>

            {isOpen && (
              <div className="exam-round-detail">
                {SET_META.map(([k, title, sub]) => (
                  <SetBlock key={k} row={s[k]} title={title} sub={sub} />
                ))}
                {s.measured?.exam_note || s.measured?.notes ? (
                  <p className="muted">{s.measured.exam_note || s.measured.notes}</p>
                ) : null}
                {s.case_id ? (
                  <Row>
                    <Link className="btn btn-sm btn-light" href={'/cases/detail?id=' + s.case_id + '&step=exam'}>
                      <Icon name="pencil" /> แก้ไขที่ขั้นวัดสายตาของเคส
                    </Link>
                  </Row>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
