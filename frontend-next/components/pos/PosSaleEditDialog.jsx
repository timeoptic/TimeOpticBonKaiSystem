'use client';
/**
 * แก้ใบขาย POS ที่บันทึกไปแล้ว — ผู้ดูแลระบบเท่านั้น (ร้านขอ 28 ต.ค. 2026)
 *
 * แถวเดิมแก้ชื่อ / จำนวน / ราคาได้ · ลบแถวได้ · เพิ่มแถวจากรายการเดียวกับหน้าขาย ·
 * แก้ชื่อ เบอร์ลูกค้า และหมายเหตุได้ · บังคับเหตุผล แล้วสรุปสิ่งที่เปลี่ยนก่อนยืนยัน
 *
 * แถวสินค้าใช้ CartItemRow ตัวเดียวกับหน้าขาย · แถวเดิมทำเป็น "พิมพ์ชื่อเอง" เพื่อให้แก้ชื่อได้
 * ตรงแถว · ของจากคลังเปลี่ยนจำนวนหรือลบแถว ระบบคืน/ตัดสต็อกให้ที่ฝั่ง API
 *
 * ด่านจริงอยู่ที่ PUT /api/pos/sales/:id/items — ที่นี่แค่บอกก่อนกด
 */
import { useMemo, useRef, useState } from 'react';
import { money } from '../../lib/format.js';
import { useAsync } from '../../lib/hooks.js';
import {
  addItem, bumpQty, hiddenFromOther, lineTotal, removeItem, round2, setCustomName, setMeta, setPrice, setQty,
  toItemsPayload, validateCart,
} from '../../lib/pos/cart.js';
import { posApi } from '../../lib/pos/posApi.js';
import { Field } from '../ui.jsx';
import { Icon } from '../Icon.jsx';
import { useToast } from '../Toast.jsx';
import { useConfirm } from '../Confirm.jsx';
import { CartItemRow } from './CartItemRow.jsx';
import { ProductPicker } from './ProductPicker.jsx';
import { POS_MODES } from './PosModeCards.jsx';

const CHANGE_TH = { textAlign: 'left', fontWeight: 400, color: 'var(--ink-faint)', padding: '5px 12px 5px 0', whiteSpace: 'nowrap', verticalAlign: 'top' };

