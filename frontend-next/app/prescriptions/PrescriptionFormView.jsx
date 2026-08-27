'use client';
/**
 * Shared prescription create/edit form. Port of frontend/src/pages/prescriptions/PrescriptionForm.jsx,
 * restructured the same way app/customers/CustomerFormView.jsx was: `editing` is an explicit prop,
 * not derived from a route param, and outgoing write URLs use the query-string `id` rather than an
 * id read back out of the loaded response body (see this plan's Global Constraints).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, Check, Field, Fieldset, FormActions, FormGrid, Loading, PageHead, Row, Split,
} from '../../components/ui.jsx';
import { Picker } from '../../components/Picker.jsx';
import { EmployeeSelect, ListSelect, Select } from '../../components/Selects.jsx';
import { custName, dtLocal, nowLocal, toStamp } from '../../lib/format.js';
import { Icon } from '../../components/Icon.jsx';

const HEALTH = [
  ['health_cataract', 'ต้อกระจก'], ['health_eye_surgery', 'เคยผ่าตัดตา'],
  ['health_diabetes', 'เบาหวาน'], ['health_bp', 'ความดัน'], ['health_heart', 'โรคหัวใจ'],
];

/** one eye's eight measurement boxes */
function EyeSide({ side, t }) {
  const k = side === 'R' ? 'r' : 'l';
  const v = (f) => t[`${k}_${f}`] ?? '';
  const box = (f, label, placeholder) => (
    <Field label={label}>
      <input name={`${k}_${f}`} defaultValue={v(f)} placeholder={placeholder} />
    </Field>
  );
  return (
    <Fieldset legend={side === 'R' ? 'ตาขวา — Right (R)' : 'ตาซ้าย — Left (L)'}>
      <FormGrid>
        {box('sphere', 'Sphere', '-1.25')}
        {box('cylinder', 'Cylinder', '-0.50')}
        {box('axis', 'Axis', '90')}
        {box('add', 'Add', '+2.00')}
        {box('pd', 'PD', '32')}
        {box('va', 'VA', '1.0')}
        {box('prism', 'Prism')}
        {box('base', 'Base')}
      </FormGrid>
    </Fieldset>
  );
}

