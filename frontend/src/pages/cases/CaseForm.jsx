import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, readForm } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, Check, Field, FormActions, FormGrid, Loading, PageHead, Row, Split,
} from '../../components/ui.jsx';
import { Picker } from '../../components/Picker.jsx';
import { EmployeeSelect, StatusSelect } from '../../components/Selects.jsx';
import { custName } from '../../lib/format.js';

export default function CaseForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { ok, err } = useToast();
  const queryCustomer = params.get('customer');

  const { data: initial, loading } = useAsync(
    () => (queryCustomer ? api.get('/api/customers/' + queryCustomer) : Promise.resolve(null)),
    [queryCustomer]
  );
  const [picked, setPicked] = useState(null);

  if (loading) return <Loading />;

  const customer = picked ?? initial;

  const save = async (e) => {
    e.preventDefault();
    if (!customer) return err('กรุณาเลือกลูกค้าก่อน');
    try {
      const saved = await api.post('/api/cases', {
        ...readForm(e.currentTarget),
        customer_id: customer.id,
      });
      ok('เปิดเคส ' + saved.case_code + ' แล้ว');
      navigate('/cases/' + saved.id);
    } catch (ex) {
      err(ex);
    }
    return undefined;
  };

  return (
    <>
      <PageHead icon="🗂" title="New Case" subtitle="เปิดเคสใหม่" />

      <Split>
        <Card
          title="เลือกลูกค้า"
          right={<Link className="btn btn-sm btn-light" to="/customers/new">+ ลูกค้าใหม่</Link>}
        >
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

      <form onSubmit={save}>
        <Card title="เปิดเคสใหม่">
          <FormGrid>
            <Field label="พนักงานผู้รับเรื่อง"><EmployeeSelect name="received_by" defaultValue="" /></Field>
            <Field label="สถานะเริ่มต้น">
              <StatusSelect name="status" openOnly defaultValue="reception" />
            </Field>
            <Field label="ประเภทงาน">
              <Row>
                <Check name="is_rush">งานด่วน 🔥</Check>
                <Check name="is_new_customer">ลูกค้าใหม่</Check>
              </Row>
            </Field>
            <Field label="หมายเหตุความเร่งด่วน"><input name="priority_note" /></Field>
          </FormGrid>

          <Field label="บันทึกตอนรับเรื่อง / Reception note" className="full">
            <textarea name="reception_note" placeholder="ลูกค้าต้องการอะไร มีอาการอย่างไร" />
          </Field>

          <FormActions>
            <button className="btn btn-lg" type="submit">✔ เปิดเคส</button>
            <Link className="btn btn-light" to="/cases">ยกเลิก</Link>
          </FormActions>
        </Card>
      </form>
    </>
  );
}
