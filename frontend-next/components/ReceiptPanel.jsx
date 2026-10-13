'use client';

/**
 * ส่วน "ใบเสร็จรับเงิน" ของหน้าเคสและหน้าใบขาย POS (ร้านขอ 13 ต.ค. 2026)
 *
 * แสดงทุกบิลที่ออกใบได้ (ทุกออเดอร์ของเคส / ใบขายใบนี้) พร้อมใบที่ออกไว้แล้ว:
 *   ยังไม่ออก   → [ออกใบเสร็จ]  ทางเดียวที่ทำให้เกิดเลข (ถามยืนยันก่อน)
 *   ออกแล้ว     → [ดูใบเสร็จ] [พิมพ์ซ้ำ] [ประวัติการพิมพ์]
 * พิมพ์ซ้ำไม่เรียกการออกเลข — ไปหน้าใบเสร็จเดิมแล้วสั่งพิมพ์ (ลงประวัติหนึ่งแถว)
 *
 * ใบที่ยกเลิกไปแล้วของบิลเดียวกัน (ลบออเดอร์ / รีเซ็ตเลข ต.ค.) ขึ้นเป็นบรรทัดประวัติเงียบ ๆ
 * ไม่ให้เลขเดิมหายไปจากสายตา แต่ไม่มีปุ่มให้กด
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../lib/apiClient.js';
import { useAsync } from '../lib/hooks.js';
import { fmtDateTime, money } from '../lib/format.js';
import { Badge, Card, Loading } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { useConfirm } from './Confirm.jsx';
import { useToast } from './Toast.jsx';

export const PRINT_STATUS = {
  NOT_REQUESTED: ['gray', 'ยังไม่เคยสั่งพิมพ์'],
  REQUESTED: ['blue', 'ส่งคำสั่งพิมพ์แล้ว'],
  UNKNOWN: ['warn', 'ไม่ทราบผลการพิมพ์'],
  CONFIRMED: ['ok', 'ยืนยันว่าพิมพ์ออกแล้ว'],
  FAILED: ['danger', 'พิมพ์ไม่สำเร็จ'],
};

export function PrintStatusBadge({ status }) {
  const [kind, label] = PRINT_STATUS[status] || PRINT_STATUS.NOT_REQUESTED;
  return <Badge kind={kind}>{label}</Badge>;
}

/** ลิงก์หน้าใบเสร็จของบิลนี้ — `print` = เปิดแล้วสั่งพิมพ์ทันที (ปุ่มพิมพ์ซ้ำ) */
export function receiptHref(sourceType, sourceId, print = false) {
  const q = sourceType === 'POS' ? `sale=${sourceId}` : `order=${sourceId}`;
  return `/print/receipt?${q}${print ? '&print=1' : ''}`;
}

/** key กันกดซ้ำ — ปุ่มเดียวกดสองทีได้ key เดียวกัน, กดใหม่หลังทำเสร็จได้ key ใหม่ */
export function newKey() {
  return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).slice(0, 64);
}

