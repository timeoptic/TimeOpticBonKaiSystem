'use client';
/**
 * รายละเอียดใบขาย POS + เก็บยอดค้าง
 *
 * ประวัติการรับเงินเป็นรายการที่งอกเพิ่มอย่างเดียว — รับเพิ่มทีหลังสร้างแถวใหม่เสมอ
 * ไม่มีปุ่มไหนในหน้านี้แก้งวดที่รับไปแล้ว เพราะการเขียนทับทำให้ตอบไม่ได้ว่าเงิน
 * ก้อนไหนรับวันไหนโดยใคร ซึ่งเป็นคำถามแรกเวลายอดไม่ตรง
 *
 * ปุ่มส่งมอบไม่สนใจว่าจ่ายครบหรือยัง — ร้านนี้ปล่อยของทั้งที่ค้างเงินได้
 */
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useAsync } from '../../../../lib/hooks.js';
import { fmtDateTime, money } from '../../../../lib/format.js';
import { useAuth } from '../../../../contexts/AuthContext.jsx';
import { isAdminUp } from '../../../../lib/roles.js';
import {
  Card, Field, Kv, Loading,
} from '../../../../components/ui.jsx';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { useToast } from '../../../../components/Toast.jsx';
import { posApi, PAY_METHODS, payMethodLabel } from '../../../../lib/pos/posApi.js';
import { PaymentBadge, FulfillmentBadge } from '../../../../components/pos/PosStatusBadge.jsx';

const ITEM_COLS = [
  { label: 'สินค้า', render: (r) => (
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
  { label: 'จำนวน', cls: 'num', key: 'quantity' },
  { label: 'ราคา/ชิ้น', cls: 'num', render: (r) => money(r.unit_price) },
  { label: 'รวม', cls: 'num', render: (r) => <b>{money(r.line_total)}</b> },
];

const PAY_COLS = [
  { label: 'วันที่', render: (r) => fmtDateTime(r.paid_at) },
  { label: 'ช่องทาง', render: (r) => payMethodLabel(r.payment_method) },
  { label: 'จำนวนเงิน', cls: 'num', render: (r) => <b>{money(r.amount)}</b> },
  { label: 'รับมา', cls: 'num', render: (r) => (r.amount_received ? money(r.amount_received) : '—') },
  { label: 'ทอน', cls: 'num', render: (r) => (r.change_amount ? money(r.change_amount) : '—') },
  { label: 'ผู้รับเงิน', key: 'created_by_name' },
];

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

  if (loading) return <Loading />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;
  if (!sale) return <Card><p className="muted">ไม่พบใบขายนี้</p></Card>;

  const balance = Number(sale.balance_amount);

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
            <Link className="pos-btn back" href="/pos/history/">← ประวัติ POS</Link>
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

      <Card title="รายการสินค้า" tight>
        <DataTable columns={ITEM_COLS} rows={sale.items} />
      </Card>

      <Card title="ประวัติการรับเงิน" tight>
        <DataTable columns={PAY_COLS} rows={sale.payments} empty="ยังไม่มีการรับเงิน" />
      </Card>

      {sale.status !== 'void' && balance > 0 && (
        <Card title={`+ รับชำระเพิ่ม (ค้างอยู่ ${money(balance)})`}>
          <Field label="ช่องทางชำระเงิน">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAY_METHODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
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
            <button type="button" className="pos-btn primary" style={{ width: 'auto', margin: 0, padding: '12px 20px', fontSize: 15 }} disabled={busy} onClick={toggleDeliver}>
              {sale.fulfillment_status === 'delivered'
                ? 'ยกเลิกการส่งมอบ'
                : 'ทำเครื่องหมายว่าลูกค้ารับสินค้าแล้ว'}
            </button>
            {/* ยกเลิกใบขายคือการลบเงินออกจากยอดของวัน — แอดมินขึ้นไปเท่านั้น
                และ API ตรวจซ้ำอีกชั้น การซ่อนปุ่มเป็นแค่มารยาท */}
            {isAdminUp(actor) && (
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
