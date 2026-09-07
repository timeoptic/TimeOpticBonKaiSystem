'use client';
/**
 * ช่องค้นหา/เลือกสินค้า — วางอยู่ตำแหน่งเดียวกับช่อง "ชื่อสินค้า" ของ POS เดิม
 *
 * สินค้าทั้งหมดมาจาก `/api/pos/products` ซึ่งอ่านตาราง products กลาง — ไม่มี
 * รายการสินค้าตัวไหนเขียนไว้ในไฟล์นี้ เพิ่มสินค้าที่ฐานแล้วขึ้นเองทันที
 *
 * โหลดครั้งเดียวตอนเปิดหน้าแล้วกรองในเครื่อง ไม่ยิง API ทุกตัวอักษร — แคตตาล็อก
 * ของร้านมีหลักสิบถึงหลักร้อยรายการ การกรองในเครื่องเร็วกว่ารอเน็ตเสมอ และ
 * หน้าร้านพิมพ์ไปคุยกับลูกค้าไป จะรอ debounce ไม่ได้
 *
 * กด Enter = หยิบตัวแรกที่เจอ · พนักงานที่ชินแล้วพิมพ์ "hitop 60" แล้ว Enter รัว ๆ ได้
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from '../../lib/format.js';
import { PosField } from './PosField.jsx';

export function ProductPicker({ products, onPick }) {
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
      const hay = `${p.name} ${p.sku} ${p.brand || ''} ${p.category_name}`.toLowerCase();
      /* ทุกคำต้องเจอ ไม่ใช่ทั้งประโยคต้องติดกัน — "acuvue astig" จึงหาเจอ */
      return t.split(/\s+/).every((w) => hay.includes(w));
    });
    return rows.slice(0, 60);
  }, [products, term]);

  /* จัดกลุ่มตามหมวดเพื่อให้กวาดตาหาได้เร็วกว่ารายการยาวเรียงเดียว */
  const groups = useMemo(() => {
    const out = [];
    let last = null;
    hits.forEach((p) => {
      if (p.category_name !== last) {
        out.push({ head: p.category_name, items: [] });
        last = p.category_name;
      }
      out[out.length - 1].items.push(p);
    });
    return out;
  }, [hits]);

  const pick = (p) => {
    onPick(p);
    setTerm('');
    setOpen(false);
  };

  return (
    <div className="pos-search" ref={box}>
      <PosField label="ชื่อสินค้า:" icon="bag">
        <input
          value={term}
          placeholder="ค้นหาหรือเลือกสินค้า — ชื่อ หรือ SKU"
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits.length) { e.preventDefault(); pick(hits[0]); }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      </PosField>

      {open && (
        <div className="pos-results">
          {groups.length === 0 && <div className="pos-hit"><span className="pos-hit-name">ไม่พบสินค้าที่ค้นหา</span></div>}
          {groups.map((g) => (
            <div key={g.head}>
              <div className="pos-cat">{g.head}</div>
              {g.items.map((p) => (
                <button type="button" key={p.id} className="pos-hit" onClick={() => pick(p)}>
                  <span className="pos-hit-name">
                    <b>{p.name}</b>
                    <small>{p.sku}{p.brand ? ` · ${p.brand}` : ''}</small>
                  </span>
                  {/* ราคา 0 คือ "ยังไม่ได้ตั้งราคา" ไม่ใช่ "ของฟรี" จึงบอกให้พิมพ์เอง */}
                  <span className="pos-hit-price">
                    {Number(p.base_selling_price) > 0 ? money(p.base_selling_price) : 'ตั้งราคาเอง'}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
