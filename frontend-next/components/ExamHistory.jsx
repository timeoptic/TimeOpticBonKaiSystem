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
import { GlassesUseTag, RxSetBlock } from './RxSets.jsx';
import { cylPower, fmtDate, roundGlassesUse, sphPower } from '../lib/format.js';
import { Icon } from './Icon.jsx';

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
              <GlassesUseTag value={roundGlassesUse(s)} />
              <span>{`R ${sphPower(summary?.r_sphere)} / ${cylPower(summary?.r_cylinder)} × ${summary?.r_axis || '—'}`}</span>
              <span>{`L ${sphPower(summary?.l_sphere)} / ${cylPower(summary?.l_cylinder)} × ${summary?.l_axis || '—'}`}</span>
            </Row>

            {isOpen && (
              <div className="exam-round-detail">
                <RxSetBlock row={s.old} title="ค่าสายตาเดิม" sub="Old Glasses" />
                <RxSetBlock row={s.measured} title="ค่าสายตาที่วัดครั้งนี้" sub="Measured Prescription" />
                <RxSetBlock row={s.final} title="ค่าสายตาที่ใช้ใน Case" sub="Final Prescription" star />
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
