/**
 * Pick one physical stock item (a lens or a frame) for an order.
 * Controlled: the parent owns `value` and gets the whole row back.
 */
import { api } from '../api/client.js';
import { Picker } from './Picker.jsx';
import { money } from '../lib/format.js';

export function StockPicker({ label, type, value, onChange }) {
  return (
    <div className="stack">
      <div>
        {value ? (
          <div className="row">
            <span className="badge blue">#{value.id}</span>
            <b>{value.product_name}</b>
            <span className="muted">{money(value.product_price)}</span>
            <button type="button" className="btn btn-sm btn-light" onClick={() => onChange(null)}>
              ✕ เอาออก
            </button>
          </div>
        ) : <span className="muted">ยังไม่ได้เลือก</span>}
      </div>
      <Picker
        placeholder={`ค้นหา${label}ในคลัง (ชื่อ / รหัส)`}
        fetcher={(q) => api.get('/api/stock', { q, type, sold: 0, limit: 40 })}
        label={(r) => r.product_name}
        sub={(r) => `${money(r.product_price)}${r.location ? ' · ' + r.location : ''}`}
        selectedId={value?.id}
        onPick={onChange}
      />
    </div>
  );
}
