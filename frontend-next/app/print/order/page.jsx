'use client';
/**
 * ใบสั่งซื้อสินค้า / INVOICE — A4 แนวตั้ง "แผ่นเดียว" เสมอ
 *
 * เรียกจากปุ่ม "ใบสั่ง" ของหน้าเคสและหน้าออเดอร์ ด้วย ?id=<order id>
 *
 * กระดาษหนึ่งแผ่นแบ่งครึ่งตามยาว แล้วฉีกตามเส้นประกลางแผ่น:
 *   ครึ่งบน = Customer Copy    ให้ลูกค้าถือกลับไป (ยอดเงิน + วันนัดรับ + ที่ติดต่อร้าน)
 *   ครึ่งล่าง = Internal Copy   อยู่กับงานในร้าน (ค่าสายตา + สเปกเลนส์ + ช่องให้ช่างกรอกมือ)
 *
 * กฎเหล็กของไฟล์นี้: **ห้ามมีหน้า 2**
 *   - .sheet สูง 297mm ตายตัว, .half สูงครึ่งละ 148.5mm ตายตัว
 *   - ทั้งสอง half มี overflow:hidden เป็นตาข่ายกันตก ข้อมูลยาวผิดปกติจะถูกตัด
 *     ไม่ใช่ดันให้เกิดหน้าใหม่
 *   - ห้ามใส่ page-break-* / break-*: page ที่ไหนก็ตามในไฟล์นี้
 *     ตรงกันข้าม เราสั่ง break-inside:avoid ให้มันอยู่ด้วยกัน
 *   - ตัวเลขทุกตัวเป็น mm ไม่ใช่ % หรือ vh — % ของความสูงตอนพิมพ์เชื่อไม่ได้
 *
 * CSS อยู่ในไฟล์นี้ ไม่ใช่ globals.css เพราะ @page ตั้งขนาดกระดาษให้ทั้งแอปไม่ได้
 * (เหมือน /print/prescription) กฎต้องมีผลเฉพาะตอนเปิดหน้านี้
 *
 * ที่มาของค่าแต่ละช่อง — คนละแหล่งกัน ห้ามรวมเป็นแหล่งเดียว:
 *   VA / SPH / CYL / AXIS / ADD   ใบ Final ของเคส (prescriptions.kind='final')
 *   PD                            ขั้น "วัด Center" (centerings.r_pd / l_pd)
 *   ราคา / เลนส์ / กรอบ / วันนัดรับ  ออเดอร์ (custom_orders)
 *   Deposit / PayType             ประวัติการรับเงินจริง (payments) ไม่ใช่ช่อง deposit
 *                                 ที่กรอกไว้ตอนเปิดออเดอร์ — เงินที่รับจริงคือความจริง
 */
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync } from '../../../lib/hooks.js';
import { Card, Loading } from '../../../components/ui.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { Icon } from '../../../components/Icon.jsx';
import { custName, fmtDate, money, power, rxNum } from '../../../lib/format.js';

const DASH = '—';

/* ที่ติดต่อของร้านที่พิมพ์ลงใบให้ลูกค้า — ยังไม่มีช่องเก็บในตาราง settings
   (มีแค่ shop_name / เวลาเปิด-ปิด) แก้ตรงนี้ที่เดียวเมื่อร้านย้ายหรือเปลี่ยนเบอร์ */
const SHOP = {
  tel: '+66 (032) 511-360, 081-643-9282',
  email: 'timeoptic.hh@gmail.com',
};

/* QR สองอันวางเป็นไฟล์ไว้ที่ frontend-next/public/ แล้วมันขึ้นเอง ไม่ต้องแก้โค้ด
   ยังไม่มีไฟล์ก็พิมพ์ได้ — ช่องจะเป็นกรอบเส้นประที่กว้างเท่าของจริง เลย์เอาต์ไม่ขยับ */
const QRS = [
  ['/qr-line.png', 'LINE'],
  ['/qr-location.png', 'LOCATION'],
];

