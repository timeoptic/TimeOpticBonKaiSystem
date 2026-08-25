'use client';
/**
 * Shared booking create/edit form. Port of frontend/src/pages/bookings/BookingForm.jsx,
 * with one structural change: `editing` is now an explicit prop instead of being derived
 * from whether a path param was present (react-router's `!!useParams().id`). The two
 * callers — app/bookings/new/page.jsx and app/bookings/edit/page.jsx — each pass the
 * right value; this component itself reads `id` from the query string only when editing.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync, readForm } from '../../lib/hooks.js';
import { useBookingLabels } from '../../contexts/MetaContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, Field, FormActions, FormGrid, Loading, PageHead, Row, Split, Stack,
} from '../../components/ui.jsx';
import { Picker } from '../../components/Picker.jsx';
import { EmployeeSelect, Select } from '../../components/Selects.jsx';
import { custName, dateOnly, hhmm, todayISO } from '../../lib/format.js';

export function BookingFormView({ editing }) {
  // `editing` must always be passed explicitly (true or false) by the caller —
  // if omitted it's undefined (falsy), which silently renders a *create* form
  // on what was meant to be an *edit* route.
  const router = useRouter();
  const params = useSearchParams();
  const { ok, err } = useToast();
  const { serviceTypes, channels, intakeQuestions } = useBookingLabels();

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
  const [answers, setAnswers] = useState({});

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
    for (const k of Object.keys(body)) if (k.startsWith('q_')) delete body[k];

    // a linked customer owns the name fields; don't duplicate them on the booking
    if (customer) {
      body.first_name = null;
      body.last_name = null;
      body.phone = null;
      body.line_id = null;
    }
    if (!editing) {
      body.step_notes = intakeQuestions
        .map((q, i) => ({ question: q, note: (answers[i] || '').trim() }))
        .filter((x) => x.note)
        .map((x) => ({ step: 'intake', question: x.question, note: x.note }));
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

  /* when a customer is linked, the free-text fields are hidden and left blank */
  const freeText = (name, label) => (
    <Field label={label}>
      <input name={name} defaultValue={b.customer_id ? '' : (b[name] || '')} />
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
                ✕ ล้าง
              </button>
            </Row>
          ) : <span className="muted">ลูกค้าใหม่ — กรอกชื่อ/เบอร์ด้านล่างได้เลย</span>}

          <div style={{ display: customer ? 'none' : '', marginTop: 10 }}>
            <FormGrid>
              {freeText('first_name', 'ชื่อ')}
              {freeText('last_name', 'นามสกุล')}
              {freeText('phone', 'เบอร์โทร')}
              {freeText('line_id', 'LINE ID')}
            </FormGrid>
          </div>
        </Card>
      </Split>

      <form onSubmit={save}>
        <Card title="รายละเอียดการจอง">
          <FormGrid>
            <Field label="วันที่จอง *">
              <input
                name="booking_date"
                type="date"
                required
                defaultValue={dateOnly(b.booking_date) || queryDate || todayISO(1)}
              />
            </Field>
            <Field label="เวลา *">
              <input name="booking_time" type="time" required defaultValue={hhmm(b.booking_time) || '10:00'} />
            </Field>
            <Field label="ใช้เวลาประมาณ (นาที)">
              <input name="duration_min" type="number" min="5" step="5" defaultValue={b.duration_min ?? 30} />
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
            <Field
              label="แจ้งเตือนล่วงหน้า (นาที)"
              hint="ส่งเข้า Telegram ก่อนถึงคิว · ใส่ 0 = ไม่แจ้ง"
            >
              <input
                name="reminder_minutes"
                type="number"
                min="0"
                max="1440"
                defaultValue={b.reminder_minutes ?? 10}
              />
            </Field>
            <Field label="ผู้รับจอง">
              <EmployeeSelect name="created_by" defaultValue={b.created_by || ''} />
            </Field>
          </FormGrid>

          <Field label="บันทึกเบื้องต้น / Intake note" className="full">
            <textarea
              name="intake_note"
              defaultValue={b.intake_note || ''}
              placeholder="ลูกค้าโทรมาเรื่องอะไร มีอาการอย่างไร ต้องการอะไรเป็นพิเศษ"
            />
          </Field>
          <Field label="หมายเหตุอื่น ๆ" className="full">
            <textarea name="notes" defaultValue={b.notes || ''} />
          </Field>
        </Card>

        {!editing && (
          <Card title="คำถามเบื้องต้นตอนรับจอง (กรอกเท่าที่ถามได้)">
            <Stack>
              {intakeQuestions.map((q, i) => (
                <Field key={q} label={q}>
                  <input
                    placeholder="คำตอบ…"
                    value={answers[i] || ''}
                    onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                  />
                </Field>
              ))}
            </Stack>
            <p className="hint">
              ข้อมูลนี้จะถูกส่งไปกับการแจ้งเตือน Telegram และคัดลอกเข้าเคสอัตโนมัติเมื่อลูกค้ามาถึง
            </p>
          </Card>
        )}

        <FormActions>
          <button className="btn btn-lg" type="submit">
            {editing ? '💾 บันทึกการแก้ไข' : '✔ บันทึกการจอง'}
          </button>
          <Link className="btn btn-light" href={editing ? '/bookings/detail?id=' + b.id : '/bookings'}>ยกเลิก</Link>
        </FormActions>
      </form>
    </>
  );
}