const newRef = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `edit-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** แถวเดิมของใบ → รูปของตะกร้า · ชื่อแก้ได้ผ่านช่อง "พิมพ์ชื่อเอง" */
const fromSale = (r) => ({
  key: `old-${r.id}`,
  id: Number(r.id),
  sku: r.sku_snapshot || '',
  name: r.product_name_snapshot,
  category_name: r.product_id ? 'ของจากคลัง · แก้จำนวนหรือลบ ระบบคืน/ตัดสต็อกให้' : '',
  pos_fields: [],
  pos_custom: true,
  custom_name: r.product_name_snapshot,
  quantity: Number(r.quantity),
  unit_price: round2(r.unit_price),
  item_meta: {},
});

const lineText = (name, qty, price) => `${name} × ${qty} @ ${money(price)}`;

export function PosSaleEditDialog({ sale, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const editRef = useRef(newRef());

  const [items, setItems] = useState(() => (sale.items || []).map(fromSale));
  const [mode, setMode] = useState('other');
  const [custName, setCustName] = useState(sale.customer_name_snapshot || '');
  const [custPhone, setCustPhone] = useState(sale.customer_phone_snapshot || '');
  const [note, setNote] = useState(sale.note || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const modeDef = POS_MODES.find((m) => m.key === mode);
  const { data: products, loading } = useAsync(
    (signal) => (modeDef.stockType ? posApi.stockProducts(modeDef.stockType, signal) : posApi.products(null, signal)),
    [mode],
  );
  const shown = useMemo(
    () => (products || []).filter((p) => p.stock || !hiddenFromOther(p)),
    [products],
  );

  const total = round2(items.reduce((s, it) => s + lineTotal(it), 0) - Number(sale.discount_amount || 0));
  const paid = round2(sale.paid_amount);
  const owing = total > paid + 0.001;

  /* สิ่งที่เปลี่ยน — ใช้ทั้งตัดสินว่ามีอะไรให้บันทึก และสรุปก่อนยืนยัน */
  const changes = useMemo(() => {
    const out = [];
    const kept = new Map(items.filter((it) => it.id).map((it) => [it.id, it]));
    (sale.items || []).forEach((r) => {
      const was = lineText(r.product_name_snapshot, Number(r.quantity), r.unit_price);
      const it = kept.get(Number(r.id));
      if (!it) { out.push(['ลบ', was, '—']); return; }
      const now = lineText(it.custom_name.trim() || r.product_name_snapshot, it.quantity, it.unit_price);
      if (now !== was) out.push(['แก้', was, now]);
    });
    items.filter((it) => !it.id).forEach((it) => {
      out.push(['เพิ่ม', '—', lineText(it.pos_custom ? it.custom_name || 'สินค้าพิมพ์เอง' : it.name, it.quantity, it.unit_price)]);
    });
    [['ชื่อลูกค้า', sale.customer_name_snapshot, custName],
      ['เบอร์โทร', sale.customer_phone_snapshot, custPhone],
      ['หมายเหตุ', sale.note, note]].forEach(([label, from, to]) => {
      if ((from || '').trim() !== to.trim()) out.push([label, from || '—', to.trim() || '—']);
    });
    return out;
  }, [items, sale, custName, custPhone, note]);

  const cartErrs = validateCart(items);
  const blocked = cartErrs[0]?.message
    || (total < paid - 0.001
      ? `ยอดใหม่ ${money(total)} ต่ำกว่าเงินที่รับแล้ว ${money(paid)} — แก้ยอดในประวัติการรับเงินก่อน`
      : null)
    || ((owing || sale.fulfillment_status !== 'delivered') && !custName.trim() && !custPhone.trim()
      ? 'ใบที่ยังค้างเงินหรือยังไม่ส่งมอบ ต้องมีชื่อหรือเบอร์โทรลูกค้า'
      : null);
  const canSave = !busy && !blocked && changes.length > 0 && reason.trim() !== '';
  const badKeys = new Set(cartErrs.map((e) => e.key));

  const save = async () => {
    if (!canSave) return;
    const sure = await confirm('ยืนยันแก้ไขรายการขาย', (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {changes.map(([label, from, to], i) => (
            <tr key={i}>
              <th style={CHANGE_TH}>{label}</th>
              <td style={{ textAlign: 'right', padding: '5px 0' }}>
                <span className="muted">{from}</span> → <b>{to}</b>
              </td>
            </tr>
          ))}
          <tr>
            <th style={CHANGE_TH}>ยอดสุทธิ</th>
            <td style={{ textAlign: 'right', padding: '5px 0' }}>
              <span className="muted">{money(sale.total_amount)}</span> → <b>{money(total)}</b>
            </td>
          </tr>
          <tr>
            <th style={CHANGE_TH}>เหตุผล</th>
            <td style={{ textAlign: 'right', padding: '5px 0' }}>{reason.trim()}</td>
          </tr>
        </tbody>
      </table>
    ), { confirmText: 'ยืนยันแก้ไข' });
    if (!sure) return;

    setBusy(true);
    try {
      await posApi.editItems(sale.id, {
        items: items.map((it) => (it.id
          ? { id: it.id, product_name: it.custom_name.trim(), quantity: it.quantity, unit_price: it.unit_price }
          : toItemsPayload([it])[0])),
        customer_name: custName.trim(),
        customer_phone: custPhone.trim(),
        note: note.trim(),
        reason: reason.trim(),
        edit_ref: editRef.current,
      });
      toast.ok('แก้ไขรายการขายแล้ว');
      onSaved();
    } catch (e) {
      toast.err(e);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="แก้ไขรายการขาย" style={{ maxWidth: 980 }}>
        <h3>แก้ไขรายการขาย {sale.pos_no}</h3>
        <div className="m-body">
          <div className="pos-cart">
            <div className="pos-grid pos-thead" aria-hidden="true">
              <span>สินค้า</span><span>จำนวน</span><span>ราคาต่อหน่วย</span><span>รวมเงิน</span><span>จัดการ</span>
            </div>
            {items.length === 0
              ? <p className="muted" style={{ padding: 12 }}>ยังไม่มีสินค้า — ใบขายต้องมีอย่างน้อย 1 รายการ</p>
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

          <Field label="เพิ่มสินค้า">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {POS_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`btn btn-sm ${m.key === mode ? '' : 'btn-light'}`}
                  onClick={() => setMode(m.key)}
                >
                  <Icon name={m.icon} /> {m.title.replace('ขาย', '')}
                </button>
              ))}
            </div>
            <ProductPicker
              products={shown}
              placeholder={loading ? 'กำลังโหลดรายการสินค้า…' : 'ค้นหาชื่อ แบรนด์ หรือรหัส SKU แล้วกดเพื่อเพิ่ม'}
              onPick={(p) => setItems((c) => addItem(c, p))}
            />
          </Field>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <Field label="ชื่อลูกค้า">
                <input value={custName} onChange={(e) => setCustName(e.target.value)} autoComplete="off" />
              </Field>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <Field label="เบอร์โทร">
                <input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} inputMode="tel" autoComplete="off" />
              </Field>
            </div>
          </div>
          <Field label="หมายเหตุ">
            <input value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          </Field>

          <p style={{ margin: '4px 0 12px' }}>
            ยอดสุทธิ <span className="muted">{money(sale.total_amount)}</span> → <b>{money(total)}</b>
            {' · '}รับเงินแล้ว {money(paid)}
            {owing && <> · <b>ค้าง {money(total - paid)}</b></>}
          </p>

          <Field label="เหตุผลที่แก้ไข *">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น พนักงานคีย์ราคาผิด ลูกค้าเปลี่ยนสินค้า"
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="m-foot">
          {blocked ? <span className="process-blockers" style={{ marginRight: 'auto' }}>{blocked}</span> : null}
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="button" className="btn" onClick={save} disabled={!canSave}>
            <Icon name="check" />
            {busy ? ' กำลังบันทึก…' : ' บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  );
}
