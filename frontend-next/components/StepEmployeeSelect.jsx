'use client';
/**
 * ช่องเลือกพนักงานของขั้นตอนงาน — แสดงเฉพาะคนที่แอดมินกำหนดให้ขั้นนั้น
 * (หน้า /employees/process-staff · api services/ProcessStaff.php · ร้านขอ 17 พ.ย. 2026: ค่าคอมต้องคิดถูกคน)
 *
 * กติกาเดียวกับ API:
 *   - ประเภทงานยังไม่ตั้ง / ตั้งเป็น "เลือกได้จากพนักงานทั้งหมด" / ช่องนั้นยังไม่ใส่ชื่อ → ทุกคน
 *   - ประเภทงานว่างหรือค่าเก่า → ใช้ชุดของ "ตัดแว่นใหม่"
 *   - คนที่บันทึกไว้แล้วแต่ไม่อยู่ในรายชื่อ ยังแสดงอยู่ (ใบเก่าต้องอ่านออก และ API ไม่ตรวจถ้าไม่เปลี่ยนคน)
 */
import { useMemo } from 'react';
import { useMeta } from '../contexts/MetaContext.jsx';
import { Select } from './Selects.jsx';

export const DEFAULT_CASE_TYPE = 'ตัดแว่นใหม่';

export function staffTypeKey(caseType, caseTypes) {
  const t = String(caseType || '').trim();
  return (caseTypes || []).includes(t) ? t : DEFAULT_CASE_TYPE;
}

/** id ที่เลือกได้ของช่องนี้ · null = ไม่จำกัด */
export function useStepAllowed(step, caseType) {
  const { meta } = useMeta();
  return useMemo(() => {
    const cfg = meta.process_staff?.[staffTypeKey(caseType, meta.lists?.case_type)];
    if (!cfg || cfg.mode !== 'list') return null;
    const list = (cfg.slots?.[step] || []).map(Number);
    return list.length ? new Set(list) : null;
  }, [meta, step, caseType]);
}

/** รายชื่อพนักงาน (จาก meta) ที่เลือกได้ในขั้นนี้ บวกคนที่บันทึกไว้แล้ว */
export function useStepEmployees(step, caseType, current) {
  const { meta } = useMeta();
  const allowed = useStepAllowed(step, caseType);
  return useMemo(() => {
    const cur = current === undefined || current === null || current === '' ? null : Number(current);
    const list = (meta.employees || []).filter((e) => !allowed || allowed.has(Number(e.id)) || Number(e.id) === cur);
    if (cur && !list.some((e) => Number(e.id) === cur)) {
      list.push({ id: cur, employee_name: `พนักงาน ID ${cur}` });
    }
    return { list, limited: !!allowed };
  }, [meta.employees, allowed, current]);
}

export function StepEmployeeSelect({
  step, caseType, name, value, defaultValue, onChange, blank = '— เลือกพนักงาน —', ...rest
}) {
  const { list, limited } = useStepEmployees(step, caseType, value ?? defaultValue);
  const options = [['', limited ? '— เลือกผู้รับผิดชอบขั้นนี้ —' : blank], ...list.map((e) => [e.id, e.employee_name])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}
