'use client';
/**
 * เลือกเลนส์จำลองของ Bewell — หน้าตาเดียวกับการเลือกเลนส์จากคลัง (LensPicker ตัวเดิม)
 * ต่างกันแค่แหล่งข้อมูล: lib/lens/mockLenses.js ไม่ใช่ /api/stock
 *
 * แถวที่ส่งออกไปมี id เป็น null เสมอ ออเดอร์จึงไม่ผูกล็อต และขั้นขายไม่ตัดสต็อกเลนส์
 * (ทางเดียวกับชื่อเลนส์ที่พิมพ์เอง) · ของที่ต้องเบิกไปอยู่ในใบเบิกเลนส์แทน
 * props ชุดเดียวกับ StockPicker เพื่อสลับแทนกันได้ใน OrderFormView
 */
import { useState } from 'react';
import { LensPicker } from './LensPicker.jsx';
import { Icon } from './Icon.jsx';
import { searchMockLenses } from '../lib/lens/lensSource.js';

/* รายการแสดงแค่ชื่อ (nameOnly) ช่องคงเหลือจึงไม่ถูกวาด — LensPicker ยังต้องการฟังก์ชันนี้อยู่ */
const mockStock = () => ({ text: '', tone: 'new' });

export function MockLensPicker({ picked = null, onPick, onClear = null }) {
  const [open, setOpen] = useState(false);

  if (picked?.mock && !open) {
    const sub = 'เลนส์จำลอง (รายชื่อจากเว็บหลัก TimeOptic) · สั่งตามเคส';
    return (
      <div className="picked-item">
        <Icon name="glasses" />
        <b>{picked.product_name}</b>
        <span className="muted" title={sub}>{sub}</span>
        <span className="p-id">{picked.mock_code}</span>
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
        placeholder="ชื่อเลนส์ / ยี่ห้อ / SKU"
        fetcher={(term, params) => Promise.resolve(searchMockLenses(term, params))}
        label={(r) => r.product_name}
        stock={mockStock}
        nameOnly
        onPick={(r) => {
          setOpen(false);
          onPick(r);
        }}
      />
      {picked?.mock && (
        <div className="pick-actions">
          <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen(false)}>
            ยกเลิกการเปลี่ยน
          </button>
        </div>
      )}
    </>
  );
}
