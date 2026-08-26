'use client';
/** Thin wrapper over Picker.jsx for choosing an available stock item. */
import { Picker } from './Picker.jsx';
import { api } from '../lib/apiClient.js';
import { money } from '../lib/format.js';

export function StockPicker({ type, onPick, selectedId = null }) {
  return (
    <Picker
      placeholder={`ค้นหาสินค้า${type ? ' (' + type + ')' : ''}…`}
      fetcher={(term) => api.get('/api/stock', { q: term, type: type || undefined, sold: 0, limit: 30 })}
      label={(r) => `${r.brand ? r.brand + ' ' : ''}${r.product_name}`}
      sub={(r) => `${r.sku ? 'SKU ' + r.sku + ' — ' : ''}${money(r.product_price)}`}
      onPick={onPick}
      selectedId={selectedId}
    />
  );
}
