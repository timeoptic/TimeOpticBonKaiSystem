'use client';
/**
 * ยอดขายจากงานตัดแว่น
 *
 * สถานะในตารางมาจาก `v_case_board` ซึ่งเป็น view เดียวกับที่กระดานงานใช้ —
 * รายงานกับกระดานจึงพูดสถานะชุดเดียวกัน ไม่มีสถานะชุดที่สองให้ต้องแปลกลับไปมา
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, Kpis } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { ExportButtons, ReportFilter, useReport } from '../../../../components/ReportFilter.jsx';
import {
  DrillKpi, NoData, ReportState, TableSearch, bucketNote, filterRows, toSeries,
} from '../../../../components/reports/bits.jsx';
import { Bars, HBars } from '../../../../components/charts.jsx';
import { count, fmtDate, money, moneyShort } from '../../../../lib/format.js';
import { downloadCsv } from '../../../../lib/exportCsv.js';

/** สีป้ายตามขั้นตอนที่เคสค้างอยู่ — เสร็จแล้วเขียว กำลังเดินน้ำเงิน */
function StatusBadge({ row }) {
  if (!row.status) {
    return <Badge kind="gray">ไม่ผูกเคส</Badge>;
  }
  return <Badge kind={row.order_closed ? 'ok' : 'blue'}>{row.status}</Badge>;
}

const COLUMNS = [
  { label: 'เลขเคส', key: 'code' },
  { label: 'วันที่', sortKey: 'date', render: (r) => fmtDate(r.date) },
  { label: 'ลูกค้า', key: 'customer' },
  { label: 'พนักงาน', key: 'employee' },
  { label: 'ประเภทสินค้า', sortKey: 'lens_type', render: (r) => (
    <>
      {r.lens_type || <span className="muted">—</span>}
      {r.product ? <div className="muted sm">{r.product}</div> : null}
    </>
  ) },
  { label: 'ยอดขาย', cls: 'right', sortKey: 'revenue', render: (r) => money(r.revenue) },
  { label: 'ค้างชำระ', cls: 'right', sortKey: 'balance', render: (r) => (
    r.balance > 0 ? <b className="warn-text">{money(r.balance)}</b> : <span className="muted">—</span>
  ) },
  { label: 'สถานะ', sortKey: 'status', render: (r) => <StatusBadge row={r} /> },
];

export default function MainProcessReport() {
  const { filter, data, error, loading } = useReport('main-process');
  const [term, setTerm] = useState('');
  const router = useRouter();

  const rows = filterRows(data?.bills || [], term);

  const csv = () => downloadCsv(
    `รายงานงานตัดแว่น ${filter.from} ถึง ${filter.to}`,
    [
      { label: 'เลขเคส', value: (r) => r.code },
      { label: 'วันที่', value: (r) => r.date },
      { label: 'ลูกค้า', value: (r) => r.customer },
      { label: 'พนักงาน', value: (r) => r.employee },
      { label: 'ประเภทเลนส์', value: (r) => r.lens_type },
      { label: 'สินค้า', value: (r) => r.product },
      { label: 'ยอดขาย', value: (r) => r.revenue },
      { label: 'ชำระแล้ว', value: (r) => r.paid },
      { label: 'ค้างชำระ', value: (r) => r.balance },
      { label: 'กำไร', value: (r) => r.profit },
      { label: 'สถานะ', value: (r) => r.status },
    ],
    rows,
  );

  return (
    <>
      <ReportFilter actions={<ExportButtons onCsv={csv} disabled={!rows.length} />} />

      <ReportState loading={loading} error={error} data={data}>
        {data && !data.kpi.bills
          ? <NoData bounds={data.bounds} channel={filter.channel} what="เคส" />
          : null}
        {data && data.kpi.bills ? (
          <>
            <Kpis>
              <DrillKpi label="จำนวนเคส" icon="🗂" value={`${count(data.kpi.bills)} เคส`} />
              <DrillKpi
                label="ยอดขายรวม" icon="💰" kind="accent" value={money(data.kpi.revenue)}
                sub={`เฉลี่ย ${moneyShort(data.kpi.avg)} ต่อเคส`}
              />
              <DrillKpi label="ชำระแล้ว" icon="✅" kind="ok" value={money(data.kpi.paid)} />
              <DrillKpi
                label="ค้างชำระ" icon="⏳" kind={data.kpi.balance > 0 ? 'warn' : ''}
                value={money(data.kpi.balance)}
              />
              <DrillKpi
                label="กำไร" icon="📈"
                value={data.kpi.profit === null ? '—' : money(data.kpi.profit)}
                /* บอกให้ชัดว่ากำไรก้อนนี้คิดจากกี่เคสในกี่เคส — ไม่งั้นตัวเลขนี้
                   ถูกอ่านว่าเป็นกำไรของทั้งช่วง ทั้งที่เคสที่ยังไม่ได้เลือกของ
                   จากคลังยังไม่มีต้นทุนให้หัก */
                sub={data.kpi.uncosted
                  ? `จาก ${data.kpi.costed} เคสที่มีต้นทุน (อีก ${data.kpi.uncosted} เคสยังไม่ได้เลือกของ)`
                  : 'จากต้นทุนกรอบและเลนส์จริง'}
              />
            </Kpis>

            <Card title={`ยอดขาย${bucketNote(data.daily) || ''}`}>
              <Bars data={toSeries(data.daily, (d) => d.main)} />
            </Card>

            <div className="report-split">
              <Card title="ยอดขายตามประเภทเลนส์">
                <HBars
                  data={data.by_lens.map((d) => ({
                    label: d.label, value: d.revenue, sub: `${d.bills} เคส`,
                  }))}
                />
              </Card>
              <Card title="ยอดขายตามพนักงาน">
                <HBars
                  data={data.by_employee.map((d) => ({
                    label: d.label, value: d.revenue, sub: `${d.bills} เคส`,
                  }))}
                />
              </Card>
            </div>

            <Card
              title="รายการเคส"
              right={<TableSearch value={term} onChange={setTerm} count={rows.length} />}
              tight
            >
              <DataTable
                columns={COLUMNS}
                rows={rows}
                sortable
                defaultSort={{ key: 'date', dir: 'desc' }}
                empty={term ? 'ไม่พบรายการที่ค้นหา' : 'ช่วงนี้ยังไม่มีเคส'}
                onRowClick={(r) => router.push(
                  r.case_id ? `/cases/detail?id=${r.case_id}` : `/orders/detail?id=${r.id}`,
                )}
              />
            </Card>
          </>
        ) : null}
      </ReportState>
    </>
  );
}
