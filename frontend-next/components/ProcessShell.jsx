'use client';
/**
 * The frame every process panel sits in: its status at the top, its data in
 * the middle, and — always in the same place — the action bar that is the ONLY
 * thing that moves that process's status.
 *
 * Saving inside a panel is a draft save: it stores data and leaves the status
 * alone. "✓ <completeLabel>" is what marks the process done, and the server
 * re-checks the requirements before it agrees (api/routes/processes.php).
 *
 * A panel that owns a form can put its own buttons in this bar instead of
 * growing a second one at the bottom of its content: call useProcessActions()
 * and register a saveDraft (adds "บันทึก Draft") and/or a beforeComplete hook
 * (runs first when <Icon name="check" /> is pressed; return false to stop).
 */
import { createContext, useCallback, useContext, useState } from 'react';
import { api } from '../lib/apiClient.js';
import { useToast } from './Toast.jsx';
import { useConfirm } from './Confirm.jsx';
import { Badge, Field } from './ui.jsx';
import { Icon } from './Icon.jsx';
import { PROCESS_STATE_META, stateMeta } from '../lib/caseProcesses.js';
import { fmtDateTime } from '../lib/format.js';

const BADGE_KIND = { done: 'ok', warn: 'warn', danger: 'danger', locked: 'gray', '': 'gray' };

/* what a person can set by hand. "เสร็จแล้ว" is not here on purpose: finishing a
   process goes through its own ✓ action so the requirements are checked. */
const SETTABLE = ['not_started', 'in_progress', 'waiting', 'problem'];

const ProcessActions = createContext(null);
export const useProcessActions = () => useContext(ProcessActions);