/** ค่าสายตาหนึ่งข้าง — ลำดับนี้คือลำดับที่พิมพ์ออกมา */
const RX_ROWS = [
  ['VA', (rx, k) => rxNum(rx?.[`${k}_va`])],
  ['Sphere', (rx, k) => power(rx?.[`${k}_sphere`])],
  ['Cylinder', (rx, k) => power(rx?.[`${k}_cylinder`])],
  ['Axis', (rx, k) => rxNum(rx?.[`${k}_axis`])],
  ['Add', (rx, k) => power(rx?.[`${k}_add`])],
  /* PD มาจากขั้นวัด Center ไม่ใช่ใบสายตา — ใบเก่าบางใบกรอก r_pd ไว้เอง จึงถอยไปใช้ได้ */
  ['PD', (rx, k, ctr) => rxNum(ctr?.[`${k}_pd`] ?? rx?.[`${k}_pd`])],
];

const EYES = [['r', 'Right'], ['l', 'Left']];

const frameLabel = (o) => o?.frame_name
  || [o?.frame_brand, o?.frame_model].filter(Boolean).join(' ')
  || '';

/** ชนิดงาน — ออเดอร์เก่ากรอก lens_type ไว้ ใบใหม่อ่านจากดีไซน์ของเลนส์ที่เลือก */
const workType = (o) => o?.lens_type || o?.lens_design || '';

/**
 * วิธีชำระที่พิมพ์ลงใบ = วิธีของเงินก้อนล่าสุดที่รับจริง (ไม่นับรายการที่ยกเลิก)
 * ไม่ใช่ deposit_pay_type ที่เป็นแค่ค่าที่พิมพ์ไว้ตอนเปิดออเดอร์และไม่เคยอัปเดตอีก
 */
function payType(o, methodLabel) {
  const live = (o?.payment_rows || []).filter((p) => !p.cancelled_at);
  const m = live.length ? live[live.length - 1].method : o?.deposit_pay_type;
  return m ? (methodLabel[m] || m) : '';
}

/** ป้ายกำกับ + ค่า หนึ่งบรรทัด ค่าว่างพิมพ์เส้นประไว้ให้เขียนมือ */
function F({ k, v, fill = false }) {
  return (
    <div className="iv-f">
      <span className="iv-f-k">{k}</span>
      {v ? <span className="iv-f-v">{v}</span> : <span className={fill ? 'iv-f-blank' : 'iv-f-v iv-dim'}>{fill ? '' : DASH}</span>}
    </div>
  );
}

/** หัวใบ — ใช้ซ้ำทั้งครึ่งบนและครึ่งล่าง สองครึ่งต้องอ่านเป็นใบเดียวกัน */
function Head({ order, copy }) {
  return (
    <div className="iv-head">
      <div className="iv-brand">
        <div className="iv-brand-mark"><Icon name="glasses" /><b>TIME OPTIC</b></div>
        <small>{copy}</small>
      </div>
      <div className="iv-title">
        <b>ใบสั่งซื้อสินค้า</b>
        <span>INVOICE</span>
      </div>
      <div className="iv-ref">
        <span>{fmtDate(order.order_date) || DASH}</span>
        <b>{order.invoice_code || `#${order.id}`}</b>
      </div>
    </div>
  );
}

/** QR หนึ่งช่อง — ไม่มีไฟล์ก็ยังกินที่เท่าเดิม เลย์เอาต์จึงไม่ขยับตอนเอาไฟล์มาวาง */
function Qr({ src, label }) {
  const [bad, setBad] = useState(false);
  return (
    <div className={`iv-qr ${bad ? 'iv-qr-empty' : ''}`}>
      {bad ? <span>QR<br />{label}</span> : <img src={src} alt={`QR ${label}`} onError={() => setBad(true)} />}
    </div>
  );
}

