'use client';
/**
 * การรับเงิน — รวมทั้งสองระบบ
 *
 * **หน้านี้เป็นหน้าเดียวที่นับด้วยวันที่รับเงิน ไม่ใช่วันที่เปิดบิล** ตัวเลขจึงไม่
 * เท่ากับ "ยอดขาย" ในหน้าอื่นของช่วงเดียวกัน และนั่นถูกแล้ว — มัดจำที่รับเดือนนี้
 * มาจากบิลของเดือนที่แล้วได้ · คำอธิบายอยู่บนหน้าจอด้วย ไม่ใช่แค่ในคอมเมนต์
 */
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { Badge, Card, Kpis } from '../../../../components/ui.jsx';
import { DataTable } from '../../../../components/DataTable.jsx';
import { Pager } from '../../../../components/Pager.jsx';
import { ExportButtons, ReportFilter, useReport } from '../../../../components/ReportFilter.jsx';
import { DrillKpi, NoData, ReportState, bucketNote, toSeries } from '../../../../components/reports/bits.jsx';
import { Bars, Donut, seriesColor } from '../../../../components/charts.jsx';
import { useToast } from '../../../../components/Toast.jsx';
import { count, fmtDateTime, money, moneyShort } from '../../../../lib/format.js';
import { api } from '../../../../lib/apiClient.js';
import { SOURCES, openHref } from '../../../../lib/paymentTx.js';
import { filterQuery } from '../../../../lib/reportRange.js';

/**
 * ป้ายไทยของช่องทางชำระ
 *
 * ค่าที่ไม่รู้จักได้ชื่อของตัวเองกลับไป ไม่ใช่ถูกยุบเป็น "อื่นๆ" — เงินที่อ่านไม่ออก
 * ว่ามาทางไหน ยังดีกว่าเงินที่หายเข้าไปในถังชื่อ "อื่นๆ" จนตามไม่ได้
 */
const METHOD_LABEL = {
  cash: 'เงินสด',
  transfer: 'BBL',
  qr: 'QR Payment',
  credit: 'บัตรเครดิต',
  thungngern: 'ถุงเงิน',
  unknown: 'ไม่ระบุช่องทาง',
};
const label = (m) => METHOD_LABEL[m] || m;

/** ตารางรายการรับเงินแบ่งหน้าชุดใหญ่กว่าทั้งแอป — ช่วงหนึ่งเดือนมีเป็นร้อยรายการ */
const TX_PAGE_SIZES = [25, 50, 100];

/** เลขอ้างอิง — กดเปิดเคส / ใบสั่ง / บิล POS · ขายสินค้าระบบเดิมไม่มีหน้าให้เปิด */
function TxRef({ row }) {
  const href = openHref(row.open);
  const code = row.code || '—';
  return (
    <>
      {href ? <Link href={href}>{code}</Link> : code}
      {row.legacy ? <Badge kind="gray" style={{ marginLeft: 6 }}>ระบบเดิม</Badge> : null}
    </>
  );
}

const TX_COLUMNS = [
  { label: 'วันที่/เวลา', sortKey: 'paid_at', render: (r) => fmtDateTime(r.paid_at), mobile: 'body' },
  { label: 'เลขอ้างอิง', sortKey: 'code', render: (r) => <TxRef row={r} />, mobile: 'title' },
  { label: 'แหล่งที่มา', sortKey: 'source_label', mobile: 'status', render: (r) => (
    <Badge kind={r.source === 'main' ? 'blue' : 'gray'}>{r.source_label}</Badge>
  ) },
  { label: 'ลูกค้า', key: 'customer', mobile: 'subtitle' },
  { label: 'รายการ/ประเภทงาน', sortKey: 'items', mobile: 'meta', render: (r) => (
    <>
      {r.items || <span className="muted">—</span>}
      {r.kind ? <div className="muted sm">{r.kind}</div> : null}
    </>
  ) },
  { label: 'ช่องทางชำระ', key: 'method', mobile: 'body' },
  { label: 'จำนวนเงิน', cls: 'right', sortKey: 'amount', render: (r) => money(r.amount), mobile: 'body' },
  { label: 'ผู้รับเงิน', key: 'employee', mobile: 'meta' },
];

/**
 * กำลังสั่งพิมพ์อยู่หรือเปล่า — ตอนพิมพ์ตารางต้องมีครบทุกแถว ไม่ใช่แค่หน้าที่เปิดอยู่
 *
 * `flushSync` เพราะเบราว์เซอร์จับภาพหน้าไปพิมพ์ทันทีที่ beforeprint คืนค่า · setState
 * ธรรมดาของ React รอ render รอบถัดไป ซึ่งช้าไปหนึ่งจังหวะ PDF จะได้แค่ 50 แถวแรก
 */
function usePrinting() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  return printing;
}

