'use client';
/**
 * เปิดใบสั่งตัดเลนส์ระหว่างขาย โดยไม่ต้องออกจากหน้า
 *
 * เลนส์สั่งตัดไม่ได้อยู่บนชั้นให้เลือก — ร้านสั่งทำเฉพาะรายตามค่าสายตาของลูกค้า
 * คนที่วัดสายตาเสร็จรู้ค่าตั้งแต่ตอนนั้น และอยากสั่งของทันที ไม่ใช่รอปิดการขาย
 * ก่อนแล้วค่อยให้ระบบเปิดใบสั่งให้
 *
 * ยิงไปที่ `POST /api/rx` ซึ่งส่งต่อให้บริการของฝั่งคลัง — เลขใบสั่ง (RX-ปี-ลำดับ)
 * ออกจากที่นั่น รุ่นเลนส์ที่ยังไม่มีในแคตตาล็อกก็ถูกสร้างจากชื่อที่กรอกที่นั่น
 * เหมือนกัน ที่นี่ไม่มีกฎอะไรเป็นของตัวเอง
 *
 * ผลที่ได้กลับมาไม่ใช่ล็อตในคลัง — เลนส์สั่งตัดไม่มีล็อต · ฟอร์มขายจึงเก็บแค่
 * ชื่อกับ SKU ลงช่องของข้างนั้น ไม่มี lot id ให้ผูก และตอนยืนยันการขายก็ไม่มี
 * อะไรถูกตัดจากคลังซ้ำ
 */
import { useState } from 'react';
import { api } from '../lib/apiClient.js';
import { useToast } from './Toast.jsx';
import { Field, FormGrid } from './ui.jsx';
import { Icon } from './Icon.jsx';

/** ค่าสายตาที่ใบสั่งต้องรู้ — ข้างตามาจากช่องที่กดเปิด ไม่ต้องถามซ้ำ */
const RX_FIELDS = [
  ['sph', 'SPH (สายตาสั้น/ยาว)', 'เช่น -2.25'],
  ['cyl', 'CYL (สายตาเอียง)', 'เช่น -0.50'],
  ['axis', 'AXIS (องศา)', '0–180'],
  ['add', 'ADD (ระยะใกล้)', 'เช่น +2.00'],
];

const LENS_FIELDS = [
  ['model', 'รุ่นเลนส์ *', 'เช่น HiVision · Varilux X'],
  ['brand', 'ยี่ห้อ / Brand', 'เช่น Hoya'],
  ['coating', 'Coating', 'เช่น BlueControl'],
  ['index', 'Index', 'เช่น 1.60'],
];

export function NewRxLensModal({ side, onClose, onCreated }) {
  const { ok, err } = useToast();
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!(form.model || '').trim() && !(form.brand || '').trim()) {
      err(new Error('บอกอย่างน้อยว่าเลนส์รุ่นอะไร หรือยี่ห้ออะไร'));
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/api/rx', {
        ...form,
        eye_side: side === 'r' ? 'right' : 'left',
      });
      const order = res.order ?? res;
      ok(`เปิดใบสั่ง ${order.referenceDoc} แล้ว`);
      onCreated(order);
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h3>สั่งตัดเลนส์ {side === 'r' ? 'ขวา (R)' : 'ซ้าย (L)'}</h3>
        <p className="hint">
          สำหรับเลนส์ที่ร้านไม่ได้สต็อก — ระบบออกเลขใบสั่งให้ และไม่ตัดของจากคลัง
        </p>
        {/* ไม่ใช้ <form> ด้วยเหตุผลเดียวกับ NewProductModal — โมดัลนี้อยู่ข้างใน
            ฟอร์มออเดอร์ ฟอร์มซ้อนฟอร์มไม่ได้ */}
        <div>
          <div className="m-body">
            <FormGrid>
              {LENS_FIELDS.map(([name, label, placeholder]) => (
                <Field key={name} label={label}>
                  <input
                    name={name}
                    value={form[name] ?? ''}
                    placeholder={placeholder}
                    onChange={set(name)}
                  />
                </Field>
              ))}
              {RX_FIELDS.map(([name, label, placeholder]) => (
                <Field key={name} label={label}>
                  <input
                    name={name}
                    value={form[name] ?? ''}
                    placeholder={placeholder}
                    onChange={set(name)}
                  />
                </Field>
              ))}
              <Field label="ราคาทุนจากผู้ขาย / Cost" hint="ไม่กรอกก็ได้ — ลงทีหลังตอนใบกำกับมา">
                <input
                  name="cost_per_unit" type="number" min="0" step="1"
                  value={form.cost_per_unit ?? ''} onChange={set('cost_per_unit')}
                />
              </Field>
              <Field label="ราคาขาย / Sale price" hint="ราคาที่บอกลูกค้าไปแล้ว">
                <input
                  name="sale_price" type="number" min="0" step="1"
                  value={form.sale_price ?? ''} onChange={set('sale_price')}
                />
              </Field>
            </FormGrid>
          </div>
          <div className="m-foot">
            <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button type="button" className="btn" onClick={save} disabled={busy}>
              <Icon name="check" /> เปิดใบสั่งแล้วใส่ในออเดอร์
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
