'use client';
/**
 * เลือกเลนส์จากรายการเลนส์ของ Bewell (lens_catalog) — ช่องเลือกแบบพิมพ์ค้นได้ จัดกลุ่มตามชนิด
 *
 * ไม่ใช่คลัง: ไม่มีจำนวนคงเหลือ ไม่แยกตามค่าสายตา (เลนส์สั่งตัดตามค่าสายตาของเคส)
 * แถวที่ส่งออกไปมี id เป็น null เสมอ ขั้นขายจึงไม่ตัดสต็อกเลนส์ ของที่ใช้ไปอยู่ในใบเบิกเลนส์แทน
 * props ชุดเดียวกับ StockPicker เพื่อสลับแทนกันได้ใน OrderFormView
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/apiClient.js';
import { Select } from './Selects.jsx';
import { Icon } from './Icon.jsx';
import { catalogOptions, toStockRow } from '../lib/lens/lensSource.js';

/* ขอรายการครั้งเดียวต่อหน้า — สองข้าง (R/L) ใช้ชุดเดียวกัน */
let cache = null;
function loadCatalog() {
  if (!cache) {
    cache = api.get('/api/lens-catalog', { active: 1 }).catch((e) => {
      cache = null;
      throw e;
    });
  }
  return cache;
}

export function CatalogLensPicker({ picked = null, onPick, onClear = null }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((rows) => alive && setList(rows))
      .catch((e) => alive && setError(e.message || 'โหลดรายการเลนส์ไม่ได้'));
    return () => {
      alive = false;
    };
  }, []);

  if (picked?.catalog && !open) {
    const sub = [picked.lens_type, picked.lens_index, picked.coating].filter(Boolean).join(' · ');
    return (
      <div className="picked-item">
        <Icon name="glasses" />
        <b>{picked.product_name}</b>
        <span className="muted" title={sub}>{sub} · สั่งตัดตามเคส</span>
        <span className="p-id">{picked.sku}</span>
        <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(true)}>เปลี่ยน</button>
        {onClear && (
          <button type="button" className="btn btn-sm btn-light" onClick={onClear}>ล้าง</button>
        )}
      </div>
    );
  }

  if (error) return <p className="note danger">{error}</p>;
  if (!list) return <p className="hint">กำลังโหลดรายการเลนส์…</p>;
  if (!list.length) {
    return <p className="hint">ยังไม่มีเลนส์ที่เปิดใช้งาน — เพิ่มได้ที่เมนู “รายการเลนส์”</p>;
  }

  return (
    <>
      <Select
        search
        aria-label="เลือกเลนส์"
        value={picked?.lens_catalog_id ? String(picked.lens_catalog_id) : ''}
        options={[['', '— เลือกเลนส์ —'], ...catalogOptions(list)]}
        onChange={(e) => {
          const row = list.find((c) => String(c.id) === String(e.target.value));
          if (!row) return;
          setOpen(false);
          onPick(toStockRow(row));
        }}
      />
      {picked?.catalog && (
        <div className="pick-actions">
          <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(false)}>
            ยกเลิกการเปลี่ยน
          </button>
        </div>
      )}
    </>
  );
}
