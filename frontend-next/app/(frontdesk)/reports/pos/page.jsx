'use client';
/**
 * ยอดขายหน้าร้าน
 *
 * แถวที่ติดป้าย "ระบบเดิม" มาจากตาราง `sales` — การขายสินค้าทั่วไปยุคก่อนมี POS
 * ยังมีเงินจริงอยู่ในนั้น จึงนับรวมในยอด ไม่ใช่ถูกซ่อนเพราะมาจากตารางอื่น
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card, Kpis } from '../../../../components/ui.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { Pager } from '../../../../components/Pager.jsx';
import { PAGE_SIZES } from '../../../../lib/pager.js';
import { ExportButtons, ReportFilter, useReport } from '../../../../components/ReportFilter.jsx';
import {
  DrillKpi, NoData, ReportState, TableSearch, bucketNote, filterRows, toSeries,
} from '../../../../components/reports/bits.jsx';
import { Bars, HBars, seriesColor } from '../../../../components/charts.jsx';
import { count, fmtDateTime, money, moneyShort } from '../../../../lib/format.js';
import { downloadCsv } from '../../../../lib/exportCsv.js';

const PAY_BADGE = {
  paid: ['ok', 'จ่ายครบ'],
  partial: ['warn', 'จ่ายบางส่วน'],
  unpaid: ['danger', 'ยังไม่จ่าย'],
};

const COLUMNS = [
  { label: 'เลขบิล', sortKey: 'bill_no', mobile: 'title', render: (r) => (
    <>
      <span className="mono">{r.bill_no}</span>
      {r.src === 'legacy' ? <Badge kind="gray" style={{ marginLeft: 6 }}>ระบบเดิม</Badge> : null}
    </>
  ) },
  { label: 'วันที่', sortKey: 'date', render: (r) => fmtDateTime(r.date), mobile: 'body' },
  { label: 'พนักงาน', key: 'employee', mobile: 'meta' },
  { label: 'ลูกค้า', sortKey: 'customer', render: (r) => r.customer || <span className="muted">ขาจร</span> },
  { label: 'สินค้า', sortKey: 'items', mobile: 'meta', render: (r) => (
    <span className="cell-clip" title={r.items || ''}>{r.items || '—'}</span>
  ) },
  { label: 'จำนวน', cls: 'right', sortKey: 'qty', render: (r) => count(r.qty), mobile: 'meta' },
  { label: 'ยอดรวม', cls: 'right', sortKey: 'revenue', render: (r) => money(r.revenue), mobile: 'body' },
  { label: 'การชำระ', sortKey: 'pay_status', mobile: 'status', render: (r) => {
    const [kind, label] = PAY_BADGE[r.pay_status] || ['gray', r.pay_status];
    return (
      <>
        <Badge kind={kind}>{label}</Badge>
        {r.balance > 0 ? <div className="muted sm">ค้าง {moneyShort(r.balance)}</div> : null}
      </>
    );
  } },
];

export default function PosReport() {
  const { filter, data, error, loading } = useReport('pos');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);
  const router = useRouter();

  const rows = filterRows(data?.bills || [], term);

  /* เปลี่ยนช่วงวันที่ (ได้ data ชุดใหม่) หรือพิมพ์คำค้น = ผลคนละชุด กลับไปหน้า 1 */
  useEffect(() => { setPage(1); }, [data, term, perPage]);

  const csv = () => downloadCsv(
    `รายงานขายหน้าร้าน ${filter.from} ถึง ${filter.to}`,
    [
      { label: 'เลขบิล', value: (r) => r.bill_no },
      { label: 'ที่มา', value: (r) => (r.src === 'legacy' ? 'ระบบเดิม' : 'POS') },
      { label: 'วันที่', value: (r) => r.date },
      { label: 'พนักงาน', value: (r) => r.employee },
      { label: 'ลูกค้า', value: (r) => r.customer },
      { label: 'สินค้า', value: (r) => r.items },
      { label: 'จำนวน', value: (r) => r.qty },
      { label: 'ยอดรวม', value: (r) => r.revenue },
      { label: 'ชำระแล้ว', value: (r) => r.paid },
      { label: 'ค้างชำระ', value: (r) => r.balance },
    ],
    rows,
  );

  return (
    <>
      <ReportFilter
        actions={<ExportButtons onExcel={csv} disabled={!rows.length} />}
        hideBy
      />

      <ReportState loading={loading} error={error} data={data}>
        {/* ใบที่ถูกยกเลิกไม่นับเป็นยอดขาย แต่ต้องบอกว่ามีอยู่ — 14 ใบที่หายไป
            จากรายงานโดยไม่มีอะไรอธิบาย ถูกอ่านว่ารายงานพัง ไม่ใช่ว่าใบถูกยกเลิก */}
        {data && data.voided?.bills ? (
          <div className="report-note warn">
            <b>ช่วงนี้มีใบขายที่ถูกยกเลิก {count(data.voided.bills)} ใบ</b>
            {' '}(มูลค่ารวม {money(data.voided.amount)}) — ไม่ถูกนับเป็นยอดขาย
            และไม่อยู่ในตารางข้างล่าง{' '}
            <Link href="/pos/history">ดูประวัติการขายทั้งหมด <Icon name="arrowRight" /></Link>
          </div>
        ) : null}
        {data && !data.kpi.bills
          ? <NoData bounds={data.bounds} channel={filter.channel} what="บิลขายหน้าร้าน" />
          : null}
        {data && data.kpi.bills ? (
          <>
            <Kpis>
              <DrillKpi
                label="ยอดขาย POS" icon="bag" kind="accent" value={money(data.kpi.revenue)}
              />
              <DrillKpi label="จำนวนบิล" icon="receipt" value={`${count(data.kpi.bills)} ใบ`} />
              <DrillKpi label="จำนวนสินค้า" icon="box" value={`${count(data.kpi.products)} ชิ้น`} />
              <DrillKpi label="เฉลี่ยต่อบิล" icon="trending" value={money(data.kpi.avg)} />
              <DrillKpi
                label="ค้างชำระ" icon="hourglass" kind={data.kpi.balance > 0 ? 'warn' : ''}
                value={money(data.kpi.balance)}
              />
            </Kpis>

            <div className="report-split">
              <Card title={`ยอดขาย${bucketNote(data.daily) || ''}`}>
                <Bars data={toSeries(data.daily, (d) => d.pos)} />
              </Card>
              <Card title="ยอดขายตามหมวดสินค้า">
                <HBars
                  data={data.by_category.map((d, i) => ({
                    label: d.category,
                    value: d.revenue,
                    sub: `${count(d.qty)} ชิ้น`,
                    color: seriesColor(i),
                  }))}
                />
                {!data.by_category.length ? (
                  <p className="muted sm" style={{ marginTop: 10 }}>
                    หมวดสินค้าจะขึ้นเมื่อมีการขายผ่านหน้า POS —
                    รายการจากระบบเดิมไม่มีหมวดติดมาด้วย
                  </p>
                ) : null}
              </Card>
            </div>

            <Card
              title="รายการบิล"
              right={<TableSearch value={term} onChange={setTerm} count={rows.length} />}
              tight
            >
              <DataTable
                columns={COLUMNS}
                rows={rows}
                sortable
                /* หั่นหน้าใน DataTable ไม่ใช่หั่นก่อนส่งเข้าไป — ตารางนี้เรียงคอลัมน์ได้
                   ถ้าหั่นก่อน ปุ่ม "ยอดมากไปน้อย" จะเรียงแค่แถวของหน้าที่เปิดอยู่ */
                defaultSort={{ key: 'date', dir: 'desc' }}
                page={page}
                perPage={perPage}
                empty={term ? 'ไม่พบรายการที่ค้นหา' : 'ช่วงนี้ยังไม่มีบิลขายหน้าร้าน'}
                /* บิลของระบบเดิมไม่มีหน้ารายละเอียดให้เปิด — กดแล้วไม่ไปไหน
                   ดีกว่าพาไปหน้า 404 ที่ดูเหมือนระบบพัง */
                onRowClick={(r) => (r.src === 'pos' ? router.push(`/pos/detail?id=${r.id}`) : null)}
              />

              <Pager
                total={rows.length}
                page={page}
                perPage={perPage}
                onPage={setPage}
                onPerPage={setPerPage}
              />
            </Card>
          </>
        ) : null}
      </ReportState>
    </>
  );
}
