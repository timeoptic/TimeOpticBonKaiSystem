'use client';
/**
 * ตั้งค่าเกณฑ์แจ้งเตือนค่าสายตา (Prescription Safety Alert) — spec ข้อ 8.4
 *
 * ทุกการบันทึกเป็นเวอร์ชันใหม่ ไม่แก้ของเดิม — การทบทวนที่บันทึกไปแล้วยังชี้เวอร์ชันที่ใช้ตอนนั้น
 * แก้ได้เฉพาะผู้ถือ system.zone (ทั้งหน้าตั้งค่าอยู่หลัง AdminOnly zone="system" และ API กันซ้ำ)
 */
import { useEffect, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useToast } from '../../../components/Toast.jsx';
import { Card, Field } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icon.jsx';
import { fmtDateTime } from '../../../lib/format.js';

const RULES = [
  { key: 'sph', label: 'SPH', unit: 'D', cols: [['warn', 'เตือน'], ['critical', 'ทบทวน']] },
  { key: 'cyl', label: 'CYL', unit: 'D', cols: [['warn', 'เตือน'], ['critical', 'ทบทวน']] },
  { key: 'se', label: 'SE', unit: 'D', cols: [['warn', 'เตือน'], ['critical', 'ทบทวน']] },
  { key: 'add', label: 'ADD', unit: 'D', cols: [['warn', 'เตือน'], ['critical', 'ทบทวน']] },
  { key: 'axis', label: 'AXIS', unit: '°', cols: [['warn', 'เตือน'], ['min_cyl', 'เมื่อ |CYL| ≥']] },
];

const toForm = (rules) => Object.fromEntries(RULES.map(({ key, cols }) => [key, {
  enabled: !!rules?.[key]?.enabled,
  ...Object.fromEntries(cols.map(([f]) => [f, rules?.[key]?.[f] == null ? '' : String(rules[key][f])])),
}]));

/** ตรวจก่อนส่ง — ฝั่ง API ตรวจซ้ำด้วยกติกาเดียวกัน (RxSafetyStore::save) */
function problemsOf(form) {
  const out = [];
  for (const { key, label, cols } of RULES) {
    for (const [f, fl] of cols) {
      const v = form[key][f];
      if (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) out.push(`${label} ${fl}: ต้องเป็นตัวเลขตั้งแต่ 0`);
    }
    if (cols.some(([f]) => f === 'critical') && Number(form[key].critical) <= Number(form[key].warn)) {
      out.push(`${label}: เกณฑ์ทบทวน (แดง) ต้องมากกว่าเกณฑ์เตือน (เหลือง)`);
    }
  }
  return out;
}

const summary = (rules) => RULES.map(({ key, label, cols }) => {
  const r = rules?.[key] || {};
  if (!r.enabled) return `${label} ปิด`;
  return `${label} ${cols.map(([f]) => r[f]).join('/')}`;
}).join(' · ');

export function RxAlertRules() {
  const { ok, err } = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/settings/rx-alert-rules')
      .then((d) => { setData(d); setForm(toForm(d.rules)); })
      .catch((e) => setData({ error: e.message || String(e) }));
  }, []);

  if (!data) return <Card title="เกณฑ์แจ้งเตือนค่าสายตา"><p className="muted">กำลังโหลด…</p></Card>;
  if (data.error) return <Card title="เกณฑ์แจ้งเตือนค่าสายตา"><p className="muted">{data.error}</p></Card>;

  const problems = problemsOf(form);
  const set = (key, f, v) => setForm((x) => ({ ...x, [key]: { ...x[key], [f]: v } }));

  const save = async () => {
    setBusy(true);
    try {
      const rules = Object.fromEntries(RULES.map(({ key, cols }) => [key, {
        enabled: form[key].enabled,
        ...Object.fromEntries(cols.map(([f]) => [f, Number(form[key][f])])),
      }]));
      const d = await api.put('/api/settings/rx-alert-rules', { rules, note });
      setData((x) => ({ ...x, ...d }));
      setForm(toForm(d.rules));
      setNote('');
      ok(`บันทึกเกณฑ์แล้ว (เวอร์ชัน ${d.version})`);
    } catch (e) { err(e); } finally { setBusy(false); }
  };

  return (
    <div data-testid="rx-alert-rules">
      <Card title="เกณฑ์แจ้งเตือนค่าสายตา (Prescription Safety Alert)" right={<span className="muted">{`ใช้อยู่: v${data.version}`}</span>}>
        <p className="rxs-block-note" style={{ fontWeight: 500, marginBottom: 10 }}>
          <Icon name="warning" />
          ค่าเกณฑ์เป็นค่าทดลอง ต้องผ่านการตรวจทานโดยนักทัศนมาตรก่อนใช้จริง ไม่ใช่มาตรฐานวินิจฉัย
        </p>
        <p className="muted" style={{ marginTop: 0 }}>
          เทียบค่าแว่นเดิมกับค่าที่จ่ายจริง (แยกตาขวา/ซ้าย) · ถึงเกณฑ์ &quot;เตือน&quot; = สีเหลือง ยืนยันต่อได้ ·
          ถึงเกณฑ์ &quot;ทบทวน&quot; = สีแดง ต้องใส่เหตุผลก่อนยืนยัน · บันทึกแล้วเป็นเวอร์ชันใหม่ ประวัติเดิมไม่เปลี่ยน
        </p>
        <div className="rxs-table-wrap">
          <table className="rxs-table rxs-rules">
            <thead>
              <tr><th>กฎ</th><th>เปิดใช้</th><th>เตือน (เหลือง)</th><th>ทบทวน (แดง)</th></tr>
            </thead>
            <tbody>
              {RULES.map(({ key, label, unit, cols }) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`เปิดใช้ ${label}`}
                      checked={form[key].enabled}
                      onChange={(e) => set(key, 'enabled', e.target.checked)}
                    />
                  </td>
                  {cols.map(([f, fl]) => (
                    <td key={f}>
                      <span className="rxs-rule-cell">
                        {f === 'min_cyl' && <small className="muted">{fl}</small>}
                        <input
                          inputMode="decimal"
                          aria-label={`${label} ${fl}`}
                          value={form[key][f]}
                          disabled={!form[key].enabled}
                          onChange={(e) => set(key, f, e.target.value)}
                        />
                        <small className="muted">{f === 'min_cyl' ? 'D' : unit}</small>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {problems.length > 0 && (
          <ul className="rxs-list" style={{ marginTop: 8 }}>
            {problems.map((p) => <li key={p} className="rxs-block-note"><Icon name="xCircle" /> {p}</li>)}
          </ul>
        )}
        <Field label="หมายเหตุการแก้ไข" className="full">
          <input aria-label="หมายเหตุการแก้ไข" value={note} placeholder="เช่น ปรับตามที่นักทัศนมาตรตรวจทาน" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-lg" disabled={busy || problems.length > 0} onClick={save}>
            <Icon name="save" /> บันทึกเกณฑ์
          </button>
        </div>
      </Card>

      <Card title="ประวัติการแก้เกณฑ์" tight>
        <ul className="rxs-rule-history">
          {(data.history || []).map((h) => (
            <li key={h.version}>
              <b>{`v${h.version}`}</b>
              {` · ${fmtDateTime(h.changed_at)} · ${h.changed_by_name || 'ระบบ'}`}
              {h.note ? ` · ${h.note}` : ''}
              <div className="muted">{summary(h.rules)}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
