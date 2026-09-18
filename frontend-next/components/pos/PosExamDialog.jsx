'use client';
/**
 * ฟอร์มวัดสายตาของ POS — เล็ก ๆ ของตัวเอง ไม่ใช่ ExamPanel ของเคส
 *
 * สเปก: docs/superpowers/specs/2026-09-16-pos-contact-lens-eye-exam-design.md
 *
 * ทำไมไม่ใช้หน้าวัดสายตาเดิม: ไม่มีหน้าวัดสายตานอกเคสอยู่เลย (`/exam/` เป็นแค่
 * รายการเคสที่รอวัด) และ `ExamPanel` ฮาร์ดโค้ด `case_id` ลงทุกใบที่มันเขียน
 * (ExamPanel.jsx:499, 567) การไปแก้มันคือการแตะ Process หลักของเคสตัดแว่น
 * ซึ่งเจ้าของร้านสั่งห้ามไว้ · คอนแทคเลนส์จึงเป็นเรื่องของ POS ฝ่ายเดียว
 *
 * บันทึกเป็นแถว `prescriptions` ธรรมดาใบเดียว: ไม่มี `case_id`, `kind='final'`,
 * `source='contact_lens'` (ค่าที่ระบบรู้จักอยู่แล้ว — RxSets.jsx แปลเป็น
 * "จากคอนแทคเลนส์" ให้เอง) · **ไม่เรียก `/confirm`** จึงไม่ติดด่าน "ใช้สำหรับ /
 * Test For" ที่บังคับไว้สำหรับใบสั่งตัดแว่น (prescriptions.php:155) และไม่ต้อง
 * เพิ่มตัวเลือกใหม่ใน Lookup
 *
 * ผลวัดเข้าประวัติลูกค้าเองทันที เพราะ `examSessions()` ดึงทุกแถวของลูกค้าไม่ว่า
 * จะผูกเคสหรือไม่ และ `ExamHistory` รองรับรอบที่ไม่ผูกเคสอยู่แล้ว
 */
import { useState } from 'react';

import { api } from '../../lib/apiClient.js';
import {
  custName, normSphere, normCyl, normAxis, normAdd, normVa,
  rxPairMissing, toStamp, nowLocal,
} from '../../lib/format.js';

/* ห้าค่าที่กล่องคอนแทคเลนส์ต้องใช้ — PD ไม่อยู่ในนี้โดยตั้งใจ มันเป็นของขั้นวัด
   Center ในเคสตัดแว่น (ตาราง centerings) ใบสายตาถือค่านั้นไม่ได้ */
const COLS = [
  ['sphere', 'SPH', normSphere],
  ['cylinder', 'CYL', normCyl],
  ['axis', 'AXIS', normAxis],
  ['add', 'ADD', normAdd],
  ['va', 'VA', normVa],
];

const EYES = [['r', 'R / ขวา'], ['l', 'L / ซ้าย']];

const blankEye = () => ({ sphere: '', cylinder: '', axis: '', add: '', va: '' });

export function PosExamDialog({ customer, onClose, onSaved }) {
  const [vals, setVals] = useState({ r: blankEye(), l: blankEye() });
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  const set = (eye, field, v) =>
    setVals((s) => ({ ...s, [eye]: { ...s[eye], [field]: v } }));

  async function save() {
    /* ตรวจรูปแบบด้วยตัวเดียวกับหน้าวัดสายตาของเคส — ค่าเดียวกันต้องถูกยอมรับ
       เหมือนกันทั้งสองทาง ไม่งั้นใบที่วัดจาก POS จะมีมาตรฐานคนละชุด */
    const errs = [];
    const body = {
      customer_id: customer.id,
      case_id: null,
      kind: 'final',
      source: 'contact_lens',
      test_date: toStamp(nowLocal()),
    };

    let filled = false;
    for (const [eye, eyeLabel] of EYES) {
      for (const [field, , norm] of COLS) {
        const { value, error } = norm(vals[eye][field]);
        if (error) errs.push(`${eyeLabel} — ${error}`);
        if (String(value).trim() !== '') filled = true;
        body[`${eye}_${field}`] = value;
      }
      /* ค่าเอียงครึ่งเดียวสั่งอะไรไม่ได้ — กฎเดียวกับใบสั่งตัด */
      const pair = rxPairMissing(vals[eye]);
      if (pair) errs.push(`${eyeLabel} — ${pair.error}`);
    }

    if (!filled) errs.push('ยังไม่ได้กรอกค่าสายตาสักช่อง');
    if (errs.length) {
      setErrors([...new Set(errs)]);
      return;
    }

    setBusy(true);
    setErrors([]);
    try {
      const row = await api.post('/api/prescriptions', body);
      onSaved(row);
    } catch (e) {
      setErrors([e.message || 'บันทึกไม่สำเร็จ']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-modal-scrim" role="dialog" aria-modal="true">
      <div className="pos-modal">
        <div className="pos-modal-head">
          <h2>วัดสายตา — {custName(customer)}</h2>
        </div>

        <div className="pos-modal-body">
          <p className="muted">
            ค่านี้เก็บเป็นประวัติของลูกค้า และใช้อ้างอิงตอนกรอกค่าของกล่องคอนแทคเลนส์
            — ระบบไม่เติมค่าให้อัตโนมัติ
          </p>

          <div className="rx-grid-wrap">
            <table className="rx-grid">
              <thead>
                <tr>
                  <th />
                  {COLS.map(([field, label]) => <th key={field}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {EYES.map(([eye, eyeLabel]) => (
                  <tr key={eye}>
                    <th scope="row">{eyeLabel}</th>
                    {COLS.map(([field, label]) => (
                      <td key={field} data-col={label}>
                        <input
                          value={vals[eye][field]}
                          aria-label={`${eyeLabel} ${label}`}
                          onChange={(e) => set(eye, field, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {errors.map((e) => <p className="pos-err" key={e}>{e}</p>)}
        </div>

        <div className="pos-modal-foot">
          <button type="button" className="pos-back" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button type="button" className="pos-go" onClick={save} disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึกผลวัด'}
          </button>
        </div>
      </div>
    </div>
  );
}
