'use client';
/**
 * ลูกค้ามาจากช่องทางไหน — รายงานการตลาด
 *
 * ข้อมูลถูกถามตอนเปิดเคส (ขั้น "รับลูกค้า") และเก็บไว้ที่ `cases.referral_source`
 * มาตลอด แต่ยังไม่เคยมีหน้าไหนอ่านมัน
 *
 * หน้านี้ไม่ได้เรียงตามจำนวนเคส แต่เรียงตาม **ยอดขาย** — ช่องทางที่พาคนมาเยอะ
 * กับช่องทางที่พาเงินมาเยอะเป็นคนละช่องทางกันได้ และอย่างหลังคือสิ่งที่เจ้าของร้าน
 * ต้องรู้ก่อนตัดสินใจว่าจะลงโฆษณาที่ไหน
 */
import { Card, Kpis } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { ExportButtons, ReportFilter, useReport } from '../../../../components/ReportFilter.jsx';
import { DrillKpi, NoData, ReportState } from '../../../../components/reports/bits.jsx';
import { Donut, HBars, seriesColor } from '../../../../components/charts.jsx';
import { count, money, moneyShort } from '../../../../lib/format.js';
import { downloadCsv } from '../../../../lib/exportCsv.js';

/** แถบอัตราปิดการขาย — เหมือนในตารางพนักงาน อ่านได้โดยไม่ต้องดูตัวเลข */
function Conv({ value }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
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

export default function ChannelsReport() {
  const { filter, data, error, loading } = useReport('channels');

  const csv = () => downloadCsv(
    `รายงานช่องทางลูกค้า ${filter.from} ถึง ${filter.to}`,
    [
      { label: 'ช่องทาง', value: (r) => r.label },
      { label: 'จำนวนเคส', value: (r) => r.cases },
      { label: 'ลูกค้า', value: (r) => r.customers },
      { label: 'ลูกค้าใหม่', value: (r) => r.new_customers },
      { label: 'ปิดการขายได้', value: (r) => r.sold },
      { label: 'ปิดการขาย %', value: (r) => r.conversion },
      { label: 'ยอดขาย', value: (r) => r.revenue },
      { label: 'เฉลี่ยต่อเคส', value: (r) => r.avg },
      { label: 'สัดส่วนยอดขาย %', value: (r) => r.revenue_share },
    ],
    data?.by_referral || [],
  );

  const merged = Object.keys(data?.merged || {});

  return (
    <>
      <ReportFilter
        actions={<ExportButtons onExcel={csv} disabled={!data?.by_referral?.length} />}
        statusNote="หน้านี้ต้องนับเคสทั้งหมดเพื่อคิดอัตราปิดการขาย จึงกรองตามสถานะงานไม่ได้"
        hideBy
      />

      <ReportState loading={loading} error={error} data={data}>
        {data && !data.kpi.cases
          ? <NoData bounds={data.bounds} channel={filter.channel} what="เคส" />
          : null}

        {data && data.kpi.cases ? (
          <>
            <div className="report-note">
              <b>หน้านี้นับด้วยวันที่เปิดเคส</b> ไม่ใช่วันที่เปิดบิล — คำถามคือ
              &ldquo;ลูกค้าที่เดินเข้ามาช่วงนี้ มาจากช่องทางไหน&rdquo;
              {' '}เคสที่เปิดแล้วยังไม่ได้ขายก็ยังนับ เพราะช่องทางนั้นพาคนมาแล้วจริง
              {' '}· ตัวกรอง &ldquo;ช่องทางขาย&rdquo; ด้านบนไม่มีผลกับหน้านี้
              {' '}(POS ไม่มีเคส และไม่ได้ถามว่ารู้จักร้านจากไหน)
            </div>

            <Kpis>
              <DrillKpi
                label="ช่องทางที่ทำเงินสูงสุด" icon="sparkle" kind="accent"
                value={data.kpi.top_label || '—'}
                sub={`${money(data.kpi.top_revenue)} จากทั้งหมด ${moneyShort(data.kpi.revenue)}`}
              />
              <DrillKpi label="เคสทั้งหมด" icon="board" value={`${count(data.kpi.cases)} เคส`} />
              <DrillKpi
                label="ลูกค้าใหม่" icon="sparkle" kind="ok"
                value={`${count(data.kpi.new_customers)} คน`}
                sub={`จาก ${count(data.kpi.cases)} เคสในช่วงนี้`}
              />
              <DrillKpi
                label="ช่องทางที่ใช้อยู่" icon="trending"
                value={`${count(data.kpi.channels)} ช่องทาง`}
              />
              <DrillKpi
                label="ไม่ได้ถาม" icon="warning"
                kind={data.kpi.unasked > 0 ? 'warn' : ''}
                value={`${count(data.kpi.unasked)} เคส`}
                /* ยิ่งช่องนี้เยอะ ตัวเลขทั้งหน้ายิ่งเชื่อได้น้อยลง — ต้องบอกตรง ๆ
                   ไม่ใช่ปล่อยให้อ่านว่าข้อมูลครบ */
                sub={data.kpi.unasked
                  ? 'สัดส่วนข้างล่างจึงยังไม่ครบภาพ'
                  : 'ถามครบทุกเคส'}
              />
            </Kpis>

            <div className="report-split">
              <Card title="สัดส่วนยอดขายตามช่องทาง">
                <Donut
                  items={data.by_referral.map((r, i) => ({
                    label: r.label, value: r.revenue, color: seriesColor(i),
                  }))}
                  total={data.kpi.revenue}
                  totalLabel="ยอดขายรวม"
                />
              </Card>

              <Card
                title="จำนวนเคสที่แต่ละช่องทางพามา"
                right={<span className="muted">เรียงตามยอดขาย</span>}
              >
                <HBars
                  data={data.by_referral.map((r, i) => ({
                    label: r.label,
                    value: r.cases,
                    sub: `ลูกค้าใหม่ ${r.new_customers} คน · ปิดการขายได้ ${r.sold}`,
                    color: seriesColor(i),
                  }))}
                  format={(v) => `${count(v)} เคส`}
                />
              </Card>
            </div>

            <Card title="ตารางช่องทาง" tight>
              <DataTable
                columns={[
                  { label: 'ช่องทาง', sortKey: 'label', mobile: 'title', render: (r) => (
                    <span className="row" style={{ gap: 8 }}>
                      <i
                        className="sw"
                        style={{ background: seriesColor(data.by_referral.indexOf(r)) }}
                      />
                      {r.label}
                    </span>
                  ) },
                  { label: 'เคส', cls: 'right', sortKey: 'cases', render: (r) => count(r.cases), mobile: 'body' },
                  { label: 'ลูกค้า', cls: 'right', sortKey: 'customers', render: (r) => count(r.customers), mobile: 'body' },
                  { label: 'ลูกค้าใหม่', cls: 'right', sortKey: 'new_customers', render: (r) => count(r.new_customers), mobile: 'meta' },
                  { label: 'ยอดขาย', cls: 'right', sortKey: 'revenue', render: (r) => <b>{money(r.revenue)}</b>, mobile: 'body' },
                  { label: 'เฉลี่ย/เคส', cls: 'right', sortKey: 'avg', render: (r) => money(r.avg), mobile: 'meta' },
                  { label: 'ปิดการขาย', cls: 'right', sortKey: 'conversion', render: (r) => <Conv value={r.conversion} />, mobile: 'body' },
                ]}
                rows={data.by_referral}
                rowKey={(r) => r.label}
                sortable
                defaultSort={{ key: 'revenue', dir: 'desc' }}
                footer={(
                  <tr>
                    <th>รวม</th>
                    <th className="right">{count(data.kpi.cases)}</th>
                    <th className="right" />
                    <th className="right">{count(data.kpi.new_customers)}</th>
                    <th className="right">{money(data.kpi.revenue)}</th>
                    <th className="right" />
                    <th className="right" />
                  </tr>
                )}
              />
              {merged.length ? (
                <p className="muted sm" style={{ padding: '10px 16px' }}>
                  ในช่วงนี้มีเคสที่บันทึกด้วยรหัสรุ่นเก่า ({merged.join(', ')})
                  {' '}ถูกยุบเข้ากลุ่มปัจจุบันแล้ว เพื่อไม่ให้ช่องทางเดียวกันแยกเป็นสองแถว
                </p>
              ) : null}
            </Card>

            <div className="report-split">
              <Card title="ประเภทลูกค้า">
                <HBars
                  data={data.by_category.map((c, i) => ({
                    label: c.label,
                    value: c.revenue,
                    sub: `${c.cases} เคส`,
                    color: seriesColor(i + 2),
                  }))}
                />
                <p className="muted sm" style={{ marginTop: 12 }}>
                  Sight First คือคนไข้ที่ถูกส่งต่อมา ไม่ใช่ลูกค้าที่เดินเข้าร้านเอง
                  {' '}— คนละธุรกิจกัน จึงแยกดู
                </p>
              </Card>

              <Card title="ช่องทางที่ติดต่อเข้ามา (จากคิวจอง)">
                {data.by_booking.length ? (
                  <>
                    <HBars
                      data={data.by_booking.map((b, i) => ({
                        label: b.label,
                        value: b.bookings,
                        sub: `เปิดเป็นเคสได้ ${b.converted} จาก ${b.bookings}`,
                        color: seriesColor(i),
                      }))}
                      format={(v) => `${count(v)} คิว`}
                    />
                    <p className="muted sm" style={{ marginTop: 12 }}>
                      คนละคำถามกับตารางข้างบน — เห็นโฆษณาบน Facebook แล้วโทรมาจอง
                      {' '}คือรู้จักทาง FB แต่ติดต่อทางโทรศัพท์
                    </p>
                  </>
                ) : (
                  <p className="muted sm">ช่วงนี้ยังไม่มีคิวจอง</p>
                )}
              </Card>
            </div>
          </>
        ) : null}
      </ReportState>
    </>
  );
}
