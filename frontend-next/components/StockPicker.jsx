'use client';
/**
 * Choose one stock item.
 *
 * One line per product (group=product): a batch of nine lenses is one line
 * saying "เหลือ 9 ชิ้น", and two batches of the same lens are still one line —
 * picking it takes the oldest batch that has stock. The per-unit shape the API
 * also serves is for the stock screen, not for picking.
 *
 * Once something is chosen the search collapses into a single line: the form
 * below it is what the staff need to see, not thirty products they already
 * scrolled past.
 */
import { useState } from 'react';
import { Picker } from './Picker.jsx';
import { Icon } from './Icon.jsx';
import { StockEmbedModal } from './StockEmbedModal.jsx';
import { useToast } from './Toast.jsx';
import { api } from '../lib/apiClient.js';

/** product_name usually already starts with the brand — don't say it twice */
export const stockLabel = (r) => {
  const name = r.product_name || '';
  const brand = r.brand || r.brand_name || '';
  return brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
};

/**
 * ตอนเลือกสินค้า คำถามคือ "ชิ้นนี้ใช่ไหม และยังมีของไหม" ไม่ใช่ "ชิ้นนี้เท่าไหร่" —
 * ราคาที่ลูกค้าจ่ายจริงคนขายเป็นคนตั้งในออเดอร์ ราคาต้นทางเป็นแค่ค่าตั้งต้นที่
 * OrderFormView เติมให้ในช่องราคาเมื่อเลือกแล้ว (ดู setP ที่ pickInto)
 * เอาตัวเลขราคาออกจากบรรทัดนี้ยังทำให้ชื่อสินค้ากับ SKU ไม่โดนตัดทิ้งบนจอแคบด้วย
 */
const stockSub = (r) => [
  /* id เป็น null = ยังไม่เคยรับของเข้าสักล็อต (มีแต่ชื่อในแคตตาล็อก) เลือกได้ ขายแล้วยอดติดลบ */
  r.id == null
    ? 'ยังไม่เคยรับของเข้า'
    : (Number(r.remaining_qty) ? `เหลือ ${r.remaining_qty} ชิ้น` : 'หมดสต็อก'),
  Number(r.lot_count) > 1 ? `${r.lot_count} ล็อต` : null,
  r.sku ? 'SKU ' + r.sku : null,
  r.location || null,
].filter(Boolean).join(' · ');

export function StockPicker({ type, onPick, selectedId = null, picked = null, onClear = null }) {
  const { err } = useToast();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [opening, setOpening] = useState(false);
  /* บังคับให้ Picker โหลดรายการใหม่หลังเพิ่มสินค้า ไม่งั้นของที่เพิ่งลงคลังจะไม่โผล่
     จนกว่าจะพิมพ์ค้นหาใหม่ */
  const [listNonce, setListNonce] = useState(0);

  const afterCreate = (row) => {
    setAdding(false);
    setListNonce((v) => v + 1);
    if (row) { setOpen(false); onPick(row); }
  };

  /* ออเดอร์เก็บ id ของล็อต สินค้าที่ยังไม่เคยรับของเข้าจึงต้องให้ฝั่งคลังเปิดล็อตค้างส่ง
     (ยอดศูนย์) ก่อน — ใบเดียวกับที่ยอดติดลบจะไปลงตอนยืนยันการขาย */
  const choose = async (r) => {
    if (r.id != null) {
      setOpen(false);
      onPick(r);
      return;
    }
    if (opening) return;
    setOpening(true);
    try {
      const row = await api.post('/api/stock/backorder-lot', { sku: r.sku });
      setOpen(false);
      onPick(row);
    } catch (ex) {
      err(ex);
    } finally {
      setOpening(false);
    }
  };

  if (picked && !open) {
    return (
      <div className="picked-item">
        <Icon name="box" />
        <b>{stockLabel(picked)}</b>
        {/* title ไว้กู้ข้อความที่ถูก … ตัดไปตอนแถวแคบ (ดู .picked-item .muted) */}
        <span className="muted" title={stockSub(picked)}>{stockSub(picked)}</span>
        <span className="p-id">#{picked.id}</span>
        <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(true)}>เปลี่ยน</button>
        {onClear && (
          <button type="button" className="btn btn-sm btn-light" onClick={onClear}>ล้าง</button>
        )}
      </div>
    );
  }

  /* บอกวิธีพิมพ์ที่คนขายใช้จริง — พิมพ์หลายคำได้ ("MC 1.6") ไม่ต้องพิมพ์ชื่อ
     สินค้าให้ตรง · ฝั่ง API เป็นคนตัดคำให้ (api/core/StockSearch.php) */
  const placeholder = type === 'Lens'
    ? 'ค้นหาเลนส์ — เช่น MC 1.6 / Blue 1.6 / ชื่อ / SKU'
    : `ค้นหาสินค้า${type ? ' (' + type + ')' : ''} — ชื่อ / ยี่ห้อ / รุ่น / สี / SKU`;

  return (
    <>
      <Picker
        key={listNonce}
        placeholder={placeholder}
        fetcher={(term) => api.get('/api/stock', {
          q: term, type: type || undefined, sold: 0, group: 'product', limit: 30,
        })}
        label={stockLabel}
        sub={stockSub}
        onPick={choose}
        selectedId={selectedId}
      />
      <div className="pick-actions">
        {/* ของที่เพิ่งมาถึงร้านยังไม่มีใครลงคลัง แต่ลูกค้ายืนรออยู่ — ลงตรงนี้ได้เลย
            ไม่ต้องทิ้งออเดอร์ที่กรอกค้างไว้ไปเปิดหน้าสต็อก */}
        <button type="button" className="btn btn-sm btn-light" onClick={() => setAdding(true)}>
          <Icon name="sparkle" /> ไม่พบสินค้า? เพิ่มใหม่
        </button>
        {picked && (
          <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(false)}>
            ยกเลิกการเปลี่ยน
          </button>
        )}
      </div>

      {/* ฟอร์มตัวจริงของฝั่งคลัง ฝังมาเป็น iframe — ฟอร์มเดียวกับที่หน้ารับของ
          ใช้ ไม่ใช่ของที่หน้าตาคล้ายกัน · เหตุผลที่ต้องฝังอยู่ใน StockEmbedModal */}
      {adding && (
        <StockEmbedModal
          what="product"
          type={type || 'Frame'}
          title={type === 'Lens' ? 'เพิ่มเลนส์เข้าคลัง' : 'เพิ่มสินค้าเข้าคลัง'}
          onClose={() => setAdding(false)}
          onProduct={afterCreate}
        />
      )}
    </>
  );
}
