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
import { api } from '../lib/apiClient.js';
import { money } from '../lib/format.js';

/** product_name usually already starts with the brand — don't say it twice */
export const stockLabel = (r) => {
  const name = r.product_name || '';
  const brand = r.brand || r.brand_name || '';
  return brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
};

const stockSub = (r) => [
  money(r.product_price),
  Number(r.remaining_qty) ? `เหลือ ${r.remaining_qty} ชิ้น` : 'หมดสต็อก',
  Number(r.lot_count) > 1 ? `${r.lot_count} ล็อต` : null,
  r.sku ? 'SKU ' + r.sku : null,
  r.location || null,
].filter(Boolean).join(' · ');

export function StockPicker({ type, onPick, selectedId = null, picked = null, onClear = null }) {
  const [open, setOpen] = useState(false);

  if (picked && !open) {
    return (
      <div className="picked-item">
        <Icon name="box" />
        <b>{stockLabel(picked)}</b>
        <span className="muted">{stockSub(picked)}</span>
        <span className="p-id">#{picked.id}</span>
        <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(true)}>เปลี่ยน</button>
        {onClear && (
          <button type="button" className="btn btn-sm btn-light" onClick={onClear}>ล้าง</button>
        )}
      </div>
    );
  }

  return (
    <>
      <Picker
        placeholder={`ค้นหาสินค้า${type ? ' (' + type + ')' : ''} — ชื่อ / ยี่ห้อ / SKU`}
        fetcher={(term) => api.get('/api/stock', {
          q: term, type: type || undefined, sold: 0, group: 'product', limit: 30,
        })}
        label={stockLabel}
        sub={stockSub}
        onPick={(r) => { setOpen(false); onPick(r); }}
        selectedId={selectedId}
      />
      {picked && (
        <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(false)}>
          ยกเลิกการเปลี่ยน
        </button>
      )}
    </>
  );
}
