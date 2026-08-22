import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, Field, FormActions, FormGrid, Loading, PageHead } from '../../components/ui.jsx';
import { ListSelect } from '../../components/Selects.jsx';
import { NATIONALITIES } from '../../lib/constants.js';
import { dateOnly } from '../../lib/format.js';

export default function CustomerForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { ok, err } = useToast();

  const { data: c, loading } = useAsync(
    () => (editing ? api.get('/api/customers/' + id) : Promise.resolve({})),
    [id]
  );

  if (loading) return <Loading />;

  const save = async (body) => {
    try {
      const saved = editing
        ? await api.put('/api/customers/' + c.id, body)
        : await api.post('/api/customers', body);
      ok('บันทึกลูกค้าเรียบร้อย');
      if (params.get('next') === 'case') navigate('/cases/new?customer=' + saved.id);
      else navigate('/customers/' + saved.id);
    } catch (ex) {
      err(ex);
    }
  };

  return (
    <>
      <PageHead
        icon="👥"
        title={editing ? 'Edit Customer' : 'New Customer'}
        subtitle={editing ? 'แก้ไขข้อมูลลูกค้า' : 'ลูกค้าใหม่'}
      />
      <form className="card" onSubmit={onSubmit(save)}>
        <div className="card-body">
          <FormGrid>
            <Field label="ชื่อ / First name">
              <input name="first_name" defaultValue={c.first_name || ''} required />
            </Field>
            <Field label="ชื่อกลาง / Mid name">
              <input name="mid_name" defaultValue={c.mid_name || ''} />
            </Field>
            <Field label="นามสกุล / Last name">
              <input name="last_name" defaultValue={c.last_name || ''} />
            </Field>
            <Field label="เพศ / Sex">
              <ListSelect name="sex" kind="sex" defaultValue={c.sex || ''} blank="—" />
            </Field>
            <Field label="สัญชาติ / Nationality">
              <input name="nationality" defaultValue={c.nationality || ''} list="nat-list" />
            </Field>
            <Field label="วันเกิด / Birth date">
              <input name="birth_date" type="date" defaultValue={dateOnly(c.birth_date)} />
            </Field>
            <Field label="เบอร์โทร / Phone">
              <input name="phone" defaultValue={c.phone || ''} />
            </Field>
            <Field label="LINE ID">
              <input name="line_id" defaultValue={c.line_id || ''} />
            </Field>
            <Field label="อีเมล / Email">
              <input name="email" type="email" defaultValue={c.email || ''} />
            </Field>
            <Field label="หมายเหตุ / Notes" className="full">
              <textarea name="notes" defaultValue={c.notes || ''} />
            </Field>
          </FormGrid>

          <datalist id="nat-list">
            {NATIONALITIES.map((n) => <option key={n} value={n} />)}
          </datalist>

          <FormActions>
            <button className="btn btn-lg" type="submit">
              {editing ? '💾 บันทึกการแก้ไข' : '✔ บันทึกลูกค้าใหม่'}
            </button>
            <Link className="btn btn-light" to={editing ? '/customers/' + c.id : '/customers'}>ยกเลิก</Link>
          </FormActions>
        </div>
      </form>
    </>
  );
}
