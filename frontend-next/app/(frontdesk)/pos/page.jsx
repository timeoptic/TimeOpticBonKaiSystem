'use client';
/**
 * POS ขายหน้าร้าน
 *
 * โมดูลแยกจาก Main Process 6 ขั้น — ขายของเบ็ดเตล็ดที่ไม่มีเคส ไม่มีใบสายตา
 * ไม่มีวันนัดรับ · หน้านี้ประกอบร่างอย่างเดียว ตรรกะเงินอยู่ที่ lib/pos/cart.js
 * และของจริงที่บันทึกคือค่าที่ api/routes/pos.php คำนวณใหม่เองเสมอ
 *
 * หน้าตาเป็นการ์ดใบเดียวกลางจอตามระบบ POS ด่วนเดิม เรียงช่องกรอกลำดับเดียวกัน:
 * วันที่/ช่องทางชำระ → สินค้า → ลูกค้า/หมายเหตุ → เส้นประ → ยอดรวม/รูปแบบชำระ →
 * รับเงิน/เงินทอน → กล่องรับสินค้า → ปุ่ม · ที่ต่างจากเดิมคือช่อง "ชื่อสินค้า"
 * ช่องเดียวกลายเป็นตะกร้าที่รับได้หลายรายการ
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { useAsync } from '../../../lib/hooks.js';
import { custName, cylPower, fmtDate, money, roundGlassesUse, sphPower, todayISO } from '../../../lib/format.js';
import { api } from '../../../lib/apiClient.js';
import { eyeRefText } from '../../../lib/pos/rxRef.js';
import { GlassesUseTag } from '../../../components/RxSets.jsx';
import { Picker } from '../../../components/Picker.jsx';
import { PosExamDialog } from '../../../components/pos/PosExamDialog.jsx';
import { PosNewCustomer } from '../../../components/pos/PosNewCustomer.jsx';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { inSystemZone } from '../../../lib/roles.js';
import { Card, Loading } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icon.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { useConfirm } from '../../../components/Confirm.jsx';

import { posApi, PAY_METHODS } from '../../../lib/pos/posApi.js';
import {
  addItem, removeItem, setQty, bumpQty, setPrice, setMeta, setCustomName,
  totals, changeFor, validateCart, validatePayment, toItemsPayload,
  isContactLens, hiddenFromOther,
} from '../../../lib/pos/cart.js';
import { ProductPicker } from '../../../components/pos/ProductPicker.jsx';
import { POS_MODES, PosModeCards, PosCategoryChips } from '../../../components/pos/PosModeCards.jsx';
import { CartItemRow } from '../../../components/pos/CartItemRow.jsx';
import { ConfirmSaleModal } from '../../../components/pos/ConfirmSaleModal.jsx';
import { PosField, PosOut } from '../../../components/pos/PosField.jsx';
import { DateField } from '../../../components/DateField.jsx';
import { Select } from '../../../components/Selects.jsx';

const blankForm = () => ({
  customerName: '',
  customerPhone: '',
  method: 'cash',
  mode: 'full',
  amount: '',
  received: '',
  delivered: true,
  note: '',
});

/* คีย์กันบันทึกซ้ำ หนึ่งค่าต่อหนึ่งตะกร้า — ออกตั้งแต่เปิดตะกร้า ไม่ใช่ตอนกดปุ่ม
   ถ้าออกตอนกดปุ่ม การกดสองครั้งจะได้สองคีย์ ซึ่งกันอะไรไม่ได้เลย */
/* "รายการนี้เป็นคอนแทคเลนส์ไหม" (ต้องผูกใบวัด) — ของ pos_items เดิมถามจากนิยาม
   ช่องกรอก (มีช่องค่าสายตา) ของคลังถามจากประเภทสินค้า ดู isContactLens ใน cart.js */
const hasPower = isContactLens;

