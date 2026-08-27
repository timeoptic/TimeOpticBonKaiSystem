'use client';
/**
 * Shared customer create/edit form. Port of frontend/src/pages/customers/CustomerForm.jsx,
 * restructured the same way app/bookings/BookingFormView.jsx was: `editing` is an explicit
 * prop, not derived from a route param. This version also bakes in, from the start, the
 * error/loader guards that BookingFormView needed a hotfix to add after its final review —
 * see the plan's Global Constraints for why both guards are required together.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, Field, FormActions, FormGrid, Loading, PageHead } from '../../components/ui.jsx';
import { ListSelect } from '../../components/Selects.jsx';
import { NATIONALITIES } from '../../lib/constants.js';
import { dateOnly } from '../../lib/format.js';
import { Icon } from '../../components/Icon.jsx';

// editing must always be passed explicitly by the caller (true or false) — if a future
// page forgets it, editing becomes undefined (falsy), silently serving a *create* form
// on what was meant to be an *edit* route.
export function CustomerFormView({ editing }) {
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();

  const id = editing ? params.get('id') : null;

  const { data, loading, error } = useAsync(() => {
    if (!editing || !id) return Promise.resolve({});
    return api.get('/api/customers/' + id);
  }, [editing, id]);

  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;
  if (editing && !id) {
    return <Card><h2>ไม่พบรหัสลูกค้า</h2><p className="muted">ไม่มี id ของลูกค้าที่จะแก้ไข</p></Card>;
  }
  if (editing && (!data || !data.id)) {
    return <Card><h2>ไม่พบข้อมูลลูกค้า</h2><p className="muted">ไม่พบลูกค้ารายนี้ในระบบ</p></Card>;
  }

  const c = data;

  const save = async (body) => {
    try {
      const saved = editing
        ? await api.put('/api/customers/' + id, body)
        : await api.post('/api/customers', body);
      ok('บันทึกลูกค้าเรียบร้อย');
      if (params.get('next') === 'case') router.push('/cases/new?customer=' + saved.id);
      else router.push('/customers/detail?id=' + saved.id);
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
              <Icon name="save" /> {editing ? 'บันทึกการแก้ไข' : 'บันทึกลูกค้าใหม่'}
            </button>
            <Link className="btn btn-light" href={editing ? '/customers/detail?id=' + id : '/customers'}>ยกเลิก</Link>
          </FormActions>
        </div>
      </form>
    </>
  );
}
