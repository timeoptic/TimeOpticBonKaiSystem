'use client';
/**
 * ประวัติการขาย POS
 *
 * ตอบคำถามหน้าร้านสองข้อเป็นหลัก: "ใครยังค้างเงินอยู่บ้าง" กับ "ของใครยังไม่มารับ"
 * ตัวกรองจึงตั้งอยู่บนสองสถานะนั้น ไม่ใช่บนวันที่อย่างเดียว
 *
 * ค้นหาครอบทั้งเลขที่ใบ ชื่อลูกค้า เบอร์โทร และชื่อสินค้า — พนักงานจำได้อย่างเดียว
 * ว่า "คนที่ซื้อน้ำยาไปเมื่อวาน" ก็ต้องหาเจอ
 */
import { useState } from 'react';
import Link from 'next/link';

import { useAsync, useDebounced } from '../../../../lib/hooks.js';
import { fmtDateTime, money, todayISO } from '../../../../lib/format.js';
import { Card, Field, Loading, Toolbar } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { posApi, PAY_METHODS } from '../../../../lib/pos/posApi.js';
import { PaymentBadge, FulfillmentBadge } from '../../../../components/pos/PosStatusBadge.jsx';
import { DateField } from '../../../../components/DateField.jsx';

const COLS = [
  { label: 'เลขที่', render: (r) => <Link href={`/pos/detail/?id=${r.id}`}><b>{r.pos_no}</b></Link> },
  { label: 'วันที่', render: (r) => fmtDateTime(r.sale_date) },
  {
    label: 'ลูกค้า',
    render: (r) => [r.customer_name_snapshot, r.customer_phone_snapshot]
      .filter(Boolean).join(' · ') || 'ลูกค้าทั่วไป',
  },
  { label: 'สินค้า', render: (r) => `${r.item_count} รายการ / ${r.unit_count} ชิ้น` },
  { label: 'ยอดรวม', cls: 'num', render: (r) => money(r.total_amount) },
  { label: 'ชำระแล้ว', cls: 'num', render: (r) => money(r.paid_amount) },
  {
    label: 'คงเหลือ',
    cls: 'num',
    render: (r) => (
      <b style={{ color: Number(r.balance_amount) > 0 ? '#c0392b' : 'inherit' }}>
        {money(r.balance_amount)}
      </b>
    ),
  },
  { label: 'การชำระ', render: (r) => <PaymentBadge sale={r} /> },
  { label: 'การรับสินค้า', render: (r) => <FulfillmentBadge sale={r} /> },
  { label: 'ผู้ขาย', key: 'created_by_name' },
];

export default function PosHistoryPage() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const [pay, setPay] = useState('');
  const [ful, setFul] = useState('');
  const [method, setMethod] = useState('');
  const term = useDebounced(q);

  const { data, loading, error } = useAsync(
    () => posApi.sales({
      q: term, from, to, payment_status: pay, fulfillment_status: ful, method, limit: 300,
    }),
    [term, from, to, pay, ful, method],
  );

  const rows = data || [];

  return (
    <div className="pos">
      <div className="pos-bar">
        <div className="pos-bar-in">
          <span className="pos-bar-mark">🧾</span>
          <div>
            <h1>ประวัติการขาย POS</h1>
            <p>ขายสินค้า / บริการทั่วไป</p>
          </div>
          <span className="pos-bar-act">
            <Link className="pos-btn primary" href="/pos/">+ ขายรายการใหม่</Link>
          </span>
        </div>
      </div>

      <Card>
        <Toolbar>
          <Field label="ค้นหา">
            <input
              value={q}
              placeholder="เลขที่ / ชื่อลูกค้า / เบอร์โทร / ชื่อสินค้า"
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
          <Field label="ตั้งแต่">
            <DateField value={from} onChange={setFrom} />
          </Field>
          <Field label="ถึง">
            <DateField value={to} onChange={setTo} />
          </Field>
          <Field label="การชำระ">
            <select value={pay} onChange={(e) => setPay(e.target.value)}>
              <option value="">ทั้งหมด</option>
              <option value="unpaid">ยังไม่ชำระ</option>
              <option value="partial">ชำระบางส่วน</option>
              <option value="paid">ชำระครบแล้ว</option>
            </select>
          </Field>
          <Field label="การรับสินค้า">
            <select value={ful} onChange={(e) => setFul(e.target.value)}>
              <option value="">ทั้งหมด</option>
              <option value="waiting">ยังไม่ส่งมอบ</option>
              <option value="delivered">ส่งมอบแล้ว</option>
            </select>
          </Field>
          <Field label="ช่องทางชำระ">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">ทั้งหมด</option>
              {PAY_METHODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </Field>
        </Toolbar>
      </Card>

      <Card tight>
        {loading && <Loading />}
        {error && <p className="muted">{error.message}</p>}
        {!loading && !error && (
          <DataTable columns={COLS} rows={rows} empty="ยังไม่มีรายการขายในช่วงที่เลือก" />
        )}
      </Card>
    </div>
  );
}