/* ชิปหมวดหมู่ — ของคลังใช้แบรนด์ที่มีของมากที่สุดก่อน ของหน้าร้านใช้กลุ่มตามลำดับเดิม */
const MAX_CHIPS = 8;
function chipsOf(list, stock) {
  if (!stock) return [...new Set(list.map((p) => p.category_name).filter(Boolean))];
  const n = new Map();
  list.forEach((p) => { if (p.brand) n.set(p.brand, (n.get(p.brand) || 0) + 1); });
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHIPS).map(([b]) => b);
}

const newRef = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export default function PosPage() {
  const { actor } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: products, loading, error } = useAsync(() => posApi.products(), []);

  /* การ์ดที่เลือก = แหล่งที่ช่องค้นหาไปหา · บิลไม่ผูกกับการ์ด สลับแล้วของในบิลไม่หาย */
  const [mode, setMode] = useState('frame');
  const [chip, setChip] = useState(null);
  const modeDef = POS_MODES.find((m) => m.key === mode);
  const {
    data: stockList, loading: stockLoading, error: stockError, reload: reloadStock,
  } = useAsync(
    (signal) => (modeDef.stockType ? posApi.stockProducts(modeDef.stockType, signal) : Promise.resolve([])),
    [mode],
  );
  const switchMode = (m) => { setMode(m); setChip(null); };

  /* รายการของการ์ดที่เลือก — การ์ด "สินค้าอื่น" ไม่เอาคอนแทคเลนส์/กรอบของ pos_items
     ที่ซ้ำกับคลัง (ขายทางนั้นแล้วคลังไม่รู้) และไม่เอาช่อง "อื่นๆ (พิมพ์เอง)" ซึ่งมี
     ปุ่ม "เพิ่มรายการด้วยตนเอง" ของมันเองแล้ว */
  /* ระหว่างโหลดของการ์ดใหม่ useAsync ยังถือรายการของการ์ดเดิมไว้ — ต้องว่างไว้ก่อน
     ไม่งั้นกด Enter ตอนนั้นจะหยิบกรอบใส่บิลทั้งที่อยู่การ์ดคอนแทคเลนส์ */
  const modeList = useMemo(() => {
    if (modeDef.stockType) return stockLoading ? [] : (stockList || []);
    return (products || []).filter((p) => !hiddenFromOther(p) && !p.pos_custom);
  }, [modeDef.stockType, stockLoading, stockList, products]);
  const chips = useMemo(() => chipsOf(modeList, !!modeDef.stockType), [modeList, modeDef.stockType]);
  const shown = useMemo(() => (
    !chip ? modeList : modeList.filter((p) => (modeDef.stockType ? p.brand : p.category_name) === chip)
  ), [modeList, chip, modeDef.stockType]);
  const customItem = useMemo(() => (products || []).find((p) => p.pos_custom), [products]);

  const [items, setItems] = useState([]);
  const [form, setForm] = useState(blankForm);
  const [saleDate, setSaleDate] = useState(todayISO());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [done, setDone] = useState(null);
  const clientRef = useRef(newRef());

  /* ลูกค้าที่เลือกจากฐาน — คนละเรื่องกับช่องชื่อ/เบอร์ที่พิมพ์เอง ซึ่งยังอยู่สำหรับ
     ลูกค้าขาจรที่ไม่มีแถวในระบบ · เลือกแล้วเติมชื่อ/เบอร์ให้ด้วย กฎมัดจำจะได้ผ่าน */
  const [customer, setCustomer] = useState(null);
  const [rx, setRx] = useState(null);          // ใบค่าสายตาที่แนบกับบิลนี้
  const [rxFrom, setRxFrom] = useState('');    // มาจากไหน ใช้โชว์อย่างเดียว
  const [examOpen, setExamOpen] = useState(false);
  const [newCust, setNewCust] = useState(false);   // เปิดฟอร์มเพิ่มลูกค้าใหม่อยู่ไหม

  /* ประวัติรอบวัดของลูกค้าคนที่เลือก — โหลดครั้งเดียวต่อคน ไม่ได้เลือกใครก็ไม่ยิง */
  const { data: sessions, reload: reloadSessions } = useAsync(
    (signal) => (customer ? api.get(`/api/customers/${customer.id}/exam-sessions`, {}, signal) : Promise.resolve([])),
    [customer?.id],
  );
  /* ให้เลือกรอบเองจากประวัติ แบบเดียวกับ "เลือกจากประวัติ" ในขั้นวัดสายตาของเคส —
     เดิมมีแค่ปุ่มใช้ผลวัดล่าสุด ซึ่งหยิบรอบที่เก่ากว่านั้นไม่ได้ (ร้านขอเปลี่ยน 17 ก.ย. 2026) */
  const [pickHistory, setPickHistory] = useState(false);
  const rounds = sessions || [];

  const pickCustomer = (c) => {
    setCustomer(c);
    setPickHistory(false);
    setRx(null);
    setRxFrom('');
    setForm((f) => ({
      ...f,
      customerName: custName(c),
      customerPhone: c.phone || f.customerPhone,
    }));
  };

  const clearCustomer = () => {
    setCustomer(null);
    setPickHistory(false);
    setRx(null);
    setRxFrom('');
  };

  /**
   * ถามก่อนเอาสินค้าออกจากบิล
   *
   * แถวในบิลไม่ได้มีแค่ชื่อสินค้า — จำนวนกับราคาที่แก้มือไปแล้วอยู่ในแถวนั้นด้วย
   * กดกากบาทพลาดหนึ่งครั้งคือพิมพ์ใหม่ทั้งแถว และตอนนั้นลูกค้ายืนรออยู่ตรงหน้า
   */
  const dropItem = useCallback(async (it) => {
    const name = (it.pos_custom ? it.custom_name : it.name) || 'รายการนี้';
    if (!await confirm('เอาออกจากบิล', `เอา "${name}" ออกจากบิล?`, { confirmText: 'เอาออก', danger: true })) return;
    setItems((c) => removeItem(c, it.key));
  }, [confirm]);

  const set = useCallback((k, v) => setForm((f) => ({ ...f, [k]: v })), []);
  const sums = useMemo(() => totals(items), [items]);

  /* แผงค่าสายตาโผล่เฉพาะตอนในบิลมีของที่ถามค่าสายตา — บิลขายน้ำยาหรือค่าประกอบแว่น
     ต้องไม่มีอะไรงอกขึ้นมาให้พนักงานต้องอ่านผ่าน */
  const needsRx = useMemo(() => items.some(hasPower), [items]);

  /* "ชำระเต็มจำนวน" ไม่ให้พิมพ์ยอดเอง — ยอดคือยอดสุทธิเสมอ ลดโอกาสพิมพ์ผิด
     ซึ่งเป็นเหตุผลเดียวกับที่ระบบเดิมมีช่องรูปแบบการชำระให้เลือก */
  const payNow = form.mode === 'full' ? sums.total
    : form.mode === 'none' ? 0
      : Number(form.amount) || 0;

  const balance = Math.max(0, Math.round((sums.total - payNow) * 100) / 100);
  const change = form.method === 'cash' ? changeFor(form.received, payNow) : 0;

  const cartErrors = useMemo(() => validateCart(items), [items]);
  const payErrors = useMemo(() => validatePayment({
    total: sums.total,
    amount: payNow,
    method: form.method,
    received: form.received,
    delivered: form.delivered,
    customerName: form.customerName,
    customerPhone: form.customerPhone,
  }), [sums.total, payNow, form]);

  /* ตะกร้าว่างไม่ต้องขึ้นข้อความเตือน — หน้าจอบอกอยู่แล้วว่ายังไม่มีของ
     และปุ่มก็ปิดอยู่ · เตือนตั้งแต่ยังไม่ทำอะไรคือเสียงรบกวน */
  const errors = useMemo(() => (
    items.length === 0 ? [] : [...cartErrors.map((e) => e.message), ...payErrors]
  ), [items.length, cartErrors, payErrors]);

  const badKeys = useMemo(() => new Set(cartErrors.map((e) => e.key).filter(Boolean)), [cartErrors]);

  /* ล้างทั้งบิล — ถามก่อนเสมอ เพราะแถวในบิลมีจำนวนกับราคาที่แก้มือไปแล้วอยู่ด้วย */
  const clearAll = async () => {
    if (!items.length) return;
    if (!await confirm('ล้างรายการ', `เอาสินค้าทั้ง ${items.length} รายการออกจากบิล?`, { confirmText: 'ล้างรายการ', danger: true })) return;
    setItems([]);
  };

  const resetAll = () => {
    reloadStock();
    setItems([]);
    setForm(blankForm());
    setSaleDate(todayISO());
    setDone(null);
    setSaveError(null);
    clientRef.current = newRef();
  };

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      const sale = await posApi.create({
        client_ref: clientRef.current,
        sale_date: saleDate,
        items: toItemsPayload(items).map((line, i) => (
          /* ใบค่าสายตาผูกกับ "รายการ" ไม่ใช่ทั้งบิล — ซื้อสองกล่องคนละใบวัดในบิล
             เดียวได้ ซึ่งเป็นเหตุผลที่ item_meta ถูกออกแบบให้อยู่ที่ item ตั้งแต่แรก */
          rx && hasPower(items[i])
            ? { ...line, item_meta: { ...line.item_meta, rx_id: rx.id } }
            : line
        )),
        customer_id: customer?.id || null,
        customer_name: form.customerName.trim() || null,
        customer_phone: form.customerPhone.trim() || null,
        delivered: form.delivered,
        note: form.note || null,
        payment: payNow > 0
          ? {
            method: form.method,
            amount: payNow,
            amount_received: form.method === 'cash' && form.received !== ''
              ? Number(form.received) : null,
          }
          : { amount: 0 },
      });
      setConfirming(false);
      setDone(sale);
      toast.ok(`บันทึกการขาย ${sale.pos_no} แล้ว`);
    } catch (e) {
      setSaveError(e.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading text="กำลังโหลดรายการสินค้า…" />;
  if (error) {
    return (
      <Card>
        <p className="muted">{error.message}</p>
        <p>ตรวจสอบว่า PHP API และ MySQL ของ XAMPP รันอยู่</p>
      </Card>
    );
  }

  /* ---- หน้าจอหลังบันทึกสำเร็จ ---- */
  if (done) {
    return (
      <div className="pos">
        <div className="pos-card">
          <div className="pos-card-in">
            <div className="pos-done">
              <div className="pos-tick"><Icon name="checkCircle" /></div>
              <h2>บันทึกการขายสำเร็จ</h2>
              <div className="pos-no">{done.pos_no}</div>
              <div className="pos-done-figs">
                <div className="pos-sum-row"><span>ยอดขาย</span><b>{money(done.total_amount)}</b></div>
                <div className="pos-sum-row"><span>ยอดชำระ</span><b>{money(done.paid_amount)}</b></div>
                <div className="pos-sum-row"><span>ยอดค้าง</span><b>{money(done.balance_amount)}</b></div>
              </div>
            </div>
            <button type="button" className="pos-btn primary" onClick={resetAll}><Icon name="bag" /> ขายรายการใหม่</button>
            {/* หน้าพิมพ์ใบเสร็จเดียวกับปุ่ม 🧾 ใบเสร็จ ในหน้ารายละเอียดใบขาย — เลขออกเมื่อกด "ออกใบเสร็จ" ที่หน้านั้น */}
            <Link className="pos-btn link" href={`/print/receipt?sale=${done.id}`}><Icon name="receipt" /> พิมพ์ใบเสร็จ</Link>
            <Link className="pos-btn link" href={`/pos/detail/?id=${done.id}`}>ดูรายละเอียดใบนี้</Link>
            <Link className="pos-btn link" href="/pos/history/"><Icon name="refresh" /> ดูประวัติการขาย POS</Link>
            <Link className="pos-btn back" href="/"><Icon name="arrowLeft" /> กลับไปหน้าระบบแว่นตา (Main)</Link>
          </div>
        </div>
      </div>
    );
  }

  /* ---- หน้าขาย ----
     แผงซ้าย = หาของแล้วใส่ตะกร้า · แผงขวา = เก็บเงิน
     เดิมเป็นคอลัมน์เดียวเรียงลงมา 16 บล็อก ทำให้ตอนจะดูยอดรวมต้องเลื่อนพ้นตะกร้า
     ไปก่อน ซึ่งเป็นสิ่งที่พนักงานต้องทำทุกบิล · แยกสองแผงแล้วยอดรวมค้างอยู่กับที่
     ไม่ว่าตะกร้าจะยาวแค่ไหน */
  return (
    <div className="pos">
      <div className="pos-head">
        <span className="pos-mark"><Icon name="bag" /></span>
        <div className="pos-head-txt">
          <h1>ขายหน้าร้าน</h1>
          <p>สร้างรายการขายสินค้าหน้าร้านได้อย่างรวดเร็ว — บิลด่วน ไม่ต้องเปิดเคส</p>
        </div>
        <div className="pos-head-act">
          <span className="pos-who">ผู้ขาย · {actor?.displayName || '—'}</span>
          <Link className="btn btn-light btn-sm" href="/pos/history/"><Icon name="refresh" /> ประวัติการขาย</Link>
        </div>
      </div>

      <div className="pos-work">
        {/* ─── แผงซ้าย: เลือกของ ─────────────────────────────────────────── */}
        <section className="pos-main">
          <PosModeCards mode={mode} onMode={switchMode} />

          <div className="pos-panel">
            <h2 className="pos-panel-h">ค้นหาสินค้า</h2>
            {stockError
              ? <p className="pos-err">{stockError.message}</p>
              : (
                <ProductPicker
                  products={shown}
                  placeholder={stockLoading
                    ? 'กำลังโหลดสินค้าจากคลัง…'
                    : `ค้นหา${modeDef.title.replace('ขาย', '')} — ชื่อ แบรนด์ หรือรหัส SKU …`}
                  onPick={(p) => setItems((c) => addItem(c, p))}
                />
              )}
            <PosCategoryChips chips={chips} value={chip} onChange={setChip} />
          </div>

          <div className="pos-panel">
            <div className="pos-cart-head">
              <h2 className="pos-panel-h">
                รายการสินค้าในบิล <span className="pos-count-txt">({items.length} รายการ)</span>
              </h2>
              <div className="pos-cart-acts">
                <button type="button" className="btn btn-sm pos-clear" disabled={!items.length} onClick={() => void clearAll()}>
                  <Icon name="trash" /> ล้างรายการ
                </button>
                {customItem && (
                  <button type="button" className="btn btn-sm pos-add" onClick={() => setItems((c) => addItem(c, customItem))}>
                    <Icon name="plus" /> เพิ่มรายการด้วยตนเอง
                  </button>
                )}
              </div>
            </div>
            <div className="pos-cart">
              <div className="pos-grid pos-thead" aria-hidden="true">
                <span>สินค้า</span><span>จำนวน</span><span>ราคาต่อหน่วย</span><span>รวมเงิน</span><span>จัดการ</span>
              </div>
              {items.length === 0
                ? (
                  <div className="pos-cart-empty">
                    <span className="pos-empty-ico"><Icon name="box" /></span>
                    <b>ยังไม่มีสินค้าในบิล</b>
                    ค้นหาสินค้าด้านบน แล้วกดเพื่อเพิ่มลงบิล
                  </div>
                )
                : items.map((it) => (
                  <CartItemRow
                    key={it.key}
                    item={it}
                    bad={badKeys.has(it.key)}
                    onQty={(v) => setItems((c) => setQty(c, it.key, v))}
                    onBump={(d) => setItems((c) => bumpQty(c, it.key, d))}
                    onPrice={(v) => setItems((c) => setPrice(c, it.key, v))}
                    onMeta={(k, v) => setItems((c) => setMeta(c, it.key, k, v))}
                    onCustomName={(v) => setItems((c) => setCustomName(c, it.key, v))}
                    onRemove={() => void dropItem(it)}
                  />
                ))}
            </div>
          </div>
        </section>

        {/* ─── แผงขวา: เก็บเงิน ──────────────────────────────────────────── */}
        <aside className="pos-side">
          <div className="pos-side-in">
            {/* ยอดรวมเป็นของชิ้นเดียวที่ต้องเห็นก่อนเสมอตอนเก็บเงิน จึงอยู่บนสุด
                และตัวใหญ่กว่าทุกอย่างในแผง ไม่ใช่แถวหนึ่งในฟอร์ม */}
            <div className="pos-total">
              <span className="pos-total-ico"><Icon name="receipt" /></span>
              <span className="pos-total-txt">
                <span className="pos-total-lab">ยอดรวมทั้งสิ้น</span>
                <b className="pos-total-val">{money(sums.total)}</b>
              </span>
              <span className="pos-total-n">{sums.itemCount} รายการ</span>
            </div>

            <div className="pos-row">
              <PosField label="วันที่ขาย" icon="calendar">
                {/* วันที่ย้อนหลังเปลี่ยนตัวเลขปิดยอดของวันที่ปิดไปแล้ว จึงเปิดเฉพาะแอดมิน
                    ขึ้นไป คนอื่นเห็นวันที่แต่แก้ไม่ได้ — API ตรวจซ้ำอยู่ดี */}
                <DateField
                  value={saleDate}
                  readOnly={!inSystemZone(actor)}
                  onChange={setSaleDate}
                />
              </PosField>
              <PosField label="ช่องทางชำระเงิน" icon="card">
                <Select value={form.method} onChange={(e) => set('method', e.target.value)} options={PAY_METHODS} />
              </PosField>
            </div>

            <div className="pos-row one">
              <PosField label="รูปแบบการชำระ" icon="circleHalf">
                <Select
                  value={form.mode}
                  onChange={(e) => set('mode', e.target.value)}
                  options={[['full', 'ชำระเต็มจำนวน'], ['deposit', 'มัดจำ / ชำระบางส่วน'], ['none', 'ยังไม่รับเงิน']]}
                />
              </PosField>
            </div>

            {form.mode === 'deposit' && (
              <div className="pos-row one">
                <PosField label="ยอดที่รับวันนี้ (บาท)" icon="receipt">
                  <input
                    inputMode="decimal"
                    value={form.amount}
                    placeholder="กรอกยอดมัดจำ"
                    onChange={(e) => set('amount', e.target.value)}
                  />
                </PosField>
              </div>
            )}

            {form.method === 'cash' && payNow > 0 && (
              <div className="pos-row">
                <PosField label="รับเงินมา (บาท)" icon="banknote">
                  <input
                    inputMode="decimal"
                    value={form.received}
                    placeholder="0.00"
                    onChange={(e) => set('received', e.target.value)}
                  />
                </PosField>
                <PosOut label="เงินทอน (บาท)" icon="banknote" tone="change">
                  {money(change)}
                </PosOut>
              </div>
            )}

            {balance > 0 && (
              <div className="pos-row one">
                <PosOut label="ยอดค้างชำระ (บาท)" icon="hourglass" tone="money">
                  {money(balance)}
                </PosOut>
              </div>
            )}

            <hr className="pos-sep" />

            <span className="pos-sec"><Icon name="user" /> ข้อมูลลูกค้า</span>
            <div className="pos-row">
              <PosField label="ชื่อลูกค้า" icon="user">
                <input
                  value={form.customerName}
                  placeholder="เฉพาะมัดจำ / สั่งของ"
                  onChange={(e) => set('customerName', e.target.value)}
                />
              </PosField>
              <PosField label="เบอร์โทร" icon="phone">
                <input
                  inputMode="tel"
                  value={form.customerPhone}
                  placeholder="เฉพาะมัดจำ / สั่งของ"
                  onChange={(e) => set('customerPhone', e.target.value)}
                />
              </PosField>
            </div>

            {/* ─── คอนแทคเลนส์: ผูกลูกค้าจริงเพื่อให้ค่าสายตาเป็นประวัติของคนคนนั้น ───
                โผล่เฉพาะตอนในบิลมีของที่ถามค่าสายตา · บิลทั่วไปไม่เห็นอะไรเพิ่มเลย */}
            {needsRx && (
              <div className="pos-row one">
                {/* ไม่ส่ง icon ให้ตัวห่อ — .pos-f วางไอคอนแบบ absolute กึ่งกลางแนวตั้ง
                    ของกล่องแม่ ซึ่งถูกสำหรับช่องกรอกบรรทัดเดียว แต่แผงนี้สูงหลายบรรทัด
                    ไอคอนจะไปลอยทับช่องกรอกที่อยู่กลางแผง · ไอคอนรูปตาอยู่ที่ปุ่มแล้ว */}
                <PosField label="ค่าสายตาสำหรับคอนแทคเลนส์">
                  <div className="pos-rx">
                    {rx ? (
                      <div className="pos-rx-on">
                        <b>แนบค่าสายตาแล้ว</b>
                        <span className="muted">{rxFrom}</span>
                        <span className="pos-rx-vals">{eyeRefText(rx, 'RL')}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-light"
                          onClick={() => { setRx(null); setRxFrom(''); }}
                        >
                          ไม่แนบค่าสายตา
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* สองปุ่มนี้ต้องเห็นตั้งแต่วินาทีที่มีคอนแทคเลนส์ในบิล — เคยซ่อนไว้
                            หลังการเลือกลูกค้า แล้วหาไม่เจอว่าจะไปวัดสายตาตรงไหน ปิดปุ่มไว้
                            พร้อมบอกเหตุผล อ่านออกกว่าการไม่มีปุ่มให้เห็นเลย */}
                        <div className="pos-rx-acts">
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={!customer || !rounds.length}
                            onClick={() => setPickHistory((v) => !v)}
                          >
                            {pickHistory ? 'ปิดรายการ' : <><Icon name="download" /> เลือกจากประวัติ</>}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={!customer}
                            onClick={() => setExamOpen(true)}
                          >
                            <Icon name="eye" /> วัดสายตาใหม่
                          </button>
                        </div>

                        {customer && pickHistory && (
                          <div className="rx-history pos-rx-history">
                            {rounds.map((r, i) => {
                              /* รอบที่ยังไม่มีใบ final ใช้ค่าที่วัดได้ — ป้ายท้ายแถวบอกว่าเป็นแบบไหน */
                              const src = r.final || r.measured;
                              if (!src) return null;
                              return (
                                <button
                                  type="button"
                                  key={r.key}
                                  className="rx-history-row"
                                  onClick={() => {
                                    setRx(src);
                                    setRxFrom(`ผลวัด ${fmtDate(r.exam_date)}`
                                      + (r.case_code ? ` · ${r.case_code}` : '')
                                      + (r.final ? '' : ' · ค่าที่วัดได้'));
                                    setPickHistory(false);
                                  }}
                                >
                                  <b>{`${fmtDate(r.exam_date)}${r.case_code ? ` · ${r.case_code}` : ''}${i === 0 ? ' · ล่าสุด' : ''}`}</b>
                                  <GlassesUseTag value={roundGlassesUse(r)} />
                                  <span>{`R ${sphPower(src.r_sphere)} / ${cylPower(src.r_cylinder)} x ${src.r_axis || '—'}`}</span>
                                  <span>{`L ${sphPower(src.l_sphere)} / ${cylPower(src.l_cylinder)} x ${src.l_axis || '—'}`}</span>
                                  <span className="muted">{r.final ? 'ค่าที่ใช้จริง' : 'ค่าที่วัดได้'}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {customer ? (
                          <p className="pos-rx-hint">
                            <b>{custName(customer)}</b>
                            {customer.phone ? <span className="muted">{customer.phone}</span> : null}
                            {!rounds.length ? <span className="muted">ยังไม่มีผลวัดเดิมในระบบ</span> : null}
                            <button type="button" className="btn btn-sm btn-light" onClick={clearCustomer}>
                              เปลี่ยนลูกค้า
                            </button>
                          </p>
                        ) : (
                          <>
                            <p className="pos-rx-hint">
                              เลือกลูกค้าก่อน จึงจะกดสองปุ่มด้านบนได้ — หรือขายโดยไม่แนบค่าสายตาก็ได้
                            </p>
                            {newCust ? (
                              /* ลูกค้าหน้าใหม่ที่ยังไม่มีในระบบ — ต้องสร้างก่อนถึงจะวัดสายตาได้
                                 เพราะใบค่าสายตาต้องมีเจ้าของเสมอ (customer_id เป็น NOT NULL) */
                              <PosNewCustomer
                                onCreated={(c) => { pickCustomer(c); setNewCust(false); }}
                                onPickExisting={(c) => { pickCustomer(c); setNewCust(false); }}
                                onCancel={() => setNewCust(false)}
                              />
                            ) : (
                              <>
                                <Picker
                                  placeholder="ค้นชื่อ / เบอร์โทรลูกค้า"
                                  fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
                                  label={(c) => custName(c)}
                                  sub={(c) => c.phone || ''}
                                  onPick={pickCustomer}
                                  autoLoad={false}
                                />
                                <button
                                  type="button"
                                  className="btn btn-sm btn-light"
                                  onClick={() => setNewCust(true)}
                                >
                                  <Icon name="user" /> ลูกค้าใหม่ — ยังไม่มีในระบบ
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </PosField>
              </div>
            )}

            <div className="pos-row one">
              <PosField label="หมายเหตุ" icon="clipboard">
                <textarea
                  rows={1}
                  value={form.note}
                  placeholder="กรอกหมายเหตุ (ถ้ามี)"
                  onChange={(e) => set('note', e.target.value)}
                />
              </PosField>
            </div>

            {/* สถานะรับสินค้าแยกจากสถานะจ่ายเงินโดยสิ้นเชิง — ติ๊กได้แม้ยังค้างเงิน */}
            <label className={`pos-deliver${form.delivered ? '' : ' off'}`}>
              <span className="pos-deliver-ico"><Icon name={form.delivered ? 'checkCircle' : 'hourglass'} /></span>
              <span className="pos-deliver-txt">
                ลูกค้ารับสินค้าแล้ววันนี้
                <b className="pos-deliver-state">
                  {form.delivered
                    ? 'บิลนี้จะปิดงานทันที'
                    : 'รอลูกค้ามารับ — บิลยังไม่ปิด'}
                </b>
              </span>
              <input
                type="checkbox"
                checked={form.delivered}
                onChange={(e) => set('delivered', e.target.checked)}
              />
            </label>

            {errors.map((e) => <p className="pos-err" key={e}>{e}</p>)}

            <button
              type="button"
              className="btn btn-lg pos-go"
              disabled={busy || errors.length > 0 || items.length === 0}
              onClick={() => { setSaveError(null); setConfirming(true); }}
            >
              <Icon name="banknote" /> รับเงิน {money(payNow)}
            </button>
          </div>
        </aside>
      </div>

      {examOpen && customer && (
        <PosExamDialog
          customer={customer}
          onClose={() => setExamOpen(false)}
          onSaved={(row) => {
            setRx(row);
            setRxFrom(`วัดที่หน้าร้าน ${fmtDate(row.test_date)}`);
            setExamOpen(false);
            setPickHistory(false);
            reloadSessions();
            toast.ok('บันทึกผลวัดสายตาแล้ว — เข้าประวัติของลูกค้าเรียบร้อย');
          }}
        />
      )}

      {confirming && (
        <ConfirmSaleModal
          items={items}
          sums={sums}
          form={{ ...form, amount: payNow }}
          change={change}
          busy={busy}
          error={saveError}
          onBack={() => setConfirming(false)}
          onConfirm={save}
        />
      )}
    </div>
  );
}
