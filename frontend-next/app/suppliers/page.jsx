'use client';
import { api } from '../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useMeta } from '../../contexts/MetaContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Badge, Card, Field, FormActions, FormGrid, Loading, PageHead } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';

export default function SupplierList() {
  const { reload: reloadMeta } = useMeta();
  const { ok, err } = useToast();
  const { data: rows, loading, reload } = useAsync(() => api.get('/api/suppliers'), []);

  const add = async (body, form) => {
    try {
      await api.post('/api/suppliers', body);
      await reloadMeta();
      ok('เพิ่มแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  const toggle = async (r) => {
    try {
      await api.put('/api/suppliers/' + r.id, { ...r, active: Number(r.active) ? 0 : 1 });
      await reloadMeta();
      reload();
    } catch (ex) { err(ex); }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHead icon="🏭" title="Suppliers" subtitle="ซัพพลายเออร์เลนส์/สินค้า" />

      <div className="card">
        <div className="card-head"><h2>เพิ่มซัพพลายเออร์</h2></div>
        <form className="card-body" onSubmit={onSubmit(add)}>
          <FormGrid>
            <Field label="ชื่อซัพพลายเออร์ *"><input name="name" required /></Field>
            <Field label="ผู้ติดต่อ"><input name="contact_person" /></Field>
            <Field label="เบอร์โทร"><input name="phone" /></Field>
            <Field label="อีเมล"><input name="email" type="email" /></Field>
            <Field label="Lead time ปกติ (วัน)">
              <input name="default_lead_days" type="number" min="0" defaultValue={7} />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn" type="submit">+ เพิ่มซัพพลายเออร์</button>
          </FormActions>
        </form>
      </div>

      <Card title="รายชื่อซัพพลายเออร์" tight>
        <DataTable
          columns={[
            { label: 'ID', key: 'id', cls: 'mono' },
            { label: 'ชื่อ', key: 'name' },
            { label: 'ผู้ติดต่อ', key: 'contact_person' },
            { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
            { label: 'อีเมล', key: 'email' },
            { label: 'Lead time', render: (r) => r.default_lead_days + ' วัน', cls: 'num' },
            {
              label: 'สถานะ',
              render: (r) => (Number(r.active) ? <Badge kind="ok">ใช้งาน</Badge> : <Badge kind="gray">ปิด</Badge>),
            },
            {
              label: '',
              cls: 'nowrap',
              render: (r) => (
                <button type="button" className="btn btn-sm btn-light" onClick={() => toggle(r)}>
                  {Number(r.active) ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                </button>
              ),
            },
          ]}
          rows={rows}
          empty="ยังไม่มีซัพพลายเออร์"
        />
      </Card>
    </>
  );
}
