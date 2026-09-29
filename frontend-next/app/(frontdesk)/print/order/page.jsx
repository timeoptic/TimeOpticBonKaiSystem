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
 *   TestFor                       ใบเดียวกัน ช่อง "ใช้สำหรับ" (prescriptions.test_for = TestFor ของระบบเดิม)
 *                                 แทนช่อง Type ที่เคยอ่านชนิดเลนส์ของออเดอร์ (ร้านขอ 14 ก.ย. 2026)
 *   PD                            ขั้น "วัด Center" (centerings.r_pd / l_pd)
 *   ราคา / เลนส์ / กรอบ / วันนัดรับ  ออเดอร์ (custom_orders)
 *   Deposit / PayType             ประวัติการรับเงินจริง (payments) ไม่ใช่ช่อง deposit
 *                                 ที่กรอกไว้ตอนเปิดออเดอร์ — เงินที่รับจริงคือความจริง
 */
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/apiClient.js';
import { useAsync } from '../../../../lib/hooks.js';
import { Card, Loading } from '../../../../components/ui.jsx';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { PaperView } from '../../../../components/PaperView.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import {
  addPower, custName, cylPower, dominantEyeLabel, fmtDate, glassesUseOf, money, rxNum, sphPower,
} from '../../../../lib/format.js';
import { measureCells } from '../../../../lib/orderMeasures.js';

const DASH = '—';

/* ชื่อวันบนใบเป็นภาษาอังกฤษเสมอ ไม่ผูกกับภาษาของเครื่องที่สั่งพิมพ์
   (toLocaleDateString ให้ผลต่างกันได้ถ้า ICU ของเบราว์เซอร์ไม่ครบ) */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** วันนัดบนใบ — เติมชื่อวันหน้าวันที่ เช่น "Sunday, 31/08/2026" */
function fmtApptDate(v) {
  const date = fmtDate(v);
  if (!date) return '';
  const d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d) ? date : `${WEEKDAYS[d.getDay()]}, ${date}`;
}

/** เวลาเปิด-ปิดร้านบนใบ — ค่าในฐานเก็บเป็น 24 ชม. (`09:30`) ใบพิมพ์แสดงแบบอังกฤษ 12 ชม. */
function to12h(t) {
  const [h, m] = String(t || '').split(':');
  const hh = Number(h);
  if (!Number.isFinite(hh) || m === undefined) return String(t || '');
  const suffix = hh < 12 ? 'AM' : 'PM';
  return `${String(hh % 12 || 12).padStart(2, '0')}:${m} ${suffix}`;
}

/* เลขบนหัวใบคือ "รหัสเคสเต็ม" ตามที่เก็บในฐาน — ใบเก่าที่ย้ายมาจาก Access เป็น OLD-010299
   ใบที่เปิดในระบบใหม่เป็น CASE-2026-00001 ต้องพิมพ์ให้ครบทั้งคำนำหน้าและปี ไม่ใช่ตัดเหลือแต่เลข
   เพราะเลขเปล่าของสองชุดนี้ชนกันได้ และรหัสที่พิมพ์ต้องค้นในระบบเจอตรงตัว
   ออเดอร์ที่ไม่ได้ผูกเคส (มีอยู่ไม่กี่ใบ) ตกกลับไปใช้เลขออเดอร์เติมศูนย์ 5 หลัก
   จะได้ไม่มีใบไหนไม่มีเลข */
const caseNo = (o) =>
  String(o?.case_code || '').trim() || String(o?.id ?? '').padStart(5, '0');

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
  ['Sphere', (rx, k) => sphPower(rx?.[`${k}_sphere`])],
  ['Cylinder', (rx, k) => cylPower(rx?.[`${k}_cylinder`])],
  ['Axis', (rx, k) => rxNum(rx?.[`${k}_axis`])],
  ['Add', (rx, k) => addPower(rx?.[`${k}_add`])],
  /* PD มาจากขั้นวัด Center ไม่ใช่ใบสายตา — ใบเก่าบางใบกรอก r_pd ไว้เอง จึงถอยไปใช้ได้ */
  ['PD', (rx, k, ctr) => rxNum(ctr?.[`${k}_pd`] ?? rx?.[`${k}_pd`])],
];

