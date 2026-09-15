'use client';
import { api } from '../../../../../lib/apiClient.js';
import { readForm } from '../../../../../lib/hooks.js';
import { useToast } from '../../../../../components/Toast.jsx';
import { Badge, Empty, Field } from '../../../../../components/ui.jsx';
import { ACTION_LABEL } from '../../../../../lib/constants.js';
import { SEND_EVENT_LABEL } from '../../../../../lib/centeringSend.js';
import { CUSTOMER_EVENT_LABEL } from '../../../../../lib/caseCustomer.js';
import { eventNote } from '../../../../../lib/caseProcesses.js';
import { fmtDateTime } from '../../../../../lib/format.js';
import { Icon } from '../../../../../components/Icon.jsx';

export function TimelinePanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const events = c.events || [];

  const addNote = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api.post(`/api/cases/${c.id}/note`, { ...readForm(form), employee_id: actorId() });
      ok('บันทึกแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>ไทม์ไลน์เคส</h2>
        <Badge kind="gray">{`${events.length} เหตุการณ์`}</Badge>
      </div>

      <form className="card-body" onSubmit={addNote}>
        <div className="row">
          <Field label="เพิ่มบันทึกลงไทม์ไลน์" className="grow">
            <input name="note" placeholder="พิมพ์บันทึก…" required />
          </Field>
          <button className="btn" type="submit">+ บันทึก</button>
        </div>
      </form>

      <div className="card-body">
        {events.length === 0 ? <Empty>ยังไม่มีเหตุการณ์</Empty> : (
          <div className="timeline">
            {events.map((ev) => (
              <div className="tl-item" key={ev.id}>
                <div className="tl-dot" />
                <div className="tl-body">
                  <div className="tl-head">
                    <b>{ACTION_LABEL[ev.action] || SEND_EVENT_LABEL[ev.action] || CUSTOMER_EVENT_LABEL[ev.action] || ev.action}</b>
                    {ev.to_label ? <Badge kind="blue"><Icon name="arrowRight" /> {ev.to_label}</Badge> : null}
                    <span className="muted">{fmtDateTime(ev.created_at)}</span>
                    {ev.employee_name ? <span className="muted">{'· ' + ev.employee_name}</span> : null}
                  </div>
                  {ev.note ? <div className="tl-note">{eventNote(ev)}</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