export function ProcessShell({ process, state = {}, caseId, reload, right = null, actionsRef = null, children }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState({});
  const [statusOpen, setStatusOpen] = useState(false);
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState('');

  /* stable so a panel's register effect runs once, not every render */
  const register = useCallback((a) => {
    setActions(a || {});
    /* the page needs the panel's saveDraft too — its unsaved-changes guard
       offers "บันทึกและไปต่อ", and a panel without a <form> has nothing else
       to submit */
    if (actionsRef) actionsRef.current = a || {};
  }, [actionsRef]);

  const sm = stateMeta(state.status);
  const missing = state.missing || [];
  const blocking = state.blocking || [];
  const completed = state.status === 'completed';
  /* "completed" can mean two things: someone pressed the confirm button
     (a stored row with a timestamp), or the case simply has all the data this
     process needs (derived — every case created before case_processes existed).
     Only the first one is something to re-open; the second still wants a
     confirmation, so the action bar keeps offering it. */
  const confirmed = completed && !!Number(state.stored) && !!state.completed_at;
  const canComplete = !missing.length && !blocking.length;

  const post = async (verb, body) => {
    setBusy(true);
    try {
      await api.post(`/api/cases/${caseId}/processes/${process.id}/${verb}`, body || {});
      return true;
    } catch (ex) { err(ex); return false; } finally { setBusy(false); }
  };

  const start = async () => {
    if (await post('start')) { ok('เริ่มขั้นตอนนี้แล้ว'); reload(); }
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      await actions.saveDraft();
    } catch (ex) { err(ex); } finally { setBusy(false); }
  };

  const complete = async () => {
    if (actions.beforeComplete) {
      setBusy(true);
      let proceed = false;
      try { proceed = await actions.beforeComplete() !== false; } catch (ex) { err(ex); } finally { setBusy(false); }
      if (!proceed) return;
    }
    if (await post('complete')) { ok(`${process.completeLabel} แล้ว`); reload(); }
  };

  /* Status by hand — for the things the data cannot know: waiting on a customer
     to call back, a problem someone needs to see on the board. */
  const setStatus = async () => {
    if (!pick) return;
    if (await post('state', { status: pick, note: note.trim() || null })) {
      ok('อัปเดตสถานะแล้ว');
      setStatusOpen(false);
      setNote('');
      setPick(null);
      reload();
    }
  };

  const reopen = async () => {
    if (!await confirm(
      'เปิดขั้นตอนนี้เพื่อแก้ไข',
      `${process.label} ยืนยันไปแล้ว การแก้ไขข้อมูลอาจมีผลต่อขั้นตอนอื่น (รายการขาย, Center, สั่งเลนส์, ผลิต) ต้องการเปิดเพื่อแก้ไขหรือไม่?`,
      { confirmText: 'เปิดเพื่อแก้ไข' },
    )) return;
    if (await post('reopen')) { ok('เปิดให้แก้ไขแล้ว'); reload(); }
  };

  return (
    <div className="card process-card">
      <div className="card-head">
        <h2><Icon name={process.icon} /> {process.label}</h2>
        <button
          type="button"
          className="status-btn"
          title="เปลี่ยนสถานะขั้นตอนนี้"
          onClick={() => { setPick(SETTABLE.includes(state.status) ? state.status : null); setStatusOpen(true); }}
        >
          <Badge kind={BADGE_KIND[sm.cls] ?? 'gray'}><Icon name={sm.icon} /> {sm.label}</Badge>
          <Icon name="pencil" />
        </button>
        {state.note ? <span className="muted">{state.note}</span> : null}
        {right ? <div className="right">{right}</div> : null}
      </div>

      <div className="card-body process-body">
        <ProcessActions.Provider value={{ register, state, process }}>
          {children}
        </ProcessActions.Provider>
      </div>

      <div className="process-foot">
        <div className="process-foot-info">
          {confirmed
            ? <span className="muted">{`ยืนยันเมื่อ ${fmtDateTime(state.completed_at)}`}</span>
            : completed
              ? <span className="muted">ข้อมูลครบแล้ว — ยังไม่ได้กดยืนยันในระบบ</span>
              : state.started_at
                ? <span className="muted">{`เริ่มเมื่อ ${fmtDateTime(state.started_at)}`}</span>
                : <span className="muted">ยังไม่ได้เริ่มขั้นตอนนี้</span>}
          {state.updated_at && state.started_at
            ? <span className="muted">{`แก้ไขล่าสุด ${fmtDateTime(state.updated_at)}`}</span>
            : null}
          {!completed && (blocking.length || missing.length) ? (
            <span className="process-blockers">
              {blocking.length ? `ติดที่: ${blocking.join(', ')}` : `ยังขาด: ${missing.join(', ')}`}
            </span>
          ) : null}
        </div>

        <div className="process-foot-actions">
          {confirmed ? (
            <button type="button" className="btn btn-light" onClick={reopen} disabled={busy}>
              <Icon name="pencil" /> แก้ไขข้อมูล
            </button>
          ) : (
            <>
              {actions.saveDraft && (
                <button type="button" className="btn btn-light" onClick={saveDraft} disabled={busy}>
                  <Icon name="save" /> บันทึก Draft
                </button>
              )}
              {!actions.saveDraft && (state.status === 'not_started' || state.status === 'locked') && (
                <button
                  type="button"
                  className="btn btn-light"
                  onClick={start}
                  disabled={busy || !!blocking.length}
                  title={blocking.length ? `ยังเริ่มไม่ได้ — ${blocking.join(', ')}` : undefined}
                >
                  ▶ เริ่มทำขั้นตอนนี้
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={complete}
                disabled={busy || (!canComplete && !actions.beforeComplete)}
                title={canComplete ? undefined : `ยังยืนยันไม่ได้ — ${[...blocking, ...missing].join(', ')}`}
              >
                <Icon name="check" /> {process.completeLabel}
              </button>
            </>
          )}
        </div>
      </div>

      {statusOpen && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) setStatusOpen(false); }}>
          <div className="modal">
            <h3>{`สถานะขั้น ${process.label}`}</h3>
            <div className="m-body">
              <p className="hint">
                ใช้บอกสิ่งที่ข้อมูลบอกแทนไม่ได้ เช่น กำลังรอลูกค้าตอบกลับ หรือมีปัญหาที่ต้องให้คนอื่นเห็นบนกระดาน
                — ส่วน “เสร็จแล้ว” ให้กดปุ่มยืนยันของขั้นตอนนั้นเพื่อให้ระบบตรวจเงื่อนไขก่อน
              </p>
              <div className="status-choices">
                {SETTABLE.map((k) => {
                  const m = PROCESS_STATE_META[k];
                  return (
                    <button
                      type="button"
                      key={k}
                      className={`chip-btn ${pick === k ? 'active' : ''}`}
                      onClick={() => setPick(k)}
                    >
                      <Icon name={m.icon} /> {m.label}
                    </button>
                  );
                })}
              </div>
              <Field label="หมายเหตุ (ไม่บังคับ)" className="full">
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            <div className="m-foot">
              <button type="button" className="btn btn-light" onClick={() => setStatusOpen(false)}>ยกเลิก</button>
              <button type="button" className="btn" onClick={setStatus} disabled={busy || !pick}>บันทึกสถานะ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
