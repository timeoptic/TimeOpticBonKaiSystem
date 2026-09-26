'use client';
/**
 * เลือกเลนส์จากรายการเลนส์ของ Bewell (lens_catalog) — หน้าตาเดียวกับการเลือกเลนส์จากคลัง
 * (LensPicker ตัวเดิม: ช่องค้นหา Coating SPH/CYL และรายการชื่อเลนส์) ต่างกันแค่แหล่งข้อมูล
 *
 * ไม่ใช่คลัง: ไม่มีจำนวนคงเหลือ · SPH/CYL ไม่กรองรายการ เพราะเลนส์สั่งตัดตามค่าสายตาของเคส
 * ทำได้ทุกค่า · แถวที่ส่งออกไปมี id เป็น null เสมอ ขั้นขายจึงไม่ตัดสต็อกเลนส์
 * props ชุดเดียวกับ StockPicker เพื่อสลับแทนกันได้ใน OrderFormView
 */
import { useState } from 'react';
import { api } from '../lib/apiClient.js';
import { LensPicker } from './LensPicker.jsx';
import { Icon } from './Icon.jsx';
import { searchCatalog, toStockRow } from '../lib/lens/lensSource.js';

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

/* รายการแสดงแค่ชื่อ (nameOnly) ช่องคงเหลือจึงไม่ถูกวาด — LensPicker ยังต้องการฟังก์ชันนี้อยู่ */
const noStock = () => ({ text: '', tone: 'new' });

export function CatalogLensPicker({ picked = null, onPick, onClear = null }) {
  const [open, setOpen] = useState(false);

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

  return (
    <>
      <LensPicker
        placeholder="ชื่อเลนส์ / ยี่ห้อ / รหัส"
        fetcher={(term, params) => loadCatalog().then((list) => searchCatalog(list, term, params).map(toStockRow))}
        label={(r) => r.product_name}
        stock={noStock}
        nameOnly
        onPick={(r) => {
          setOpen(false);
          onPick(r);
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
