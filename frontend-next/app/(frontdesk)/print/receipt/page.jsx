'use client';
/**
 * ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ — A4 **แนวนอน** สองใบบนแผ่นเดียว
 *
 * เรียกได้สองทางเพราะเงินเข้าร้านได้สองทาง:
 *   ?order=<order id>   ออเดอร์แว่นของเคส  (GET /api/orders/:id)
 *   ?sale=<sale id>     ใบขาย POS หน้าร้าน (GET /api/pos/sales/:id)
 * ทั้งสองถูกแปลงเป็นรูปร่างเดียวกันที่ lib/receipt.js ไฟล์นี้จึงมีหน้าที่ "วาด"
 * อย่างเดียว ไม่มีการตัดสินใจเรื่องตัวเลขอยู่ในนี้เลย — เลข VAT กับผลรวมบรรทัด
 * มีเทสต์คุมอยู่ที่โมดูลนั้น ไม่ใช่ตรวจด้วยตาบนกระดาษ
 *
 * เลย์เอาต์มาจากฟอร์ม Excel เดิมของร้าน วางทีละบรรทัดตามของจริง:
 *   ซ้าย = ต้นฉบับ (ลูกค้า) · ขวา = สำเนา (ร้าน) — ฉีกตามเส้นประกลางแผ่น
 *
 * กฎเหล็กเดียวกับ /print/order: **ห้ามมีหน้า 2**
 *   - .rc-sheet กว้าง 297mm สูง 210mm ตายตัว (A4 แนวนอน)
 *   - .rc-copy สองใบ ใบละ 148.5mm มี overflow:hidden เป็นตาข่ายกันตก
 *     รายการยาวผิดปกติจะถูกตัด ไม่ใช่ดันให้เกิดหน้าใหม่
 *   - ห้ามใส่ page-break-* / break-*: page ที่ไหนก็ตามในไฟล์นี้
 *   - ตัวเลขทุกตัวเป็น mm ไม่ใช่ % หรือ vh
 *
 * CSS อยู่ในไฟล์นี้ ไม่ใช่ globals.css เพราะ @page ตั้งขนาดกระดาษให้ทั้งแอปไม่ได้
 * (เหมือน /print/order และ /print/prescription) กฎต้องมีผลเฉพาะตอนเปิดหน้านี้
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/apiClient.js';
import { useAsync } from '../../../../lib/hooks.js';
import { Card, Loading } from '../../../../components/ui.jsx';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { fmtDate } from '../../../../lib/format.js';
import { bahtText, bahtTextEn } from '../../../../lib/bahttext.js';
import { orderReceipt, saleReceipt, vatBreakdown } from '../../../../lib/receipt.js';

/* ที่ติดต่อของร้านบนหัวใบ — ยังไม่มีช่องเก็บในตาราง settings (มีแค่ shop_name
   กับเวลาเปิด-ปิด) เหมือน /print/order แก้ตรงนี้ที่เดียวเมื่อร้านย้ายหรือเปลี่ยนเบอร์

   เบอร์กับเลขผู้เสียภาษีเป็นตัวเลข ใช้ร่วมกันทั้งสองภาษา เก็บเฉพาะ "ค่า" ไม่มีป้าย
   นำหน้า เพราะป้าย (โทร / Tel) เปลี่ยนตามภาษาของใบ ส่วนชื่อกับที่อยู่แยกสองชุด
   ชื่อไทยเอามาจาก SHOP.tagline ใน lib/constants.js ที่แอปใช้อยู่แล้ว จะได้ไม่มี
   ชื่อร้านภาษาไทยสองแบบในระบบเดียวกัน */
const SHOP = {
  tel: '+66 32 511 360, +66 81 643 9282',
  taxId: '3101800278601',
  th: {
    name: 'ร้านแว่นตาไทม์ออพติก',
    address: '106/4 ถ.เพชรเกษม อ.หัวหิน จ.ประจวบคีรีขันธ์',
  },
  en: {
    name: 'Timeoptic Optical shop',
    address: '106/4 Phechkasem Rd. Hua-Hin  Prachuabkhirikhan',
  },
};

/**
 * ป้ายบนใบสองภาษา — ลูกค้าต่างชาติขอใบภาษาอังกฤษได้ ลูกค้าไทยเอาไปยื่นภาษีได้
 * เลือกจากปุ่มบนแถบเครื่องมือ ไม่ได้เดาจากสัญชาติลูกค้าในระบบ เพราะคนสั่งพิมพ์
 * คือพนักงานที่ยืนอยู่ตรงหน้าลูกค้า รู้ดีกว่าฐานข้อมูลว่าใบนี้จะเอาไปใช้ทำอะไร
 *
 * สิ่งที่ **ไม่** อยู่ในนี้เพราะไม่เปลี่ยนตามภาษา:
 *   - ชื่อ/ที่อยู่ร้าน เป็นชื่อเฉพาะ เขียนอังกฤษทั้งสองโหมด
 *   - คำอ่านจำนวนเงิน พิมพ์ทั้งไทยและอังกฤษสองบรรทัดเสมอ (ดู .rc-words)
 *     ใบเดียวกันอาจต้องอ่านให้ทั้งลูกค้าและสรรพากรเข้าใจ จึงไม่ตัดทิ้งข้างใดข้างหนึ่ง
 */
