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
import { LensPicker } from './LensPicker.jsx';
import { Icon } from './Icon.jsx';
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

/* ช่องคงเหลือของตารางเลนส์ (LensPicker) — ข้อมูลเดียวกับ stockSub แต่ SKU มีคอลัมน์ของตัวเอง */
const lensStock = (r) => {
  if (r.id == null) return { text: 'ยังไม่เคยรับของเข้า', tone: 'new' };
  const left = Number(r.remaining_qty);
  const text = [
    left ? `เหลือ ${r.remaining_qty} ชิ้น` : 'หมดสต็อก',
    Number(r.lot_count) > 1 ? `${r.lot_count} ล็อต` : null,
    r.location || null,
  ].filter(Boolean).join(' · ');
  return { text, tone: left > 0 ? 'ok' : 'out' };
};

export function StockPicker({ type, onPick, selectedId = null, picked = null, onClear = null }) {
  const { err } = useToast();
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);

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
    ? 'ชื่อเลนส์ / ยี่ห้อ / SKU'
    : `ค้นหาสินค้า${type ? ' (' + type + ')' : ''} — ชื่อ / ยี่ห้อ / รุ่น / สี / SKU`;

  return (
    <>
      {/* เลนส์มีตัวกรอง Coating / SPH / CYL เพิ่ม — มีตัวกรองอยู่ขอ 200 แถว เพราะคือการหา
          ค่าสายตาเดียวให้ครบทุก index ทุกยี่ห้อ ไม่ใช่ 30 ตัวแรกของ Coating ที่มีเป็นพันรุ่น */}
      {type === 'Lens' ? (
        <LensPicker
          placeholder={placeholder}
          fetcher={(term, filters) => api.get('/api/stock', {
            q: term, type, sold: 0, group: 'product',
            limit: Object.keys(filters).length ? 200 : 30, ...filters,
          })}
          label={stockLabel}
          stock={lensStock}
          onPick={choose}
          selectedId={selectedId}
        />
      ) : (
        <Picker
          placeholder={placeholder}
          fetcher={(term) => api.get('/api/stock', {
            q: term, type: type || undefined, sold: 0, group: 'product', limit: 30,
          })}
          label={stockLabel}
          sub={stockSub}
          onPick={choose}
          selectedId={selectedId}
        />
      )}
      {/* ปุ่ม "ไม่พบสินค้า? เพิ่มใหม่" ถูกเอาออกตามที่ร้านขอ 17 ก.ย. 2026 — เพิ่มสินค้าเข้าคลังทำที่หน้าสต็อก */}
      {picked && (
        <div className="pick-actions">
          <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(false)}>
            ยกเลิกการเปลี่ยน
          </button>
        </div>
      )}
    </>
  );
}
