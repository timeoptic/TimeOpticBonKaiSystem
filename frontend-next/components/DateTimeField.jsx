'use client';
/**
 * ช่อง "วันที่และเวลา" — ปฏิทินของ DateField กับรายการเวลาของ TimeField วางคู่กัน
 *
 * แทน `<input type="datetime-local">` ที่เบราว์เซอร์เป็นคนวาด · เป็นตัวประกอบล้วน ๆ
 * ไม่มีปฏิทินหรือรายการเวลาเป็นของตัวเอง ระบบจึงยังมีปฏิทินชุดเดียวเหมือนเดิม
 *
 * ค่าที่รับและส่งออกเป็น 'YYYY-MM-DDTHH:MM' เท่ากับที่ `datetime-local` เคยส่ง —
 * ที่เรียกใช้และ API ปลายทางจึงไม่ต้องแก้อะไรเลย ส่วนค่าที่อ่านกลับมาจาก API เป็น
 * '2026-09-05 14:30:00' ตามที่ MySQL เก็บ ก็รับได้ (ดู splitLocal)
 *
 *   <DateTimeField name="paid_at" defaultValue={nowLocal()} />   ฟอร์มอ่านเอง
 *   <DateTimeField value={v} onChange={setV} />                  หน้าคุมค่าเอง
 *
 * เวลาว่างแต่มีวันที่ ถือเป็นเที่ยงคืนของวันนั้น — ครึ่งค่าที่ค้างอยู่ไม่ใช่เวลาที่บันทึกได้
 */
import { useState } from 'react';
import { joinLocal, splitLocal } from '../lib/calendar.js';
import { DateField } from './DateField.jsx';
import { TimeField } from './TimeField.jsx';

export function DateTimeField({
  name,
  value,
  defaultValue = '',
  onChange,
  required = false,
  disabled = false,
  readOnly = false,
  min = '',
  max = '',
  step = 15,
  className = '',
  id,
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const raw = controlled ? (value || '') : inner;
  const [date, time] = splitLocal(raw);

  const commit = (next) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  return (
    <div className={`dtf ${className}`.trim()}>
      {name ? <input type="hidden" name={name} value={raw} /> : null}
      <DateField
        id={id}
        value={date}
        /* ล้างวันที่ทิ้ง = ล้างทั้งค่า ไม่ใช่เหลือเวลาลอยอยู่โดยไม่รู้ว่าเป็นเวลาของวันไหน */
        onChange={(d) => commit(d ? joinLocal(d, time) : '')}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        min={min ? splitLocal(min)[0] : ''}
        max={max ? splitLocal(max)[0] : ''}
      />
      <TimeField
        value={time}
        onChange={(t) => commit(joinLocal(date, t))}
        disabled={disabled || !date}
        readOnly={readOnly}
        step={step}
      />
    </div>
  );
}