const TEXT = {
  th: {
    title: 'ใบเสร็จ', original: 'ต้นฉบับ', dup: 'สำเนา',
    tel: 'โทร', shopTaxId: 'เลขประจำตัวผู้เสียภาษี',
    billNo: 'เลขที่', date: 'วันที่',
    custName: 'ชื่อลูกค้า', custTaxId: 'เลขประจำตัวผู้เสียภาษี',
    address: 'ที่อยู่', custTel: 'โทร',
    colDesc: 'รายการ', colQty: 'จำนวน', colUnit: 'ราคาต่อหน่วย', colAmount: 'ราคารวม',
    vatExcl: 'ราคาก่อนภาษี', vatVat: 'ภาษีมูลค่าเพิ่ม 7%', vatIncl: 'ราคารวมภาษี',
    approvedBy: 'ผู้อนุมัติเอกสาร',
  },
  en: {
    title: 'RECEIPT', original: 'Original', dup: 'Copy',
    tel: 'Tel', shopTaxId: 'Tax ID',
    billNo: 'Bill No.', date: 'Date',
    custName: 'Customer name', custTaxId: 'Tax ID Number',
    address: 'Address', custTel: 'Tel',
    colDesc: 'Description', colQty: 'Amount', colUnit: 'Unit Price', colAmount: 'Price',
    vatExcl: 'Price Excluding VAT', vatVat: 'Value Added Tax (VAT) 7%', vatIncl: 'Total Including VAT',
    approvedBy: 'Approved by',
  },
};

/** ช่องลูกค้าบนใบตอนยังไม่ได้ดึงอะไรมา — รูปร่างเดียวกับ state ของแผงกรอกข้อมูล */
const EMPTY_CUST = { name: '', taxId: '', address: '', phone: '' };

/** ช่องราคาในตาราง — ตัวเลขจัดรูปเงิน 2 ตำแหน่ง ขีดกลางพิมพ์ตามตัว ค่าว่างเว้นไว้ */
const cell = (v) => {
  if (v === null || v === undefined) return '';
  return typeof v === 'number' ? money2(v) : v;
};

/** ช่องจำนวน — เป็นจำนวนชิ้น ไม่ใช่เงิน จึงไม่มีทศนิยม ("2" ไม่ใช่ "2.00") */
const qtyCell = (v) => {
  if (v === null || v === undefined) return '';
  return typeof v === 'number' ? String(v) : v;
};

/* จำนวนบรรทัดขั้นต่ำในตาราง — ใบที่มีสินค้าชิ้นเดียวกับใบที่มีหลายชิ้นต้องสูงเท่ากัน
   ไม่งั้นบล็อกสรุป VAT ลอยขึ้นลงคนละที่ในแต่ละใบ เส้นฉีกกลางแผ่นจะดูเบี้ยว
   ครึ่งแผ่นสูง 210mm รับได้ราว 24 แถวก่อนชนช่องเซ็น

   11 มาจากการนับของจริง: ใบแว่นหนึ่งคู่ที่ยาวที่สุดใช้ 8 บรรทัด (Glasses · Frame ·
   Lens R · Lens L · Prescription · R · L · Add) เหลือเผื่อส่วนลดกับบรรทัดอื่น ๆ อีก 3
   แถวเปล่าที่เกินจากนี้ไม่ได้ช่วยอะไร นอกจากทำให้ใบดูโหว่

   แถวเปล่าที่ตัดออกกลายเป็นที่ว่างเหนือลายเซ็น ซึ่งเป็นตัวรับแรงตอนคอลัมน์รายการ
   ตกบรรทัด (ดู .rc-desc) — ชื่อยาวหนึ่งบรรทัดที่งอกกินสูง 4.1mm */
const MIN_ROWS = 11;

const money2 = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** โลโก้หัวใบ — ไฟล์หายก็ยังพิมพ์ได้ กลับไปเป็นไอคอนแว่น + ชื่อร้าน (เหมือน /print/order) */
function BrandMark() {
  const [bad, setBad] = useState(false);
  if (bad) return <span className="rc-mark"><Icon name="glasses" /><b>TIME OPTIC</b></span>;
  return <img className="rc-logo" src="/logo-timeoptic.png" alt="TIME OPTIC" onError={() => setBad(true)} />;
}

/** แถว "ป้าย : ค่า" ของบล็อกหัวใบและบล็อกลูกค้า — ค่าว่างพิมพ์ขีดให้เขียนมือ */
function F({ k, v, wide }) {
  return (
    <div className={`rc-f ${wide ? 'rc-f-wide' : ''}`}>
      <span className="rc-f-k">{k}</span>
      <span className={`rc-f-v ${String(v ?? '').trim() ? '' : 'rc-f-blank'}`}>{v || ''}</span>
    </div>
  );
}

