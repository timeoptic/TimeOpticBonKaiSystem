'use client';
/**
 * Process 1 — รับลูกค้า. The intake facts that belong to the case itself
 * (who took it, how the customer found us and the reception note), plus a
 * read-only look at the customer the case is attached to.
 *
 * The rush flag and the free-text source detail used to be edited here. Both
 * columns still exist and still render wherever they were shown before — this
 * form just no longer offers them, and the `...c` spread below carries the
 * stored values through untouched on every save.
 *
 * Saving here is a draft save: it writes the case row and leaves the
 * process status alone — ProcessShell owns "✓ เปิดเคสเรียบร้อย".
 */
import Link from 'next/link';
import { api } from '../../../../../lib/apiClient.js';
import { readForm } from '../../../../../lib/hooks.js';
import { useToast } from '../../../../../components/Toast.jsx';
import { Field, FormActions, FormGrid, Kv } from '../../../../../components/ui.jsx';
import { EmployeeSelect, ListSelect } from '../../../../../components/Selects.jsx';
import { custName, fmtDate } from '../../../../../lib/format.js';
import { birthWithAge } from '../../../../../lib/customerAge.js';
import { Icon } from '../../../../../components/Icon.jsx';

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
          ['วันเกิด', birthWithAge(c.birth_date, fmtDate) || '—'],
          ['ตอนเปิดเคส', Number(c.is_new_customer) ? 'ลูกค้าใหม่' : 'ลูกค้าเก่า'],
        ]}
      />
    </div>
  );
}
