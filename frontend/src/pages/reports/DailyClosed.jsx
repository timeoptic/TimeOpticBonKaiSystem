import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync } from '../../lib/hooks.js';
import {
  Card, Field, Kpi, Kpis, Loading, PageHead, PrintButton, Split, Toolbar,
} from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { custName, fmtDateTime, money, moneyShort, todayISO } from '../../lib/format.js';

/** one of the "แยกตามวิธีชำระ / ประเภท" breakdown cards */
function PayTable({ title, map, total }) {
  const rows = Object.entries(map || {}).map(([k, v]) => ({ id: k, k, v }));
  return (
    <Card title={title} tight>
      <DataTable
        columns={[
          { label: 'วิธีชำระ', key: 'k' },
          { label: 'จำนวนเงิน', render: (r) => money(r.v), cls: 'num' },
        ]}
        rows={rows}
        empty="ไม่มีรายการ"
        footer={<tr><td>รวม</td><td className="num">{money(total)}</td></tr>}
      />
    </Card>
  );
}

export default function DailyClosed() {
  const [params] = useSearchParams();
  const [from, setFrom] = useState(params.get('from') || todayISO());
  const [to, setTo] = useState(params.get('to') || params.get('from') || todayISO());

  const { data: d, loading, error } = useAsync(
    () => api.get('/api/reports/daily-closed', { from, to }),
    [from, to]
  );

  const setBoth = (a, b) => { setFrom(a); setTo(b); };

  return (
    <div>
      <PageHead icon="📅" title="Daily Closed" subtitle="สรุปยอดรายวัน" actions={<PrintButton />} />

      <Toolbar className="no-print">
        <Field label="ตั้งแต่วันที่">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-light" onClick={() => setBoth(todayISO(), todayISO())}>วันนี้</button>
        <button type="button" className="btn btn-light" onClick={() => setBoth(todayISO(-1), todayISO(-1))}>เมื่อวาน</button>
        <button type="button" className="btn btn-light" onClick={() => setBoth(todayISO(-6), todayISO())}>7 วันล่าสุด</button>
      </Toolbar>

      {loading && <Loading text="กำลังคำนวณ…" />}
      {error && <Card><p className="muted">{error.message}</p></Card>}
      {!loading && !error && (() => {
        const s = d.summary;
        const grand = Number(s.payment_total) + Number(s.other_income);
        return (
          <>
            <Kpis>
              <Kpi kind="ok" label="รับเงินจากลูกค้ารวม" value={moneyShort(s.payment_total)} sub={`${d.payments.length} รายการ`} />
              <Kpi kind="accent" label="ในนั้น: ปิดออเดอร์" value={moneyShort(s.close_income)} sub={`${d.orders.length} ออเดอร์`} />
              <Kpi kind="accent" label="ในนั้น: มัดจำ" value={moneyShort(s.deposit_total)} sub={`${d.deposits.length} ออเดอร์`} />
              <Kpi kind="accent" label="ขายสินค้าทั่วไป" value={moneyShort(s.sale_total)} sub={`${d.sales.length} รายการ`} />
              <Kpi label="รายรับอื่น" value={moneyShort(s.other_income)} />
              <Kpi kind="danger" label="รายจ่าย" value={moneyShort(s.expense)} />
              <Kpi
                kind="ok"
                label="รวมรับสุทธิ"
                value={moneyShort(grand - Number(s.expense))}
                sub={`รับ ${moneyShort(grand)} − จ่าย ${moneyShort(s.expense)}`}
              />
            </Kpis>

            <Split>
              <PayTable title="เงินที่รับ แยกตามวิธีชำระ" map={s.payment_by_method} total={s.payment_total} />
              <PayTable title="เงินที่รับ แยกตามประเภท" map={s.payment_by_kind} total={s.payment_total} />
            </Split>

            <Card title="รายการรับเงินทั้งหมด" tight>
              <DataTable
                columns={[
                  { label: 'เวลา', render: (p) => fmtDateTime(p.paid_at), cls: 'nowrap' },
                  { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
                  { label: 'ประเภท', key: 'kind' },
                  { label: 'วิธี', key: 'method' },
                  { label: 'จำนวน', render: (p) => money(p.amount), cls: 'num' },
                  { label: 'ผู้รับ', key: 'received_by_name' },
                  { label: 'หมายเหตุ', key: 'notes' },
                ]}
                rows={d.payments}
                empty="ไม่มีการรับเงินในช่วงนี้"
                footer={d.payments.length ? (
                  <tr>
                    <td colSpan={4}>รวม</td>
                    <td className="num">{money(s.payment_total)}</td>
                    <td colSpan={2} />
                  </tr>
                ) : null}
              />
            </Card>

            <Card title="ออเดอร์ที่ปิดการขาย" tight>
              <DataTable
                columns={[
                  { label: 'เวลา', render: (o) => fmtDateTime(o.order_close_date), cls: 'nowrap' },
                  { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
                  { label: 'ลูกค้า', render: custName },
                  { label: 'เลนส์', key: 'lens_name' },
                  { label: 'กรอบ', key: 'frame_name' },
                  { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
                  { label: 'มัดจำ', render: (o) => money(o.deposit), cls: 'num' },
                  { label: 'รับเพิ่ม', render: (o) => money(o.order_close_income), cls: 'num' },
                  { label: 'ชำระ', key: 'order_close_pay_type' },
                  { label: 'ผู้ปิด', key: 'close_employee_name' },
                ]}
                rows={d.orders}
                empty="ไม่มีออเดอร์ที่ปิดในช่วงนี้"
              />
            </Card>

            <Card title="การขายสินค้าทั่วไป" tight>
              <DataTable
                columns={[
                  { label: 'เวลา', render: (r) => fmtDateTime(r.sale_date), cls: 'nowrap' },
                  { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
                  { label: 'สินค้า', key: 'product_name' },
                  { label: 'ราคา', render: (r) => money(r.price), cls: 'num' },
                  { label: 'ส่วนลด', render: (r) => money(r.discount), cls: 'num' },
                  { label: 'สุทธิ', render: (r) => money(Number(r.price) - Number(r.discount)), cls: 'num' },
                  { label: 'ชำระ', key: 'pay_type' },
                  { label: 'พนักงาน', key: 'employee_name' },
                ]}
                rows={d.sales}
                empty="ไม่มีการขายสินค้าในช่วงนี้"
              />
            </Card>

            <Card title="มัดจำที่รับในช่วงนี้" tight>
              <DataTable
                columns={[
                  { label: 'เวลา', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
                  { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
                  { label: 'ลูกค้า', render: custName },
                  { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
                  { label: 'มัดจำ', render: (o) => money(o.deposit), cls: 'num' },
                  { label: 'ชำระ', key: 'deposit_pay_type' },
                  { label: 'พนักงาน', key: 'employee_name' },
                ]}
                rows={d.deposits}
                empty="ไม่มีการรับมัดจำในช่วงนี้"
              />
            </Card>
          </>
        );
      })()}
    </div>
  );
}
