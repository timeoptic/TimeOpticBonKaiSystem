'use client';
/**
 * Process 1 — รับลูกค้า. The intake facts that belong to the case itself
 * (who took it, how the customer found us, the rush flag and the reception
 * note), plus a read-only look at the customer the case is attached to.
 *
 * Saving here is a draft save: it writes the case row and leaves the
 * process status alone — ProcessShell owns "✓ เปิดเคสเรียบร้อย".
 */
import Link from 'next/link';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { Check, Field, FormActions, FormGrid, Kv } from '../../../../components/ui.jsx';
import { EmployeeSelect, ListSelect } from '../../../../components/Selects.jsx';
import { custName, fmtDate } from '../../../../lib/format.js';
import { Icon } from '../../../../components/Icon.jsx';

export function ReceptionPanel({ c, reload }) {
  const { ok, err } = useToast();

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put('/api/cases/' + c.id, { ...c, ...readForm(e.currentTarget) });
      ok('บันทึกข้อมูลการรับเคสแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div className="stack">
      <form onSubmit={save}>
        <FormGrid>
          <Field label="พนักงานผู้รับเรื่อง">
            <EmployeeSelect name="received_by" defaultValue={c.received_by || ''} />
          </Field>
          <Field label="ประเภทงาน / Case Type">
            <ListSelect name="case_type" kind="case_type" defaultValue={c.case_type || ''} blank="— ไม่ระบุ —" />
          </Field>
          {/* เลือกผิดตอนเปิดเคสต้องแก้ได้ที่นี่ — มันคือตัวแบ่งสมุดงานบนกระดาน
              ถ้าแก้ไม่ได้ เคสก็ค้างอยู่ผิดแท็บไปตลอด */}
          <Field label="ประเภทลูกค้า / Customer Category">
            <ListSelect
              name="customer_category"
              kind="customer_category"
              defaultValue={c.customer_category || ''}
              blank="— เลือกประเภทลูกค้า —"
            />
          </Field>
          <Field label="รู้จักเราจากช่องทางไหน / Customer Source">
            <ListSelect name="referral_source" kind="referral_source" defaultValue={c.referral_source || ''} blank="— ไม่ระบุ —" />
          </Field>
          <Field label="รายละเอียดช่องทาง / Source Detail">
            <input name="referral_note" defaultValue={c.referral_note || ''} placeholder="ไม่กรอกก็ได้" />
          </Field>
          <Field label="งานด่วน">
            <Check name="is_rush" defaultChecked={!!Number(c.is_rush)}><Icon name="flame" /> ทำเป็นงานด่วน</Check>
          </Field>
        </FormGrid>
        <Field label="บันทึกการรับเรื่อง" className="full">
          <textarea name="reception_note" defaultValue={c.reception_note || ''} />
        </Field>
        <FormActions>
          <button className="btn btn-light" type="submit"><Icon name="save" /> บันทึกข้อมูลการรับเคส</button>
        </FormActions>
      </form>

      <Kv
        rows={[
          ['ลูกค้า', <Link key="cust" href={'/customers/detail?id=' + c.customer_id}>{custName(c)}</Link>],
          ['โทร', c.phone || '—'],
          ['LINE / WhatsApp', c.line_id || '—'],
          ['วันเกิด', fmtDate(c.birth_date) || '—'],
          ['ตอนเปิดเคส', Number(c.is_new_customer) ? 'ลูกค้าใหม่' : 'ลูกค้าเก่า'],
        ]}
      />
    </div>
  );
}
