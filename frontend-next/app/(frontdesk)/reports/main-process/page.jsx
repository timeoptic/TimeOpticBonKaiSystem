'use client';
/**
 * ยอดขายจากงานตัดแว่น
 *
 * สถานะในตารางมาจาก `v_case_board` ซึ่งเป็น view เดียวกับที่กระดานงานใช้ —
 * รายงานกับกระดานจึงพูดสถานะชุดเดียวกัน ไม่มีสถานะชุดที่สองให้ต้องแปลกลับไปมา
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, Kpis } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { Pager } from '../../../../components/Pager.jsx';
import { PAGE_SIZES } from '../../../../lib/pager.js';
import { ExportButtons, ReportFilter, useReport } from '../../../../components/ReportFilter.jsx';
import {
  DrillKpi, NoData, PendingNote, ReportState, TableSearch, bucketNote, filterRows, toSeries,
} from '../../../../components/reports/bits.jsx';
import { Bars, HBars } from '../../../../components/charts.jsx';
import { count, fmtDate, money, moneyShort } from '../../../../lib/format.js';
import { downloadCsv } from '../../../../lib/exportCsv.js';
import { useAuth } from '../../../../contexts/AuthContext.jsx';
import { inSystemZone } from '../../../../lib/roles.js';
import { Icon } from '../../../../components/Icon.jsx';
import { EditBillDateDialog } from '../../../../components/reports/EditBillDateDialog.jsx';

/** สีป้ายตามขั้นตอนที่เคสค้างอยู่ — เสร็จแล้วเขียว กำลังเดินน้ำเงิน */
function StatusBadge({ row }) {
  if (!row.status) {
    return <Badge kind="gray">ไม่ผูกเคส</Badge>;
  }
  return <Badge kind={row.order_closed ? 'ok' : 'blue'}>{row.status}</Badge>;
}

/* `onEditDate` มีเฉพาะแอดมิน/เจ้าของร้าน — ปุ่มดินสอข้างวันเปิดบิล (API กันสิทธิ์เองอีกชั้น)
   · stopPropagation เพราะกดแถวคือเปิดหน้าเคส */
const columns = (onEditDate) => [
  { label: 'เลขเคส', key: 'code', mobile: 'title' },
  { label: 'วันเปิดบิล', sortKey: 'date', mobile: 'body', render: (r) => (
    <>
      {fmtDate(r.date)}
      {onEditDate ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          title="แก้วันเปิดบิล"
          aria-label={`แก้วันเปิดบิล ${r.code}`}
          style={{ padding: '2px 6px', marginLeft: 4 }}
          onClick={(e) => { e.stopPropagation(); onEditDate(r); }}
        >
          <Icon name="pencil" />
        </button>
      ) : null}
    </>
  ) },
  /* วันปิดงาน = วันส่งมอบ (ยืนยันส่งมอบแล้วบิลปิดเอง) · ใบที่ยังไม่ปิดเว้นเป็นขีด */
  { label: 'วันปิดงาน', sortKey: 'closed_at', mobile: 'body', render: (r) => (
    r.closed_at ? fmtDate(r.closed_at) : <span className="muted">—</span>
  ) },
  { label: 'ลูกค้า', key: 'customer', mobile: 'subtitle' },
  { label: 'พนักงาน', key: 'employee', mobile: 'meta' },
  { label: 'ประเภทสินค้า', sortKey: 'lens', mobile: 'meta', render: (r) => (
    <>
      {r.lens || <span className="muted">—</span>}
      {r.product ? <div className="muted sm">{r.product}</div> : null}
    </>
  ) },
  { label: 'ยอดขาย', cls: 'right', sortKey: 'revenue', render: (r) => money(r.revenue), mobile: 'body' },
  { label: 'ค้างชำระ', cls: 'right', sortKey: 'balance', mobile: 'body', render: (r) => (
    r.balance > 0 ? <b className="warn-text">{money(r.balance)}</b> : <span className="muted">—</span>
  ) },
  { label: 'สถานะ', sortKey: 'status', render: (r) => <StatusBadge row={r} />, mobile: 'status' },
];