function OrderSheet() {
  const id = useSearchParams().get('id');

  /* ปุ่มส่งมาแค่เลขออเดอร์ แต่ PD อยู่ที่ขั้นวัด Center ของเคส และใบ Final ที่เป็น
     ปัจจุบันก็อยู่ที่เคส — อ่านออเดอร์ก่อนเพื่อรู้ case_id แล้วค่อยอ่านเคสทีเดียวได้ครบ */
  const { data, loading, error } = useAsync(async () => {
    if (!id) throw new Error('ไม่ได้ระบุเลขออเดอร์');
    const o = await api.get(`/api/orders/${id}`);
    const [c, settings] = await Promise.all([
      o.case_id ? api.get(`/api/cases/${o.case_id}`) : null,
      api.get('/api/settings').catch(() => ({})),
    ]);
    return { o, c, settings };
  }, [id]);

  const { data: meta } = useAsync(() => api.get('/api/meta'), []);

  if (loading) return <Loading text="กำลังเตรียมใบสั่งซื้อ…" />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  const { o, c, settings } = data;
  const ctr = c?.centering || null;
  /* ใบ Final ของเคสคือตัวปัจจุบันเสมอ ส่วน o.prescription คือใบที่ผูกไว้ตอนเปิดออเดอร์
     ใบที่ผูกไว้มาก่อน ถ้าไม่มีค่อยไปหยิบใบ final ล่าสุดของเคส */
  const rx = o.prescription
    || (c?.prescriptions || []).find((r) => r.kind === 'final')
    || null;

  const name = custName(o);
  const net = Number(o.total_price || 0) - Number(o.discount || 0);
  const paid = Number(o.paid || 0);
  const remain = Number(o.balance || 0);
  const appt = o.appointment_date ? fmtDate(o.appointment_date) : '';
  const methodLabel = meta?.lists?.pay_type_labels || {};
  const hours = settings?.shop_open_time && settings?.shop_close_time
    ? `${settings.shop_open_time} – ${settings.shop_close_time} น.`
    : '';

  /* บล็อกเงิน — ชุดเดียวกันทั้งครึ่งบนและครึ่งล่าง ลูกค้ากับช่างต้องเห็นเลขเดียวกัน */
  const moneyRows = [
    ['Price', money(net)],
    ['Deposit', money(paid)],
    ['Remain', money(remain)],
    ['PayType', payType(o, methodLabel)],
    ['Appointment', appt],
  ];

  return (
    <>
      <style>{sheetCss}</style>

      <div className="iv-sheet-actions no-print">
        <button type="button" className="btn" onClick={() => window.print()}>
          <Icon name="printer" /> พิมพ์ใบสั่งซื้อ (A4 หน้าเดียว)
        </button>
        {c?.id ? (
          <Link className="btn btn-light" href={`/cases/detail?id=${c.id}`}>
            <Icon name="board" /> กลับไปที่เคส
          </Link>
        ) : null}
        <Link className="btn btn-light" href={`/orders/detail?id=${o.id}`}>
          <Icon name="glasses" /> เปิดออเดอร์
        </Link>
      </div>

      <div className="iv-sheet-hint no-print">
        <b>ตั้งค่าในกล่องพิมพ์ให้ครบ 3 อย่าง</b>
        <ol>
          <li>ขนาดกระดาษ = <b>A4</b> · แนว <b>ตั้ง (Portrait)</b></li>
          <li>ระยะขอบ / Margins = <b>ไม่มี (None)</b> — ใบเผื่อขอบในตัวแล้ว</li>
          <li>เอาติ๊ก <b>หัวกระดาษและท้ายกระดาษ</b> ออก และมาตราส่วน (Scale) ต้องเป็น <b>100%</b></li>
        </ol>
        <p>
          Print Preview ต้องขึ้น <b>1 หน้า</b> และเห็นครบทั้งสองครึ่ง — ถ้าขึ้น 2 หน้า
          แปลว่ามาตราส่วนไม่ใช่ 100% หรือระยะขอบไม่ใช่ None
        </p>
        <p className="iv-qr-note">
          ช่อง QR: วางไฟล์ <b>qr-line.png</b> และ <b>qr-location.png</b> ไว้ที่
          <b> frontend-next/public/</b> แล้วรูปจะขึ้นเอง — ยังไม่มีไฟล์ก็พิมพ์ได้ ช่องจะเป็นกรอบเปล่า
        </p>
      </div>

      <div className="iv-sheet">
        {/* ═══ ครึ่งบน — Customer Copy ═══ */}
        <section className="iv-half iv-top">
          <Head order={o} copy="Customer Copy / สำหรับลูกค้า" />

          <div className="iv-cust-body">
            <div className="iv-col">
              <F k="Name" v={name} />
              <F k="Type" v={workType(o)} />
              <F k="Frame" v={frameLabel(o)} />
              <F k="Lens" v={o.lens_name} />
            </div>
            <div className="iv-col iv-money">
              {moneyRows.map(([k, v]) => <F key={k} k={k} v={v} />)}
            </div>
          </div>

          <div className="iv-shop">
            <div className="iv-shop-info">
              <div><Icon name="phone" /> <b>Tel.</b> {SHOP.tel}</div>
              <div><b>E-mail:</b> {SHOP.email}</div>
              <div>
                <b>เวลาเปิดร้าน / Opening Hours</b>
                {hours ? <> {hours}</> : null}
              </div>
            </div>
            <div className="iv-qrs">
              {QRS.map(([src, label]) => <Qr key={label} src={src} label={label} />)}
            </div>
          </div>
        </section>

        {/* เส้นฉีก — ไม่ใช่ page break ทั้งสองครึ่งอยู่บนกระดาษแผ่นเดียวกัน */}
        <div className="iv-cut" aria-hidden="true"><span>ฉีกตามรอยนี้</span></div>

        {/* ═══ ครึ่งล่าง — Internal / Production Copy ═══ */}
        <section className="iv-half iv-bottom">
          <Head order={o} copy="Internal Copy / สำหรับร้าน" />

          <div className="iv-job">
            <div className="iv-job-no">{o.id}</div>
            <div className="iv-job-appt">
              <span>Appointment</span>
              <b className="iv-box">{appt || ''}</b>
            </div>
            <div className="iv-job-code">{o.case_code || ''}</div>
          </div>

          <div className="iv-who">
            <F k="Customer" v={name} />
            <F k="Phone no." v={o.phone} />
            <F k="Craftsman" fill />
          </div>

          {/* ค่าสายตา — สองข้างวางคู่กัน ช่างอ่านทีเดียวเห็นทั้งคู่ ไม่ต้องไล่แถว */}
          <div className="iv-rx">
            {EYES.map(([k, label]) => (
              <div className="iv-rx-eye" key={k}>
                <div className="iv-rx-title">{label}</div>
                {RX_ROWS.map(([rowLabel, read]) => (
                  <div className="iv-rx-row" key={rowLabel}>
                    <span className="iv-rx-k">{rowLabel}</span>
                    <span className="iv-rx-v">{read(rx, k, ctr)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="iv-spec">
            <div className="iv-col">
              <F k="Type" v={workType(o)} />
              <F k="LensName" v={o.lens_name} />
              <F k="FrameName" v={frameLabel(o)} />
              <F k="RightLen" v={o.lens_r_name} />
              <F k="LeftLen" v={o.lens_l_name} />
              <F k="Frame" v={[o.frame_color, o.frame_size, o.frame_sku].filter(Boolean).join(' · ')} />
            </div>
            <div className="iv-col iv-money">
              {moneyRows.map(([k, v]) => <F key={k} k={k} v={v} />)}
              <F k="Employee" v={o.employee_name} />
            </div>
          </div>

          {/* ช่องที่ช่างเขียนมือตอนสั่งของ — ระบบไม่มีค่าให้ ตั้งใจเว้นเป็นเส้น */}
          <div className="iv-hand">
            <F k="Lens Name for Order" fill />
            <F k="Frame Type" fill />
            <F k="Number Order" fill />
          </div>

          <div className="iv-marks">
            <div className="iv-mark">
              <span className="iv-f-k">PD</span>
              <span className="iv-dots">{[0, 1, 2, 3, 4].map((i) => <i key={i} />)}</span>
            </div>
            <div className="iv-mark">
              <span className="iv-f-k">FH</span>
              <span className="iv-opts">{['A', 'B', 'ED', 'DBL'].map((t) => <b key={t}>{t}</b>)}</span>
            </div>
          </div>

          <div className="iv-note">
            <span>หมายเหตุ / รายละเอียดสำหรับสั่งงาน</span>
          </div>
        </section>
      </div>
    </>
  );
}

export default function PrintOrderPage() {
  return <QueryParamPage><OrderSheet /></QueryParamPage>;
}

/* งบความสูง A4 = 297mm พอดี ห้ามเกินแม้ 1mm ไม่งั้นได้หน้า 2
     --half-top + --half-bottom ต้องรวมได้ 297 เสมอ

   ไม่ได้แบ่งครึ่งเท่ากันแล้ว: ครึ่งบน (สำเนาลูกค้า) มีไม่กี่บรรทัด เหลือที่ว่างเป็นแถบใหญ่
   ส่วนครึ่งล่าง (ใบสั่งงานช่าง) อัดจนตัวหนังสือต้องเล็กกว่าที่ควร — ย้ายเส้นฉีกลงมา
   คืนที่ให้ครึ่งล่าง 44.5mm แล้วขยายตัวหนังสือ/ระยะบรรทัดของครึ่งล่างตาม
   ทั้งสอง half เป็น flex column + overflow:hidden — ข้อมูลยาวผิดปกติจะถูกตัด
   ไม่ใช่ดันกระดาษให้ยาวออกไป */
const sheetCss = `
.iv-sheet{
  --ink:#000; --line:#000; --soft:#666;
  --half-top:104mm; --half-bottom:193mm;   /* 104 + 193 = 297 */
  box-sizing:border-box;
  width:210mm; height:297mm; margin:0 auto;
  background:#fff; color:var(--ink);
  display:flex; flex-direction:column;
  font-family:"Sarabun","Noto Sans Thai",system-ui,-apple-system,"Segoe UI",sans-serif;
  font-variant-numeric:tabular-nums;
  break-inside:avoid;
}
.iv-sheet *{box-sizing:border-box}

.iv-half{
  padding:7mm 9mm; overflow:hidden;
  display:flex; flex-direction:column; break-inside:avoid;
}
.iv-half.iv-top{height:var(--half-top);font-size:9pt;line-height:1.5}
.iv-half.iv-bottom{height:var(--half-bottom);font-size:8pt;line-height:1.4;
  padding-top:5mm;padding-bottom:5mm}

/* ---- หัวใบ ---- */
.iv-head{display:flex;align-items:flex-start;justify-content:space-between;gap:6mm;
  padding-bottom:2mm;border-bottom:0.4mm solid var(--line)}
.iv-head .iv-brand{display:flex;flex-direction:column;align-items:flex-start;gap:0;min-width:34mm}
.iv-head .iv-brand-mark{display:flex;align-items:center;gap:1.6mm}
.iv-head .iv-brand .ico{width:6mm;height:6mm;margin:0;flex:0 0 auto}
.iv-half.iv-bottom .iv-head .iv-brand .ico{width:4.8mm;height:4.8mm}
.iv-head .iv-brand b{font-size:11pt;letter-spacing:1.2px;line-height:1.1}
.iv-half.iv-bottom .iv-head .iv-brand b{font-size:9pt}
.iv-head .iv-brand small{font-size:6.5pt;color:var(--soft);letter-spacing:.3px}
.iv-head .iv-title{text-align:center;flex:1 1 auto}
.iv-head .iv-title b{display:block;font-size:13pt;line-height:1.2}
.iv-half.iv-bottom .iv-head .iv-title b{font-size:10.5pt}
.iv-head .iv-title span{font-size:8pt;letter-spacing:3px;color:var(--soft)}
.iv-head .iv-ref{text-align:right;min-width:34mm;display:flex;flex-direction:column}
.iv-head .iv-ref span{font-size:8pt}
.iv-head .iv-ref b{font-size:9.5pt;letter-spacing:.5px}

/* ---- แถวป้าย: ค่า ---- */
.iv-f{display:flex;gap:2mm;align-items:baseline;min-width:0;padding:0.6mm 0}
.iv-half.iv-bottom .iv-f{padding:0.5mm 0}
.iv-f-k{flex:0 0 24mm;font-weight:700;color:var(--soft);white-space:nowrap}
.iv-half.iv-bottom .iv-f-k{flex:0 0 21mm}
.iv-f-v{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.iv-f-v.iv-dim{color:#aaa;font-weight:400}
/* ค่าว่างที่ "ตั้งใจให้เขียนมือ" — เส้นจริง ไม่ใช่ขีดกลาง */
.iv-f-blank{flex:1 1 auto;border-bottom:0.25mm dotted #444;height:3.4mm}
.iv-col.iv-money .iv-f-k{flex:0 0 22mm}
.iv-col.iv-money .iv-f-v{text-align:right;font-weight:700}

/* ---- ครึ่งบน ---- */
.iv-cust-body{flex:1 1 auto;display:grid;grid-template-columns:1fr 1fr;
  column-gap:10mm;align-content:center;padding:4mm 0}
.iv-cust-body .iv-col{display:flex;flex-direction:column;gap:2.6mm;min-width:0}

.iv-shop{display:flex;align-items:flex-end;justify-content:space-between;gap:6mm;
  padding-top:2.5mm;border-top:0.4mm solid var(--line)}
.iv-shop-info{font-size:8pt;line-height:1.6;min-width:0}
.iv-shop-info .ico{width:3.5mm;height:3.5mm;vertical-align:-0.5mm}
.iv-qrs{display:flex;gap:3mm;flex:0 0 auto}
.iv-qr{width:18mm;height:18mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
.iv-qr img{width:100%;height:100%;object-fit:contain}
.iv-qr-empty{border:0.3mm dashed #999;color:#999;font-size:6pt;text-align:center;line-height:1.3}

/* ---- เส้นฉีกกลางแผ่น (ไม่ใช่ page break) ---- */
.iv-cut{position:relative;height:0;border-top:0.3mm dashed #999}
.iv-cut span{position:absolute;right:9mm;top:-2.6mm;background:#fff;padding:0 2mm;
  font-size:6pt;color:#999;letter-spacing:.5px}

/* ---- ครึ่งล่าง ---- */
.iv-job{display:flex;align-items:center;gap:6mm;padding:2.5mm 0 2mm}
.iv-job-no{font-size:14pt;font-weight:800;letter-spacing:1px;min-width:20mm}
.iv-job-appt{display:flex;align-items:center;gap:2mm}
.iv-job-appt span{font-weight:700;color:var(--soft)}
.iv-job-appt .iv-box{display:inline-block;min-width:32mm;padding:0.8mm 2mm;
  border:0.3mm solid var(--line);text-align:center;font-size:8.5pt}
.iv-job-code{margin-left:auto;font-size:8pt;letter-spacing:.5px;color:var(--soft)}

.iv-who{display:grid;grid-template-columns:1.4fr 1fr 1fr;column-gap:6mm;
  padding:2mm 0;border-top:0.25mm solid #bbb;border-bottom:0.25mm solid #bbb}
.iv-who .iv-f-k{flex:0 0 16mm}

/* ค่าสายตา: สองข้างกว้างเท่ากันเป๊ะ ตัวเลขอยู่ในกรอบ อ่านทีละแถวข้ามข้างได้ */
.iv-rx{display:grid;grid-template-columns:1fr 1fr;column-gap:8mm;padding:2mm 0}
.iv-rx-eye{display:flex;flex-direction:column;gap:1mm}
.iv-rx-title{text-align:center;font-weight:800;font-size:9pt;letter-spacing:1px;
  border-bottom:0.3mm solid var(--line);padding-bottom:1mm;margin-bottom:1mm}
.iv-rx-row{display:flex;align-items:center;gap:2mm}
.iv-rx-k{flex:0 0 15mm;font-weight:700;color:var(--soft)}
.iv-rx-v{flex:1 1 auto;border:0.25mm solid var(--line);padding:0.9mm 2mm;
  text-align:center;font-size:8.5pt;font-weight:700;line-height:1.35}

.iv-spec{display:grid;grid-template-columns:1.35fr 1fr;column-gap:8mm;
  padding:1.8mm 0;border-top:0.25mm solid #bbb}
.iv-spec .iv-col{display:flex;flex-direction:column;min-width:0}

.iv-hand{display:flex;flex-direction:column;gap:1mm;padding:1.8mm 0;
  border-top:0.25mm solid #bbb}
.iv-hand .iv-f-k{flex:0 0 34mm}
.iv-hand .iv-f-blank{height:4mm}

.iv-marks{display:flex;gap:12mm;padding:1.8mm 0}
.iv-mark{display:flex;align-items:center;gap:3mm}
.iv-mark .iv-f-k{flex:0 0 auto}
.iv-dots{display:flex;gap:3mm}
.iv-dots i{width:3.2mm;height:3.2mm;border:0.3mm solid var(--line);border-radius:50%}
.iv-opts{display:flex;gap:0}
.iv-opts b{padding:0 2.5mm;border-right:0.25mm solid var(--line);font-weight:700}
.iv-opts b:last-child{border-right:0}

.iv-note{flex:1 1 auto;min-height:13mm;border:0.3mm solid var(--line);
  padding:2mm 2.5mm;color:var(--soft);font-size:7.5pt}

/* ---- เปลือกหน้าจอ (ไม่ติดไปกับกระดาษ) ---- */
.iv-sheet-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.iv-sheet-hint{max-width:210mm;margin:0 auto 12px;padding:10px 14px;font-size:13px;line-height:1.6;
  border:1px solid #e3c98a;border-radius:8px;background:#fdf7e6;color:#5b4a1d}
.iv-sheet-hint ol{margin:6px 0 0;padding-left:20px}
.iv-sheet-hint p{margin:8px 0 0}
.iv-sheet-hint .iv-qr-note{padding-top:8px;border-top:1px dashed #e3c98a;color:#6b5a2d}

@media screen{
  .iv-sheet{border:1px solid #c9d6d5;box-shadow:0 2px 14px rgba(0,0,0,.1);border-radius:4px}
}

/* @page อยู่นอก @media print โดยตั้งใจ (เหมือน /print/prescription) — margin:0
   คือสิ่งที่สั่งให้เบราว์เซอร์เลิกพิมพ์หัว/ท้ายกระดาษไปด้วย */
@page{size:A4 portrait;margin:0}

@media print{
  html,body{margin:0!important;padding:0!important;background:#fff}
  /* เหลือเฉพาะกระดาษ — sidebar / topbar / ปุ่ม / กล่องคำแนะนำ ไม่ติดไปด้วย */
  .sidebar,.sidebar-overlay,.topbar,.page-head,.no-print,.toasts,.scrim{display:none!important}
  .app,.main,.content{display:block!important;margin:0!important;padding:0!important;
    max-width:none!important;width:auto!important;min-height:0!important}
  .iv-sheet{margin:0;border:0;box-shadow:none;border-radius:0}
  /* พิมพ์เส้นกรอบและพื้นให้ครบตามที่เห็นบนจอ ไม่ใช่ถูกเบราว์เซอร์ตัดทิ้งเพื่อประหยัดหมึก */
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;
