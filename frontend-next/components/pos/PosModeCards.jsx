'use client';
/**
 * การ์ดเลือก "ขายอะไร" บนหน้า POS (Bewell เหลือสองใบ) — ร้านขอ 18 ก.ย. 2026
 *
 * การ์ดคือแหล่งที่ช่องค้นหาไปหา ไม่ใช่ประเภทของบิล: บิลเดียวใส่ของปนกันได้ สลับการ์ด
 * แล้วของในบิลไม่หาย · สองใบแรกดึงจากคลังและตัดสต็อกจริงตอนบันทึก ใบที่สามคือรายการ
 * ของหน้าร้าน (pos_items) ที่ไม่ตัดสต็อกเหมือนเดิม
 */
import { Icon } from '../Icon.jsx';

export const POS_MODES = [
  { key: 'frame', icon: 'glasses', title: 'ขายกรอบแว่น', sub: 'ดึงจากคลัง · ตัดสต็อก', stockType: 'Frame' },
  /* Bewell ไม่ขายคอนแทคเลนส์หน้าร้าน — การ์ด 'contact' (stockType ContactLen) เอาออกแล้ว */
  { key: 'other', icon: 'tag', title: 'สินค้าอื่น / บริการ', sub: 'น้ำยา กล่องแว่น ค่าบริการ', stockType: null },
];

export function PosModeCards({ mode, onMode }) {
  return (
    <div className="pos-modes" role="radiogroup" aria-label="เลือกประเภทสินค้าที่จะขาย">
      {POS_MODES.map((m) => {
        const on = m.key === mode;
        return (
          <button
            type="button"
            key={m.key}
            role="radio"
            aria-checked={on}
            className={`pos-mode${on ? ' on' : ''}`}
            onClick={() => onMode(m.key)}
          >
            <span className="pos-mode-ico"><Icon name={m.icon} /></span>
            <span className="pos-mode-txt">
              <b>{m.title}</b>
              <small>{m.sub}</small>
            </span>
            <span className="pos-mode-dot" aria-hidden="true">{on && <Icon name="check" />}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * ชิปหมวดหมู่ใต้ช่องค้นหา — ของคลังแยกตามแบรนด์ ของหน้าร้านแยกตามกลุ่ม
 * กดชิปที่เลือกอยู่ซ้ำ = ดูทั้งหมด
 */
export function PosCategoryChips({ chips, value, onChange }) {
  if (!chips.length) return null;
  return (
    <div className="pos-chips-wrap">
      <span className="pos-lab">หมวดหมู่ที่นิยม</span>
      <div className="pos-chips">
        {chips.map((c) => {
          const on = c === value;
          return (
            <button
              type="button"
              key={c}
              className={`pos-chip${on ? ' on' : ''}`}
              aria-pressed={on}
              onClick={() => onChange(on ? null : c)}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}
