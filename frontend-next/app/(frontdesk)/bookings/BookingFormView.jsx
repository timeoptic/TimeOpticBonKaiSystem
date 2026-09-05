'use client';
/**
 * Shared booking create/edit form. Port of frontend/src/pages/bookings/BookingForm.jsx,
 * with one structural change: `editing` is now an explicit prop instead of being derived
 * from whether a path param was present (react-router's `!!useParams().id`). The two
 * callers — app/bookings/new/page.jsx and app/bookings/edit/page.jsx — each pass the
 * right value; this component itself reads `id` from the query string only when editing.
 *
 * 28/08/2026 ตัดช่องที่หน้าร้านไม่ได้กรอกจริงออก: ใช้เวลาประมาณ, ผู้รับจอง,
 * บันทึกเบื้องต้น และการ์ดคำถามเบื้องต้น ส่วน "แจ้งเตือนล่วงหน้า" ย้ายไปตั้งครั้งเดียว
 * ที่หน้า ตั้งค่า/แจ้งเตือน (reminder_default_minutes) แล้วฝั่ง API หยิบไปใช้เอง
 * — ค่าเดิมของคิวที่บันทึกไว้แล้วไม่ถูกแตะ เพราะ PUT ส่งเฉพาะช่องที่ยังอยู่ในฟอร์ม
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../lib/hooks.js';
import { useBookingLabels } from '../../../contexts/MetaContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import {
  Card, Field, FormActions, FormGrid, Loading, PageHead, Row, Split,
} from '../../../components/ui.jsx';
import { Picker } from '../../../components/Picker.jsx';
import { EmployeeSelect, Select } from '../../../components/Selects.jsx';
import { custName, dateOnly, hhmm, todayISO } from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';
import { DateField } from '../../../components/DateField.jsx';

export function BookingFormView({ editing }) {
  // `editing` must always be passed explicitly (true or false) by the caller —
  // if omitted it's undefined (falsy), which silently renders a *create* form
  // on what was meant to be an *edit* route.
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();
  const { serviceTypes, channels } = useBookingLabels();

  const id = editing ? params.get('id') : null;
  const queryCustomer = params.get('customer');
  const queryDate = params.get('date');

  const { data, loading, error } = useAsync(async () => {
    // guard mirrors the `editing && !id` check below — avoids ever calling
    // GET /api/bookings/null when someone lands on /bookings/edit with no id
    if (editing && !id) return { b: {}, customer: null };
    const b = editing ? await api.get('/api/bookings/' + id) : {};
    let customer = null;
    if (editing && b.customer_id) customer = await api.get('/api/customers/' + b.customer_id);
    else if (queryCustomer) customer = await api.get('/api/customers/' + queryCustomer);
    return { b, customer };
  }, [editing, id, queryCustomer]);

  /* undefined = untouched, null = explicitly cleared */
  const [override, setOverride] = useState(undefined);

  if (editing && !id) {
    return <Card><h2>ไม่พบรหัสการจอง</h2><p className="muted">ไม่มี id ของการจองที่จะแก้ไข</p></Card>;
  }
  if (loading) return <Loading />;
  if (error) return <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>;

  const b = data.b;
  const customer = override === undefined ? data.customer : override;

  const save = async (e) => {
    e.preventDefault();
    const body = { ...readForm(e.currentTarget), customer_id: customer ? customer.id : null };

    // a linked customer owns the name fields; don't duplicate them on the booking
    if (customer) {
      body.first_name = null;
      body.last_name = null;
      body.phone = null;
      body.line_id = null;
    }
    try {
      const saved = editing
        ? await api.put('/api/bookings/' + b.id, body)
        : await api.post('/api/bookings', body);
      ok(editing ? 'บันทึกแล้ว' : 'จองคิว ' + saved.booking_code + ' เรียบร้อย');
      router.push('/bookings/detail?id=' + saved.id);
    } catch (ex) {
      err(ex);
    }
  };

  /* when a customer is linked, the free-text fields are hidden and left blank
     · form="booking-form" เพราะการ์ดนี้อยู่เหนือ <form> คนละก้อนกันตามเลย์เอาต์
       ถ้าไม่ผูกไว้ readForm() ซึ่งอ่านแค่ form.elements จะไม่เห็นสี่ช่องนี้เลย
       แล้วการจองลูกค้าใหม่จะโดน API ตีกลับว่าไม่ได้กรอกชื่อ/เบอร์ */
  const freeText = (name, label) => (
    <Field label={label}>
      <input form="booking-form" name={name} defaultValue={b.customer_id ? '' : (b[name] || '')} />
    </Field>
  );

  return (
    <>
      <PageHead
        icon="📅"
        title={editing ? 'Edit Booking' : 'New Booking'}
        subtitle={editing ? 'แก้ไขการจองคิว' : 'จองคิวลูกค้า'}
      />

      <Split>
        <Card title="ลูกค้าเดิม (ถ้ามี)">
          <Picker
            placeholder="ค้นหาลูกค้าเดิม (ชื่อ / เบอร์โทร / รหัส)"
            fetcher={(q) => api.get('/api/customers', { q, limit: 40 })}
            label={custName}
            sub={(r) => r.phone || ''}
            selectedId={customer?.id}
            onPick={setOverride}
          />
        </Card>

        <Card title="ลูกค้าที่จอง">
          {customer ? (
            <Row>
              <span className="badge blue">#{customer.id}</span>
              <b>{custName(customer)}</b>
              <span className="muted">{customer.phone || ''}</span>
              <button type="button" className="btn btn-sm btn-light" onClick={() => setOverride(null)}>
                <Icon name="x" /> ล้าง
              </button>
            </Row>
          ) : <span className="muted">ลูกค้าใหม่ — กรอกชื่อ/เบอร์ด้านล่างได้เลย</span>}

          <div style={{ display: customer ? 'none' : '', marginTop: 10 }}>
            <FormGrid>
              {freeText('first_name', 'ชื่อ')}
              {freeText('last_name', 'นามสกุล')}
              {freeText('phone', 'เบอร์โทร')}
              {freeText('line_id', 'LINE ID / WhatsApp')}
            </FormGrid>
          </div>
        </Card>
      </Split>

      <form id="booking-form" onSubmit={save}>
        <Card title="รายละเอียดการจอง">
          <FormGrid>
            <Field label="วันที่จอง *">
              <DateField
                name="booking_date"
                required
                defaultValue={dateOnly(b.booking_date) || queryDate || todayISO(1)}
              />
            </Field>
            <Field label="เวลา *">
              <input name="booking_time" type="time" required defaultValue={hhmm(b.booking_time) || '10:00'} />
            </Field>
            <Field label="บริการที่ต้องการ">
              <Select name="service_type" options={serviceTypes} defaultValue={b.service_type || 'eye_exam'} />
            </Field>
            <Field label="จองผ่านช่องทาง">
              <Select name="channel" options={channels} defaultValue={b.channel || 'phone'} />
            </Field>
            <Field label="พนักงานผู้ดูแล">
              <EmployeeSelect name="assigned_to" defaultValue={b.assigned_to || ''} />
            </Field>
          </FormGrid>

          <Field label="หมายเหตุอื่น ๆ" className="full">
            <textarea name="notes" defaultValue={b.notes || ''} />
          </Field>
        </Card>

        <FormActions>
          <button className="btn btn-lg" type="submit">
            <Icon name="save" /> {editing ? 'บันทึกการแก้ไข' : 'บันทึกการจอง'}
          </button>
          <Link className="btn btn-light" href={editing ? '/bookings/detail?id=' + b.id : '/bookings'}>ยกเลิก</Link>
        </FormActions>
      </form>
    </>
  );
}
