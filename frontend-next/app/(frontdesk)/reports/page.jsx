'use client';
/**
 * ภาพรวม — หน้าแรกของรายงาน
 *
 * ตอบสามคำถามเรียงกันจากบนลงล่าง: ขายได้เท่าไหร่ (KPI) · มาจากทางไหน (เทียบ
 * สองช่องทาง) · ขึ้นลงยังไง (รายวัน) · ทุก KPI กดเข้าไปดูที่มาของตัวเลขได้
 */
import { Card, Kpis } from '../../../components/ui.jsx';
import { ExportButtons, ReportFilter, useReport } from '../../../components/ReportFilter.jsx';
import { DrillKpi, NoData, ReportState, bucketNote, toSeries } from '../../../components/reports/bits.jsx';
import { Bars, Donut, seriesColor } from '../../../components/charts.jsx';
import { count, money, moneyShort } from '../../../lib/format.js';
import { downloadCsv } from '../../../lib/exportCsv.js';
import { filterQuery } from '../../../lib/reportRange.js';

export default function OverviewPage() {
  const { filter, data, error, loading } = useReport('overview');
  const q = filterQuery(filter);

  const csv = () => downloadCsv(
    `รายงานภาพรวม ${filter.from} ถึง ${filter.to}`,
    [
      { label: 'วันที่', value: (r) => r.date },
      { label: 'Main Process', value: (r) => r.main ?? 0 },
      { label: 'POS', value: (r) => r.pos ?? 0 },
      { label: 'รวม', value: (r) => (r.main ?? 0) + (r.pos ?? 0) },
    ],
    data?.daily || [],
  );

  return (
    <>
      <ReportFilter actions={<ExportButtons onCsv={csv} disabled={!data} />} />

      <ReportState loading={loading} error={error} data={data}>
        {data && !data.kpi.bills
          ? <NoData bounds={data.bounds} channel={filter.channel} />
          : null}
        {data && data.kpi.bills ? (
          <>
            <Kpis>
              <DrillKpi
                label="ยอดขายรวม" icon="💰" kind="accent"
                value={money(data.kpi.revenue)}
                sub={`${count(data.kpi.bills)} บิล · รับเงินแล้ว ${moneyShort(data.kpi.paid)}`}
              />
              <DrillKpi
                label="จำนวนบิล" icon="🧾"
                value={`${count(data.kpi.bills)} ใบ`}
                sub="กดดูรายการทั้งหมด"
                to={`/reports/main-process?${q}`}
              />
              <DrillKpi
                label="ลูกค้า" icon="👥"
                value={`${count(data.kpi.customers)} คน`}
                sub={data.kpi.walk_in
                  ? `+ ขาจรอีก ${count(data.kpi.walk_in)} บิล`
                  : 'ที่มีประวัติในระบบ'}
              />
              <DrillKpi
                label="ยอดค้างชำระ" icon="⏳" kind={data.kpi.balance > 0 ? 'warn' : ''}
                value={money(data.kpi.balance)}
                sub={`จากบิลในช่วงนี้ · ค้างสะสมทั้งร้าน ${moneyShort(data.kpi.outstanding_all_time)}`}
                to={`/reports/payments?${q}`}
              />
              <DrillKpi
                label="เฉลี่ยต่อบิล" icon="📈"
                value={money(data.kpi.avg_bill)}
              />
            </Kpis>

            <div className="report-split">
              <Card title="สัดส่วนยอดขาย">
                <Donut
                  items={data.channels.map((c, i) => ({
                    label: c.label,
                    value: c.revenue,
                    color: seriesColor(i),
                  }))}
                  total={data.kpi.revenue}
                  totalLabel="ยอดขายรวม"
                  format={moneyShort}
                />
              </Card>

              <Card title="เทียบสองช่องทาง">
                <div className="chan-cards">
                  {data.channels.map((c, i) => (
                    <div key={c.key} className="chan">
                      <div className="chan-head">
                        <span className="sw" style={{ background: seriesColor(i) }} />
                        <b>{c.label}</b>
                        <small>{c.sub}</small>
                        <span className="chan-share">{c.share}%</span>
                      </div>
                      <div className="chan-val">{money(c.revenue)}</div>
                      <div className="chan-bar">
                        <span style={{
                          width: `${Math.max(c.share, c.revenue > 0 ? 1 : 0)}%`,
                          background: seriesColor(i),
                        }}
                        />
                      </div>
                      <dl className="chan-kv">
                        <dt>จำนวนบิล</dt>
                        <dd>{count(c.bills)} ใบ</dd>
                        <dt>รับเงินแล้ว</dt>
                        <dd>{moneyShort(c.paid)}</dd>
                        <dt>ค้างชำระ</dt>
                        <dd className={c.balance > 0 ? 'warn-text' : ''}>
                          {moneyShort(c.balance)}
                        </dd>
                      </dl>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card
              title={`ยอดขาย${bucketNote(data.daily) || ''}`}
              right={<span className="muted">ทุกช่องทางรวมกัน</span>}
            >
              <Bars data={toSeries(data.daily, (d) => (d.main || 0) + (d.pos || 0))} />
            </Card>
          </>
        ) : null}
      </ReportState>
    </>
  );
}
