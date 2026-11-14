'use client';
/**
 * รายละเอียดใบขาย POS + เก็บยอดค้าง
 *
 * ประวัติการรับเงินเป็นรายการที่งอกเพิ่มอย่างเดียว — รับเพิ่มทีหลังสร้างแถวใหม่เสมอ ·
 * ข้อยกเว้นเดียวคือปุ่ม "แก้ไข" ของแอดมิน สำหรับงวดที่บันทึกผิด (ร้านขอ 29 ก.ย. 2026)
 * บังคับเหตุผล และค่าก่อน → หลังลงบันทึกการใช้งาน จึงยังตอบได้ว่าเดิมเป็นอะไร
 *
 * ปุ่มส่งมอบไม่สนใจว่าจ่ายครบหรือยัง — ร้านนี้ปล่อยของทั้งที่ค้างเงินได้
 */
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Icon } from '../../../../components/Icon.jsx';
import { EditGate } from '../../../../components/EditLock.jsx';

import { useAsync, useNowLocal } from '../../../../lib/hooks.js';
import { fmtDateTime, money, toStamp } from '../../../../lib/format.js';
import { useAuth } from '../../../../contexts/AuthContext.jsx';
import { inSystemZone, isSuperuser } from '../../../../lib/roles.js';
import {
  Card, Field, Kv, Loading,
} from '../../../../components/ui.jsx';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { useToast } from '../../../../components/Toast.jsx';
import { posApi, PAY_METHODS, payMethodLabel } from '../../../../lib/pos/posApi.js';
import { PaymentBadge, FulfillmentBadge } from '../../../../components/pos/PosStatusBadge.jsx';
import { Select } from '../../../../components/Selects.jsx';
import { DateTimeField } from '../../../../components/DateTimeField.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import { ReceiptPanel } from '../../../../components/ReceiptPanel.jsx';
import { PosSaleEditDialog } from '../../../../components/pos/PosSaleEditDialog.jsx';

const ITEM_COLS = [
  { label: 'สินค้า', mobile: 'title', render: (r) => (
    <>
      <b>{r.product_name_snapshot}</b>
      {r.sku_snapshot && <small style={{ display: 'block', color: 'var(--pos-muted)' }}>{r.sku_snapshot}</small>}
      {/* dynamic field ที่ขายไปพร้อมชิ้นนั้น — ค่าสายตา สี รหัสแว่น */}
      {(() => {
        let meta = {};
        try { meta = JSON.parse(r.item_meta || '{}') || {}; } catch { /* เก็บมาเสีย ก็แค่ไม่แสดง */ }
        const pairs = Object.entries(meta).filter(([k, v]) => k !== 'custom_name' && String(v).trim());
        return pairs.length
          ? <small style={{ display: 'block' }}>{pairs.map(([k, v]) => `${k}: ${v}`).join(' · ')}</small>
          : null;
      })()}
    </>
  ) },
  { label: 'จำนวน', cls: 'num', key: 'quantity', mobile: 'body' },
  { label: 'ราคา/ชิ้น', cls: 'num', render: (r) => money(r.unit_price), mobile: 'body' },
  { label: 'รวม', cls: 'num', render: (r) => <b>{money(r.line_total)}</b>, mobile: 'body' },
];

const PAY_COLS = [
  { label: 'วันที่', render: (r) => fmtDateTime(r.paid_at), mobile: 'title' },
  { label: 'ช่องทาง', render: (r) => payMethodLabel(r.payment_method), mobile: 'subtitle' },
  { label: 'จำนวนเงิน', cls: 'num', render: (r) => <b>{money(r.amount)}</b>, mobile: 'body' },
  { label: 'รับมา', cls: 'num', render: (r) => (r.amount_received ? money(r.amount_received) : '—'), mobile: 'meta' },
  { label: 'ทอน', cls: 'num', render: (r) => (r.change_amount ? money(r.change_amount) : '—'), mobile: 'meta' },
  { label: 'ผู้รับเงิน', key: 'created_by_name', mobile: 'meta' },
];

