'use client';
/**
 * ช่องค้นหา/เลือกสินค้า
 *
 * รายการที่ค้นมาจากการ์ดที่เลือกอยู่ (ดู PosModeCards): กรอบ/คอนแทคเลนส์มาจากคลัง
 * (`/api/pos/stock-products`) ส่วนสินค้าอื่นมาจาก `/api/pos/products` (pos_items) —
 * ไม่มีรายการสินค้าตัวไหนเขียนไว้ในไฟล์นี้
 *
 * โหลดครั้งเดียวต่อการ์ดแล้วกรองในเครื่อง ไม่ยิง API ทุกตัวอักษร — หน้าร้านพิมพ์ไป
 * คุยกับลูกค้าไป จะรอ debounce ไม่ได้
 *
 * กด Enter = หยิบตัวแรกที่ยังมีของ · ของจากคลังที่หมดแล้วยังโชว์ (เป็นสีเทา กดไม่ได้)
 * เพื่อให้พนักงานรู้ว่าพิมพ์ถูกแล้ว แค่ของหมด ไม่ใช่ไปหาชื่ออื่นต่อ
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from '../../lib/format.js';
import { Icon } from '../Icon.jsx';

const soldOut = (p) => p.stock && Number(p.on_hand) <= 0;

export function ProductPicker({ products, onPick, placeholder }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  /* คลิกที่อื่นแล้วปิดรายการ — ไม่งั้นมันค้างทับตะกร้าอยู่อย่างนั้น */
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const hits = useMemo(() => {
    const t = term.trim().toLowerCase();
    const rows = !t ? products : products.filter((p) => {
      const hay = `${p.name} ${p.sku} ${p.brand || ''} ${p.category_name || ''}`.toLowerCase();
      /* ทุกคำต้องเจอ ไม่ใช่ทั้งประโยคต้องติดกัน — "acuvue astig" จึงหาเจอ */
      return t.split(/\s+/).every((w) => hay.includes(w));
    });
    return rows.slice(0, 60);
  }, [products, term]);

  /* จัดกลุ่มเพื่อให้กวาดตาหาได้เร็วกว่ารายการยาวเรียงเดียว — ของคลังจัดตามแบรนด์ */
  const groups = useMemo(() => {
    const out = [];
    let last = null;
    hits.forEach((p) => {
      const head = p.stock ? (p.brand || 'ไม่ระบุแบรนด์') : p.category_name;
      if (head !== last) {
        out.push({ head, items: [] });
        last = head;
      }
      out[out.length - 1].items.push(p);
    });
    return out;
  }, [hits]);

  const pick = (p) => {
    if (soldOut(p)) return;
    onPick(p);
    setTerm('');
    setOpen(false);
  };

  return (
    <div className="pos-search" ref={box}>
      <div className="pos-f pos-f-search">
        <span className="pos-ico icon-only" aria-hidden="true"><Icon name="search" /></span>
        <input
          value={term}
          placeholder={placeholder || 'ค้นหาชื่อสินค้า หรือรหัส SKU …'}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            const first = hits.find((p) => !soldOut(p));
            if (e.key === 'Enter' && first) { e.preventDefault(); pick(first); }
            if (e.key === 'Escape') setOpen(false);
          }}
          aria-label="ค้นหาสินค้า"
        />
      </div>

      {open && (
        <div className="pos-results">
          {groups.length === 0 && <div className="pos-hit"><span className="pos-hit-name">ไม่พบสินค้าที่ค้นหา</span></div>}
          {groups.map((g) => (
            <div key={g.head}>
              <div className="pos-cat">{g.head}</div>
              {g.items.map((p) => {
                const out = soldOut(p);
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={`pos-hit${out ? ' is-out' : ''}`}
                    disabled={out}
                    onClick={() => pick(p)}
                  >
                    <span className="pos-hit-name">
                      <b>{p.name}</b>
                      <small>{p.sku}{!p.stock && p.brand ? ` · ${p.brand}` : ''}</small>
                    </span>
                    {p.stock && (
                      <span className={`pos-stock${out ? ' out' : ''}`}>
                        {out ? 'หมด' : `เหลือ ${p.on_hand}`}
                      </span>
                    )}
                    {/* ราคา 0 คือ "ยังไม่ได้ตั้งราคา" ไม่ใช่ "ของฟรี" จึงบอกให้พิมพ์เอง */}
                    <span className="pos-hit-price">
                      {Number(p.base_selling_price) > 0 ? money(p.base_selling_price) : 'ตั้งราคาเอง'}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