/**
 * ตารางพิมพ์ยาวหลายหน้า — การ์ดทั่วไปของรายงานห้ามตัดข้ามหน้า (globals.css) ซึ่งกับตาราง
 * ยาวแปลว่าหน้าว่างหนึ่งหน้าก่อนตาราง · วางไว้ในหน้านี้แทน globals.css เพราะใช้ที่นี่ที่เดียว
 */
const TX_PRINT_CSS = `@media print{
  .pay-tx{break-inside:auto}
  .pay-tx .table-wrap{overflow:visible}
  .pay-tx thead{display:table-header-group}
  .pay-tx tr{break-inside:avoid}
  .pay-tx a{color:inherit;text-decoration:none}
}`;

/**
 * รายละเอียดรายการรับเงิน — หนึ่งแถวต่อเงินหนึ่งก้อน ตอบว่ายอดบนการ์ดข้างบนมาจากไหน
 *
 * โหลดจากเส้นของตัวเอง (`payments/transactions`) ไม่ใช่ยัดรวมกับ Dashboard ช่วงหลายปี
 * มีเป็นหมื่นแถว Dashboard ไม่ควรต้องรอ · ยอดท้ายตารางมาจาก API ซึ่งคิดจากเงินชุด
 * เดียวกับ "รับเงินรวม" ไม่ใช่บวกแถวเองในเบราว์เซอร์
 */
function Transactions() {
  const { data, error, loading } = useReport('payments/transactions');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const printing = usePrinting();

  /* ตัวกรองเปลี่ยน (ได้ data ชุดใหม่) หรือเปลี่ยนจำนวนต่อหน้า กลับไปหน้า 1 */
  useEffect(() => { setPage(1); }, [data, perPage]);

  const rows = data?.rows || [];

  return (
    <Card
      title="รายละเอียดรายการรับเงิน"
      className="pay-tx"
      tight
      right={data ? <span className="muted">{`${count(data.count)} รายการ`}</span> : null}
    >
      <style>{TX_PRINT_CSS}</style>
      <ReportState loading={loading} error={error} data={data}>
        <DataTable
          columns={TX_COLUMNS}
          rows={rows}
          rowKey={(r) => r.key}
          sortable
          defaultSort={{ key: 'paid_at', dir: 'desc' }}
          page={printing ? 0 : page}
          perPage={printing ? 0 : perPage}
          empty="ช่วงนี้ยังไม่มีการรับเงิน"
          footer={data ? (
            <tr>
              <th colSpan={6}>{`รวม ${count(data.count)} รายการ`}</th>
              <th className="right">{money(data.total)}</th>
              <th />
            </tr>
          ) : null}
        />
        <div className="no-print">
          <Pager
            total={rows.length}
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={setPerPage}
            sizes={TX_PAGE_SIZES}
          />
        </div>
      </ReportState>
    </Card>
  );
}

export default function PaymentsReport() {
  const { filter, data, error, loading } = useReport('payments');
  const { err } = useToast();

  /**
   * ส่งออก Excel สองชีท — สรุป กับรายการรับเงินทีละครั้ง (หนึ่งแถวต่อเงินหนึ่งก้อน)
   *
   * ให้เซิร์ฟเวอร์สร้างไฟล์ เพราะรายการรับเงินทีละก้อนไม่ได้อยู่ในหน้านี้ หน้าจอได้มา
   * แค่ยอดสรุป · ส่งตัวกรองทั้งชุดที่อยู่ใน URL ไปตรง ๆ ไฟล์จึงเป็นชุดเดียวกับที่เห็น
   * ชื่อไฟล์ที่ส่งไปเป็นแค่ตัวสำรอง ปกติใช้ชื่อที่มากับหัว Content-Disposition
   */
  const excel = async () => {
    try {
      await api.download(
        `/api/reports/payments.xlsx?${filterQuery(filter)}`,
        `รายงานการรับเงิน ${filter.from} ถึง ${filter.to}.xlsx`,
      );
    } catch (e) {
      err(e);
    }
  };

  return (
    <>
      <ReportFilter
        actions={<ExportButtons onExcel={excel} disabled={!data?.count} />}
        channels={SOURCES}
        channelLabel="แหล่งที่มา"
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
                label="รับเงินรวม" icon="coins" kind="accent" value={money(data.total)}
                sub={`${count(data.count)} รายการ`}
              />
              <DrillKpi
                label="จากงานตัดแว่น" icon="glasses" value={money(data.by_channel.main)}
              />
              <DrillKpi label="จากหน้าร้าน" icon="bag" value={money(data.by_channel.pos)} />
              <DrillKpi
                label="บิลที่ผ่อนอยู่" icon="hourglass"
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

            <Transactions />
          </>
        ) : null}
      </ReportState>
    </>
  );
}
