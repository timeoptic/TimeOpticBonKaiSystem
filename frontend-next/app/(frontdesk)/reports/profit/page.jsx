'use client';
/**
 * รายงานกำไร
 *
 * ฝั่งงานตัดแว่นได้ตัวเลขจริงจากต้นทุนล็อตในคลัง · ฝั่ง POS **บอกตรง ๆ ว่าไม่มี
 * ข้อมูลต้นทุน** ไม่ใช่แสดง 0 ซึ่งจะอ่านว่ากำไรเท่ากับยอดขายทั้งก้อน แล้วเจ้าของ
 * ร้านเอาไปตัดสินใจผิด · ช่องต้นทุนที่ว่างพร้อมคำอธิบาย มีประโยชน์กว่าเลขที่แต่งขึ้น
 */
import { Card, Kpis } from '../../../../components/ui.jsx';
import { ExportButtons, ReportFilter, useReport } from '../../../../components/ReportFilter.jsx';
import {
  DrillKpi, NoData, ReportState, bucketNote, toStacked,
} from '../../../../components/reports/bits.jsx';
import { StackedBars, seriesColor } from '../../../../components/charts.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { count, money, moneyShort } from '../../../../lib/format.js';
import { downloadCsv } from '../../../../lib/exportCsv.js';

const COST_COLOR = seriesColor(1);   // ส้ม — ต้นทุน
const PROFIT_COLOR = seriesColor(2); // เขียวอมฟ้า — กำไร

export default function ProfitReport() {
  const { filter, data, error, loading } = useReport('profit');

  const csv = () => downloadCsv(
    `รายงานกำไร ${filter.from} ถึง ${filter.to}`,
    [
      { label: 'วันที่', value: (r) => r.date },
      { label: 'ต้นทุน', value: (r) => r.cost },
      { label: 'กำไร', value: (r) => r.profit },
      { label: 'ยอดขาย', value: (r) => r.cost + r.profit },
    ],
    data?.daily || [],
  );

  const m = data?.main;

  return (
    <>
      <ReportFilter actions={<ExportButtons onExcel={csv} disabled={!data?.daily?.length} />} />

      <ReportState loading={loading} error={error} data={data}>
        {data && !m.bills && !data.pos.bills
          ? <NoData bounds={data.bounds} channel={filter.channel} />
          : null}
        {data && (m.bills || data.pos.bills) ? (
          <>
            <Kpis>
              <DrillKpi
                label="ยอดขายรวม" icon="coins" value={money(m.revenue + data.pos.revenue)}
                sub={`งานตัดแว่น ${moneyShort(m.revenue)} · หน้าร้าน ${moneyShort(data.pos.revenue)}`}
              />
              <DrillKpi
                label="ต้นทุนที่บันทึกไว้" icon="box"
                value={money(m.frame_cost + m.lens_cost)}
                sub="กรอบ + เลนส์ จากราคาทุนของล็อต"
              />
              <DrillKpi
                label="กำไรขั้นต้น" icon="trending" kind="ok"
                value={m.has_cost ? money(m.profit) : '—'}
                sub={m.has_cost ? `เฉพาะงานตัดแว่น ${m.costed} เคส` : 'ยังไม่มีเคสที่มีต้นทุน'}
              />
              <DrillKpi
                label="อัตรากำไร" icon="target" kind="accent"
                value={m.margin === null ? '—' : `${m.margin}%`}
                /* อัตรากำไรหารด้วยยอดขายของเคสที่รู้ต้นทุน ไม่ใช่ยอดขายทั้งช่วง —
                   ไม่งั้นเอากำไรของ 17 เคส ไปหารยอดขายของ 20 เคส */
                sub={`คิดจากยอดขาย ${moneyShort(m.costed_revenue)} ที่รู้ต้นทุน`}
              />
            </Kpis>

            <div className="report-split">
              <Card title="งานตัดแว่น (Main Process)">
                <table className="grid pl-table">
                  <tbody>
                    <tr>
                      <td>ยอดขาย</td>
                      <td className="right strong">{money(m.revenue)}</td>
                    </tr>
                    <tr>
                      <td>ต้นทุนกรอบ</td>
                      <td className="right">− {money(m.frame_cost)}</td>
                    </tr>
                    <tr>
                      <td>ต้นทุนเลนส์</td>
                      <td className="right">− {money(m.lens_cost)}</td>
                    </tr>
                    <tr>
                      <td>
                        ต้นทุนอื่น ๆ
                        <div className="muted sm">
                          ค่าประกอบ ค่าส่ง ค่าแรง — ระบบยังไม่มีที่เก็บต่อเคส
                        </div>
                      </td>
                      <td className="right muted">− {money(0)}</td>
                    </tr>
                    <tr className="pl-total">
                      <td>กำไรขั้นต้น</td>
                      <td className="right">{m.has_cost ? money(m.profit) : '—'}</td>
                    </tr>
                  </tbody>
                </table>
                {m.uncosted ? (
                  <p className="muted sm" style={{ marginTop: 10 }}>
                    <Icon name="warning" /> {count(m.uncosted)} เคสจาก {count(m.bills)} เคส
                    ยังไม่ได้เลือกกรอบหรือเลนส์จากคลัง จึงยังไม่มีต้นทุน —
                    ยอดขายของเคสเหล่านั้นรวมอยู่ในบรรทัดแรก แต่ไม่ถูกนำไปคิดกำไร
                  </p>
                ) : null}
              </Card>

              <Card title="ขายหน้าร้าน (POS)">
                <table className="grid pl-table">
                  <tbody>
                    <tr>
                      <td>ยอดขาย</td>
                      <td className="right strong">{money(data.pos.revenue)}</td>
                    </tr>
                    <tr>
                      <td>จำนวนบิล</td>
                      <td className="right">{count(data.pos.bills)} ใบ</td>
                    </tr>
                    <tr>
                      <td>ต้นทุนสินค้า</td>
                      <td className="right muted">ไม่มีข้อมูล</td>
                    </tr>
                    <tr className="pl-total pl-muted">
                      <td>กำไร</td>
                      <td className="right">—</td>
                    </tr>
                  </tbody>
                </table>
                <div className="report-note tight" style={{ marginTop: 12 }}>
                  <b>ทำไมช่องนี้ว่าง</b> — ตาราง <code>pos_sale_items</code> เก็บเฉพาะ
                  ราคาขาย ไม่มีคอลัมน์ต้นทุน และสินค้า Custom ที่พนักงานพิมพ์ชื่อเอง
                  ก็ไม่มีแถวในคลังให้อ้างอิงอยู่แล้ว · จะได้กำไรฝั่งนี้ต้องเพิ่มการ
                  บันทึกต้นทุนตอนขายก่อน
                </div>
              </Card>
            </div>

            <Card
              title={`ต้นทุนและกำไร${bucketNote(data.daily) || ''}`}
              right={<span className="muted">เฉพาะงานตัดแว่นที่มีต้นทุน</span>}
            >
              <StackedBars
                data={toStacked(data.daily, (d) => [d.cost, d.profit])}
                series={[
                  { label: 'ต้นทุน', color: COST_COLOR },
                  { label: 'กำไร', color: PROFIT_COLOR },
                ]}
              />
            </Card>
          </>
        ) : null}
      </ReportState>
    </>
  );
}