const EYES = [['r', 'Right'], ['l', 'Left']];

/* ป้ายตาหลัก/ตารอง ต่อท้ายหัว Right / Left — มาจากช่องเดียวบนใบ Final ไม่ใช่ค่าต่อตา
   ตัวตัดสินอยู่ที่ lib/format.js เพราะติดผิดข้างแล้วเลนส์ออกมาผิด ต้องมีเทสต์คุม */
const dominantTag = (rx, k) => dominantEyeLabel(rx?.dominant_eye, k);

/** ขั้นตอนงานหลังบ้าน — ช่างติ๊ก/เซ็นกำกับทีละช่องตามที่งานเดินไป */
const STAGES = ['สั่งเลนส์', 'เจียร์เลนส์', 'QC', 'เก็บแว่น'];

/**
 * ช่องวัดที่ช่างกรอกมือ — PD/FH มาจากการวัดบนหน้าลูกค้า ส่วน A/B/ED/DBL เป็นขนาดกรอบ
 * fig = รูปกำกับหัวตาราง (ดู FrameFig) ช่องที่ไม่มีรูปเว้นที่ไว้เท่ากันเพื่อให้หัวตารางตรงแนว
 */
const MEASURES = [
  ['PD', null],
  ['FH', null],
  ['A', 'a'],
  ['B', 'b'],
  ['ED', 'ed'],
  ['DBL', 'dbl'],
];

/**
 * รูปกำกับค่าขนาดกรอบ วาดเป็น SVG ในไฟล์เลยเพื่อไม่ต้องพึ่งไฟล์รูปตอนพิมพ์
 *   a   ความกว้างกรอบเลนส์ (เส้นวัดพาดด้านบน)
 *   b   ความสูงกรอบเลนส์ (เส้นวัดตั้งด้านข้าง)
 *   ed  เส้นผ่านศูนย์กลางยาวสุดของเลนส์ (เส้นทแยงผ่านกลาง)
 *   dbl ระยะระหว่างเลนส์สองข้าง (ลูกศรตรงสะพานแว่น)
 */
function FrameFig({ kind }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' };
  if (kind === 'a') return (
    <svg className="iv-fig" viewBox="0 0 26 22" aria-hidden="true">
      <ellipse cx="13" cy="14" rx="12" ry="6.5" {...p} />
      <path d="M1 4h24M1 2v4M25 2v4" {...p} />
    </svg>
  );
  if (kind === 'b') return (
    <svg className="iv-fig" viewBox="0 0 30 22" aria-hidden="true">
      <ellipse cx="12" cy="11" rx="11" ry="6.5" {...p} />
      <path d="M27 4.5v13M25 4.5h4M25 17.5h4" {...p} />
    </svg>
  );
  if (kind === 'ed') return (
    <svg className="iv-fig" viewBox="0 0 26 22" aria-hidden="true">
      <ellipse cx="13" cy="11" rx="12" ry="6.5" {...p} />
      <path d="M3 15.5L23 6.5M3 13.2v2.6M23 6.5h-2.6" {...p} />
    </svg>
  );
  return (
    <svg className="iv-fig" viewBox="0 0 48 22" aria-hidden="true">
      <ellipse cx="11" cy="11" rx="10" ry="6.5" {...p} />
      <ellipse cx="37" cy="11" rx="10" ry="6.5" {...p} />
      <path d="M21 11h6M22.6 9.2 21 11l1.6 1.8M25.4 9.2 27 11l-1.6 1.8" {...p} />
    </svg>
  );
}

const frameLabel = (o) => o?.frame_name
  || [o?.frame_brand, o?.frame_model].filter(Boolean).join(' ')
  || '';

