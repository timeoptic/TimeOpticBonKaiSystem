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
import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useAsync, useDebounced } from '../../../../lib/hooks.js';
import { PAGE_SIZES } from '../../../../lib/pager.js';
import { fmtDateTime, money, todayISO } from '../../../../lib/format.js';
import { Card, Field, Loading } from '../../../../components/ui.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { FilterBar } from '../../../../components/FilterBar.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { Pager } from '../../../../components/Pager.jsx';
import { posApi, PAY_METHODS } from '../../../../lib/pos/posApi.js';
import { PaymentBadge, FulfillmentBadge } from '../../../../components/pos/PosStatusBadge.jsx';
import DateRangeField from '@/stockmod/components/DateRangeField';
import { Select } from '../../../../components/Selects.jsx';

/* ช่วงตั้งต้นของหน้านี้: 30 วันล่าสุด · ประกาศไว้ข้างนอกเพื่อให้ปุ่มรีเซ็ตกับ
   ตัวนับ "ตัวกรอง (N)" เทียบกับค่าเดียวกันเสมอ */
const DEFAULT_FROM = todayISO(-30);
const DEFAULT_TO = todayISO();

const COLS = [
  { label: 'เลขที่', mobile: 'title', render: (r) => <Link href={`/pos/detail/?id=${r.id}`}><b>{r.pos_no}</b></Link> },
  { label: 'วันที่', render: (r) => fmtDateTime(r.sale_date), mobile: 'body' },
  {
    label: 'ลูกค้า',
    mobile: 'subtitle',
    render: (r) => [r.customer_name_snapshot, r.customer_phone_snapshot]
      .filter(Boolean).join(' · ') || 'ลูกค้าทั่วไป',
  },
  { label: 'สินค้า', render: (r) => `${r.item_count} รายการ / ${r.unit_count} ชิ้น`, mobile: 'body' },
  { label: 'ยอดรวม', cls: 'num', render: (r) => money(r.total_amount), mobile: 'body' },
  { label: 'ชำระแล้ว', cls: 'num', render: (r) => money(r.paid_amount), mobile: 'meta' },
  {
    label: 'คงเหลือ',
    cls: 'num',
    mobile: 'body',
    render: (r) => (
      <b style={{ color: Number(r.balance_amount) > 0 ? '#c0392b' : 'inherit' }}>
        {money(r.balance_amount)}
      </b>
    ),
  },
  { label: 'การชำระ', render: (r) => <PaymentBadge sale={r} />, mobile: 'status' },
  { label: 'การรับสินค้า', render: (r) => <FulfillmentBadge sale={r} />, mobile: 'status' },
  { label: 'ผู้ขาย', key: 'created_by_name', mobile: 'meta' },
];

export default function PosHistoryPage() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [pay, setPay] = useState('');
  const [ful, setFul] = useState('');
  const [method, setMethod] = useState('');

  /* ตัวเลขบนปุ่ม "ตัวกรอง (N)" — นับเฉพาะสิ่งที่ถูกเปลี่ยนจากค่าตั้งต้น
     ช่วงวันที่ตั้งต้นคือ 30 วันล่าสุด ซึ่งไม่ใช่ "ไม่ได้กรอง" แต่ก็ไม่ใช่สิ่งที่
     ผู้ใช้เลือกเอง จึงไม่นับจนกว่าจะถูกแก้ · คำค้นไม่นับ มันอยู่นอกแผ่นและ
     เห็นได้ด้วยตาว่าพิมพ์อะไรค้างไว้ */
  const activeFilters = [pay, ful, method].filter(Boolean).length
    + (from !== DEFAULT_FROM || to !== DEFAULT_TO ? 1 : 0);
  const term = useDebounced(q);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);

  const { data, loading, error } = useAsync(
    () => posApi.sales({
      q: term, from, to, payment_status: pay, fulfillment_status: ful, method, limit: 300,
    }),
    [term, from, to, pay, ful, method],
  );

  const rows = data || [];

  /* ขยับตัวกรองอันไหนก็ตาม = บิลคนละชุด กลับไปหน้า 1 ไม่งั้นค้างอยู่หน้าที่ไม่มีอยู่จริง */
  useEffect(() => { setPage(1); }, [term, from, to, pay, ful, method, perPage]);

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
        {/* หกช่องนี้บนจอ 360px เคยตกลงมาเรียงกันเป็นหกแถว รวมกับป้ายกำกับแล้ว
            สูงราว 400px — คือทั้งจอ ก่อนที่บิลใบแรกจะได้โผล่ · ตอนนี้เหลือช่องค้นหา
            กับปุ่ม "ตัวกรอง (N)" ส่วนที่เหลืออยู่ในแผ่นที่ดันขึ้นมาตอนกด
            บนเดสก์ท็อปทั้งหกช่องยังยืนเรียงแถวเดียวเหมือนเดิม */}
        <FilterBar
          count={activeFilters}
          resultCount={rows.length}
          onReset={() => {
            setQ(''); setFrom(DEFAULT_FROM); setTo(DEFAULT_TO);
            setPay(''); setFul(''); setMethod('');
          }}
          search={(
            <div className="search-field">
              <Icon name="search" />
              <input
                type="search"
                value={q}
                placeholder="เลขที่ / ชื่อลูกค้า / เบอร์โทร / ชื่อสินค้า"
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
        >
          <Field label="ช่วงวันที่">
            <DateRangeField
              split
              from={from}
              to={to}
              onApply={({ from: f, to: t }) => { setFrom(f); setTo(t); }}
            />
          </Field>
          <Field label="การชำระ">
            <Select
              value={pay}
              onChange={(e) => setPay(e.target.value)}
              options={[['', 'ทั้งหมด'], ['unpaid', 'ยังไม่ชำระ'], ['partial', 'ชำระบางส่วน'], ['paid', 'ชำระครบแล้ว']]}
            />
          </Field>
          <Field label="การรับสินค้า">
            <Select
              value={ful}
              onChange={(e) => setFul(e.target.value)}
              options={[['', 'ทั้งหมด'], ['waiting', 'ยังไม่ส่งมอบ'], ['delivered', 'ส่งมอบแล้ว']]}
            />
          </Field>
          <Field label="ช่องทางชำระ">
            <Select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              options={[['', 'ทั้งหมด'], ...PAY_METHODS]}
            />
          </Field>
        </FilterBar>
      </Card>

      <Card tight>
        {loading && <Loading />}
        {error && <p className="muted">{error.message}</p>}
        {!loading && !error && (
          <>
            <DataTable
              columns={COLS}
              rows={rows}
              page={page}
              perPage={perPage}
              empty="ยังไม่มีรายการขายในช่วงที่เลือก"
            />

            <Pager
              total={rows.length}
              page={page}
              perPage={perPage}
              onPage={setPage}
              onPerPage={setPerPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
