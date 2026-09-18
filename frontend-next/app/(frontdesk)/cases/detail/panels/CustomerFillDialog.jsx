'use client';
/**
 * เติมข้อมูลลูกค้า — popup จากขั้นรับลูกค้า (ร้านขอ 15 ก.ย. 2026)
 *
 * ให้กรอกเฉพาะช่องที่ลูกค้ายังว่าง (วันเกิด/อายุ เบอร์โทร LINE อีเมล เพศ) · ค่าที่มีอยู่แล้ว
 * แก้ที่นี่ไม่ได้ ต้องไปหน้าแก้ไขข้อมูลลูกค้า · API ตรวจซ้ำและปฏิเสธการเขียนทับ
 * (POST /api/customers/:id/fill — ไม่ใช่ PUT ที่เขียนทับทั้งสิบช่อง)
 *
 * เบอร์โทรที่ตรงกับลูกค้าคนอื่นเตือนก่อนหนึ่งครั้ง — มักแปลว่าลูกค้าคนนี้มีใบซ้ำอยู่แล้ว
 * กด "บันทึกต่อ" ได้ถ้าเป็นคนละคนจริง (เช่นใช้เบอร์ของคนในบ้าน)
 *
 * วางผ่าน portal และหยุด event input/change ไว้ที่ตัวเอง — หน้าเคสนับการพิมพ์ใดๆ ใน
 * เนื้อหาเป็น "มีข้อมูลยังไม่บันทึก" การพิมพ์ใน popup แล้วกดยกเลิกต้องไม่ทิ้งสถานะนั้นไว้
 */
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../../../../lib/apiClient.js';
import { useToast } from '../../../../../components/Toast.jsx';
import { Field, FormGrid } from '../../../../../components/ui.jsx';
import { ListSelect } from '../../../../../components/Selects.jsx';
import { DateField } from '../../../../../components/DateField.jsx';
import { Icon } from '../../../../../components/Icon.jsx';
import { custName } from '../../../../../lib/format.js';
import {
  emptyFields, fillBody, fillProblems, phoneMatches,
} from '../../../../../lib/customerFill.js';

const WARN = { margin: 0, display: 'flex', gap: 6, alignItems: 'flex-start', color: 'var(--warn, #92400E)', overflowWrap: 'anywhere' };

