'use client';
/**
 * ใบสายตาสำหรับพิมพ์ — สลิป 180mm x 55mm (แนวนอน)
 *
 * ถูกเรียกจากปุ่ม "พิมพ์" ของ Final Prescription, หน้าออเดอร์ และรายการ
 * Prescriptions ด้วย ?id=<prescription id>
 *
 * กระดาษมีโลโก้ TIMEOPTIC พิมพ์มาแล้วที่มุมขวาบน เราจึงไม่พิมพ์โลโก้ซ้ำ และต้อง
 * กันพื้นที่มุมนั้นว่างไว้ (--logo x --logo-h) ชื่อลูกค้าที่ยาวจะไม่วิ่งไปทับ
 *
 * ทำไมกว้าง 180 สูง 55: ใบนี้ต้องมีตารางค่าสายตาอยู่ซ้ายและบล็อก CASE / วันที่ /
 * Lens / Frame อยู่ขวา "ระดับเดียวกัน" ห้ามตกลงไปใต้ตาราง — 6 คอลัมน์ตัวเลข
 * บวกบล็อกขวาใส่ในความกว้าง 55mm ไม่ได้ ด้านยาวจึงเป็นความกว้างของกระดาษ
 *
 * ที่มาของค่าแต่ละช่อง — คนละแหล่งกันโดยตั้งใจ ห้ามรวมเป็นแหล่งเดียว:
 *   VA / SPH / CYL / AXIS / ADD  ใบ Final ของเคส (prescriptions.kind='final')
 *   PD                           ขั้น "วัด Center" (centerings.r_pd / l_pd)
 *   Lens / Frame                 ออเดอร์ของเคส (orders)
 *
 * CSS ทั้งหมดอยู่ในไฟล์นี้ ไม่ใช่ globals.css เพราะ @page ตั้งขนาดกระดาษให้ทั้งแอป
 * ไม่ได้ — กฎนี้ต้องมีผลเฉพาะตอนเปิดหน้านี้เท่านั้น
 */
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/apiClient.js';
import { useAsync } from '../../../../lib/hooks.js';
import { Card, Loading } from '../../../../components/ui.jsx';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { custName, fmtDateTime, power, rxNum } from '../../../../lib/format.js';

const DASH = '—';

/* หัวตาราง + วิธีอ่านค่าของแต่ละคอลัมน์ ลำดับนี้คือลำดับที่พิมพ์ออกมา */
const RX_COLS = [
  ['VA', (rx, k) => rxNum(rx?.[`${k}_va`])],
  ['Sph', (rx, k) => power(rx?.[`${k}_sphere`])],
  ['Cyl', (rx, k) => power(rx?.[`${k}_cylinder`])],
  ['Axis', (rx, k) => rxNum(rx?.[`${k}_axis`])],
  ['Add', (rx, k) => power(rx?.[`${k}_add`])],
  /* PD ไม่ได้อยู่บนใบสายตา — อ่านจากขั้นวัด Center แยกซ้าย/ขวา */
  ['PD', (rx, k, ctr) => rxNum(ctr?.[`${k}_pd`])],
];

const EYES = [['r', 'Right'], ['l', 'Left']];

/** แถว Lens ที่จะพิมพ์ — สองข้างคนละรุ่นได้ ถ้าต่างกันต้องแยกบรรทัด ไม่ใช่ตัดทิ้ง */
function lensRows(o) {
  const r = o?.lens_r_name || '';
  const l = o?.lens_l_name || '';
  if (r && l && r !== l) return [['Lens R', r], ['Lens L', l]];
  return [['Lens', o?.lens_name || r || l || DASH]];
}

const frameLabel = (o) => o?.frame_name
  || [o?.frame_brand, o?.frame_model].filter(Boolean).join(' ')
  || DASH;

/** จำแนวกระดาษที่เลือกไว้ต่อเครื่อง — คนเดิมเครื่องเดิมใช้เครื่องพิมพ์ตัวเดิมทุกวัน */
const ORIENT_KEY = 'timeoptic.slip.orient';
const readOrient = () => {
  try { return localStorage.getItem(ORIENT_KEY) === 'portrait'; } catch { return false; }
};