export default function MainProcessReport() {
  const { filter, data, error, loading, reload } = useReport('main-process');
  const { actor } = useAuth();
  const [editing, setEditing] = useState(null);
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PAGE_SIZES[0]);
  const router = useRouter();

  const rows = filterRows(data?.bills || [], term);

  /* เปลี่ยนช่วงวันที่ (ได้ data ชุดใหม่) หรือพิมพ์คำค้น = ผลคนละชุด กลับไปหน้า 1 */
  useEffect(() => { setPage(1); }, [data, term, perPage]);

  const csv = () => downloadCsv(
    `รายงานงานตัดแว่น ${filter.from} ถึง ${filter.to}`,
    [
      { label: 'เลขเคส', value: (r) => r.code },
      { label: 'วันเปิดบิล', value: (r) => r.date },
      { label: 'วันปิดงาน', value: (r) => r.closed_at },
      { label: 'ลูกค้า', value: (r) => r.customer },
      { label: 'พนักงาน', value: (r) => r.employee },
      { label: 'เลนส์', value: (r) => r.lens },
      { label: 'สินค้า', value: (r) => r.product },
      { label: 'ยอดขาย', value: (r) => r.revenue },
      { label: 'ชำระแล้ว', value: (r) => r.paid },
      { label: 'ค้างชำระ', value: (r) => r.balance },
      { label: 'กำไร', value: (r) => r.profit },
      { label: 'สถานะ', value: (r) => r.status },
    ],
    /* ไฟล์เรียงตามวันปิดงานเก่าไปใหม่ · ใบที่ยังไม่ปิดต่อท้าย (ตารางบนจอยังเรียงตามที่กดหัวคอลัมน์) */
    [...rows].sort((a, b) => (!a.closed_at - !b.closed_at)
      || String(a.closed_at || '').localeCompare(String(b.closed_at || ''))
      || String(a.date).localeCompare(String(b.date))),
  );

  return (
    <>
      <ReportFilter actions={<ExportButtons onExcel={csv} disabled={!rows.length} />} />

      <ReportState loading={loading} error={error} data={data}>
        <PendingNote pending={data?.pending} />
        {data && !data.kpi.bills
          ? <NoData bounds={data.bounds} channel={filter.channel} what="เคส" />
          : null}
        {data && data.kpi.bills ? (
          <>
            <Kpis>
              <DrillKpi label="จำนวนเคส" icon="board" value={`${count(data.kpi.bills)} เคส`} />
              <DrillKpi
                label="ยอดขายรวม" icon="coins" kind="accent" value={money(data.kpi.revenue)}
                sub={`เฉลี่ย ${moneyShort(data.kpi.avg)} ต่อเคส`}
              />
              <DrillKpi label="ชำระแล้ว" icon="checkCircle" kind="ok" value={money(data.kpi.paid)} />
              <DrillKpi
                label="ค้างชำระ" icon="hourglass" kind={data.kpi.balance > 0 ? 'warn' : ''}
                value={money(data.kpi.balance)}
              />
              <DrillKpi
                label="กำไร" icon="trending"
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
                columns={columns(inSystemZone(actor) ? setEditing : null)}
                rows={rows}
                sortable
                /* หั่นหน้าใน DataTable ไม่ใช่หั่นก่อนส่งเข้าไป — ตารางนี้เรียงคอลัมน์ได้
                   ถ้าหั่นก่อน ปุ่ม "ยอดมากไปน้อย" จะเรียงแค่แถวของหน้าที่เปิดอยู่ */
                /* เรียงตามวันที่ที่ใบนั้นถูกนับ — โหมดวันปิดบิลจึงไล่ตามวันส่งมอบ */
                defaultSort={{ key: filter.by === 'close' && filter.status !== 'open' ? 'closed_at' : 'date', dir: 'desc' }}
                page={page}
                perPage={perPage}
                empty={term ? 'ไม่พบรายการที่ค้นหา' : 'ช่วงนี้ยังไม่มีเคส'}
                onRowClick={(r) => router.push(
                  r.case_id ? `/cases/detail?id=${r.case_id}` : `/orders/detail?id=${r.id}`,
                )}
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

      {editing && (
        <EditBillDateDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}