/**
 * เลนส์บนสำเนาลูกค้า — เอาแค่สี่อย่างที่ลูกค้าใช้เทียบของได้: ยี่ห้อ รุ่น โค้ตติ้ง ดัชนีหักเห
 *
 * ไม่ใช้ lens_name เพราะมันคือชื่อยาวที่มีค่าสายตาต่อท้ายมาด้วย
 * ("Hitop Aspheric Blue (1.56) -1.50/-0.50") ซึ่งลูกค้าอ่านไม่ออกและซ้ำกับ
 * ตารางค่าสายตาในสำเนาร้านอยู่แล้ว
 *
 * สองแหล่ง เรียงตามความน่าเชื่อ: คอลัมน์ของออเดอร์เองมาก่อน (ออเดอร์เก่ากรอกมือไว้)
 * ไม่มีค่อยถอยไปอ่านจากล็อตสต๊อกที่ผูกไว้ — ยกเว้น "รุ่น" (products.attributes.model)
 * ที่ตาราง custom_orders ไม่มีคอลัมน์: เลนส์สต็อกอ่านจากล็อต ส่วนเลนส์สั่งตัด RX ไม่มีล็อต
 * API จึงส่ง lens_model ที่อ่านจากสินค้าตาม SKU มาให้ (orderDetail ใน api/routes/orders.php)
 *
 * ช่องไหนว่างก็หายไปทั้งช่อง ไม่ค้างคั่นกลางไว้ให้อ่านสะดุด
 */
const lensSpec = (o) => {
  const lot = o?.left_lens || o?.right_lens || null;
  return [
    o?.lens_brand || lot?.brand_name || lot?.brand,
    lot?.model || o?.lens_model,
    o?.lens_coating || lot?.coating,
    o?.lens_index || lot?.lens_index,
  ].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ');
};

/**
 * เลนส์สั่งตัด RX ขึ้น "(RX)" หน้าชื่อ — ช่างกับลูกค้าเห็นทันทีว่าข้างไหนต้องรอแล็บ
 * (ร้านขอ 28 ก.ย. 2026) · ดูจากใบสั่งตัดที่ผูกกับข้างนั้น (lens_r_rx_id / lens_l_rx_id)
 * ไม่ใช่จากชื่อ · ชื่อว่างแต่เป็น RX ก็ยังขึ้น "(RX)" ให้รู้
 */
const withRx = (isRx, text) => [isRx && '(RX)', text].filter(Boolean).join(' ');

/**
 * หมายเหตุที่พิมพ์ลงใบ — มาจากคนละหน้าจอกัน จึงพิมพ์แยกบรรทัดพร้อมป้ายว่ามาจากขั้นไหน
 * ช่างอ่านแล้วต้องรู้ทันทีว่าข้อไหนมาจากหมอวัด ข้อไหนมาจากคนขาย
 *
 *   วัดสายตา  prescriptions.exam_note ของใบ kind='final' — ช่อง "บันทึกการตรวจ"
 *             ในหัวข้อ 6 ของ ExamPanel ซึ่งบันทึกลงใบ final ใบเดียวกับที่ใบนี้
 *             ใช้อ่านค่าสายตาอยู่แล้ว จึงไม่ต้องไปหาใบอื่น
 *   ขาย       custom_orders.notes — การ์ด "หมายเหตุ" ของ OrderFormView
 *             (สีเลนส์ ทรงกรอบ การปรับขาแว่น)
 *
 * ว่างทั้งคู่ = ไม่คืนแถวเลย ใบออกมาเหมือนเดิมทุกประการ กรอบเปล่าไว้ให้เขียนมือ
 */
const noteRows = (o, rx) => [
  ['วัดสายตา', rx?.exam_note],
  ['ขาย', o?.notes],
].filter(([, v]) => String(v ?? '').trim());

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

/** โลโก้หัวใบ — ไฟล์รูปหายก็ยังพิมพ์ได้ ตกกลับไปเป็นไอคอนแว่น+ชื่อร้านแบบเดิม */
function BrandMark() {
  const [bad, setBad] = useState(false);
  if (bad) return <div className="iv-brand-mark"><Icon name="glasses" /><b>TIME OPTIC</b></div>;
  return <img className="iv-logo" src="/logo-bewell.png" alt="TIME OPTIC at Be Well" onError={() => setBad(true)} />;
}

