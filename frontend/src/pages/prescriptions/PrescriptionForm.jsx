import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, readForm } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, Check, Field, Fieldset, FormActions, FormGrid, Loading, PageHead, Row, Split,
} from '../../components/ui.jsx';
import { Picker } from '../../components/Picker.jsx';
import { EmployeeSelect, ListSelect, Select } from '../../components/Selects.jsx';
import { custName, dtLocal, nowLocal, toStamp } from '../../lib/format.js';

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

export default function PrescriptionForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { ok, err } = useToast();

  const queryCustomer = params.get('customer');
  const queryCase = params.get('case');

  const { data, loading } = useAsync(async () => {
    const t = editing ? await api.get('/api/prescriptions/' + id) : {};
    const cid = editing ? t.customer_id : (queryCustomer ? Number(queryCustomer) : null);
    const customer = cid ? await api.get('/api/customers/' + cid) : null;
    return { t, customer };
  }, [id, queryCustomer]);

  const [picked, setPicked] = useState(null);

  if (loading) return <Loading />;

  const t = data.t;
  const customer = picked ?? data.customer;
  const caseId = editing ? t.case_id : (queryCase ? Number(queryCase) : null);

  const save = async (e) => {
    e.preventDefault();
    if (!customer) return err('กรุณาเลือกลูกค้าก่อน');
    const body = { ...readForm(e.currentTarget), customer_id: customer.id, case_id: caseId };
    body.test_date = toStamp(body.test_date);
    try {
      if (editing) await api.put('/api/prescriptions/' + t.id, body);
      else await api.post('/api/prescriptions', body);
      ok('บันทึกผลวัดสายตาเรียบร้อย');
      navigate(caseId ? '/cases/' + caseId : '/customers/' + customer.id);
    } catch (ex) {
      err(ex);
    }
    return undefined;
  };

  return (
    <>
      <PageHead
        icon="👁"
        title="Prescription"
        subtitle="บันทึกการวัดสายตา"
        actions={caseId ? <Link className="btn btn-ghost" to={'/cases/' + caseId}>← กลับไปที่เคส</Link> : null}
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
        <form onSubmit={save}>
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
              {editing ? '💾 บันทึกการแก้ไข' : '✔ บันทึกผลวัดสายตา'}
            </button>
            {editing && <Link className="btn btn-light" to={'/print/prescription/' + t.id}>🖨 พิมพ์</Link>}
            <Link className="btn btn-light" to={caseId ? '/cases/' + caseId : '/prescriptions'}>ยกเลิก</Link>
          </FormActions>
        </form>
      </Card>
    </>
  );
}
