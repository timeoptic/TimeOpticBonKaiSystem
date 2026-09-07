'use client';
/**
 * การรับเงิน — รวมทั้งสองระบบ
 *
 * **หน้านี้เป็นหน้าเดียวที่นับด้วยวันที่รับเงิน ไม่ใช่วันที่เปิดบิล** ตัวเลขจึงไม่
 * เท่ากับ "ยอดขาย" ในหน้าอื่นของช่วงเดียวกัน และนั่นถูกแล้ว — มัดจำที่รับเดือนนี้
 * มาจากบิลของเดือนที่แล้วได้ · คำอธิบายอยู่บนหน้าจอด้วย ไม่ใช่แค่ในคอมเมนต์
 */
import { Card, Kpis } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { ExportButtons, ReportFilter, useReport } from '../../../../components/ReportFilter.jsx';
import { DrillKpi, NoData, ReportState, bucketNote, toSeries } from '../../../../components/reports/bits.jsx';
import { Bars, Donut, seriesColor } from '../../../../components/charts.jsx';
import { count, money, moneyShort } from '../../../../lib/format.js';
import { downloadCsv } from '../../../../lib/exportCsv.js';

/**
 * ป้ายไทยของช่องทางชำระ
 *
 * ค่าที่ไม่รู้จักได้ชื่อของตัวเองกลับไป ไม่ใช่ถูกยุบเป็น "อื่นๆ" — เงินที่อ่านไม่ออก
 * ว่ามาทางไหน ยังดีกว่าเงินที่หายเข้าไปในถังชื่อ "อื่นๆ" จนตามไม่ได้
 */
const METHOD_LABEL = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  qr: 'QR Payment',
  credit: 'บัตรเครดิต',
  thungngern: 'ถุงเงิน',
  unknown: 'ไม่ระบุช่องทาง',
};
const label = (m) => METHOD_LABEL[m] || m;

export default function PaymentsReport() {
  const { filter, data, error, loading } = useReport('payments');

  const csv = () => downloadCsv(
    `รายงานการรับเงิน ${filter.from} ถึง ${filter.to}`,
    [
      { label: 'ช่องทาง', value: (r) => label(r.method) },
      { label: 'จำนวนครั้ง', value: (r) => r.count },
      { label: 'ยอดเงิน', value: (r) => r.amount },
      { label: 'สัดส่วน %', value: (r) => r.share },
    ],
    data?.by_method || [],
  );

  return (
    <>
      <ReportFilter
        actions={<ExportButtons onExcel={csv} disabled={!data?.by_method?.length} />}
        statusNote="หน้านี้นับจากรายการรับเงิน ไม่ได้แยกตามสถานะงาน"
      />

      <ReportState loading={loading} error={error} data={data}>
        {data && !data.count
          ? <NoData bounds={data.bounds} channel={filter.channel} what="การรับเงิน" />
          : null}
        {data && data.count ? (
          <>
            <div className="report-note">
              <b>หน้านี้นับด้วยวันที่รับเงิน</b> ไม่ใช่วันที่เปิดบิล —
              ตัวเลขจึงไม่เท่ากับยอดขายในช่วงเดียวกัน เพราะมัดจำที่รับในช่วงนี้
              อาจมาจากบิลที่เปิดไว้ก่อนหน้า
            </div>

            <Kpis>
              <DrillKpi
                label="รับเงินรวม" icon="💰" kind="accent" value={money(data.total)}
                sub={`${count(data.count)} รายการ`}
              />
              <DrillKpi
                label="จากงานตัดแว่น" icon="👓" value={money(data.by_channel.main)}
              />
              <DrillKpi label="จากหน้าร้าน" icon="🛍" value={money(data.by_channel.pos)} />
              <DrillKpi
                label="บิลที่ผ่อนอยู่" icon="⏳"
                kind={data.installment.bills > 0 ? 'warn' : ''}
                value={`${count(data.installment.bills)} ใบ`}
                /* "ผ่อนชำระ" ไม่ใช่ช่องทางจ่ายเงิน จึงไม่อยู่ในกราฟวงกลม —
                   มันคือสถานะของบิล ที่จ่ายมาแล้วบางส่วนและยังค้างอยู่ */
                sub={data.installment.bills
                  ? `จ่ายแล้ว ${moneyShort(data.installment.paid)} · ค้าง ${moneyShort(data.installment.balance)}`
                  : 'ไม่มีบิลที่ค้างจ่ายบางส่วน'}
              />
            </Kpis>

            <div className="report-split">
              <Card title="ช่องทางการชำระเงิน">
                <Donut
                  items={data.by_method.map((m, i) => ({
                    label: label(m.method), value: m.amount, color: seriesColor(i),
                  }))}
                  total={data.total}
                  totalLabel="รับเงินรวม"
                />
              </Card>

              <Card title="แยกตามช่องทาง" tight>
                <DataTable
                  columns={[
                    { label: 'ช่องทาง', sortKey: 'method', mobile: 'title', render: (r) => (
                      <span className="row" style={{ gap: 8 }}>
                        <i
                          className="sw"
                          style={{ background: seriesColor(data.by_method.indexOf(r)) }}
                        />
                        {label(r.method)}
                      </span>
                    ) },
                    { label: 'ครั้ง', cls: 'right', sortKey: 'count', render: (r) => count(r.count), mobile: 'body' },
                    { label: 'ยอดเงิน', cls: 'right', sortKey: 'amount', render: (r) => money(r.amount), mobile: 'body' },
                    { label: 'สัดส่วน', cls: 'right', sortKey: 'share', render: (r) => `${r.share}%` },
                  ]}
                  rows={data.by_method}
                  rowKey={(r) => r.method}
                  sortable
                  empty="ช่วงนี้ยังไม่มีการรับเงิน"
                  footer={(
                    <tr>
                      <th>รวม</th>
                      <th className="right">{count(data.count)}</th>
                      <th className="right">{money(data.total)}</th>
                      <th className="right">100%</th>
                    </tr>
                  )}
                />
                {data.by_method.some((m) => m.method === 'qr') ? null : (
                  <p className="muted sm" style={{ padding: '10px 16px' }}>
                    ยังไม่มีเงินเข้าทาง QR ในช่วงนี้ — หมายเหตุ: หน้า POS
                    ยังไม่เปิดให้เลือก QR (รับได้เฉพาะเงินสด · โอน · บัตร · ถุงเงิน)
                  </p>
                )}
              </Card>
            </div>

            <Card title={`เงินเข้า${bucketNote(data.daily) || ''}`}>
              <Bars data={toSeries(data.daily, (d) => d.amount)} />
            </Card>
          </>
        ) : null}
      </ReportState>
    </>
  );
}