/** หัวใบ — ใช้ซ้ำทั้งครึ่งบนและครึ่งล่าง สองครึ่งต้องอ่านเป็นใบเดียวกัน */
function Head({ order, copy }) {
  return (
    <div className="iv-head">
      <div className="iv-brand">
        <BrandMark />
        <small>{copy}</small>
      </div>
      <div className="iv-title">
        <b>ใบสั่งซื้อสินค้า</b>
        <span>INVOICE</span>
      </div>
      <div className="iv-ref">
        <span>{fmtDate(order.order_date) || DASH}</span>
        <b>{caseNo(order)}</b>
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
  /* PD/FH/A/B/ED/DBL จากขั้นวัด Center — ช่องที่ยังไม่มีค่าว่างไว้ให้ช่างเขียนมือ */
  const measures = measureCells(ctr, c?.frame_fitting);
  /* ใบ Final ของเคสคือตัวปัจจุบันเสมอ ส่วน o.prescription คือใบที่ผูกไว้ตอนเปิดออเดอร์
     ใบที่ผูกไว้มาก่อน ถ้าไม่มีค่อยไปหยิบใบ final ล่าสุดของเคส */
  const rx = o.prescription
    || (c?.prescriptions || []).find((r) => r.kind === 'final')
    || null;

  const name = custName(o);
  const notes = noteRows(o, rx);
  const net = Number(o.total_price || 0) - Number(o.discount || 0);
  const paid = Number(o.paid || 0);
  const remain = Number(o.balance || 0);
  const appt = o.appointment_date ? fmtApptDate(o.appointment_date) : '';
  const methodLabel = meta?.lists?.pay_type_labels || {};
  const hours = settings?.shop_open_time && settings?.shop_close_time
    ? `${to12h(settings.shop_open_time)} – ${to12h(settings.shop_close_time)}`
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
          รูปบนใบอ่านจาก <b>frontend-next/public/</b> — โลโก้หัวใบ <b>logo-bewell.png</b>
          และ QR <b>qr-line.png</b> / <b>qr-location.png</b> เปลี่ยนรูปคือทับไฟล์เดิม ไม่ต้องแก้โค้ด
          ไฟล์หายก็ยังพิมพ์ได้ โลโก้กลับไปเป็นไอคอนแว่น+ชื่อร้าน ช่อง QR เป็นกรอบเปล่าที่กว้างเท่าเดิม
        </p>
      </div>

      {/* A4 = 210mm กว้างกว่าจอโทรศัพท์ราวสองเท่า — PaperView คืนทางดูให้
          (ย่อพอดีจอ / ไถซ้าย-ขวา) ไม่มีผลอะไรตอนพิมพ์หรือบนเดสก์ท็อป */}
      <PaperView>
        <div className="iv-sheet">
          {/* ═══ ครึ่งบน — Customer Copy ═══ */}
          <section className="iv-half iv-top">
            <Head order={o} copy="Customer Copy / สำหรับลูกค้า" />

            <div className="iv-cust-body">
              <div className="iv-col">
                <F k="Name" v={name} />
                <F k="TestFor" v={glassesUseOf(rx)} />
                <F k="Frame" v={frameLabel(o)} />
                <F k="Lens" v={withRx(o.lens_r_rx_id || o.lens_l_rx_id, lensSpec(o))} />
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
              <div className="iv-job-appt">
                <span>Appointment</span>
                <b className="iv-box">{appt || ''}</b>
              </div>
            </div>

            <div className="iv-who">
              <F k="Customer" v={name} />
              <F k="Phone no." v={o.phone} />
              <F k="WhatsApp" fill />
            </div>

            {/* ค่าสายตา — สองข้างวางคู่กัน ช่างอ่านทีเดียวเห็นทั้งคู่ ไม่ต้องไล่แถว */}
            <div className="iv-rx">
              {EYES.map(([k, label]) => (
                <div className="iv-rx-eye" key={k}>
                  <div className="iv-rx-title">
                    {label}
                    {dominantTag(rx, k)
                      ? <span className="iv-rx-dom">{dominantTag(rx, k)}</span>
                      : null}
                  </div>
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
                <F k="TestFor" v={glassesUseOf(rx)} />
                <F k="Frame" v={frameLabel(o)} />
                <F k="RightLen" v={withRx(o.lens_r_rx_id, o.lens_r_name)} />
                <F k="LeftLen" v={withRx(o.lens_l_rx_id, o.lens_l_name)} />
              </div>
              <div className="iv-col iv-money">
                {moneyRows.map(([k, v]) => <F key={k} k={k} v={v} />)}
                <F k="Employee" v={o.employee_name} />
              </div>
            </div>

            {/* ขั้นตอนงาน — ระบบไม่มีค่าให้ ตั้งใจเว้นช่องไว้ให้ช่างเซ็น/ลงวันที่กำกับทีละขั้น */}
            <div className="iv-stages">
              {STAGES.map((s) => (
                <div className="iv-stage" key={s}>
                  <span className="iv-stage-k">{s}</span>
                  <span className="iv-stage-box" />
                </div>
              ))}
            </div>

            {/* ค่าที่วัดหน้าลูกค้า + ขนาดกรอบ — พิมพ์ค่าจากขั้นวัด Center ช่องที่ยังไม่มีค่าเว้นให้กรอกมือ */}
            <table className="iv-meas">
              <thead>
                <tr>
                  {MEASURES.map(([k, fig]) => (
                    <th key={k}>
                      <span className="iv-meas-fig">{fig ? <FrameFig kind={fig} /> : null}</span>
                      <span className="iv-meas-k">{k}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>{MEASURES.map(([k]) => <td key={k}>{measures[k]}</td>)}</tr>
              </tbody>
            </table>

            {/* หมายเหตุจากสองขั้นก่อนหน้า พิมพ์ชิดบน ที่เหลือในกรอบยังเป็นที่ว่างให้ช่างเขียนมือ */}
            <div className="iv-note">
              <span>หมายเหตุ / รายละเอียดสำหรับสั่งงาน</span>
              {notes.length > 0 && (
                <div className="iv-note-body">
                  {notes.map(([k, v]) => (
                    <div className="iv-note-row" key={k}>
                      <span className="iv-f-k">{k}</span>
                      <span className="iv-note-v">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </PaperView>
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
  /* --line  เส้นโครงใบ (ขอบหัวใบ / ขีดใต้หัวข้อข้างซ้าย-ขวา) ยังเข้มเพื่อคุมโครง
     --rule  เส้นตาราง/กรอบช่องกรอก จงใจให้อ่อนกว่า ตัวหนังสือในช่องจะได้เด่นกว่ากรอบ
     --head  หัวข้อ/ป้ายกำกับทุกตัว ดำหนา เป็นตัวนำสายตาว่าช่องนี้คืออะไร
     --data  ค่าจริงในช่อง เทาอ่อนกว่าและบางกว่าหัวข้อ ใบจึงอ่านเป็นชั้น ๆ ไม่ดำเท่ากันทั้งใบ */
  --ink:#000; --line:#000; --rule:#a9a9a9; --head:#000; --data:#5a5a5a;
  --half-top:92mm; --half-bottom:205mm;   /* 92 + 205 = 297 */
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
/* โลโก้ TIMEOPTIC @ Be well Medical Center (สัดส่วน ~3.8:1) — ครึ่งบน/ล่างใช้ขนาดเดียวกัน */
.iv-head .iv-logo{display:block;height:7mm;width:auto}
.iv-head .iv-brand .ico{width:6mm;height:6mm;margin:0;flex:0 0 auto}
.iv-half.iv-bottom .iv-head .iv-brand .ico{width:4.8mm;height:4.8mm}
.iv-head .iv-brand b{font-size:11pt;letter-spacing:1.2px;line-height:1.1}
.iv-half.iv-bottom .iv-head .iv-brand b{font-size:9pt}
.iv-head .iv-brand small{font-size:6.5pt;color:var(--data);letter-spacing:.3px}
.iv-head .iv-title{text-align:center;flex:1 1 auto}
.iv-head .iv-title b{display:block;font-size:13pt;line-height:1.2}
.iv-half.iv-bottom .iv-head .iv-title b{font-size:10.5pt}
.iv-head .iv-title span{font-size:8pt;letter-spacing:3px;color:var(--data)}
.iv-head .iv-ref{text-align:right;min-width:34mm;display:flex;flex-direction:column}
.iv-head .iv-ref span{font-size:8pt;color:var(--data);font-weight:400}
.iv-head .iv-ref b{font-size:9.5pt;letter-spacing:.5px;white-space:nowrap}

/* ---- แถวป้าย: ค่า ---- */
.iv-f{display:flex;gap:2mm;align-items:baseline;min-width:0;padding:0.6mm 0}
.iv-half.iv-bottom .iv-f{padding:0.5mm 0}
.iv-f-k{flex:0 0 24mm;font-weight:700;color:var(--head);white-space:nowrap}
.iv-half.iv-bottom .iv-f-k{flex:0 0 21mm}
.iv-f-v{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;
  color:var(--data);font-weight:500}
.iv-f-v.iv-dim{color:#9a9a9a;font-weight:400}
/* ค่าว่างที่ "ตั้งใจให้เขียนมือ" — เส้นจริง ไม่ใช่ขีดกลาง */
.iv-f-blank{flex:1 1 auto;border-bottom:0.25mm dotted #999;height:3.4mm}
.iv-col.iv-money .iv-f-k{flex:0 0 22mm}
.iv-col.iv-money .iv-f-v{text-align:right;font-weight:600}

/* ---- ครึ่งบน ---- */
/* เนื้อครึ่งบนเกาะขอบบน (ไม่ใช่กลางแถบ) — ที่ว่างที่เหลือไปกองอยู่เหนือแถบที่ติดต่อร้าน
   ซึ่งเป็นที่ที่ลูกค้าเขียนกำกับได้ ดีกว่าลอยอยู่กลางใบ */
.iv-cust-body{flex:1 1 auto;display:grid;grid-template-columns:1fr 1fr;
  column-gap:10mm;align-content:start;padding:2.5mm 0 0}
.iv-cust-body .iv-col{display:flex;flex-direction:column;gap:2mm;min-width:0}

.iv-shop{display:flex;align-items:flex-end;justify-content:space-between;gap:6mm;
  padding-top:2.5mm;border-top:0.4mm solid var(--line)}
.iv-shop-info{font-size:8pt;line-height:1.6;min-width:0;color:var(--data)}
.iv-shop-info b{color:var(--head)}
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
.iv-job-appt{display:flex;align-items:center;gap:2mm}
.iv-job-appt span{font-weight:700;color:var(--head)}
.iv-job-appt .iv-box{display:inline-block;min-width:32mm;padding:0.8mm 2mm;
  border:0.3mm solid var(--rule);text-align:center;font-size:8.5pt}

.iv-who{display:grid;grid-template-columns:1.4fr 1fr 1fr;column-gap:6mm;
  padding:2mm 0;border-top:0.25mm solid var(--rule);border-bottom:0.25mm solid var(--rule)}
.iv-who .iv-f-k{flex:0 0 16mm}

/* ค่าสายตา: สองข้างกว้างเท่ากันเป๊ะ ตัวเลขอยู่ในกรอบ อ่านทีละแถวข้ามข้างได้ */
.iv-rx{display:grid;grid-template-columns:1fr 1fr;column-gap:8mm;padding:2mm 0}
.iv-rx-eye{display:flex;flex-direction:column;gap:1mm}
.iv-rx-title{text-align:center;font-weight:800;font-size:9pt;letter-spacing:1px;
  border-bottom:0.3mm solid var(--line);padding-bottom:1mm;margin-bottom:1mm}
/* ป้ายตาหลัก/ตารอง เกาะท้ายหัว Right / Left — เล็กกว่าและไม่ยืดตัวอักษร
   เพื่อให้ยังอ่านหัวตารางเป็น Right / Left ก่อน แล้วค่อยเห็นป้าย ไม่ใช่แข่งกันเด่น */
.iv-rx-dom{margin-left:1.5mm;font-size:7pt;font-weight:700;letter-spacing:0;
  color:var(--head);border:0.25mm solid var(--rule);border-radius:0.8mm;
  padding:0.2mm 1.2mm;white-space:nowrap;vertical-align:middle}
.iv-rx-row{display:flex;align-items:center;gap:2mm}
.iv-rx-k{flex:0 0 15mm;font-weight:700;color:var(--head)}
.iv-rx-v{flex:1 1 auto;border:0.25mm solid var(--rule);padding:0.9mm 2mm;
  text-align:center;font-size:8.5pt;color:var(--data);font-weight:600;line-height:1.35}

.iv-spec{display:grid;grid-template-columns:1.35fr 1fr;column-gap:8mm;
  padding:1.8mm 0;border-top:0.25mm solid var(--rule)}
.iv-spec .iv-col{display:flex;flex-direction:column;min-width:0}

/* ขั้นตอนงาน — สี่ช่องกว้างเท่ากัน ชื่อขั้นอยู่บน ใต้ชื่อเป็นที่ว่างให้เซ็น/ลงวันที่ */
.iv-stages{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;
  padding:2.2mm 0;border-top:0.25mm solid var(--rule)}
.iv-stage{display:flex;flex-direction:column;gap:1mm}
.iv-stage-k{font-weight:700;font-size:8.5pt;text-align:center}
.iv-stage-box{height:8mm;border:0.3mm solid var(--rule)}

/* ตารางค่าที่ต้องกรอกมือ — หัวตารางมีรูปกำกับเฉพาะค่าที่วัดจากกรอบ (A/B/ED/DBL)
   ช่อง PD/FH เว้นที่รูปไว้เท่ากันเพื่อให้ตัวอักษรหัวตารางอยู่ระดับเดียวกันทุกช่อง */
.iv-meas{width:100%;border-collapse:collapse;table-layout:fixed;margin:2.2mm 0 0}
.iv-meas th,.iv-meas td{border:0.25mm solid var(--rule);text-align:center}
.iv-meas th{padding:1mm 0.5mm;font-weight:700}
.iv-meas td{height:8mm;color:var(--data);font-weight:600;white-space:nowrap}
.iv-meas-fig{display:flex;align-items:center;justify-content:center;height:5mm}
.iv-meas .iv-fig{height:4.6mm;width:auto;color:var(--ink)}
.iv-meas-k{display:block;font-size:8.5pt;letter-spacing:.5px}

.iv-note{flex:1 1 auto;min-height:13mm;border:0.3mm solid var(--rule);
  padding:2mm 2.5mm;color:var(--data);font-size:7.5pt;
  /* กรอบนี้กินที่ที่เหลือของครึ่งล่างซึ่งสูงตายตัว ถ้าหมายเหตุยาวผิดปกติต้องถูก
     "ตัด" ตรงนี้ ไม่ใช่ดันกระดาษให้เกิดหน้า 2 — กฎเหล็กที่หัวไฟล์ */
  display:flex;flex-direction:column;overflow:hidden}
.iv-note>span{color:var(--head);font-weight:700}

/* หมายเหตุที่ระบบมีให้ พิมพ์ชิดบนใต้หัวข้อ ส่วนที่เหลือของกรอบยังว่างให้เขียนมือต่อ
   ตัวข้อความจึง clamp ไว้บรรทัดละไม่เกิน 2 บรรทัด แทนที่จะปล่อยให้กินกรอบทั้งใบ */
.iv-note-body{display:flex;flex-direction:column;gap:0.8mm;margin-top:1.4mm;
  min-height:0;overflow:hidden}
.iv-note-row{display:flex;gap:2mm;align-items:baseline}
.iv-note-row .iv-f-k{flex:0 0 16mm}
.iv-note-v{flex:1 1 auto;min-width:0;color:var(--data);font-weight:500;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;
  white-space:pre-line}

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
