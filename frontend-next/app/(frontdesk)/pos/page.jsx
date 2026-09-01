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
import { money, todayISO } from '../../../lib/format.js';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { isAdminUp } from '../../../lib/roles.js';
import { Card, Loading } from '../../../components/ui.jsx';
import { useToast } from '../../../components/Toast.jsx';

import { posApi, PAY_METHODS } from '../../../lib/pos/posApi.js';
import {
  addItem, removeItem, setQty, bumpQty, setPrice, setMeta, setCustomName,
  totals, changeFor, validateCart, validatePayment, toItemsPayload,
} from '../../../lib/pos/cart.js';
import { ProductPicker } from '../../../components/pos/ProductPicker.jsx';
import { CartItemRow } from '../../../components/pos/CartItemRow.jsx';
import { ConfirmSaleModal } from '../../../components/pos/ConfirmSaleModal.jsx';
import { PosField, PosOut } from '../../../components/pos/PosField.jsx';

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
const newRef = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export default function PosPage() {
  const { actor } = useAuth();
  const toast = useToast();

  const { data: products, loading, error } = useAsync(() => posApi.products(), []);

  const [items, setItems] = useState([]);
  const [form, setForm] = useState(blankForm);
  const [saleDate, setSaleDate] = useState(todayISO());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [done, setDone] = useState(null);
  const clientRef = useRef(newRef());

  const set = useCallback((k, v) => setForm((f) => ({ ...f, [k]: v })), []);
  const sums = useMemo(() => totals(items), [items]);

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

  const resetAll = () => {
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
        items: toItemsPayload(items),
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
              <div className="pos-tick">✅</div>
              <h2>บันทึกการขายสำเร็จ</h2>
              <div className="pos-no">{done.pos_no}</div>
              <div className="pos-done-figs">
                <div className="pos-sum-row"><span>ยอดขาย</span><b>{money(done.total_amount)}</b></div>
                <div className="pos-sum-row"><span>ยอดชำระ</span><b>{money(done.paid_amount)}</b></div>
                <div className="pos-sum-row"><span>ยอดค้าง</span><b>{money(done.balance_amount)}</b></div>
              </div>
            </div>
            <button type="button" className="pos-btn primary" onClick={resetAll}>🛒 ขายรายการใหม่</button>
            <Link className="pos-btn link" href={`/pos/detail/?id=${done.id}`}>ดูรายละเอียดใบนี้</Link>
            <Link className="pos-btn link" href="/pos/history/">↻ ดูประวัติการขาย POS</Link>
            {/* [พิมพ์ใบเสร็จ] จะมาลงตรงนี้ — เว้นที่ไว้แล้ว ยังไม่มีแบบใบเสร็จ */}
            <Link className="pos-btn back" href="/">← กลับไปหน้าระบบแว่นตา (Main)</Link>
          </div>
        </div>
      </div>
    );
  }

  /* ---- หน้าขาย ---- */
  return (
    <div className="pos">
      <div className="pos-card">
        <div className="pos-card-in">

          <div className="pos-head">
            <span className="pos-mark">🧾</span>
            <h1>ระบบ POS ด่วน</h1>
            <p>🛒 ขายสินค้าทั่วไป</p>
            <div className="pos-who">ผู้ขาย: {actor?.displayName || '—'}</div>
          </div>

          <div className="pos-row">
            <PosField label="วันที่ขาย:" icon="📅">
              {/* วันที่ย้อนหลังเปลี่ยนตัวเลขปิดยอดของวันที่ปิดไปแล้ว จึงเปิดเฉพาะแอดมิน
                  ขึ้นไป คนอื่นเห็นวันที่แต่แก้ไม่ได้ — API ตรวจซ้ำอยู่ดี */}
              <input
                type="date"
                value={saleDate}
                readOnly={!isAdminUp(actor)}
                onChange={(e) => setSaleDate(e.target.value)}
              />
            </PosField>
            <PosField label="ช่องทางชำระเงิน:" icon="💳" select>
              <select value={form.method} onChange={(e) => set('method', e.target.value)}>
                {PAY_METHODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </PosField>
          </div>

          <div className="pos-row one">
            <ProductPicker products={products || []} onPick={(p) => setItems((c) => addItem(c, p))} />
          </div>

          <div className="pos-row one">
            <span className="pos-lab">รายการสินค้า:</span>
            <div className="pos-cart">
              {items.length === 0
                ? <div className="pos-cart-empty">ยังไม่มีสินค้า — ค้นหาด้านบนแล้วกดเพื่อเพิ่ม</div>
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
                    onRemove={() => setItems((c) => removeItem(c, it.key))}
                  />
                ))}
            </div>
          </div>

          <div className="pos-row">
            <PosField label="ชื่อลูกค้า:" icon="👤">
              <input
                value={form.customerName}
                placeholder="กรอกเมื่อเป็นการมัดจำ หรือสั่งของ"
                onChange={(e) => set('customerName', e.target.value)}
              />
            </PosField>
            <PosField label="เบอร์โทร:" icon="📞">
              <input
                inputMode="tel"
                value={form.customerPhone}
                placeholder="กรอกเมื่อเป็นการมัดจำ หรือสั่งของ"
                onChange={(e) => set('customerPhone', e.target.value)}
              />
            </PosField>
          </div>

          <div className="pos-row one">
            <PosField label="หมายเหตุ (เพิ่มเติม):" icon="💬">
              <textarea
                rows={1}
                value={form.note}
                placeholder="กรอกหมายเหตุ (ถ้ามี)"
                onChange={(e) => set('note', e.target.value)}
              />
            </PosField>
          </div>

          <hr className="pos-sep" />

          <div className="pos-row">
            <PosOut label="ยอดรวม (บาท):" icon="💰" tone="money">
              {money(sums.total)}
            </PosOut>
            <PosField label="รูปแบบการชำระ:" icon="⚖️" select>
              <select value={form.mode} onChange={(e) => set('mode', e.target.value)}>
                <option value="full">ชำระเต็มจำนวน</option>
                <option value="deposit">มัดจำ / ชำระบางส่วน</option>
                <option value="none">ยังไม่รับเงิน</option>
              </select>
            </PosField>
          </div>

          {form.mode === 'deposit' && (
            <div className="pos-row one">
              <PosField label="ยอดที่รับวันนี้ (บาท):" icon="🧾">
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
              <PosField label="รับเงินมา (บาท):" icon="💵">
                <input
                  inputMode="decimal"
                  value={form.received}
                  placeholder="กรอกจำนวนเงินที่รับมา"
                  onChange={(e) => set('received', e.target.value)}
                />
              </PosField>
              <PosOut label="เงินทอน (บาท):" icon="💸" tone="change">
                {money(change)}
              </PosOut>
            </div>
          )}

          {balance > 0 && (
            <div className="pos-row one">
              <PosOut label="ยอดค้างชำระ (บาท):" icon="⏳" tone="money">
                {money(balance)}
              </PosOut>
            </div>
          )}

          {/* สถานะรับสินค้าแยกจากสถานะจ่ายเงินโดยสิ้นเชิง — ติ๊กได้แม้ยังค้างเงิน */}
          <label className={`pos-deliver${form.delivered ? '' : ' off'}`}>
            <input
              type="checkbox"
              checked={form.delivered}
              onChange={(e) => set('delivered', e.target.checked)}
            />
            <span className="pos-deliver-txt">
              🧺 ลูกค้ารับสินค้าแล้ววันนี้ (ถ้าเป็นการสั่งของ/รอของเข้า ให้เอาเครื่องหมายออก)
              <b className="pos-deliver-state">
                {form.delivered
                  ? '✓ ส่งมอบสินค้าแล้ว — บิลนี้จะปิดงานทันที'
                  : '⏳ ยังไม่ส่งมอบ / รอลูกค้ามารับ'}
              </b>
            </span>
          </label>

          {errors.map((e) => <p className="pos-err" key={e}>{e}</p>)}

          <button
            type="button"
            className="pos-btn primary"
            disabled={busy || errors.length > 0 || items.length === 0}
            onClick={() => { setSaveError(null); setConfirming(true); }}
          >
            🛒 ชำระเงิน / บันทึกการขาย
          </button>

          <Link className="pos-btn link" href="/pos/history/">
            ↻ ดูประวัติการขาย POS / เก็บยอดค้างชำระ
          </Link>
          <Link className="pos-btn back" href="/">← กลับไปหน้าระบบแว่นตา (Main)</Link>
        </div>
      </div>

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