/**
 * ใบเดียว — เรียกสองครั้งต่อแผ่น ต้นฉบับกับสำเนาต้องเหมือนกันทุกตัวอักษร
 * ต่างกันแค่คำในวงเล็บหลังหัวเรื่อง เพื่อให้ฉีกแล้วรู้ว่าใบไหนของใคร
 *
 * `t` คือชุดป้ายตามภาษาที่เลือก · `cust` คือช่องลูกค้าสี่ช่องที่แผงกรอกข้อมูลคุมอยู่
 * ทั้งคู่ถูกส่งมาจากข้างบน ไม่ใช่ state ในนี้ — ไม่งั้นต้นฉบับกับสำเนาจะไม่ตรงกัน
 */
function Copy({ r, cust, t, lang, vat, kind }) {
  const shop = SHOP[lang];
  const rows = [...r.lines];
  while (rows.length < MIN_ROWS) rows.push(null);   // เติมแถวเปล่าให้ตารางสูงเท่ากันทุกใบ

  return (
    <section className="rc-copy">
      {/* หัวเรื่องเป็นบรรทัดของตัวเองบนสุดของใบ เหนือโลโก้ — เป็นบล็อกเต็มความกว้าง
          จึงกึ่งกลางของ "ใบ" จริง ๆ ไม่ต้องพึ่ง absolute และไม่มีอะไรมาแย่งบรรทัด */}
      <div className="rc-doc-title">
        {t.title}
        <small>({kind})</small>
      </div>

      {/* ใต้หัวเรื่อง: ตราร้าน + ที่อยู่ชิดซ้าย · เลขที่ + วันที่ชิดขวา ระดับเดียวกัน */}
      <div className="rc-head">
        <div className="rc-brand">
          <BrandMark />
          <b>{shop.name}</b>
          <span>{shop.address}</span>
          <span>{t.tel} : {SHOP.tel}</span>
          <span>{t.shopTaxId} : {SHOP.taxId}</span>
        </div>
        <div className="rc-ref">
          <F k={t.billNo} v={r.billNo} />
          <F k={t.date} v={fmtDate(r.date)} />
        </div>
      </div>

      {/* สี่ช่องนี้มาจากแผง "กรอกข้อมูลลูกค้า" ไม่ได้อ่านจาก r ตรง ๆ
          ชื่อกับเบอร์ถูกเติมจากระบบให้ตั้งแต่เปิดหน้า ส่วนเลขผู้เสียภาษีกับที่อยู่
          ไม่มีคอลัมน์เก็บในตาราง customers จึงว่างไว้ — พิมพ์เอาในแผง หรือปล่อย
          เป็นเส้นประไว้เขียนมือเหมือนฟอร์ม Excel เดิมก็ได้ */}
      <div className="rc-cust">
        <F k={t.custName} v={cust.name} wide />
        <F k={t.custTaxId} v={cust.taxId} wide />
        <F k={t.address} v={cust.address} wide />
        <F k={t.custTel} v={cust.phone} wide />
      </div>

      <table className="rc-items">
        <thead>
          <tr>
            <th>{t.colDesc}</th>
            <th className="rc-n">{t.colQty}</th>
            <th className="rc-n">{t.colUnit}</th>
            <th className="rc-n">{t.colAmount}</th>
          </tr>
        </thead>
        <tbody>
          {/* คีย์เป็นลำดับแถวได้เพราะตารางนี้วาดครั้งเดียวแล้วพิมพ์ ไม่มีการเพิ่ม/ลบ/สลับแถว
              และแถวเปล่าที่เติมให้ครบความสูงก็ไม่มีคีย์อื่นให้ใช้อยู่แล้ว */}
          {rows.map((l, i) => (
            <tr key={i}>
              {/* ข้อความอยู่ใน span ไม่ใช่ใน td ตรง ๆ เพราะการจำกัดจำนวนบรรทัดต้องใช้
                  display:-webkit-box ซึ่งใส่บน td ไม่ได้ — มันจะพังการวางตารางทั้งใบ */}
              <td className={l?.indent ? 'rc-sub' : ''}><span className="rc-desc">{l?.desc || ''}</span></td>
              <td className="rc-n">{qtyCell(l?.qty)}</td>
              <td className="rc-n">{cell(l?.unit)}</td>
              <td className="rc-n">{cell(l?.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ท้ายใบ: คำอ่านจำนวนเงินอยู่ซ้าย บล็อก VAT อยู่ขวา ระดับเดียวกัน — ตามฟอร์มเดิม */}
      <div className="rc-foot">
        <div className="rc-words">
          <div className="rc-w-row"><span>Total</span><b>{bahtTextEn(r.total)}</b></div>
          <div className="rc-w-row"><span>รวม</span><b>{bahtText(r.total)}</b></div>
        </div>
        <div className="rc-vat">
          <div className="rc-v-row"><span>{t.vatExcl}</span><b>{money2(vat.excl)}</b></div>
          <div className="rc-v-row"><span>{t.vatVat}</span><b>{money2(vat.vat)}</b></div>
          <div className="rc-v-row rc-v-sum"><span>{t.vatIncl}</span><b>{money2(vat.incl)}</b></div>
        </div>
      </div>

      <div className="rc-sign">
        <span className="rc-sign-line">&nbsp;</span>
        <span className="rc-sign-k">{t.approvedBy}</span>
      </div>
    </section>
  );
}

function ReceiptSheet() {
  const params = useSearchParams();
  const orderId = params.get('order');
  const saleId = params.get('sale');

  /* ภาษาของป้ายบนใบ · แผงกรอกข้อมูลเปิดอยู่ไหม · ค่าสี่ช่องของบล็อกลูกค้า
     ทั้งสามอยู่ตรงนี้ไม่ใช่ใน <Copy> เพราะแผ่นหนึ่งมีสองใบที่ต้องเหมือนกันเป๊ะ */
  const [lang, setLang] = useState('th');
  const [editing, setEditing] = useState(false);
  const [cust, setCust] = useState(EMPTY_CUST);

  /**
   * เปิดหน้านี้ = ออกเลขใบเสร็จ
   *
   * POST /api/receipts เรียกซ้ำได้ปลอดภัย — ใบที่เคยออกเลขแล้วจะคืนเลขเดิมเสมอ
   * เปิดดูเฉย ๆ ไม่ได้พิมพ์ เลขนั้นก็ยังจองไว้ให้ใบนี้ วันหลังลูกค้ามาขอก็ได้เลขเดิม
   * ยอดเงินบนเลขถูกคิดที่ฝั่ง API จากข้อมูลในฐาน ไม่ได้ส่งจากหน้านี้ไป
   */
  const { data, loading, error } = useAsync(async () => {
    if (orderId) {
      const [o, rc] = await Promise.all([
        api.get(`/api/orders/${orderId}`),
        api.post('/api/receipts', { order_id: Number(orderId) }),
      ]);
      return orderReceipt(o, rc.receipt_no);
    }
    if (saleId) {
      const [s, rc] = await Promise.all([
        api.get(`/api/pos/sales/${saleId}`),
        api.post('/api/receipts', { sale_id: Number(saleId) }),
      ]);
      return saleReceipt(s, rc.receipt_no);
    }
    throw new Error('ไม่ได้ระบุว่าจะออกใบเสร็จของออเดอร์หรือใบขาย POS');
  }, [orderId, saleId]);

  /* ชื่อกับเบอร์เติมจากระบบให้ครั้งเดียวตอนโหลดเสร็จ หลังจากนั้นเป็นของฟอร์ม —
     ถ้าซิงก์ทุกครั้งที่ re-render สิ่งที่พนักงานพิมพ์ทับไว้จะโดนเขียนกลับทิ้ง
     เลขผู้เสียภาษีกับที่อยู่ไม่มีในตาราง customers จึงเริ่มจากว่างเสมอ */
  useEffect(() => {
    if (!data) return;
    setCust({
      ...EMPTY_CUST,
      name: data.customerName || '',
      phone: data.customerPhone || '',
    });
  }, [data]);

  if (loading) return <Loading text="กำลังเตรียมใบเสร็จ…" />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  const t = TEXT[lang];
  const setField = (key) => (e) => setCust((c) => ({ ...c, [key]: e.target.value }));
  /* คืนเฉพาะสองช่องที่ระบบรู้จัก — เลขผู้เสียภาษีกับที่อยู่ที่พิมพ์ไว้ต้องไม่โดนล้าง */
  const pullFromSystem = () => setCust((c) => ({
    ...c,
    name: data.customerName || '',
    phone: data.customerPhone || '',
  }));
  /* ล้างทั้งสี่ช่อง — ใบจะพิมพ์ออกมาเป็นเส้นประเปล่าให้เขียนมือ ซึ่งเป็นวิธีที่
     ฟอร์ม Excel เดิมของร้านใช้ กดผิดก็กด "ดึงชื่อ+เบอร์จากระบบ" เอาคืนได้ */
  const clearAll = () => setCust(EMPTY_CUST);

  const vat = vatBreakdown(data.total);
  const back = orderId
    ? { href: `/orders/detail?id=${orderId}`, icon: 'glasses', label: 'เปิดออเดอร์' }
    : { href: `/pos/detail/?id=${saleId}`, icon: 'receipt', label: 'เปิดใบขาย' };

  return (
    <>
      <style>{sheetCss}</style>

      <div className="rc-actions no-print">
        <button type="button" className="btn" onClick={() => window.print()}>
          <Icon name="printer" /> พิมพ์ใบเสร็จ (A4 แนวนอน — ต้นฉบับ + สำเนา)
        </button>

        {/* สองช่องติดกัน ไม่ใช่ dropdown — เห็นได้ทันทีว่าใบตอนนี้เป็นภาษาอะไร
            และสลับได้ในคลิกเดียว ไม่ต้องกดเปิดดูก่อน */}
        <div className="rc-lang" role="group" aria-label="ภาษาบนใบเสร็จ">
          <button
            type="button"
            aria-pressed={lang === 'th'}
            className={`rc-lang-b${lang === 'th' ? ' is-on' : ''}`}
            onClick={() => setLang('th')}
          >
            ไทย
          </button>
          <button
            type="button"
            aria-pressed={lang === 'en'}
            className={`rc-lang-b${lang === 'en' ? ' is-on' : ''}`}
            onClick={() => setLang('en')}
          >
            English
          </button>
        </div>

        <button
          type="button"
          className="btn btn-light"
          aria-expanded={editing}
          onClick={() => setEditing((v) => !v)}
        >
          <Icon name="pencil" /> กรอกข้อมูลลูกค้า
        </button>

        <Link className="btn btn-light" href={back.href}>
          <Icon name={back.icon} /> {back.label}
        </Link>
      </div>

      {/* แผงกรอกข้อมูล — อยู่นอกกระดาษ ไม่ได้ฝัง <input> ลงในใบ เพราะแผ่นหนึ่งมีสองใบ
          ที่ต้องตรงกัน และกรอบ/ความสูงของ input จะไปพังเลย์เอาต์ที่คิดมาเป็นมิลลิเมตร */}
      {editing ? (
        <div className="rc-form no-print">
          <b>กรอกข้อมูลลูกค้า</b>
          <p>
            พิมพ์แล้วขึ้นบนใบทั้งต้นฉบับและสำเนาทันที ใช้เฉพาะตอนพิมพ์ใบนี้
            <b> ไม่ได้บันทึกลงระบบ</b> — ปิดหน้าแล้วหาย ช่องที่เว้นว่างไว้จะพิมพ์เป็นเส้นประให้เขียนมือ
          </p>
          <div className="rc-form-grid">
            <label>
              {t.custName}
              <input value={cust.name} onChange={setField('name')} />
            </label>
            <label>
              {t.custTaxId}
              <input value={cust.taxId} onChange={setField('taxId')} inputMode="numeric" />
            </label>
            <label>
              {t.address}
              <input value={cust.address} onChange={setField('address')} />
            </label>
            <label>
              {t.custTel}
              <input value={cust.phone} onChange={setField('phone')} inputMode="tel" />
            </label>
          </div>
          <div className="rc-form-foot">
            <button type="button" className="btn btn-ghost" onClick={clearAll}>
              <Icon name="x" /> ล้างข้อมูล
            </button>
            <button type="button" className="btn btn-light" onClick={pullFromSystem}>
              <Icon name="refresh" /> ดึงชื่อ+เบอร์จากระบบ
            </button>
          </div>
        </div>
      ) : null}

      <div className="rc-hint no-print">
        <b>ตั้งค่าในกล่องพิมพ์ให้ครบ 3 อย่าง</b>
        <ol>
          <li>ขนาดกระดาษ = <b>A4</b> · แนว <b>นอน (Landscape)</b></li>
          <li>ระยะขอบ / Margins = <b>ไม่มี (None)</b> — ใบเผื่อขอบในตัวแล้ว</li>
          <li>เอาติ๊ก <b>หัวกระดาษและท้ายกระดาษ</b> ออก และมาตราส่วน (Scale) ต้องเป็น <b>100%</b></li>
        </ol>
        <p>
          Print Preview ต้องขึ้น <b>1 หน้า</b> และเห็นครบทั้งสองใบ — ถ้าขึ้น 2 หน้า
          แปลว่ามาตราส่วนไม่ใช่ 100% หรือแนวกระดาษยังเป็นแนวตั้งอยู่
        </p>
        <p className="rc-vat-note">
          ราคาที่กรอกในระบบถือเป็นราคา <b>รวม VAT แล้ว</b> ใบจึงถอด 7% ย้อนกลับ
          (ยอดรวม ÷ 1.07) ไม่ใช่บวกเพิ่มจากยอด — ตรงกับลำดับ Excluding → VAT → Including ของฟอร์มเดิม
        </p>
      </div>

      <div className="rc-sheet">
        <Copy r={data} cust={cust} t={t} lang={lang} vat={vat} kind={t.original} />
        <div className="rc-cut" />
        <Copy r={data} cust={cust} t={t} lang={lang} vat={vat} kind={t.dup} />
      </div>
    </>
  );
}

export default function PrintReceiptPage() {
  return <QueryParamPage><ReceiptSheet /></QueryParamPage>;
}

/* งบความกว้าง A4 แนวนอน = 297mm พอดี ห้ามเกินแม้ 1mm ไม่งั้นใบขวาตกไปหน้า 2
     .rc-copy 148.5 × 2 = 297 เส้นฉีกตรงกลางเป็นเส้นประกว้าง 0 ไม่กินที่
   ทั้งสองใบเป็น flex column + overflow:hidden — รายการยาวผิดปกติจะถูกตัด
   ไม่ใช่ดันกระดาษให้ยาวออกไป */
const sheetCss = `
.rc-sheet{
  /* --line เส้นโครงใบและกรอบตาราง · --rule เส้นให้เขียนมือ จงใจอ่อนกว่า
     --fill พื้นแถบหัวตาราง/บล็อก VAT สีเดียวกับฟอร์ม Excel เดิมของร้าน */
  --ink:#000; --line:#000; --rule:#8f8f8f; --fill:#bdd7ee; --data:#333;
  box-sizing:border-box;
  width:297mm; height:210mm; margin:0 auto;
  background:#fff; color:var(--ink);
  display:flex; flex-direction:row;
  font-family:"Sarabun","Noto Sans Thai",system-ui,-apple-system,"Segoe UI",sans-serif;
  font-variant-numeric:tabular-nums;
  break-inside:avoid;
}
.rc-sheet *{box-sizing:border-box}

.rc-copy{
  width:148.5mm; height:210mm; padding:7mm 7mm 6mm; overflow:hidden;
  display:flex; flex-direction:column; break-inside:avoid;
  font-size:8pt; line-height:1.45;
}

/* หัวข้อหลักของเอกสาร — บรรทัดบนสุดของใบ อยู่เหนือโลโก้ ตัวใหญ่ที่สุดบนกระดาษ
   เป็นบล็อกเต็มความกว้างจึงกึ่งกลางใบเองโดยไม่ต้องคำนวณ และไม่ถูกความยาวที่อยู่ร้านดันให้เยื้อง
   ป้าย (ต้นฉบับ)/(สำเนา) อยู่ใต้คำ เล็กกว่ามาก เพราะเป็นหมายเหตุ ไม่ใช่ชื่อเอกสาร */
.rc-doc-title{text-align:center;font-size:17pt;font-weight:800;line-height:1.1;
  letter-spacing:.5px;padding-bottom:2.5mm}
.rc-doc-title small{display:block;font-size:7.5pt;font-weight:600;letter-spacing:0;
  color:var(--data);margin-top:0.8mm}

/* ---- ใต้หัวเรื่อง: ตราร้านซ้าย · เลขที่+วันที่ขวา ----
   บล็อกซ้ายเรียงลงมาเป็นชั้นเดียว โลโก้ → ชื่อร้าน → ที่อยู่ → Tel → เลขผู้เสียภาษีร้าน
   ระยะบรรทัดกระชับ (1.3) เพื่อให้ห้าชั้นนี้ไม่กินความสูงเกินจำเป็น */
.rc-head{display:flex;align-items:flex-start;
  justify-content:space-between;gap:4mm;
  padding-bottom:2mm;border-bottom:0.4mm solid var(--line)}
.rc-brand{display:flex;flex-direction:column;align-items:flex-start;min-width:0;
  line-height:1.3}
.rc-brand b{font-size:9.5pt;margin-top:1.2mm}
.rc-brand span{font-size:7.5pt;color:var(--data)}
/* โลโก้เป็นภาพแนวนอนยาว — สูง 8mm แล้วมันกว้างเกินครึ่งใบจนไปเบียดหัวเรื่องกลางใบ
   6.5mm คือความสูงที่ยังอ่านชื่อแบรนด์ออกชัดและเหลือที่ว่างให้คำว่า "ใบเสร็จ" หายใจ */
.rc-logo{display:block;height:6.5mm;width:auto}
.rc-mark{display:flex;align-items:center;gap:1.5mm}
.rc-mark .ico{width:6mm;height:6mm}
.rc-mark b{font-size:9pt;letter-spacing:1px;white-space:nowrap;margin:0}

/* ---- เลขที่ / วันที่ — ตารางสองคอลัมน์ชิดขวา ป้ายชิดขวา ค่าชิดขวา
   ทั้งสองบรรทัดจึงตรงแนวกันทั้งหัวและท้าย ไม่ใช่ลอยตามความยาวข้อความ
   display:contents ทำให้ span ของ <F> กลายเป็นลูกของ grid โดยตรง ---- */
.rc-ref{display:grid;grid-template-columns:auto auto;column-gap:2.5mm;row-gap:1mm;
  align-content:start;flex:0 0 auto}
.rc-ref .rc-f{display:contents}
.rc-ref .rc-f-k{text-align:right}
.rc-ref .rc-f-v{text-align:right}

/* ---- บล็อกลูกค้า ---- */
.rc-cust{display:flex;flex-direction:column;gap:0.8mm;padding:1.5mm 0 2.5mm}

.rc-f{display:flex;gap:2mm;align-items:baseline;min-width:0}
.rc-f-k{flex:0 0 auto;font-weight:600;white-space:nowrap}
/* เลขที่กับวันที่จัดป้ายให้กว้างเท่ากัน ค่าจึงเริ่มที่คอลัมน์เดียวกันทั้งสองบรรทัด */
.rc-ref .rc-f-k{flex:0 0 26mm}
.rc-f-v{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;
  color:var(--data)}
.rc-f-wide .rc-f-k{flex:0 0 auto}
/* ค่าว่างที่ตั้งใจให้เขียนมือ — เส้นจริง ไม่ใช่ขีดกลาง */
.rc-f-blank{border-bottom:0.25mm dotted var(--rule);height:3.6mm}

/* ---- ตารางรายการ ---- */
.rc-items{width:100%;border-collapse:collapse;table-layout:fixed}
.rc-items th,.rc-items td{border:0.3mm solid var(--line);padding:0.8mm 1.5mm;
  overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.rc-items th{background:var(--fill);text-align:center;font-weight:700;font-size:7.5pt;
  line-height:1.25}
.rc-items th:first-child{width:auto}
.rc-items th:nth-child(2){width:16mm}
.rc-items th:nth-child(3){width:22mm}
.rc-items th:nth-child(4){width:24mm}
.rc-items td{height:5.2mm;vertical-align:top}
/* คอลัมน์รายการ — ชื่อกรอบ/เลนส์ที่ยาวเกินช่องให้ตกบรรทัดใหม่ในช่องเดิม ไม่ใช่โดนตัดท้าย
   จำกัดไว้ 2 บรรทัด (วิธีเดียวกับคำอ่านจำนวนเงินที่ .rc-w-row b) เพราะแถวที่สูงขึ้นไปกิน
   ที่ว่างเหนือลายเซ็น ซึ่งวัดจากของจริงแล้วมีให้ราว 14mm หรือ 3 บรรทัดเท่านั้น
   overflow-wrap:anywhere กันคำเดียวยาวรวดไม่มีช่องว่าง (เช่นรหัสสินค้า) ทะลุขอบช่อง
   สามคอลัมน์ตัวเลขยังห้ามตกบรรทัดเหมือนเดิม แถวจะได้สูงเท่ากันและตัวเลขตรงแนว */
.rc-items td:first-child{white-space:normal}
.rc-desc{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;
  overflow:hidden;overflow-wrap:anywhere}
.rc-items .rc-n{text-align:right}
.rc-items th.rc-n{text-align:center}
/* บรรทัดบรรยาย (Frame / Lens / Prescription) — ย่อหน้าเข้าไป ให้อ่านเป็นลูกของบรรทัดราคาข้างบน */
.rc-items .rc-sub{padding-left:5mm;color:var(--data)}

/* ---- ท้ายใบ: คำอ่านเงินซ้าย บล็อก VAT ขวา ---- */
.rc-foot{display:flex;align-items:stretch;gap:0;margin-top:-0.3mm}
.rc-words{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;
  border:0.3mm solid var(--line);border-top:0;border-right:0}
.rc-w-row{display:flex;gap:2mm;align-items:baseline;padding:0.8mm 1.5mm;min-width:0;
  border-bottom:0.3mm solid var(--line);flex:1 1 0}
.rc-w-row:last-child{border-bottom:0}
.rc-w-row span{flex:0 0 14mm;font-weight:700}
/* คำอ่านจำนวนเงินห้ามถูกตัดด้วย ellipsis — บรรทัดนี้คือตัวเลขที่เขียนเป็นตัวหนังสือ
   ใบที่อ่านได้ครึ่งเดียวใช้ไม่ได้ ยอดยาว (ภาษาอังกฤษยาวกว่าไทยเสมอ) จึงให้ตัดขึ้น
   บรรทัดใหม่ในช่องเดิม ไม่ใช่หายไปท้ายประโยค */
.rc-w-row b{flex:1 1 auto;min-width:0;font-weight:500;color:var(--data);
  font-size:7.5pt;line-height:1.3;white-space:normal;overflow:hidden;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}

/* 62mm = 16 + 22 + 24 ของสามคอลัมน์ตัวเลขในตารางรวมกันพอดี เส้นแบ่งซ้ายของบล็อกนี้
   จึงต่อตรงกับเส้นคอลัมน์ "จำนวน" ที่อยู่เหนือมัน ไม่เยื้องกันครึ่ง ๆ กลาง ๆ
   แก้ตัวเลขนี้เมื่อไหร่ ต้องแก้ความกว้างคอลัมน์ใน .rc-items ให้บวกได้เท่ากันเสมอ */
.rc-vat{flex:0 0 62mm;display:flex;flex-direction:column;background:var(--fill)}
.rc-v-row{display:flex;align-items:baseline;padding:0.8mm 1.5mm;
  border:0.3mm solid var(--line);border-top:0}
/* ป้ายสามบรรทัดนี้ห้ามตกบรรทัด — ถ้าตก แถวจะสูงไม่เท่ากันแล้วตัวเลขฝั่งขวาไม่ตรงแนวกัน */
.rc-v-row span{flex:1 1 auto;font-weight:600;font-size:7pt;white-space:nowrap}
/* 24mm = ความกว้างคอลัมน์ "ราคารวม" ตัวเลข VAT จึงอยู่ใต้ตัวเลขราคาในตารางพอดี */
.rc-v-row b{flex:0 0 24mm;text-align:right}
.rc-v-sum b{font-size:9pt}

/* ---- ช่องเซ็นผู้อนุมัติเอกสาร — เว้นว่างไว้ให้เซ็น
   ชิดขวาของใบตามธรรมเนียมเอกสารที่ผู้อนุมัติเซ็นมุมขวาล่าง เส้นกับป้ายกว้าง 52mm เท่ากัน
   จึงขยับเป็นก้อนเดียวและป้ายยังอยู่กึ่งกลางใต้เส้นเหมือนเดิม

   ยัง justify-content:flex-end อยู่ (ไม่ใช่ flex-start) เพื่อให้ลายเซ็นอยู่ "ตำแหน่งเดิม
   บนกระดาษ" ทุกใบ ไม่ขยับตามความยาวของรายการ · padding-bottom คือปุ่มปรับความสูง:
   20mm ยกขึ้นจากขอบล่าง ทำให้ลายเซ็นอยู่กลางที่ว่างท้ายใบแทนที่จะไปกองอยู่ก้นกระดาษ
   หลังตัดแถวเปล่าเหลือ 11 (ดู MIN_ROWS) ---- */
.rc-sign{flex:1 1 auto;display:flex;flex-direction:column;align-items:flex-end;
  justify-content:flex-end;gap:1mm;padding-bottom:20mm;min-height:14mm}
.rc-sign-line{width:52mm;text-align:center;color:var(--data);
  border-bottom:0.25mm dotted var(--rule);padding-bottom:0.5mm;
  overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.rc-sign-k{width:52mm;text-align:center;font-weight:600}

/* ---- เส้นฉีกกลางแผ่น (ไม่ใช่ page break) ----
   เส้นประอย่างเดียว ไม่มีป้ายกำกับ: ป้ายบนเส้นแนวตั้งต้องหมุนตัวหนังสือ ซึ่งที่ 6pt
   อ่านไม่ออกจริงและดูเหมือนตัวอักษรเพี้ยนบนกระดาษ เส้นประบอกตัวเองอยู่แล้วว่าให้ฉีกตรงไหน */
.rc-cut{width:0;border-left:0.3mm dashed #999}

/* ---- เปลือกหน้าจอ (ไม่ติดไปกับกระดาษ) ---- */
.rc-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.rc-hint{max-width:297mm;margin:0 auto 12px;padding:10px 14px;font-size:13px;line-height:1.6;
  border:1px solid #e3c98a;border-radius:8px;background:#fdf7e6;color:#5b4a1d}
.rc-hint ol{margin:6px 0 0;padding-left:20px}
.rc-hint p{margin:8px 0 0}
.rc-hint .rc-vat-note{padding-top:8px;border-top:1px dashed #e3c98a;color:#6b5a2d}

/* ปุ่มสลับภาษาเป็นสองช่องติดกัน สีทึบคือช่องที่กำลังใช้อยู่ ไม่ได้พึ่งเครื่องหมายถูก
   เล็ก ๆ อย่างเดียว เพราะแถบนี้ถูกกวาดตาผ่านเร็ว ๆ ก่อนกดพิมพ์ */
.rc-lang{display:inline-flex;overflow:hidden;background:var(--card);
  border:1px solid var(--line);border-radius:var(--radius-pill);
  box-shadow:var(--shadow-sm)}
.rc-lang-b{appearance:none;border:0;background:transparent;cursor:pointer;
  padding:10px 18px;font:inherit;font-size:var(--t-base);font-weight:500;
  line-height:1.2;color:var(--ink-soft)}
.rc-lang-b + .rc-lang-b{border-left:1px solid var(--line)}
.rc-lang-b.is-on{background:var(--green);color:var(--ink);font-weight:600}

/* แผงกรอกข้อมูลลูกค้า — กรอบเดียวกับ .rc-hint แต่สีกลาง ๆ เพราะเป็นที่ให้ทำงาน
   ไม่ใช่คำเตือน · ช่องเรียงตัวเองตามความกว้างจอ (auto-fit) ไม่ตายตัวเป็นสี่คอลัมน์ */
.rc-form{max-width:297mm;margin:0 auto 12px;padding:12px 14px;font-size:13px;
  line-height:1.6;background:var(--card);border:1px solid var(--line);border-radius:8px}
.rc-form > p{margin:4px 0 10px;color:var(--ink-soft)}
.rc-form-grid{display:grid;gap:10px 14px;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.rc-form label{display:flex;flex-direction:column;gap:4px;
  font-weight:600;color:var(--ink-soft)}
.rc-form input{font:inherit;padding:7px 10px;font-weight:400;
  background:var(--card);color:var(--ink);
  border:1px solid var(--line);border-radius:6px}
.rc-form input:focus-visible{outline:2px solid var(--green-ink);outline-offset:1px}
.rc-form-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}

@media screen{
  .rc-sheet{border:1px solid #c9d6d5;box-shadow:0 2px 14px rgba(0,0,0,.1);border-radius:4px}
}

/* @page อยู่นอก @media print โดยตั้งใจ (เหมือน /print/order) — margin:0 คือสิ่งที่
   สั่งให้เบราว์เซอร์เลิกพิมพ์หัว/ท้ายกระดาษไปด้วย */
@page{size:A4 landscape;margin:0}

@media print{
  html,body{margin:0!important;padding:0!important;background:#fff}
  /* เหลือเฉพาะกระดาษ — sidebar / topbar / ปุ่ม / กล่องคำแนะนำ ไม่ติดไปด้วย */
  .sidebar,.sidebar-overlay,.topbar,.page-head,.no-print,.toasts,.scrim{display:none!important}
  .app,.main,.content{display:block!important;margin:0!important;padding:0!important;
    max-width:none!important;width:auto!important;min-height:0!important}
  .rc-sheet{margin:0;border:0;box-shadow:none;border-radius:0}
  /* พิมพ์พื้นแถบสีฟ้าและเส้นกรอบให้ครบตามที่เห็นบนจอ ไม่ใช่ถูกเบราว์เซอร์ตัดทิ้งเพื่อประหยัดหมึก */
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;
