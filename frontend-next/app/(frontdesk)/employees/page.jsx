'use client';
import { api } from '../../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../../lib/hooks.js';
import { useMeta } from '../../../contexts/MetaContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { Badge, Card, Field, FormActions, FormGrid, Loading, PageHead } from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { ListSelect } from '../../../components/Selects.jsx';
import { fmtDate } from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';

function EmployeeListInner() {
  const { reload: reloadMeta } = useMeta();
  const { ok, err } = useToast();
  const { data: rows, loading, reload } = useAsync(() => api.get('/api/employees'), []);

  const add = async (body, form) => {
    try {
      await api.post('/api/employees', body);
      await reloadMeta();
      ok('เพิ่มพนักงานแล้ว');
      form.reset();
      reload();
    } catch (ex) {
      err(ex);
    }
  };

  const toggle = async (r) => {
    try {
      await api.put('/api/employees/' + r.id, { ...r, active: Number(r.active) ? 0 : 1 });
      await reloadMeta();
      reload();
    } catch (ex) {
      err(ex);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      <PageHead icon="🧑‍💼" title="Employee" subtitle="พนักงาน" />

      <div className="card">
        <div className="card-head"><h2>เพิ่มพนักงานใหม่</h2></div>
        <form className="card-body" onSubmit={onSubmit(add)}>
          <FormGrid>
            <Field label="ชื่อเล่น / Nickname *"><input name="employee_name" required /></Field>
            <Field label="ชื่อจริง"><input name="first_name" /></Field>
            <Field label="นามสกุล"><input name="last_name" /></Field>
            <Field label="เพศ"><ListSelect name="sex" kind="sex" defaultValue="Female" /></Field>
            <Field label="วันเกิด"><input name="birth_date" type="date" /></Field>
            <Field label="หน้าที่ / Roles">
              <input name="roles" placeholder="เช่น sales, optometrist, technician" />
            </Field>
          </FormGrid>
          <FormActions>
            <button className="btn" type="submit"><Icon name="check" /> เพิ่มพนักงาน</button>
          </FormActions>
        </form>
      </div>

      <Card title="รายชื่อพนักงาน" tight>
        <DataTable
          columns={[
            { label: 'ID', key: 'id', cls: 'mono' },
            { label: 'ชื่อเล่น', key: 'employee_name' },
            { label: 'ชื่อจริง', key: 'first_name' },
            { label: 'นามสกุล', key: 'last_name' },
            { label: 'เพศ', key: 'sex' },
            { label: 'หน้าที่', key: 'roles' },
            { label: 'วันเกิด', render: (r) => fmtDate(r.birth_date), cls: 'nowrap' },
            {
              label: 'สถานะ',
              render: (r) => (Number(r.active)
                ? <Badge kind="ok">ทำงานอยู่</Badge>
                : <Badge kind="gray">ลาออก</Badge>),
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
          empty="ยังไม่มีพนักงาน"
        />
      </Card>
    </>
  );
}

/* งานของแอดมิน — พนักงานขายที่พิมพ์ URL เข้ามาตรง ๆ จะเห็นคำอธิบาย
   ไม่ใช่หน้าเปล่าหรือถูกเด้งกลับเงียบ ๆ */
export default function EmployeeList() {
  return <AdminOnly><EmployeeListInner /></AdminOnly>;
}