/** กด "ออกใบเสร็จ" — ถามก่อน เพราะเลขที่ออกแล้วเรียกคืนไม่ได้ */
export function useIssueReceipt() {
  const confirm = useConfirm();
  const { err } = useToast();
  const [busy, setBusy] = useState(false);
  const issue = async (sourceType, sourceId, label) => {
    if (busy) return null;
    const yes = await confirm(
      'ออกใบเสร็จ',
      `ออกเลขใบเสร็จให้ ${label || 'บิลนี้'}? เลขที่ออกแล้วจะผูกกับบิลนี้ถาวร เรียกคืนหรือนำกลับมาใช้ไม่ได้`,
      { confirmText: 'ออกใบเสร็จ' }
    );
    if (!yes) return null;
    setBusy(true);
    try {
      return await api.post('/api/receipts/issue', {
        [sourceType === 'POS' ? 'sale_id' : 'order_id']: sourceId,
        idem_key: newKey(),
      });
    } catch (e) {
      err(e);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { issue, busy };
}

function PrintHistory({ receipt, onClose }) {
  const { data, loading, error } = useAsync(() => api.get(`/api/receipts/${receipt.id}/prints`), [receipt.id]);
  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>ประวัติการพิมพ์ {receipt.receipt_no}</h3>
        <div className="m-body">
          {loading ? <Loading /> : null}
          {error ? <p className="muted">{error.message}</p> : null}
          {data && data.length === 0 ? <p className="muted" style={{ margin: 0 }}>ยังไม่เคยสั่งพิมพ์ผ่านระบบ</p> : null}
          {data && data.length > 0 ? (
            <table className="grid">
              <thead>
                <tr><th>ครั้งที่</th><th>สั่งพิมพ์เมื่อ</th><th>โดย</th><th>ผล</th></tr>
              </thead>
              <tbody>
                {data.map((l) => (
                  <tr key={l.id}>
                    <td>{l.attempt_no}</td>
                    <td>{fmtDateTime(l.requested_at)}</td>
                    <td>{l.requested_by_name || '—'}</td>
                    <td>
                      <PrintStatusBadge status={l.status} />
                      {l.failure_reason ? <div className="muted">{l.failure_reason}</div> : null}
                      {l.resolved_by_name ? <div className="muted">ยืนยันโดย {l.resolved_by_name}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            ระบบรู้แค่ว่ามีการกดสั่งพิมพ์ — เครื่องพิมพ์ไม่ส่งผลกลับมา "พิมพ์ออกแล้ว" มาจากพนักงานกดยืนยันเท่านั้น
          </p>
        </div>
        <div className="m-foot">
          <button type="button" className="btn btn-light" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

const PANEL_CSS = `
.rcp-list{display:flex;flex-direction:column;gap:10px}
.rcp-item{border:1px solid var(--line-soft);border-radius:12px;padding:12px 14px}
.rcp-head{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}
.rcp-no{font-size:15px;white-space:nowrap;margin-right:4px}
.rcp-meta{margin-top:4px;font-size:13px;line-height:1.5}
.rcp-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.rcp-acts:empty{display:none}
.rcp-old{margin-top:6px;font-size:12px}
`;

/** `query` = { case_id } หรือ { sale_id } */
export function ReceiptPanel({ query, title = 'ใบเสร็จรับเงิน', disabled = false }) {
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const [history, setHistory] = useState(null);
  const { issue, busy } = useIssueReceipt();
  const key = JSON.stringify(query);
  const { data, loading, error } = useAsync(() => api.get('/api/receipts/for', query), [key, tick]);

  const onIssue = async (row) => {
    const rc = await issue(row.source_type, row.source_id, row.source_no);
    if (rc) router.push(receiptHref(row.source_type, row.source_id));
    else setTick((t) => t + 1);
  };

  return (
    <Card title={title}>
      {loading && !data ? <Loading /> : null}
      {error ? <p className="muted">{error.message}</p> : null}
      {data && data.length === 0 ? <p className="muted" style={{ margin: 0 }}>ยังไม่มีบิลที่ออกใบเสร็จได้</p> : null}
      {/* รายการแบบการ์ด ไม่ใช่ตาราง 7 คอลัมน์ — ส่วนนี้อยู่ในคอลัมน์แคบของหน้าเคส
          ตารางกว้างทำให้เลขใบเสร็จหักเป็นสี่บรรทัด อ่านไม่ออกว่าเป็นเลขเดียวกัน */}
      {data && data.length > 0 ? (
        <div className="rcp-list">
          {data.map((row) => {
            const rc = row.receipt;
            return (
              <div key={`${row.source_type}${row.source_id}`} className="rcp-item">
                <div className="rcp-head">
                  <b className="rcp-no">{rc ? (rc.receipt_no || 'ใบเสร็จ (เลขบิลเดิม)') : 'ยังไม่ออกใบเสร็จ'}</b>
                  {!rc ? <Badge kind="gray">ยังไม่ออก</Badge> : null}
                  {rc?.status === 'ISSUED' ? <Badge kind="ok">ออกแล้ว</Badge> : null}
                  {rc?.status === 'VOIDED' ? <Badge kind="danger">ยกเลิก</Badge> : null}
                  {rc ? <PrintStatusBadge status={rc.print_status} /> : null}
                </div>
                <div className="rcp-meta muted">
                  {row.source_type === 'POS' ? 'ใบขาย' : 'บิล'} {row.source_no || `#${row.source_id}`}
                  {' · '}{money(rc ? rc.total_amount : row.bill_total)}
                  {rc ? ` · ออก ${fmtDateTime(rc.issued_at)}` : ''}
                  {rc?.issued_by_name ? ` โดย ${rc.issued_by_name}` : ''}
                  {rc && rc.payments?.length > 1 ? ` · รับเงิน ${rc.payments.length} ครั้ง` : ''}
                  {rc?.print_count
                    ? ` · สั่งพิมพ์ ${rc.print_count} ครั้ง ล่าสุด ${fmtDateTime(rc.last_printed_at)}${rc.last_printed_by ? ` (${rc.last_printed_by})` : ''}`
                    : ''}
                </div>
                <div className="rcp-acts">
                  {!rc && !disabled ? (
                    <button type="button" className="btn btn-sm btn-accent" disabled={busy} onClick={() => onIssue(row)}>
                      <Icon name="receipt" /> ออกใบเสร็จ
                    </button>
                  ) : null}
                  {rc ? (
                    <>
                      <Link className="btn btn-sm btn-light" href={receiptHref(row.source_type, row.source_id)}>ดูใบเสร็จ</Link>
                      {rc.status === 'ISSUED' ? (
                        <Link className="btn btn-sm btn-light" href={receiptHref(row.source_type, row.source_id, true)}>
                          <Icon name="printer" /> พิมพ์ซ้ำ
                        </Link>
                      ) : null}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHistory(rc)}>ประวัติการพิมพ์</button>
                    </>
                  ) : null}
                </div>
                {(row.history || []).map((h) => (
                  <div key={`h${h.id}`} className="rcp-old muted">
                    ใบเดิม {h.receipt_no || h.legacy_no || `#${h.id}`} · ยกเลิก {fmtDateTime(h.voided_at)}
                    {h.void_reason ? ` — ${h.void_reason}` : ''}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
      <style>{PANEL_CSS}</style>
      {history ? <PrintHistory receipt={history} onClose={() => setHistory(null)} /> : null}
    </Card>
  );
}
