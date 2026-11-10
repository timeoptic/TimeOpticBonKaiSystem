'use client';
/**
 * ใบเบิกเลนส์หนึ่งใบ — ใช้ทั้งในแท็บ "ใบเบิกเลนส์" ของเคส
 *
 * ค่าสายตาที่แสดงคือ rx_snapshot (สำเนา ณ ตอนออกใบ/ตอนเบิก) ไม่ใช่ใบค่าสายตาปัจจุบัน
 * เพราะนี่คือสิ่งที่ส่งให้ร้านเลนส์จริง · ปุ่มสถานะมาจาก nextActions ซึ่งตรงกับกติกาฝั่ง API
 */
import { useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/apiClient.js';
import { Badge, Card } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { useToast } from './Toast.jsx';
import { addPower, cylPower, fmtDateTime, money, rxNum, sphPower } from '../lib/format.js';
import { EYE_LABEL, STATUS_TONE, TIMEOPTIC_TONE, lensSpecText, nextActions } from '../lib/lens/requisition.js';

const RX_COLS = [
  ['SPH', (rx, k) => sphPower(rx?.[`${k}_sphere`])],
  ['CYL', (rx, k) => cylPower(rx?.[`${k}_cylinder`])],
  ['AXIS', (rx, k) => rxNum(rx?.[`${k}_axis`])],
  ['ADD', (rx, k) => addPower(rx?.[`${k}_add`])],
  ['PD', (rx, k) => rxNum(rx?.[`${k}_pd`])],
];

export function RxSnapshotTable({ rx }) {
  if (!rx) {
    return (
      <p className="badge warn" style={{ display: 'inline-block' }}>
        ยังไม่มีค่าสายตาสุดท้าย — ยืนยันค่าสายตาในขั้นวัดสายตาก่อน แล้วจึงเบิกได้
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th>ค่าสายตา</th>
            {RX_COLS.map(([h]) => <th key={h} className="num">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {[['r', 'ขวา (R)'], ['l', 'ซ้าย (L)']].map(([k, label]) => (
            <tr key={k}>
              <td>{label}</td>
              {RX_COLS.map(([h, fn]) => <td key={h} className="num">{fn(rx, k)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LensItemsTable({ items }) {
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th>ข้าง</th>
            <th>เลนส์</th>
            <th className="num">จำนวน</th>
            <th className="num">ราคา</th>
            <th className="num">รวม</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>{EYE_LABEL[it.eye] || it.eye}</td>
              <td>
                {it.lens_name ? <b>{it.lens_name} </b> : null}
                {it.lens_name ? [it.lens_index, it.coating].filter(Boolean).join(' · ') : lensSpecText(it)}
                {it.lens_code ? <span className="muted"> · {it.lens_code}</span> : null}
                {it.source === 'MOCK' ? <span className="badge gray" style={{ marginLeft: 6 }}>จำลอง</span> : null}
              </td>
              <td className="num">{it.quantity}</td>
              <td className="num">{money(it.unit_price)}</td>
              <td className="num">{money(it.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LensRequisitionCard({ r, onChanged }) {
  const { ok, err } = useToast();
  const [busy, setBusy] = useState(null);

  const move = async (to) => {
    let reason = '';
    if (to === 'cancelled') {
      reason = window.prompt(`เหตุผลที่ยกเลิกใบเบิก ${r.req_no}`) || '';
      if (!reason.trim()) return;
    }
    setBusy(to);
    try {
      const next = await api.post(`/api/lens-requisitions/${r.id}/status`, { status: to, reason });
      ok(`${r.req_no}: ${next.status_label}${next.timeoptic_req_code && !r.timeoptic_req_code ? ` · ส่งคำขอ ${next.timeoptic_req_code} เข้าคลัง TimeOptic แล้ว` : ''}`);
      onChanged?.();
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(null);
    }
  };

  const actions = nextActions(r.status, Boolean(r.rx_snapshot));

  return (
    <Card
      title={`ใบเบิกเลนส์ ${r.req_no}`}
      badge={<Badge kind={STATUS_TONE[r.status]}>{r.status_label}</Badge>}
      right={(
        <Link className="btn btn-sm btn-light" href={`/print/lens-requisition?id=${r.id}`}>
          <Icon name="printer" /> พิมพ์
        </Link>
      )}
    >
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          ออกใบ {fmtDateTime(r.created_at)}
          {r.created_by_name ? ` · โดย ${r.created_by_name}` : ''}
          {r.invoice_code ? ` · ออเดอร์ ${r.invoice_code}` : ''}
        </p>
        {/* ใช้เลนส์จริง = ยืนยันขั้นขายแล้ว · ยังไม่ยืนยัน = ร่าง ยังไม่ขึ้นในรายการใช้เลนส์ */}
        <p className="muted" style={{ margin: 0 }}>
          {r.used_at
            ? `ใช้เลนส์ (ยืนยันขั้นขาย) ${fmtDateTime(r.used_at)}${r.used_by_name ? ` · โดย ${r.used_by_name}` : ''}`
            : 'ร่าง — นับเป็น "ใช้เลนส์" เมื่อยืนยันขั้นขาย'}
        </p>
        {r.status === 'cancelled' ? (
          <p className="note danger" style={{ margin: 0 }}>
            ยกเลิก {fmtDateTime(r.cancelled_at)}
            {r.cancelled_by_name ? ` · โดย ${r.cancelled_by_name}` : ''}
            {r.cancel_source_label ? ` · ${r.cancel_source_label}` : ''}
            {r.cancel_reason ? ` · ${r.cancel_reason}` : ''}
          </p>
        ) : null}
        {/* คำขอใน "คำขอจากสาขา" ของคลัง TimeOptic — ส่งเองตอนกดออกจาก "รอเบิก" ครั้งแรก */}
        {r.timeoptic_req_code ? (
          <p style={{ margin: 0 }}>
            คลัง TimeOptic: <b>{r.timeoptic_req_code}</b>{' '}
            <Badge kind={TIMEOPTIC_TONE[r.timeoptic_status] || 'gray'}>{r.timeoptic_status_label || r.timeoptic_status}</Badge>
            {r.timeoptic_note ? <span className="muted"> · {r.timeoptic_note}</span> : null}
          </p>
        ) : r.timeoptic_enabled && r.status === 'pending' ? (
          <p className="muted" style={{ margin: 0 }}>
            กดเลื่อนสถานะจาก "รอเบิก" แล้ว ระบบจะส่งคำขอเบิกเลนส์เข้าคลัง TimeOptic ให้เอง
          </p>
        ) : null}
        <RxSnapshotTable rx={r.rx_snapshot} />
        <LensItemsTable items={r.items || []} />
        <p style={{ margin: 0, textAlign: 'right' }}>
          <b>รวม {money(r.total)}</b>
        </p>
        {actions.length ? (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {actions.map((a) => (
              <button
                key={a.to}
                type="button"
                className={`btn btn-sm ${a.to === 'cancelled' ? 'btn-danger' : ''}`}
                disabled={busy !== null}
                onClick={() => move(a.to)}
              >
                {busy === a.to ? 'กำลังบันทึก…' : a.to === 'cancelled' ? 'ยกเลิกใบเบิก' : `→ ${a.label}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