function SlipInner() {
  const id = useSearchParams().get('id');
  /**
   * ใบเป็นแนวนอนเสมอ (180 x 55) ตัวหนังสือตั้งตรงเสมอ ไม่มีการหมุน —
   * ที่เลือกคือ "กระดาษ" ที่จะพิมพ์ลง ไม่ใช่ทิศของใบ
   *   false = กระดาษสลิป 180x55 พอดีใบ — ไดรเวอร์เครื่องพิมพ์ต้องมีขนาดนี้
   *   true  = กระดาษ A4 แนวตั้ง ใบไปเกาะหัวกระดาษมุมซ้ายบน แล้วฉีกแถบบนมาใช้
   *           ใช้ตอนไดรเวอร์ยังไม่มีขนาด 180x55 A4 กว้าง 210mm รับใบ 180mm ได้สบาย
   */
  const [portrait, setPortrait] = useState(readOrient);
  const chooseOrient = (v) => {
    setPortrait(v);
    try { localStorage.setItem(ORIENT_KEY, v ? 'portrait' : 'landscape'); } catch { /* โหมดส่วนตัว */ }
  };

  /* ปุ่มพิมพ์ส่งมาแค่เลขใบสายตา ส่วน PD / Lens / Frame / รหัสเคส อยู่ที่เคส
     จึงต้องอ่านใบก่อนเพื่อรู้ case_id แล้วค่อยอ่านเคสทีเดียวได้ครบ */
  const { data, loading, error } = useAsync(async () => {
    if (!id) throw new Error('ไม่ได้ระบุเลขใบสายตา');
    const rx = await api.get(`/api/prescriptions/${id}`);
    const c = rx.case_id ? await api.get(`/api/cases/${rx.case_id}`) : null;
    const fresh = (c?.prescriptions || []).find((r) => Number(r.id) === Number(rx.id));
    return { rx: fresh || rx, c };
  }, [id]);

  if (loading) return <Loading text="กำลังเตรียมใบสายตา…" />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  const { rx, c } = data;
  const ctr = c?.centering || null;
  const order = c?.order || null;

  return (
    <>
      <style>{slipCss(portrait)}</style>

      <div className="slip-actions no-print">
        <button type="button" className="btn" onClick={() => window.print()}>
          <Icon name="printer" /> {portrait ? 'พิมพ์ (A4 แนวตั้ง)' : 'พิมพ์ (สลิป 180 × 55 มม.)'}
        </button>
        <div className="orient-pick">
          <span>กระดาษ</span>
          <button type="button" className={`btn btn-sm ${portrait ? 'btn-light' : ''}`} onClick={() => chooseOrient(false)}>
            สลิป 180 × 55
          </button>
          <button type="button" className={`btn btn-sm ${portrait ? '' : 'btn-light'}`} onClick={() => chooseOrient(true)}>
            A4 แนวตั้ง
          </button>
        </div>
        {c?.id ? (
          <Link className="btn btn-light" href={`/cases/detail?id=${c.id}&step=exam`}>
            <Icon name="eye" /> กลับไปที่เคส
          </Link>
        ) : null}
      </div>

      {/* กล่องนี้ไม่ติดไปกับกระดาษ — เตือนค่าที่ต้องตั้งในกล่องพิมพ์ของ Chrome
          CSS สั่งขนาดกระดาษได้ก็จริง แต่ Chrome ยอมทำตามเฉพาะปลายทางที่รองรับขนาดนั้น
          ถ้าเครื่องพิมพ์ไม่มีขนาด 55x180 ในไดรเวอร์ มันจะถอยไปใช้ A4 เอง */}
      <div className="slip-hint no-print">
        <b>ตั้งค่าในกล่องพิมพ์ให้ครบ 3 อย่าง</b>
        <ol>
          <li>ขนาดกระดาษ = <b>{portrait ? 'A4 แนวตั้ง' : '180 × 55 มม.'}</b> ตามปุ่ม “กระดาษ” ข้างบน{portrait ? '' : ' — ถ้าไม่มีในรายการ ต้องไปเพิ่มขนาดนี้ในไดรเวอร์เครื่องพิมพ์ก่อน Chrome เลือกได้เฉพาะขนาดที่เครื่องพิมพ์มี'}</li>
          <li>ระยะขอบ / Margins = <b>ไม่มี (None)</b></li>
          <li>เอาติ๊ก <b>หัวกระดาษและท้ายกระดาษ</b> ออก — วันที่ / ชื่อเรื่อง / URL / เลขหน้า ที่ติดมามาจากช่องนี้</li>
        </ol>
        <p>
          ลองเช็คเร็ว ๆ ได้ด้วยการเลือกปลายทางเป็น <b>บันทึกเป็น PDF</b> — อันนั้นทำตามขนาดใน CSS ให้เอง
          ต้องได้ <b>หน้าเดียว {portrait ? 'A4 แนวตั้ง โดยใบเกาะอยู่หัวกระดาษ' : '180 × 55 มม.'}</b>
        </p>
        <p className="orient-note">
          ตัวหนังสือตั้งตรงทั้งสองแบบ ไม่มีการหมุน — ที่เลือกคือ<b>กระดาษ</b> ไม่ใช่ทิศของใบ
          แบบ <b>A4 แนวตั้ง</b> ใบจะไปเกาะหัวกระดาษมุมซ้ายบน แล้วฉีกแถบบนมาใช้
          ใช้ตอนไดรเวอร์ยังไม่มีขนาด 180 × 55
        </p>
      </div>

      <div className="slip">
        {/* แถบบนสูงเท่าโซนโลโก้ — ชื่อกินได้แค่ครึ่งซ้าย ที่เหลือคือโลโก้บนกระดาษ */}
        <div className="slip-head">
          <div className="slip-name">
            <span className="k">NAME:</span>
            <span className="v">{c ? custName(c) : DASH}</span>
          </div>
          <div className="slip-logo no-print" aria-hidden="true">โลโก้บนกระดาษ</div>
        </div>

        {/* ตัวกลางกินที่ว่างที่เหลือทั้งหมด แล้วดันสองบล็อกไปอยู่กึ่งกลาง — ขอบบน/ล่าง
            จึงเท่ากันเสมอ ไม่ว่า Lens จะเป็นหนึ่งบรรทัดหรือสอง */}
        <div className="slip-mid">
        <div className="slip-body">
          {/* ตารางความกว้างคงที่ ไม่ใช่ช่องว่าง/แท็บ — ตัวเลขจะได้ไม่เลื่อนตอนพิมพ์ */}
          <table className="slip-rx">
            <colgroup>
              <col className="c-eye" />
              {RX_COLS.map(([label]) => <col key={label} className="c-num" />)}
            </colgroup>
            <thead>
              <tr>
                <th />
                {RX_COLS.map(([label]) => <th key={label}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {EYES.map(([k, label]) => (
                <tr key={k}>
                  <th scope="row">{label}</th>
                  {RX_COLS.map(([col, read]) => <td key={col}>{read(rx, k, ctr)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>

          <div className={`slip-meta${lensRows(order).length > 1 ? ' dense' : ''}`}>
            <div className="m-row m-solo">{c?.case_code || DASH}</div>
            <div className="m-row m-solo">{fmtDateTime(rx?.test_date) || DASH}</div>
            {lensRows(order).map(([k, v]) => (
              <div className="m-row" key={k}><span className="m-k">{k}</span><span className="m-v">{v}</span></div>
            ))}
            <div className="m-row"><span className="m-k">Frame</span><span className="m-v">{frameLabel(order)}</span></div>
          </div>
        </div>
        </div>
      </div>
    </>
  );
}

export default function PrintPrescriptionPage() {
  return <QueryParamPage><SlipInner /></QueryParamPage>;
}

/* สมมาตรทั้งสองแกน บนกระดาษ 5.5 x 18 ซม.
   แนวนอน: 5 (ขอบ) + 12 (ป้าย) + 6*15 (ตัวเลข) + 6 (ร่อง) + 62 (บล็อกขวา) + 5 = 180
            ป้ายซ้าย (Right/Left) กับป้ายขวา (Lens/Frame) กว้าง 12mm เท่ากัน
   แนวตั้ง: ตารางซ้ายยืดสูงเท่าบล็อกขวาพอดี — เส้นล่างสุดของตารางจึงอยู่ระดับเดียว
            กับบรรทัด Frame แถวในตารางแบ่งความสูงนั้นเท่า ๆ กันเอง (3 แถว เทียบ 4 บรรทัด)
            แล้ว .slip-mid จัดคู่นี้ไว้กึ่งกลางที่ว่างที่เหลือ ขอบบน = ขอบล่าง
   ทุกแถวขวาเป็นบรรทัดเดียวเสมอ (ยาวเกินตัดด้วย …) ไม่งั้นความสูงสองฝั่งจะไม่ตรงกัน
   ตัวเลขชิดขวาเท่ากันทั้งหัวตารางและค่า สองแถวจึงตรงแนวกันเสมอ
   padding ซ้าย 2mm คือช่องไฟ — ค่าที่ยาวเต็มช่อง เช่น -12.50 จะได้ไม่ไปติดคอลัมน์ข้าง ๆ */
const slipCss = (portrait) => `
.slip{
  --pad:5mm; --lbl:12mm; --num:15mm; --gap:6mm; --row:5.5mm;
  --rule:0.25mm solid #000;   /* เส้นตาราง — บางพอสำหรับเครื่องพิมพ์สลิป */
  --name:14pt;    /* ชื่อลูกค้าใหญ่กว่าตัวอื่นบนใบ — คนหยิบใบต้องอ่านชื่อออกจากระยะไกล */
  --logo:38mm;    /* โซนโลโก้ TIMEOPTIC ที่พิมพ์มากับกระดาษ — ห้ามพิมพ์อะไรทับ */
  --logo-h:12mm;
  box-sizing:border-box;
  width:180mm; height:55mm; padding:var(--pad);
  background:#fff; color:#000; overflow:hidden;
  display:flex; flex-direction:column;
  font-family:ui-monospace,"Cascadia Mono",Consolas,"DejaVu Sans Mono","Courier New",monospace;
  font-size:9pt; line-height:var(--row); font-variant-numeric:tabular-nums;
}
.slip-head{flex:0 0 var(--logo-h);display:flex;align-items:flex-start}
.slip-mid{flex:1 1 auto;display:flex;align-items:center;min-height:0}
.slip-name{display:flex;gap:4mm;align-items:baseline;
  width:calc(100% - var(--logo));min-width:0}
.slip-name .k{font-weight:700;letter-spacing:.4px;flex:0 0 auto}
.slip-name .v{font-weight:700;font-size:var(--name);line-height:1.1;
  min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.slip-logo{flex:0 0 var(--logo);height:var(--logo-h);box-sizing:border-box;
  display:flex;align-items:center;justify-content:center;
  border:1px dashed #c9d6d5;border-radius:3px;color:#9bb0af;font-size:7pt}

/* สองคอลัมน์ตายตัว — บล็อกขวาตกไปใต้ตารางไม่ได้ ไม่ว่าข้อความจะยาวแค่ไหน */
/* stretch คือหัวใจของ "สูงพอดีกับ Frame" — ความสูงของแถวกริดมาจากบล็อกขวา
   ตารางซ้ายยืดตามจนก้นเสมอกัน ไม่ต้องคำนวณจำนวนแถวเอง */
.slip-body{width:100%;display:grid;grid-template-columns:max-content 1fr;column-gap:var(--gap);align-items:stretch}

.slip-rx{border-collapse:collapse;table-layout:fixed;height:100%}
.slip-rx .c-eye{width:var(--lbl)}
.slip-rx .c-num{width:var(--num)}
/* ค่ากับหัวคอลัมน์อยู่กึ่งกลางช่องทั้งคู่ — คนละช่องกว้างเท่ากัน แกนกลางจึงตรงเป็นแนว */
.slip-rx th,.slip-rx td{border:var(--rule);padding:0 1.5mm;text-align:center;
  vertical-align:middle;font-weight:400;white-space:nowrap}
.slip-rx thead th{font-weight:700;letter-spacing:.3px}
.slip-rx tbody th[scope=row]{text-align:left;font-weight:700}

/* บรรทัดแรกของทุกแถวอยู่ระดับเดียวกับแถวตาราง ชื่อเลนส์/กรอบที่ยาวขึ้นบรรทัดสองได้
   — เห็นชื่อครบสำคัญกว่าจังหวะบรรทัดที่เท่ากันเป๊ะ ตารางซ้ายยืดตามความสูงให้เอง */
.slip-meta{min-width:0}
.slip-meta .m-row{min-height:var(--row);display:flex;gap:2mm;min-width:0}
.slip-meta .m-solo{font-weight:700;white-space:nowrap}
.slip-meta .m-k{flex:0 0 var(--lbl);font-weight:700;white-space:nowrap}
/* ยาวได้ 2 บรรทัด เกินนั้นค่อยตัด — 2 บรรทัดพอสำหรับชื่อรุ่นเต็ม ๆ ที่ร้านใช้จริง
   และเป็นเพดานที่กันไม่ให้ใบล้นออกนอกกระดาษ 55mm */
.slip-meta .m-v{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;line-height:4.6mm;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
/* เลนส์สองข้างคนละรุ่น = 5 แถว ถ้าแถวไหนขึ้นสองบรรทัดจะเกิน 55mm
   ย่อลงหนึ่งขั้นเฉพาะกรณีนี้ — ตัวเล็กลงยังอ่านออก ดีกว่าชื่อหาย */
.slip-meta.dense{font-size:8pt}
.slip-meta.dense .m-row{min-height:4.8mm}
.slip-meta.dense .m-v{line-height:4mm}

.slip-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.orient-pick{display:flex;align-items:center;gap:6px;padding:4px 10px;
  border:1px solid var(--line);border-radius:999px;font-size:13px;color:var(--ink-soft)}
.slip-hint .orient-note{padding-top:8px;border-top:1px dashed #e3c98a;color:#6b5a2d}
.slip-hint{max-width:180mm;margin:12px auto 0;padding:10px 14px;font-size:13px;line-height:1.6;
  border:1px solid #e3c98a;border-radius:8px;background:#fdf7e6;color:#5b4a1d}
.slip-hint ol{margin:6px 0 0;padding-left:20px}
.slip-hint p{margin:8px 0 0}

/* บนจอ: วางให้ดูเหมือนกระดาษจริง ตอนพิมพ์เส้นขอบนี้หายไป */
@media screen{
  .slip{border:1px solid #c9d6d5;box-shadow:0 2px 10px rgba(0,0,0,.08);border-radius:4px}
}

/* @page อยู่นอก @media print โดยตั้งใจ — มันมีผลตอนพิมพ์อยู่แล้ว และ Chrome อ่านกฎ
   ที่ซ้อนอยู่ใน @media ได้ไม่แน่นอนพอ margin:0 คือสิ่งที่สั่งให้เบราว์เซอร์เลิกพิมพ์
   หัว/ท้ายกระดาษ (วันที่ / ชื่อเรื่อง / URL / เลขหน้า) ไปด้วย */
@page{size:${portrait ? 'A4 portrait' : '180mm 55mm'};margin:0}

@media print{
  html,body{margin:0!important;padding:0!important;background:#fff}
  /* เหลือเฉพาะสลิป — sidebar / topbar / breadcrumb / ปุ่ม ไม่ติดไปด้วย */
  .sidebar,.sidebar-overlay,.topbar,.page-head,.no-print,.toasts,.scrim{display:none!important}
  /* ไล่ padding/margin ของเปลือกแอปออกให้หมด สลิปจะได้เริ่มที่มุมซ้ายบนของกระดาษจริง ๆ
     ไม่ใช้ position:fixed เพราะ Chrome วางมันไม่ตรงตอนกระดาษเป็นขนาดอื่น */
  .app,.main,.content{display:block!important;margin:0!important;padding:0!important;
    max-width:none!important;width:auto!important;min-height:0!important}
  /* margin auto = กระดาษที่กว้างกว่าใบ (A4) จะเหลือช่องว่างซ้าย/ขวาเท่ากัน
     บนกระดาษสลิป 180x55 ที่พอดีใบอยู่แล้ว auto ให้ผลเป็น 0 ทั้งสองข้าง ไม่กระทบ */
  .slip{margin:0 auto;border:0;box-shadow:none;border-radius:0;break-inside:avoid;break-after:avoid}
}
`;