// editing must always be passed explicitly by the caller (true or false) — if a future
// page forgets it, editing becomes undefined (falsy), silently serving a *create* form
// on what was meant to be an *edit* route.
export function PrescriptionFormView({ editing }) {
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();
  const [picked, setPicked] = useState(null);

  const id = editing ? params.get('id') : null;
  const queryCustomer = params.get('customer');
  const queryCase = params.get('case');

  const { data, loading, error } = useAsync(() => {
    if (editing && !id) return Promise.resolve(null);
    return (async () => {
      const t = editing ? await api.get('/api/prescriptions/' + id) : {};
      const cid = editing ? t.customer_id : (queryCustomer ? Number(queryCustomer) : null);
      const customer = cid ? await api.get('/api/customers/' + cid) : null;
      return { t, customer };
    })();
  }, [editing, id, queryCustomer]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;
  if (editing && !id) {
    return <Card><h2>ไม่พบรหัสการวัดสายตา</h2><p className="muted">ไม่มี id ของรายการที่จะแก้ไข</p></Card>;
  }
  if (editing && (!data || !data.t || !data.t.id)) {
    return <Card><h2>ไม่พบข้อมูลการวัดสายตา</h2><p className="muted">ไม่พบรายการนี้ในระบบ</p></Card>;
  }

  const t = editing ? data.t : {};
  const customer = picked ?? (data && data.customer);
  const caseId = editing ? t.case_id : (queryCase ? Number(queryCase) : null);

  const save = async (body) => {
    if (!customer) return err('กรุณาเลือกลูกค้าก่อน');
    body.customer_id = customer.id;
    body.case_id = caseId;
    body.test_date = toStamp(body.test_date);
    try {
      if (editing) await api.put('/api/prescriptions/' + id, body);
      else await api.post('/api/prescriptions', body);
      ok('บันทึกผลวัดสายตาเรียบร้อย');
      router.push(caseId ? '/cases/detail?id=' + caseId : '/customers/detail?id=' + customer.id);
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <>
      <PageHead
        icon="👁"
        title="Prescription"
        subtitle="บันทึกการวัดสายตา"
        actions={caseId ? <Link className="btn btn-ghost" href={'/cases/detail?id=' + caseId}><Icon name="arrowLeft" /> กลับไปที่เคส</Link> : null}
      />

      <Split>
        <Card title="ลูกค้า">
          <Picker
            placeholder="ค้นหาลูกค้า (ชื่อ / เบอร์โทร / รหัส)"
            fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
            label={custName}
            sub={(r) => r.phone || ''}
            selectedId={customer?.id}
            onPick={setPicked}
          />
        </Card>
        <Card title="ลูกค้าที่เลือก">
          {customer ? (
            <Row>
              <span className="badge blue">#{customer.id}</span>
              <b>{custName(customer)}</b>
              <span className="muted">{customer.phone || ''}</span>
            </Row>
          ) : <span className="muted">ยังไม่ได้เลือกลูกค้า</span>}
        </Card>
      </Split>

      <Card>
        <form onSubmit={onSubmit(save)}>
          <FormGrid two>
            <Field label="ชนิดค่าสายตา">
              <Select
                name="kind"
                options={[['old', 'ค่าเดิม (แว่นเก่า)'], ['measured', 'ค่าที่วัดได้'], ['final', 'ค่าที่ใช้จริง']]}
                defaultValue={t.kind || 'measured'}
              />
            </Field>
            <Field label="พนักงานผู้วัด">
              <EmployeeSelect name="performed_by" defaultValue={t.performed_by || ''} />
            </Field>
            <Field label="วันที่วัด">
              <input name="test_date" type="datetime-local" defaultValue={dtLocal(t.test_date) || nowLocal()} />
            </Field>
            <Field label="ใช้สำหรับ / TestFor">
              <ListSelect name="test_for" kind="test_for" defaultValue={t.test_for || ''} blank="—" />
            </Field>
          </FormGrid>

          <div className="split" style={{ marginTop: 14 }}>
            <EyeSide side="R" t={t} />
            <EyeSide side="L" t={t} />
          </div>

          <Fieldset legend="ข้อมูลเพิ่มเติม">
            <FormGrid>
              <Field label="PD รวม"><input name="pd_total" defaultValue={t.pd_total || ''} /></Field>
              <Field label="แว่นเดิมเป็นแบบ"><input name="old_glasses_type" defaultValue={t.old_glasses_type || ''} /></Field>
              <Field label="ระยะแนวตั้ง R"><input name="dist_vertical_r" defaultValue={t.dist_vertical_r || ''} /></Field>
              <Field label="ระยะแนวตั้ง L"><input name="dist_vertical_l" defaultValue={t.dist_vertical_l || ''} /></Field>
              <Field label="ระยะจอ R"><input name="dist_monitor_r" defaultValue={t.dist_monitor_r || ''} /></Field>
              <Field label="ระยะจอ L"><input name="dist_monitor_l" defaultValue={t.dist_monitor_l || ''} /></Field>
              <Field label="รู้จักร้านจาก">
                <ListSelect name="known_from" kind="marketing" defaultValue={t.known_from || ''} blank="—" />
              </Field>
            </FormGrid>
          </Fieldset>

          <Fieldset legend="ประวัติสุขภาพ">
            <Row style={{ gap: 16 }}>
              {HEALTH.map(([k, label]) => (
                <Check key={k} name={k} defaultChecked={!!Number(t[k])}>{label}</Check>
              ))}
            </Row>
            <Field label="รายละเอียดสุขภาพ" className="full">
              <input name="health_note" defaultValue={t.health_note || ''} />
            </Field>
          </Fieldset>

          <FormGrid two>
            <Field label="บันทึกการตรวจ / Exam note">
              <textarea name="exam_note" defaultValue={t.exam_note || ''} />
            </Field>
            <Field label="หมายเหตุ / Notes">
              <textarea name="notes" defaultValue={t.notes || ''} />
            </Field>
          </FormGrid>

          <FormActions style={{ marginTop: 14 }}>
            <button className="btn btn-lg" type="submit">
              <Icon name="save" /> {editing ? 'บันทึกการแก้ไข' : 'บันทึกผลวัดสายตา'}
            </button>
            {editing && <Link className="btn btn-light" href={'/print/prescription?id=' + id}><Icon name="printer" /> พิมพ์</Link>}
            <Link className="btn btn-light" href={caseId ? '/cases/detail?id=' + caseId : '/prescriptions'}>ยกเลิก</Link>
          </FormActions>
        </form>
      </Card>
    </>
  );
}
