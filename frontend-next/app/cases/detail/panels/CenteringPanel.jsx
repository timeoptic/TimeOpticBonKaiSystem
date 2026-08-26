'use client';
import { api } from '../../../../lib/apiClient.js';
import { readForm } from '../../../../lib/hooks.js';
import { useToast } from '../../../../components/Toast.jsx';
import { Field, FormActions, FormGrid } from '../../../../components/ui.jsx';
import { EmployeeSelect } from '../../../../components/Selects.jsx';
import { PhotoUpload } from '../../../../components/PhotoUpload.jsx';

export function CenteringPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const ce = c.centering || {};
  const order = c.order || {};

  const post = (endpoint, extra) => async (e) => {
    e.preventDefault();
    try {
      await api.post(endpoint, { ...readForm(e.currentTarget), case_id: c.id, order_id: c.order?.id, ...extra });
      ok('บันทึกแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  const text = (name, label, source) => (
    <Field label={label}><input name={name} defaultValue={source[name] || ''} /></Field>
  );

  return (
    <div className="card">
      <div className="card-head"><h2>จุดศูนย์กลาง — Centering</h2></div>
      <form
        className="card-body"
        onSubmit={post('/api/centerings', { recorded_by: actorId() })}
      >
        <FormGrid>
          {text('r_pd', 'R PD', ce)}
          {text('l_pd', 'L PD', ce)}
          {text('pd_total', 'PD รวม', ce)}
          {text('r_height', 'R Height', ce)}
          {text('l_height', 'L Height', ce)}
          {text('vertex_distance', 'Vertex', ce)}
          {text('pantoscopic_tilt', 'Pantoscopic tilt', ce)}
          {text('wrap_angle', 'Wrap angle', ce)}
          <Field label="ผู้วัด">
            <EmployeeSelect name="performed_by" defaultValue={ce.performed_by || ''} />
          </Field>
        </FormGrid>
        <FormActions>
          <button className="btn btn-light" type="submit">💾 บันทึกจุดศูนย์กลาง</button>
        </FormActions>
      </form>

      <div className="card-body">
        <Field label="กรอบที่เลือก (จาก Process การขาย)">
          <p className="muted">
            {order.frame_name
              ? `${order.frame_name}${order.frame_brand ? ` — ${order.frame_brand}` : ''}${order.frame_sku ? ` (${order.frame_sku})` : ''}`
              : 'ยังไม่ได้เลือกกรอบ'}
          </p>
        </Field>
      </div>

      <div className="card-body">
        <PhotoUpload caseId={c.id} kind="centering" centeringId={c.centering?.id} takenBy={actorId()} />
      </div>
    </div>
  );
}
