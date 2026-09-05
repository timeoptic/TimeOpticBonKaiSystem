'use client';
/**
 * ผลงานพนักงาน — งานสองฝั่งของคนคนเดียวกัน อยู่ในแถวเดียวกัน
 *
 * สองระบบบันทึก "ใครขาย" คนละที่ (งานตัดแว่นเก็บพนักงาน · POS เก็บบัญชีผู้ใช้)
 * API เชื่อให้แล้วผ่าน `admins.employee_id` — หน้านี้จึงไม่ต้องรู้เรื่องนั้น
 */
import { useState } from 'react';
import { Card, Kpis } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { ExportButtons, ReportFilter, useReport } from '../../../../components/ReportFilter.jsx';
import {
  DrillKpi, NoData, ReportState, TableSearch, filterRows,
} from '../../../../components/reports/bits.jsx';
import { HBars } from '../../../../components/charts.jsx';
import { count, money, moneyShort } from '../../../../lib/format.js';
import { downloadCsv } from '../../../../lib/exportCsv.js';

/** แถบเล็ก ๆ ในเซลล์ บอกอัตราปิดการขายโดยไม่ต้องอ่านตัวเลข */
function Conversion({ value }) {
  if (value === null || value === undefined) {
    return <span className="muted">—</span>;
  }
  return (
    <span className="conv">
      <span className="conv-track">
        <span
          className="conv-fill"
          style={{
            width: `${Math.max(2, value)}%`,
            background: value >= 60 ? 'var(--ok)' : value >= 30 ? 'var(--warn)' : 'var(--danger)',
          }}
        />
      </span>
      <b>{value}%</b>
    </span>
  );
}

const COLUMNS = [
  { label: 'พนักงาน', key: 'employee' },
  { label: 'ลูกค้า', cls: 'right', sortKey: 'customers', render: (r) => (
    <>
      {count(r.customers)}
      {r.walk_in ? <div className="muted sm">+{r.walk_in} ขาจร</div> : null}
    </>
  ) },
  { label: 'เคส', cls: 'right', sortKey: 'cases', render: (r) => count(r.cases) },
  { label: 'ยอดงานตัดแว่น', cls: 'right', sortKey: 'main_revenue', render: (r) => money(r.main_revenue) },
  { label: 'บิล POS', cls: 'right', sortKey: 'pos_bills', render: (r) => count(r.pos_bills) },
  { label: 'ยอด POS', cls: 'right', sortKey: 'pos_revenue', render: (r) => money(r.pos_revenue) },
  { label: 'ยอดรวม', cls: 'right', sortKey: 'total', render: (r) => <b>{money(r.total)}</b> },
  { label: 'ปิดการขาย', cls: 'right', sortKey: 'conversion', render: (r) => <Conversion value={r.conversion} /> },
];

export default function EmployeeReport() {
  const { filter, data, error, loading } = useReport('employees');
  const [term, setTerm] = useState('');

  const rows = filterRows(data?.rows || [], term);
  const total = (data?.rows || []).reduce((a, r) => a + r.total, 0);
  const top = data?.rows?.[0];

  const csv = () => downloadCsv(
    `รายงานผลงานพนักงาน ${filter.from} ถึง ${filter.to}`,
    [
      { label: 'พนักงาน', value: (r) => r.employee },
      { label: 'ลูกค้า', value: (r) => r.customers },
      { label: 'ลูกค้าขาจร', value: (r) => r.walk_in },
      { label: 'จำนวนเคส', value: (r) => r.cases },
      { label: 'ยอดขาย Main Process', value: (r) => r.main_revenue },
      { label: 'จำนวนบิล POS', value: (r) => r.pos_bills },
      { label: 'ยอดขาย POS', value: (r) => r.pos_revenue },
      { label: 'ยอดรวม', value: (r) => r.total },
      { label: 'ค้างชำระ', value: (r) => r.balance },
      { label: 'ปิดการขาย %', value: (r) => r.conversion },
    ],
    rows,
  );

  return (
    <>
      <ReportFilter actions={<ExportButtons onExcel={csv} disabled={!rows.length} />} />

      <ReportState loading={loading} error={error} data={data}>
        {data && !data.rows.length
          ? <NoData bounds={data.bounds} channel={filter.channel} what="ยอดขาย" />
          : null}
        {data && data.rows.length ? (
          <>
            <Kpis>
              <DrillKpi
                label="ยอดขายรวมทุกคน" icon="💰" kind="accent" value={money(total)}
              />
              <DrillKpi
                label="ทำยอดสูงสุด" icon="🎉"
                value={top ? top.employee : '—'}
                sub={top ? money(top.total) : null}
              />
              <DrillKpi
                label="พนักงานที่มียอด" icon="🧑‍💼"
                value={`${count(data.rows.length)} คน`}
              />
            </Kpis>

            <Card title="เทียบยอดขายรวม">
              <HBars
                data={data.rows.map((r) => ({
                  label: r.employee,
                  value: r.total,
                  sub: `${r.cases} เคส · ${r.pos_bills} บิล POS`,
                }))}
                max={10}
              />
            </Card>

            <Card
              title="ตารางผลงาน"
              right={<TableSearch value={term} onChange={setTerm} count={rows.length} />}
              tight
            >
              <DataTable
                columns={COLUMNS}
                rows={rows}
                rowKey={(r) => r.employee}
                sortable
                defaultSort={{ key: 'total', dir: 'desc' }}
                empty={term ? 'ไม่พบพนักงานที่ค้นหา' : 'ช่วงนี้ยังไม่มียอดขาย'}
              />
            </Card>

            <p className="muted sm">
              <b>ปิดการขาย</b> = ออเดอร์ที่ปิดการขายแล้ว ÷ ออเดอร์ทั้งหมดที่คนนั้นรับผิดชอบ
              · คนที่ทำเฉพาะงาน POS ไม่มีออเดอร์ให้นับ จึงแสดงเป็น —
              {' '}ยอดค้างชำระรวมทุกคน {moneyShort((data.rows || []).reduce((a, r) => a + r.balance, 0))}
            </p>
          </>
        ) : null}
      </ReportState>
    </>
  );
}
