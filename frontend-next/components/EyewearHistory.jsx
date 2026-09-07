'use client';
/**
 * "ครั้งก่อนลูกค้าตัดแว่นอะไรกับเรา" — ค่าสายตาเดิม กรอบเดิม เลนส์เดิม ของคู่ก่อนหน้า
 *
 * ทุกแถวมาจากเคสอื่นเสมอ ไม่ใช่เคสที่กำลังเปิดอยู่ (ฝั่ง API ตัดด้วย exclude_case)
 * ถ้าเอาของที่กำลังเลือกอยู่มาแสดงเป็น "ของเดิม" คนขายจะอ่านว่าลูกค้าเคยใช้รุ่นนี้
 * แล้วแนะนำซ้ำรุ่นเดิมทั้งที่ยังไม่เคยใส่
 *
 * ตั้งต้นโชว์คู่ล่าสุดคู่เดียว ที่เหลือกางออกได้ — หน้าขายต้องเห็น "คู่ก่อนหน้า" ทันที
 * ไม่ใช่ไล่อ่านประวัติทั้งชีวิต
 */
import { useState } from 'react';
import Link from 'next/link';
import { Badge, Card } from './ui.jsx';
import { fmtDate, power } from '../lib/format.js';
import { Icon } from './Icon.jsx';

const RX_COLS = [['sphere', 'SPH'], ['cylinder', 'CYL'], ['axis', 'AXIS'], ['add', 'ADD'], ['va', 'VA']];

const cell = (rx, k, f) => {
  const v = rx?.[`${k}_${f}`];
  if (v === null || v === undefined || v === '') return '—';
  return f === 'sphere' || f === 'cylinder' || f === 'add' ? power(v) : String(v);
};

/** ยี่ห้อ รุ่น สี — เว้นตัวที่ไม่มี ไม่ต้องเว้นวรรคค้างไว้ */
const joinParts = (...parts) => parts.map((x) => (x || '').trim()).filter(Boolean).join(' · ');

function Round({ row, open }) {
  const rx = row.prescription;
  const when = row.order_date || row.opened_at;
  const frame = joinParts(row.frame_brand, row.frame_model, row.frame_color)
    || row.frame_name || null;
  const lens = joinParts(row.lens_brand, row.lens_name) || null;
  const lensSpec = joinParts(row.lens_design || row.lens_type, row.lens_index, row.lens_coating, row.lens_tint);

  return (
    <div className="eh-round">
      <div className="eh-when">
        <b>{fmtDate(when) || '—'}</b>
        {row.case_code
          ? (
            <Link className="eh-case" href={`/cases/detail?id=${row.case_id}&step=sales`}>
              {row.case_code}
            </Link>
          )
          : <span className="muted">{row.invoice_code || `ออเดอร์ #${row.order_id}`}</span>}
        {open ? null : <Badge kind="gray">คู่ล่าสุด</Badge>}
      </div>

      {rx ? (
        <div className="rx-grid-wrap">
          <table className="rx-grid eh-rx">
            <thead>
              <tr><th />{RX_COLS.map(([f, label]) => <th key={f}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {[['r', 'R'], ['l', 'L']].map(([k, label]) => (
                <tr key={k}>
                  <th scope="row">{label}</th>
                  {RX_COLS.map(([f, colLabel]) => <td key={f} data-col={colLabel}><span>{cell(rx, k, f)}</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted eh-none">ไม่มีค่าสายตาผูกกับคู่นี้</p>}

      <dl className="eh-items">
        <dt>Frame</dt>
        <dd>{frame || <span className="muted">—</span>}</dd>
        <dt>Lens</dt>
        <dd>
          {lens || <span className="muted">—</span>}
          {lensSpec ? <small>{lensSpec}</small> : null}
        </dd>
      </dl>
    </div>
  );
}

export function EyewearHistory({ rows, loading }) {
  const [open, setOpen] = useState(false);
  const list = rows || [];

  return (
    <Card
      title="ประวัติแว่นเดิม"
      right={list.length > 1
        ? (
          <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen((v) => !v)}>
            {open ? 'ย่อกลับ' : `ดูประวัติทั้งหมด (${list.length})`}
          </button>
        )
        : null}
    >
      {loading && <p className="muted">กำลังโหลด…</p>}

      {!loading && !list.length && (
        <p className="muted">ยังไม่มีประวัติแว่นเดิม — ลูกค้ายังไม่เคยตัดแว่นกับร้าน</p>
      )}

      {!loading && list.length > 0 && (
        <div className="eh-list">
          {(open ? list : list.slice(0, 1)).map((row) => (
            <Round key={row.order_id} row={row} open={open} />
          ))}
        </div>
      )}
    </Card>
  );
}
