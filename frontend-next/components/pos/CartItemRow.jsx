'use client';
/**
 * หนึ่งแถวในตะกร้า
 *
 * แก้ได้ทั้งจำนวนและราคาต่อชิ้นตรงแถวเลย ไม่ต้องเปิดกล่องแก้ไข — หน้าร้านลดราคา
 * ให้ลูกค้าประจำเป็นเรื่องปกติ และการต้องกดเข้าไปแก้ทีละชิ้นคือขั้นตอนที่ทำให้
 * พนักงานเลิกใช้ระบบแล้วไปจดใส่กระดาษแทน
 *
 * ราคาที่พิมพ์ตรงนี้คือราคาที่ถูกบันทึกเป็น snapshot ในใบขาย ไม่ใช่ราคาแคตตาล็อก
 */
import { money } from '../../lib/format.js';
import { lineTotal } from '../../lib/pos/cart.js';
import { Icon } from '../Icon.jsx';

export function CartItemRow({ item, bad, onQty, onBump, onPrice, onMeta, onCustomName, onRemove }) {
  return (
    <div className={`pos-line${bad ? ' is-bad' : ''}`}>
      <div className="pos-line-top">
        <div className="pos-line-name">
          {item.pos_custom ? (
            <input
              value={item.custom_name}
              placeholder="พิมพ์ชื่อสินค้า"
              onChange={(e) => onCustomName(e.target.value)}
            />
          ) : (
            <b>{item.name}</b>
          )}
          <small>
            {item.sku}
            {item.category_name ? ` · ${item.category_name}` : ''}
          </small>
        </div>
        <button type="button" className="pos-del" onClick={onRemove} aria-label="ลบรายการ"><Icon name="x" /></button>
      </div>

      <div className="pos-line-ctl">
        <div className="pos-step">
          <button type="button" onClick={() => onBump(-1)} aria-label="ลดจำนวน">−</button>
          <input
            inputMode="numeric"
            value={item.quantity}
            onChange={(e) => onQty(e.target.value)}
            aria-label="จำนวน"
          />
          <button type="button" onClick={() => onBump(1)} aria-label="เพิ่มจำนวน">+</button>
        </div>

        <input
          className="pos-price"
          inputMode="decimal"
          value={item.unit_price}
          onChange={(e) => onPrice(e.target.value)}
          aria-label="ราคาต่อชิ้น"
        />

        <span className="pos-line-sum">{money(lineTotal(item))}</span>
      </div>

      {/* ช่องกรอกเพิ่มตามชนิดสินค้า — นิยามมาจาก pos_items.pos_fields
          ผูกกับแถวนี้แถวเดียว ไม่ใช่ช่องกลางของทั้งใบ */}
      {(item.pos_fields || []).length > 0 && (
        <div className="pos-meta">
          {item.pos_fields.map((f) => {
            /* ช่องแบบตัวเลือกเป็นปุ่ม ไม่ใช่ dropdown — คอนแทคเลนส์ขายแยกข้าง ปุ่มที่
               เห็นค่าทั้งหมดพร้อมกันกดถูกกว่าบนแท็บเล็ตที่หน้าร้านใช้ และอ่านย้อนได้ว่า
               เลือกอะไรไว้โดยไม่ต้องกางออกมาดู · กดตัวที่เลือกอยู่ซ้ำ = ล้างค่า เผื่อกดพลาด */
            if (f.type === 'choice') {
              const cur = String(item.item_meta?.[f.key] ?? '');
              return (
                <div className="pos-meta-choice" key={f.key} role="group" aria-label={f.label}>
                  <span className="pos-lab">{f.label}{f.required ? ' *' : ''}</span>
                  <div className="pos-meta-opts">
                    {(f.options || []).map(([code, text]) => {
                      const on = cur === code;
                      return (
                        <button
                          type="button"
                          key={code}
                          className={`btn btn-sm${on ? '' : ' btn-light'}`}
                          aria-pressed={on}
                          onClick={() => onMeta(f.key, on ? '' : code)}
                        >
                          {text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }
            return (
              <label key={f.key}>
                {f.label}{f.required ? ' *' : ''}
                <input
                  value={item.item_meta?.[f.key] ?? ''}
                  onChange={(e) => onMeta(f.key, e.target.value)}
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