/** เวลาจาก DateTimeField ('YYYY-MM-DDTHH:MM') หรือจาก API ('YYYY-MM-DD HH:MM:SS') ให้เป็นรูปเดียวกัน */
const stampOf = (v) => {
  const s = toStamp(v || '').slice(0, 19);
  return s.length === 16 ? `${s}:00` : s;
};

const CHANGE_TH = { textAlign: 'left', fontWeight: 400, color: 'var(--ink-faint)', padding: '5px 12px 5px 0', whiteSpace: 'nowrap' };

/**
 * แก้งวดเงินที่บันทึกผิด — วันเวลารับ ยอด ช่องทาง (แอดมิน/เจ้าของร้าน · ร้านขอ 29 ก.ย. 2026)
 *
 * แบบเดียวกับ "แก้ไขรายการรับเงิน" ของหน้าเคส · ยอดแก้ได้ไม่เกินยอดใบลบงวดอื่น ·
 * ห้ามวันในอนาคต · สรุปว่าเปลี่ยนอะไรก่อนยืนยัน · ด่านจริงอยู่ที่
 * PUT /api/pos/sales/:id/payments/:pid ที่นี่แค่บอกคนแก้ก่อนกด
 */
function PosPaymentEditDialog({ sale, p, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNowLocal();

  const [amount, setAmount] = useState(String(Number(p.amount)));
  const [method, setMethod] = useState(p.payment_method);
  const [paidAt, setPaidAt] = useState(p.paid_at || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const others = (sale.payments || [])
    .filter((x) => x.id !== p.id && !x.cancelled_at)
    .reduce((s, x) => s + Number(x.amount), 0);
  const max = Math.max(0, Number(sale.total_amount) - others);
  const entered = Number(amount) || 0;

  /* [ป้าย, ค่าเดิม, ค่าใหม่, เปลี่ยนไหม] — ใช้ทั้งตัดสินว่ามีอะไรให้บันทึก และสรุปก่อนยืนยัน */
  const rows = [
    ['รับเมื่อ', fmtDateTime(p.paid_at), fmtDateTime(stampOf(paidAt)), stampOf(p.paid_at) !== stampOf(paidAt)],
    ['จำนวนเงิน', money(p.amount), money(entered), Number(p.amount) !== entered],
    ['ช่องทาง', payMethodLabel(p.payment_method), payMethodLabel(method), p.payment_method !== method],
  ];
  const changes = rows.filter((r) => r[3]);
  const blocked = amount.trim() === '' || !(entered > 0)
    ? 'จำนวนเงินต้องมากกว่า 0'
    : entered > max + 0.001
      ? `แก้เกินยอดของใบไม่ได้ — รายการนี้แก้ได้ไม่เกิน ${money(max)}`
      : !stampOf(paidAt)
        ? 'เลือกวันเวลาที่รับเงิน'
        : stampOf(paidAt) > stampOf(now) ? 'วันเวลาที่รับเงินต้องไม่เป็นเวลาในอนาคต' : null;
  const canSave = !busy && !blocked && changes.length > 0 && reason.trim() !== '';

  const save = async () => {
    if (!canSave) return;
    const sure = await confirm('ยืนยันแก้ไขการรับเงิน', (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {changes.map(([label, from, to]) => (
            <tr key={label}>
              <th style={CHANGE_TH}>{label}</th>
              <td style={{ textAlign: 'right', padding: '5px 0' }}>
                <span className="muted">{from}</span> → <b>{to}</b>
              </td>
            </tr>
          ))}
          <tr>
            <th style={CHANGE_TH}>เหตุผล</th>
            <td style={{ textAlign: 'right', padding: '5px 0' }}>{reason.trim()}</td>
          </tr>
        </tbody>
      </table>
    ), { confirmText: 'ยืนยันแก้ไข' });
    if (!sure) return;

    setBusy(true);
    try {
      await posApi.editPayment(sale.id, p.id, {
        amount: entered,
        method,
        paid_at: stampOf(paidAt),
        reason: reason.trim(),
      });
      toast.ok('แก้ไขการรับเงินแล้ว');
      onSaved();
    } catch (e) {
      toast.err(e);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="แก้ไขการรับเงิน">
        <h3>แก้ไขการรับเงิน</h3>
        <div className="m-body">
          <Field label="รับเมื่อ">
            <div style={{ maxWidth: 380 }}>
              <DateTimeField value={paidAt} onChange={setPaidAt} max={now} />
            </div>
          </Field>
          <Field label={`จำนวนเงิน (บาท) — แก้ได้ไม่เกิน ${money(max)}`}>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="ช่องทางชำระเงิน">
            <Select value={method} onChange={(e) => setMethod(e.target.value)} options={PAY_METHODS} />
          </Field>
          <Field label="เหตุผลที่แก้ไข *">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น ลูกค้าจ่ายวันที่ 25 แต่มากดรับเงินวันที่ 26"
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="m-foot">
          {blocked ? <span className="process-blockers" style={{ marginRight: 'auto' }}>{blocked}</span> : null}
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="button" className="btn" onClick={save} disabled={!canSave}>
            <Icon name="check" />
            {busy ? ' กำลังบันทึก…' : ' บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PosDetail() {
  const id = useSearchParams().get('id');
  const { actor } = useAuth();
  const toast = useToast();

  const { data: sale, loading, error, reload } = useAsync(
    () => (id ? posApi.sale(id) : Promise.resolve(null)),
    [id],
  );

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingItems, setEditingItems] = useState(false);

  if (loading) return <Loading />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;
  if (!sale) return <Card><p className="muted">ไม่พบใบขายนี้</p></Card>;

  const balance = Number(sale.balance_amount);
  /* แก้งวดได้เฉพาะแอดมินขึ้นไป บนใบที่ยังไม่ยกเลิก — API ตรวจซ้ำอีกชั้น */
  const payCols = inSystemZone(actor) && sale.status !== 'void'
    ? [...PAY_COLS, {
      label: '',
      mobile: 'meta',
      render: (r) => (r.cancelled_at ? null : (
        <button type="button" className="btn btn-sm btn-light" onClick={() => setEditing(r)}>
          <Icon name="pencil" /> เปิดการแก้ไข
        </button>
      )),
    }]
    : PAY_COLS;

  async function collect() {
    setBusy(true);
    try {
      await posApi.addPayment(sale.id, {
        method,
        amount: Number(amount),
        amount_received: method === 'cash' && received !== '' ? Number(received) : null,
      });
      setAmount('');
      setReceived('');
      toast.ok('บันทึกการรับเงินแล้ว');
      reload();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeliver() {
    setBusy(true);
    try {
      await posApi.deliver(sale.id, sale.fulfillment_status !== 'delivered');
      toast.ok('อัปเดตสถานะการรับสินค้าแล้ว');
      reload();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  }

  async function voidSale() {
    const reason = window.prompt('เหตุผลที่ยกเลิกใบขายนี้');
    if (!reason) return;
    setBusy(true);
    try {
      await posApi.void(sale.id, reason);
      toast.ok('ยกเลิกใบขายแล้ว');
      reload();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos">
      <div className="pos-bar">
        <div className="pos-bar-in">
          <span className="pos-bar-mark">🧾</span>
          <div>
            <h1>{sale.pos_no}</h1>
            <p>{fmtDateTime(sale.sale_date)}</p>
          </div>
          <span className="pos-bar-act">
            {/* ใบขายที่ถูกยกเลิกไปแล้วต้องออกใบเสร็จไม่ได้ — ใบที่พิมพ์ออกไปคือหลักฐานว่ารับเงินจริง */}
            {sale.status !== 'void' && (
              <Link className="pos-btn" href={`/print/receipt?sale=${sale.id}`}>🧾 ใบเสร็จ</Link>
            )}
            <Link className="pos-btn back" href="/pos/history/"><Icon name="arrowLeft" /> ประวัติ POS</Link>
          </span>
        </div>
      </div>

      <Card title="ข้อมูลใบขาย">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <PaymentBadge sale={sale} />
          <FulfillmentBadge sale={sale} />
        </div>
        <Kv rows={[
          ['ลูกค้า', [sale.customer_name_snapshot, sale.customer_phone_snapshot]
            .filter(Boolean).join(' · ') || 'ลูกค้าทั่วไป'],
          ['ยอดสินค้า', money(sale.subtotal)],
          ['ส่วนลด', money(sale.discount_amount)],
          ['ยอดสุทธิ', money(sale.total_amount)],
          ['ชำระแล้ว', money(sale.paid_amount)],
          ['คงเหลือ', money(sale.balance_amount)],
          ['ผู้สร้างรายการ', sale.created_by_name || '—'],
          ['สร้างเมื่อ', fmtDateTime(sale.created_at)],
          ...(sale.note ? [['หมายเหตุ', sale.note]] : []),
          ...(sale.status === 'void'
            ? [['ยกเลิกโดย', `${sale.void_by_name || '—'} · ${fmtDateTime(sale.void_at)}`],
              ['เหตุผล', sale.void_reason || '—']]
            : []),
        ]}
        />
      </Card>

      <Card
        title="รายการสินค้า"
        tight
        right={isSuperuser(actor) && sale.status !== 'void' ? (
          /* แก้ใบที่บันทึกแล้ว — ผู้ดูแลระบบเท่านั้น API ตรวจซ้ำ (PUT /api/pos/sales/:id/items) */
          <button type="button" className="btn btn-sm btn-light" onClick={() => setEditingItems(true)}>
            <Icon name="pencil" /> แก้ไขรายการ
          </button>
        ) : null}
      >
        <DataTable columns={ITEM_COLS} rows={sale.items} />
      </Card>

      <Card title="ประวัติการรับเงิน" tight>
        <DataTable columns={payCols} rows={sale.payments} empty="ยังไม่มีการรับเงิน" />
      </Card>

      {/* ใบขายที่ยกเลิกแล้วยังเห็นใบเสร็จเดิมได้ แต่ออกใบใหม่ไม่ได้ */}
      <ReceiptPanel query={{ sale_id: sale.id }} disabled={sale.status === 'void'} />

      {editing && (
        <PosPaymentEditDialog
          sale={sale}
          p={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}

      {editingItems && (
        <PosSaleEditDialog
          sale={sale}
          onClose={() => setEditingItems(false)}
          onSaved={() => { setEditingItems(false); reload(); }}
        />
      )}

      {sale.status !== 'void' && balance > 0 && (
        <Card title={`+ รับชำระเพิ่ม (ค้างอยู่ ${money(balance)})`}>
          <Field label="ช่องทางชำระเงิน">
            <Select value={method} onChange={(e) => setMethod(e.target.value)} options={PAY_METHODS} />
          </Field>
          <Field label="จำนวนเงิน (บาท)">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {method === 'cash' && (
            <Field label="รับเงินมา (บาท)">
              <input inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} />
            </Field>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="pos-btn back" style={{ width: 'auto', margin: 0 }} onClick={() => setAmount(String(balance))}>
              เก็บให้ครบ {money(balance)}
            </button>
            <button
              type="button"
              className="pos-btn primary"
              style={{ width: 'auto', margin: 0, padding: '12px 20px', fontSize: 15 }}
              disabled={busy || !(Number(amount) > 0)}
              onClick={collect}
            >
              บันทึกการรับเงิน
            </button>
          </div>
        </Card>
      )}

      {sale.status !== 'void' && (
        <Card title="การจัดการ">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <EditGate small={false} what="การรับสินค้า">
              {(close) => (
                <button type="button" className="pos-btn primary" style={{ width: 'auto', margin: 0, padding: '12px 20px', fontSize: 15 }} disabled={busy} onClick={() => { close(); toggleDeliver(); }}>
                  {sale.fulfillment_status === 'delivered'
                    ? 'ยกเลิกการส่งมอบ'
                    : 'ทำเครื่องหมายว่าลูกค้ารับสินค้าแล้ว'}
                </button>
              )}
            </EditGate>
            {/* ยกเลิกใบขายคือการลบเงินออกจากยอดของวัน — แอดมินขึ้นไปเท่านั้น
                และ API ตรวจซ้ำอีกชั้น การซ่อนปุ่มเป็นแค่มารยาท */}
            {inSystemZone(actor) && (
              <button type="button" className="pos-btn back" style={{ width: 'auto', margin: 0, color: '#c0392b', borderColor: '#e6b0aa' }} disabled={busy} onClick={voidSale}>
                ยกเลิกใบขาย
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function PosDetailPage() {
  return <QueryParamPage><PosDetail /></QueryParamPage>;
}
