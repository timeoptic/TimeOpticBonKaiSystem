'use client';
/**
 * The 9-process strip at the top of a case.
 *
 * It does two jobs at once and keeps them visually apart:
 *   • the dot's icon/colour = that process's own STATUS
 *   • the ring + underline  = the process you are currently VIEWING
 *
 * Clicking a step only ever changes what you are viewing. Nothing here writes
 * to the server — status moves through the action bar inside each process
 * (components/ProcessShell.jsx).
 */
import { CASE_PROCESSES, PROCESS_STATE_META, stateMeta } from '../lib/caseProcesses.js';
import { Icon } from './Icon.jsx';

/**
 * `list` = ขั้นที่เคสใบนี้มีจริง (มาจาก `caseDetail.process_list` ฝั่ง server ซึ่ง
 * อ่านกฎจาก Lookups::CASE_TYPE_PROCESSES) — เคสตรวจสายตาอย่างเดียวมีแค่สองขั้น
 * ไม่ส่งมา (หรือคำตอบเก่าที่ยังไม่มีคีย์นี้) = แสดงครบเหมือนเดิม ไม่ใช่หายทั้งแถบ
 */
export function CaseStepper({ processes = {}, list = null, viewing, onView }) {
  return (
    <>
      <div className="stepper">
        {CASE_PROCESSES.filter((p) => !list || list.includes(p.id)).map((p) => {
          const state = processes[p.id] || {};
          const sm = stateMeta(state.status);
          const reasons = [...(state.blocking || []), ...(state.missing || [])];
          const cls = `${sm.cls}${viewing === p.id ? ' viewing' : ''}`;
          return (
            <div className={`step ${cls}`} key={p.id} style={{ '--stage': p.color }}>
              <span className="step-line" />
              <button
                type="button"
                className="step-dot icon-only"
                aria-current={viewing === p.id ? 'step' : undefined}
                title={`${p.label}: ${sm.label}${reasons.length ? ` — ยังขาด: ${reasons.join(', ')}` : ''}`}
                onClick={() => onView(p.id)}
              >
                <Icon name={state.status === 'not_started' ? p.icon : sm.icon} />
              </button>
              <button
                type="button"
                className="step-label"
                title={`เปิดดูขั้น ${p.label}`}
                onClick={() => onView(p.id)}
              >
                {p.label}
              </button>
            </div>
          );
        })}
      </div>

      <div className="stepper-legend">
        {Object.entries(PROCESS_STATE_META).map(([k, m]) => (
          <span key={k} className={`legend-item ${m.cls}`}><Icon name={m.icon} /> {m.label}</span>
        ))}
      </div>
    </>
  );
}
