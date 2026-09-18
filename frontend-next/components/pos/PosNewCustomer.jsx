'use client';
/**
 * เพิ่มลูกค้าใหม่จากหน้า POS — ฟอร์มย่อ ไม่ใช่ฟอร์มเต็มของหน้าลูกค้า
 *
 * มีเพราะคอนแทคเลนส์ขายให้ลูกค้าหน้าใหม่ได้ และผลวัดสายตาต้องมีเจ้าของเสมอ
 * (`prescriptions.customer_id` เป็น NOT NULL) จะวัดไว้ก่อนแล้วค่อยผูกคนทีหลังไม่ได้
 *
 * ถามแค่ ชื่อ / นามสกุล / เบอร์ — API บังคับแค่ชื่อหรือนามสกุลอย่างใดอย่างหนึ่ง
 * (customers.php:281) ที่เหลือไปเติมทีหลังที่หน้าลูกค้าได้ · ตอนลูกค้ายืนรออยู่
 * ตรงเคาน์เตอร์ ฟอร์มยาวคือเหตุผลที่พนักงานเลิกใช้ระบบแล้วหันไปจดกระดาษ
 *
 * ถาม `/api/customers/duplicates` ก่อนสร้างเสมอ — ลูกค้าซ้ำเป็นปัญหาจริงของร้านนี้
 * (ค้นไม่เจอ → กดสร้างใหม่ → ประวัติค่าสายตาแตกเป็นสองใบคนละที่) · เจอที่น่าสงสัย
 * แล้วยังสร้างได้อยู่ แต่ต้องกดยืนยันอีกครั้งโดยเห็นรายชื่อที่ชนอยู่ตรงหน้า
 */
import { useState } from 'react';

import { api } from '../../lib/apiClient.js';
import { custName } from '../../lib/format.js';

export function PosNewCustomer({ onCreated, onPickExisting, onCancel }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', line_id: '' });
  const [matches, setMatches] = useState(null);   // null = ยังไม่ได้ตรวจ
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    /* แก้ข้อมูลแล้วผลตรวจซ้ำชุดเดิมใช้ไม่ได้อีก — ต้องตรวจใหม่ ไม่ใช่ปล่อยให้กด
       "ยืนยันสร้างใหม่" ผ่านด้วยผลของชื่อเก่า */
    setMatches(null);
    setError(null);
  };

  const named = form.first_name.trim() !== '' || form.last_name.trim() !== '';

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const row = await api.post('/api/customers', {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim() || null,
        /* ช่องเดียวกับ "LINE ID / WhatsApp" ของฟอร์มเต็ม — ร้านนับสองอย่างนี้เป็น
           ช่องทางติดต่อเดียวกันมาตั้งแต่แรก ไม่ใช่คนละคอลัมน์ */
        line_id: form.line_id.trim() || null,
      });
      onCreated(row);
    } catch (e) {
      setError(e.message || 'เพิ่มลูกค้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const { matches: found } = await api.post('/api/customers/duplicates', {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
        /* LINE ID ชี้ตัวคนได้พอ ๆ กับเบอร์โทร — ตัวเช็กซ้ำนับว่าเป็นหลักฐานแข็ง
           (strong) เหมือนกัน ส่งไปด้วยจึงจับคนเดิมที่เปลี่ยนเบอร์ได้ */
        line_id: form.line_id.trim(),
      });
      if (found && found.length) {
        setMatches(found);
        return;
      }
      await create();
    } catch (e) {
      setError(e.message || 'ตรวจสอบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-newc">
      <div className="pos-newc-row">
        <input
          value={form.first_name}
          placeholder="ชื่อ"
          aria-label="ชื่อลูกค้าใหม่"
          onChange={(e) => set('first_name', e.target.value)}
        />
        <input
          value={form.last_name}
          placeholder="นามสกุล"
          aria-label="นามสกุลลูกค้าใหม่"
          onChange={(e) => set('last_name', e.target.value)}
        />
        <input
          inputMode="tel"
          value={form.phone}
          placeholder="เบอร์โทร"
          aria-label="เบอร์โทรลูกค้าใหม่"
          onChange={(e) => set('phone', e.target.value)}
        />
        <input
          value={form.line_id}
          placeholder="LINE ID / WhatsApp"
          aria-label="LINE ID หรือ WhatsApp ของลูกค้าใหม่"
          onChange={(e) => set('line_id', e.target.value)}
        />
      </div>

      {matches && (
        <div className="pos-newc-dup">
          <b>มีลูกค้าที่ข้อมูลใกล้เคียงอยู่แล้ว</b>
          {matches.map((m) => (
            <button
              type="button"
              className="pos-newc-hit"
              key={m.id}
              onClick={() => onPickExisting(m)}
            >
              <span>
                <b>{custName(m)}</b>
                {m.phone ? <span className="muted">{` · ${m.phone}`}</span> : null}
                <small>{(m.why || []).join(' · ')}</small>
              </span>
              <span className="p-id">#{m.id}</span>
            </button>
          ))}
          <p className="muted">ถ้าไม่ใช่คนเหล่านี้ กดยืนยันเพื่อเพิ่มเป็นลูกค้ารายใหม่</p>
        </div>
      )}

      {error && <p className="pos-err">{error}</p>}

      <div className="pos-newc-acts">
        <button type="button" className="btn btn-sm btn-light" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || !named}
          onClick={() => (matches ? create() : check())}
        >
          {busy ? 'กำลังบันทึก…' : matches ? 'ยืนยันเพิ่มเป็นลูกค้าใหม่' : 'เพิ่มลูกค้าใหม่'}
        </button>
      </div>
    </div>
  );
}
