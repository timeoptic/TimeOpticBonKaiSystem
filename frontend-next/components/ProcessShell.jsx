'use client';
/**
 * The frame every process panel sits in: its status at the top, its data in
 * the middle, and — always in the same place — the action bar that is the ONLY
 * thing that moves that process's status.
 *
 * Saving inside a panel is a draft save: it stores data and leaves the status
 * alone. "✓ <completeLabel>" is what marks the process done, and the server
 * re-checks the requirements before it agrees (api/routes/processes.php).
 */
import { useState } from 'react';
import { api } from '../lib/apiClient.js';
import { useToast } from './Toast.jsx';
import { useConfirm } from './Confirm.jsx';
import { Badge } from './ui.jsx';
import { stateMeta } from '../lib/caseProcesses.js';
import { fmtDateTime } from '../lib/format.js';

const BADGE_KIND = { done: 'ok', warn: 'warn', danger: 'danger', locked: 'gray', '': 'gray' };

export function ProcessShell({ process, state = {}, caseId, reload, right = null, children }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

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

  const complete = async () => {
    if (await post('complete')) { ok(`${process.completeLabel} แล้ว`); reload(); }
  };

  const reopen = async () => {
    if (!await confirm(
      'เปิดขั้นตอนนี้เพื่อแก้ไข',
      `${process.label} ยืนยันไปแล้ว การแก้ไขข้อมูลอาจมีผลต่อขั้นตอนอื่น ต้องการเปิดเพื่อแก้ไขหรือไม่?`,
      { confirmText: 'เปิดเพื่อแก้ไข' },
    )) return;
    if (await post('reopen')) { ok('เปิดให้แก้ไขแล้ว'); reload(); }
  };

  return (
    <div className="card process-card">
      <div className="card-head">
        <h2>{`${process.icon} ${process.label}`}</h2>
        <Badge kind={BADGE_KIND[sm.cls] ?? 'gray'}>{`${sm.icon} ${sm.label}`}</Badge>
        {right ? <div className="right">{right}</div> : null}
      </div>

      <div className="card-body process-body">{children}</div>

      <div className="process-foot">
        <div className="process-foot-info">
          {confirmed
            ? <span className="muted">{`ยืนยันเมื่อ ${fmtDateTime(state.completed_at)}`}</span>
            : completed
              ? <span className="muted">ข้อมูลครบแล้ว — ยังไม่ได้กดยืนยันในระบบ</span>
              : state.started_at
                ? <span className="muted">{`เริ่มเมื่อ ${fmtDateTime(state.started_at)}`}</span>
                : <span className="muted">ยังไม่ได้เริ่มขั้นตอนนี้</span>}
          {!completed && (blocking.length || missing.length) ? (
            <span className="process-blockers">
              {blocking.length ? `ติดที่: ${blocking.join(', ')}` : `ยังขาด: ${missing.join(', ')}`}
            </span>
          ) : null}
        </div>

        <div className="process-foot-actions">
          {confirmed ? (
            <button type="button" className="btn btn-light" onClick={reopen} disabled={busy}>
              ✏ แก้ไขข้อมูล
            </button>
          ) : (
            <>
              {(state.status === 'not_started' || state.status === 'locked') && (
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
                disabled={busy || !canComplete}
                title={canComplete ? undefined : `ยังยืนยันไม่ได้ — ${[...blocking, ...missing].join(', ')}`}
              >
                {`✓ ${process.completeLabel}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