export function CustomerFillDialog({ c, onClose, onSaved }) {
  const { ok, err } = useToast();
  const titleId = useId();
  /* ช่องที่ว่างตอนเปิด popup — ไม่คำนวณใหม่ระหว่างกรอก ช่องจะได้ไม่หายไปต่อหน้า */
  const [fields] = useState(() => emptyFields(c));
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  /* null = ยังไม่ได้ถามว่าเบอร์นี้ซ้ำไหม · [] หรือรายชื่อ = ถามแล้ว */
  const [dups, setDups] = useState(null);

  const set = (key) => (v) => {
    setValues((s) => ({ ...s, [key]: v }));
    if (key === 'phone') setDups(null);
  };

  const body = fillBody(values, c, c.id);
  const count = Object.keys(body).length - 1;
  const problems = fillProblems(values);
  const canSave = !busy && count > 0 && problems.length === 0;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      if (body.phone && dups === null) {
        let found = [];
        try {
          found = phoneMatches(await api.post('/api/customers/duplicates', { phone: body.phone, exclude_id: c.customer_id }));
        } catch {
          /* ถามเรื่องเบอร์ซ้ำไม่สำเร็จ ไม่ใช่เหตุให้บันทึกไม่ได้ — ด่านนี้เป็นแค่คำเตือน */
        }
        if (found.length) {
          setDups(found);
          setBusy(false);
          return;
        }
      }
      await api.post(`/api/customers/${c.customer_id}/fill`, body);
      ok('บันทึกข้อมูลลูกค้าแล้ว');
      onSaved();
    } catch (ex) {
      err(ex);
      setBusy(false);
      /* ข้อมูลบนจอเก่าไปแล้ว (มีคนเติมช่องนั้นก่อน / ลูกค้าของเคสถูกเปลี่ยน) — ปิดแล้วโหลดใหม่ */
      if (ex?.reason === 'already_filled' || ex?.reason === 'case_mismatch') onSaved();
    }
  };

  const stop = (e) => e.stopPropagation();

  return createPortal(
    <div
      className="modal-back"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      onInput={stop}
      onChange={stop}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h3 id={titleId}>เติมข้อมูลลูกค้า</h3>
        <div className="m-body">
          <p className="muted" style={{ margin: '0 0 12px' }}>
            {`${custName(c)} · กรอกเฉพาะช่องที่ยังว่าง — ค่าที่มีอยู่แล้วแก้ได้ที่หน้าแก้ไขข้อมูลลูกค้า`}
          </p>

          <FormGrid>
            {fields.map((f) => {
              const label = f.required ? `${f.label} *` : f.label;
              if (f.key === 'birth_date') {
                return (
                  <Field key={f.key} label={label} hint="พิมพ์ วว/ดด/ปปปป ได้ (รับปี พ.ศ.)">
                    <DateField value={values.birth_date || ''} onChange={set('birth_date')} />
                  </Field>
                );
              }
              /* กรอกช่องนี้เมื่อลูกค้าบอกมาแค่อายุ — ระบบเก็บวันที่ถามไว้ด้วย จะได้คิดปีต่อ ๆ ไปถูก
                 กรอกพร้อมวันเกิดไม่ได้ (fillProblems เตือน) เพราะฐานเก็บได้คำตอบเดียว */
              if (f.key === 'age_years') {
                return (
                  <Field key={f.key} label={label} hint="กรอกเมื่อลูกค้าไม่ทราบวันเกิด">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="120"
                      step="1"
                      placeholder="เช่น 45"
                      autoComplete="off"
                      value={values.age_years || ''}
                      onChange={(e) => set('age_years')(e.target.value)}
                    />
                  </Field>
                );
              }
              if (f.key === 'sex') {
                return (
                  <Field key={f.key} label={label}>
                    <ListSelect kind="sex" value={values.sex || ''} onChange={(e) => set('sex')(e.target.value)} blank="—" />
                  </Field>
                );
              }
              return (
                <Field key={f.key} label={label}>
                  <input
                    type={f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : 'text'}
                    inputMode={f.key === 'phone' ? 'tel' : undefined}
                    autoComplete="off"
                    value={values[f.key] || ''}
                    onChange={(e) => set(f.key)(e.target.value)}
                    placeholder={f.key === 'line_id' ? 'LINE ID หรือเบอร์ WhatsApp' : undefined}
                  />
                </Field>
              );
            })}
          </FormGrid>

          {problems.length ? (
            <div role="alert" style={{ marginTop: 10, display: 'grid', gap: 4 }}>
              {problems.map((p) => <p key={p} style={WARN}><Icon name="warning" /> {p}</p>)}
            </div>
          ) : null}

          {dups?.length ? (
            <div role="alert" style={{ marginTop: 10, display: 'grid', gap: 4 }}>
              <p style={WARN}>
                <Icon name="warning" />
                <span>
                  {`เบอร์นี้ตรงกับลูกค้าที่มีอยู่แล้ว: ${dups.map((d) => `${custName(d)} (#${d.id})`).join(', ')}`}
                  {' — ถ้าเป็นคนละคนจริงกด "บันทึกต่อ"'}
                </span>
              </p>
            </div>
          ) : null}
        </div>
        <div className="m-foot">
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="button" className="btn btn-accent" onClick={save} disabled={!canSave}>
            <Icon name="save" />
            {busy ? ' กำลังบันทึก…' : dups?.length ? ' บันทึกต่อ' : ' บันทึกข้อมูลลูกค้า'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
