'use client';
/**
 * กำหนดผู้รับผิดชอบแต่ละขั้นตอน — ใครถูกเลือกเป็นพนักงานของขั้นไหนได้ แยกตามประเภทงาน
 * (ร้านขอ 17 พ.ย. 2026: ค่าคอมต้องคิดถูกคน)
 *
 * เก็บที่ app_settings.process_staff ผ่าน GET/PUT /api/settings/process-staff
 * API ปฏิเสธการบันทึกคนที่ไม่อยู่ในรายชื่อ (api/services/ProcessStaff.php) · ช่องเลือกพนักงานของ
 * หน้าเคสกรองตามชุดเดียวกัน (components/StepEmployeeSelect.jsx)
 *
 * ช่องที่ไม่ได้ใส่ชื่อ = เลือกได้ทุกคน — ร้านจะไม่ติดเพราะลืมตั้งบางขั้น
 * สไตล์อยู่ในหน้านี้ (ขึ้นต้น .ps-) ไม่แตะ globals.css (deploy แบบสลับรายหน้า)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/apiClient.js';
import { useAsync } from '../../../../lib/hooks.js';
import { useMeta } from '../../../../contexts/MetaContext.jsx';
import { useToast } from '../../../../components/Toast.jsx';
import { useConfirm } from '../../../../components/Confirm.jsx';
import { Loading } from '../../../../components/ui.jsx';
import { Select } from '../../../../components/Selects.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { AdminOnly } from '../../../../components/AdminOnly.jsx';
import { processInfo } from '../../../../lib/caseProcesses.js';

const SLOT_ICON = { grinder: 'wrench' };
const CASE_TYPE_ICON = { 'ตัดแว่นใหม่': 'glasses', 'เปลี่ยนเลนส์': 'eye', 'ซ่อม/ปรับแว่น': 'wrench', 'ตรวจสายตา': 'clipboard' };

const empty = () => ({ mode: 'all', slots: {} });

function Hero() {
  return (
    <div className="ps-hero">
      <div className="ps-hero-ic"><Icon name="users" /></div>
      <div className="ps-hero-text">
        <h1>กำหนดผู้รับผิดชอบแต่ละขั้นตอน</h1>
        <p>ตั้งค่ารายชื่อพนักงานที่สามารถถูกเลือกได้ในแต่ละขั้นตอนของงาน · ค่าคอมคิดจากชื่อที่เลือก</p>
      </div>
      <svg className="ps-hero-art" viewBox="0 0 320 110" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 40 C 40 30, 70 28, 98 32 C 120 35, 128 52, 122 72 C 116 92, 96 98, 74 96 C 50 94, 34 84, 28 64 Z" />
          <path d="M162 34 C 188 28, 222 28, 246 34 C 266 40, 270 58, 262 76 C 254 94, 232 98, 210 96 C 186 94, 170 84, 164 64 Z" />
          <path d="M124 42 C 134 34, 150 34, 160 42" />
          <path d="M18 40 L 4 34" />
          <path d="M248 34 C 270 30, 292 34, 316 46" />
        </g>
      </svg>
    </div>
  );
}

/** ชิปรายชื่อ + ช่องค้นหาเพิ่มคน */
function StaffPicker({ value, employees, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const byId = useMemo(() => new Map(employees.map((e) => [Number(e.id), e])), [employees]);
  const picked = new Set(value);
  const term = q.trim().toLowerCase();
  const choices = employees.filter((e) => !picked.has(Number(e.id))
    && (!term || [e.employee_name, e.first_name, e.last_name, e.roles].some((v) => String(v || '').toLowerCase().includes(term))));

  const add = (id) => { onChange([...value, Number(id)]); setQ(''); input.current?.focus(); };
  const remove = (id) => onChange(value.filter((x) => x !== id));

  return (
    <div className={`ps-pick ${open ? 'open' : ''} ${disabled ? 'off' : ''}`} ref={box}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="ps-pick-box" onClick={() => { if (!disabled) { setOpen(true); input.current?.focus(); } }}>
        {value.map((id) => (
          <span key={id} className="ps-chip">
            <Icon name="user" />
            {byId.get(id)?.employee_name || `ID ${id}`}
            {!disabled && (
              <button type="button" aria-label={`เอา ${byId.get(id)?.employee_name || id} ออก`} onClick={(e) => { e.stopPropagation(); remove(id); }}>×</button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            ref={input}
            value={q}
            placeholder={value.length ? '' : 'ทุกคนเลือกได้ — กดเพื่อเพิ่มชื่อ'}
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !q && value.length) remove(value[value.length - 1]);
              if (e.key === 'Enter') { e.preventDefault(); if (choices[0]) add(choices[0].id); }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
        )}
        {disabled && !value.length && <span className="ps-all">ทุกคนเลือกได้</span>}
        <svg className="ps-caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </div>
      {open && !disabled && (
        <ul className="ps-pick-list" role="listbox">
          {choices.length ? choices.map((e) => (
            <li key={e.id}>
              <button type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => add(e.id)}>
                <span className="ps-av">{String(e.employee_name || '?').slice(0, 2).toUpperCase()}</span>
                <span><b>{e.employee_name}</b>{e.roles ? <small>{e.roles}</small> : null}</span>
              </button>
            </li>
          )) : <li className="ps-none">{term ? 'ไม่พบชื่อที่ค้นหา' : 'เลือกครบทุกคนแล้ว'}</li>}
        </ul>
      )}
    </div>
  );
}

function ProcessStaffInner() {
  const { meta, reload: reloadMeta } = useMeta();
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { data, loading, error } = useAsync(() => api.get('/api/settings/process-staff'), []);

  const [cfg, setCfg] = useState(null);         // ค่าที่กำลังแก้ ทุกประเภทงาน
  const [saved, setSaved] = useState('');       // JSON ของค่าที่บันทึกแล้ว — ไว้ดูว่ามีอะไรค้าง
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const c = {};
    for (const t of data.case_types) c[t] = { mode: data.config?.[t]?.mode || 'all', slots: { ...(data.config?.[t]?.slots || {}) } };
    setCfg(c);
    setSaved(JSON.stringify(c));
    setType((cur) => cur || data.case_types[0]);
  }, [data]);

  const employees = meta.employees || [];

  if (loading || !cfg) return error ? <p className="muted">{error.message}</p> : <Loading />;

  const cur = cfg[type] || empty();
  const steps = data.processes?.[type] || [];
  /* แถวของประเภทงานนี้ = ช่องของทุกขั้นที่งานนี้มี (คนเจียตามขั้นส่งมอบ) */
  const rows = Object.keys(data.slots).filter((s) => steps.includes(data.slot_process[s]));
  const dirty = JSON.stringify(cfg) !== saved;
  const limited = cur.mode === 'list';

  const patch = (fn) => setCfg((c) => ({ ...c, [type]: fn(c[type] || empty()) }));
  const setSlot = (slot, ids) => patch((t) => ({ ...t, slots: { ...t.slots, [slot]: ids } }));

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/api/settings/process-staff', { config: cfg });
      const c = {};
      for (const t of data.case_types) c[t] = { mode: r.config?.[t]?.mode || 'all', slots: { ...(r.config?.[t]?.slots || {}) } };
      setCfg(c);
      setSaved(JSON.stringify(c));
      await reloadMeta();
      ok('บันทึกการตั้งค่าแล้ว');
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!await confirm(
      'รีเซ็ตเป็นค่าเริ่มต้น',
      `งาน "${type}" จะกลับไปเลือกได้จากพนักงานทั้งหมด และรายชื่อทุกขั้นจะถูกล้าง — ยังไม่บันทึกจนกว่าจะกด "บันทึกการตั้งค่า"`,
      { confirmText: 'รีเซ็ต', danger: true },
    )) return;
    patch(() => empty());
  };

  return (
    <div className="ps-page">
      <style>{CSS}</style>
      <Link href="/employees" className="ps-back"><Icon name="arrowLeft" /> กลับหน้าพนักงาน</Link>
      <Hero />

      <div className="ps-flow">
        <span className="ps-flow-tag">ขั้นตอนของงาน {type}</span>
        <ol>
          {steps.map((p, i) => (
            <li key={p} className={i === 0 ? 'first' : ''}>
              <span className="ps-dot" />
              <span>{processInfo(p).label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="ps-grid">
        <aside className="ps-side">
          <h3>เลือกงาน</h3>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={data.case_types.map((t) => [t, t, { hint: cfg[t]?.mode === 'list' ? 'กำหนดรายชื่อแล้ว' : 'ทุกคนเลือกได้' }])}
          />
          <h3>ตั้งค่าการเลือกชื่อ</h3>
          <label className="ps-radio">
            <input type="radio" name="ps-mode" checked={limited} onChange={() => patch((t) => ({ ...t, mode: 'list' }))} />
            <span>เลือกได้จากรายชื่อที่กำหนด</span>
          </label>
          <label className="ps-radio">
            <input type="radio" name="ps-mode" checked={!limited} onChange={() => patch((t) => ({ ...t, mode: 'all' }))} />
            <span>เลือกได้จากพนักงานทั้งหมด</span>
          </label>
          <p className="ps-note">
            <Icon name="warning" />
            <span>
              ขั้นที่ยังไม่ใส่ชื่อ เลือกได้ทุกคน · เคสที่ไม่ได้ระบุประเภทงานใช้ชุดของ &quot;ตัดแว่นใหม่&quot; ·
              ใบเก่าที่ชื่อคนเดิมไม่อยู่ในรายชื่อแล้ว ยังแก้ส่วนอื่นได้ตามปกติ
            </span>
          </p>
        </aside>

        <section className="ps-main">
          <div className="ps-actions">
            {dirty && <span className="ps-dirty">มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>}
            <button type="button" className="ps-btn" onClick={reset} disabled={busy}>
              <Icon name="undo" /> รีเซ็ตเป็นค่าเริ่มต้น
            </button>
            <button type="button" className="ps-save" onClick={save} disabled={busy || !dirty}>
              <Icon name="save" /> {busy ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}
            </button>
          </div>

          <div className="ps-table" role="table">
            <div className="ps-tr ps-th" role="row">
              <span role="columnheader">ลำดับ</span>
              <span role="columnheader">ขั้นตอน</span>
              <span role="columnheader">ผู้ที่สามารถถูกเลือกได้ (ระบุรายชื่อ)</span>
              <span role="columnheader">จำนวน</span>
            </div>
            {rows.map((slot, i) => {
              const ids = (cur.slots[slot] || []).map(Number);
              const proc = processInfo(data.slot_process[slot]);
              return (
                <div className="ps-tr" role="row" key={slot}>
                  <span className="ps-n">{i + 1}</span>
                  <span className="ps-step">
                    <Icon name={SLOT_ICON[slot] || proc.icon} />
                    <b>{data.slots[slot]}</b>
                    {slot === 'grinder' && <small>ค่าคอมงานเจีย</small>}
                  </span>
                  <StaffPicker value={ids} employees={employees} disabled={!limited} onChange={(v) => setSlot(slot, v)} />
                  <span className="ps-count">{limited && ids.length ? `${ids.length} คน` : 'ทุกคน'}</span>
                </div>
              );
            })}
          </div>
          {!limited && (
            <p className="ps-hint">
              <Icon name={CASE_TYPE_ICON[type] || 'glasses'} /> งาน &quot;{type}&quot; ตอนนี้เลือกได้จากพนักงานทั้งหมด —
              เลือก &quot;เลือกได้จากรายชื่อที่กำหนด&quot; ทางซ้ายเพื่อเริ่มกำหนดชื่อ
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ProcessStaffPage() {
  return <AdminOnly zone="system"><ProcessStaffInner /></AdminOnly>;
}

const CSS = `
.ps-back{display:inline-flex;align-items:center;gap:6px;margin:0 0 10px;color:var(--ink-soft);font-size:var(--t-sm);font-weight:500}
.ps-back:hover{color:var(--green-deep)}
.ps-back .ico{width:16px;height:16px}

.ps-hero{position:relative;overflow:hidden;display:flex;align-items:center;gap:18px;padding:22px 24px;margin:0 0 14px;
  border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);
  background:linear-gradient(100deg,var(--card) 0%,var(--card) 50%,var(--green-tint) 75%,#CFF5D6 100%)}
.ps-hero-ic{width:60px;height:60px;flex:0 0 60px;border-radius:var(--radius-sm);background:var(--green-tint);
  color:var(--green-ink);display:grid;place-items:center;border:1px solid var(--green-edge)}
.ps-hero-ic .ico{width:30px;height:30px}
.ps-hero-text{position:relative;z-index:1;min-width:0}
.ps-hero h1{margin:0;font-size:26px;font-weight:800;letter-spacing:-.4px;line-height:1.2;color:var(--ink)}
.ps-hero p{margin:4px 0 0;color:var(--ink-soft);font-size:var(--t-sm)}
.ps-hero-art{position:absolute;right:28px;top:50%;transform:translateY(-50%) rotate(-6deg);width:280px;color:var(--green-ink);opacity:.33}

.ps-flow{display:flex;align-items:center;gap:20px;padding:16px 22px;margin:0 0 14px;background:var(--card);
  border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm)}
.ps-flow-tag{flex:0 0 auto;font-size:var(--t-xs);font-weight:600;padding:6px 12px;border-radius:var(--radius-pill);
  background:var(--surface-alt);color:var(--ink-soft)}
.ps-flow ol{flex:1;display:flex;list-style:none;margin:0;padding:0;min-width:0}
.ps-flow li{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:var(--t-sm);
  font-weight:600;color:var(--ink);text-align:center;min-width:0}
.ps-flow li::before{content:"";position:absolute;top:8px;left:-50%;right:50%;height:2px;background:var(--line)}
.ps-flow li:first-child::before{display:none}
.ps-dot{position:relative;z-index:1;width:18px;height:18px;border-radius:50%;background:var(--card);border:2px solid var(--ink-dim)}
.ps-flow li.first .ps-dot{background:var(--green-ink);border-color:var(--green-ink);transform:rotate(45deg);border-radius:4px}

.ps-grid{display:grid;grid-template-columns:260px minmax(0,1fr);gap:14px;align-items:start}
.ps-side,.ps-main{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm);padding:20px}
.ps-side h3{margin:0 0 10px;font-size:var(--t-base);font-weight:700}
.ps-side h3 + .sel{margin-bottom:22px}
.ps-side .sel-trigger{background:var(--card);border-color:var(--line)}
.ps-radio{display:flex;align-items:center;gap:10px;padding:7px 0;cursor:pointer;font-size:var(--t-sm)}
.ps-radio input{width:20px;height:20px;accent-color:var(--green-ink);margin:0}
.ps-note{display:flex;gap:8px;margin:18px 0 0;padding:10px 12px;border-radius:var(--radius-xs);background:var(--panel);
  color:var(--ink-faint);font-size:var(--t-xs);line-height:1.55}
.ps-note .ico{width:15px;height:15px;flex:0 0 auto;margin-top:2px}

.ps-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin:0 0 16px}
.ps-dirty{margin-right:auto;font-size:var(--t-xs);font-weight:600;color:#B45309;background:#FEF3C7;padding:4px 10px;border-radius:var(--radius-pill)}
.ps-btn,.ps-save{display:inline-flex;align-items:center;gap:8px;min-height:42px;padding:0 18px;border-radius:var(--radius-sm);
  font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}
.ps-btn{border:1px solid var(--line);background:var(--card);color:var(--ink)}
.ps-btn:hover:not(:disabled){border-color:var(--green-edge)}
.ps-save{border:0;background:var(--green-deep);color:#fff;box-shadow:var(--shadow-green)}
.ps-save:hover:not(:disabled){background:#0F561E}
.ps-btn:disabled,.ps-save:disabled{opacity:.5;cursor:default;box-shadow:none}
.ps-btn .ico,.ps-save .ico{width:17px;height:17px}

.ps-table{border:1px solid var(--line-soft);border-radius:var(--radius-sm)}
.ps-tr{display:grid;grid-template-columns:64px 170px minmax(0,1fr) 84px;align-items:center;gap:12px;padding:10px 16px;
  border-bottom:1px solid var(--line-soft)}
.ps-tr:last-child{border-bottom:0}
.ps-th{background:var(--green-tint);font-size:var(--t-sm);font-weight:700;color:var(--ink);border-radius:var(--radius-sm) var(--radius-sm) 0 0}
.ps-th span:last-child{text-align:center}
.ps-n{width:32px;height:32px;border-radius:50%;background:var(--green-tint);color:var(--green-deep);display:grid;place-items:center;
  font-weight:700;font-size:var(--t-sm);margin-left:4px}
.ps-step{display:flex;align-items:center;gap:10px;min-width:0}
.ps-step .ico{width:20px;height:20px;color:var(--ink-soft);flex:0 0 auto}
.ps-step b{font-weight:600}
.ps-step small{font-size:10.5px;color:var(--ink-faint);display:block}
.ps-step{flex-wrap:wrap}
.ps-count{justify-self:center;font-size:var(--t-xs);font-weight:600;padding:5px 12px;border-radius:var(--radius-pill);
  background:var(--surface-alt);color:var(--ink-soft);white-space:nowrap}

.ps-pick{position:relative;min-width:0}
.ps-pick-box{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:42px;padding:5px 34px 5px 8px;
  border:1px solid var(--line);border-radius:var(--radius-xs);background:var(--card);cursor:text;position:relative}
.ps-pick.open .ps-pick-box{border-color:var(--green-ink);box-shadow:0 0 0 3px var(--green-tint)}
.ps-pick.off .ps-pick-box{background:var(--panel);cursor:default}
.ps-pick.off .ps-chip{opacity:.55}
.ps-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 6px 4px 9px;border:1px solid var(--line);border-radius:var(--radius-xs);
  background:var(--card);font-size:var(--t-sm);font-weight:500;white-space:nowrap}
.ps-chip .ico{width:14px;height:14px;color:var(--ink-faint)}
.ps-chip button{border:0;background:none;padding:0 3px;font-size:16px;line-height:1;color:var(--ink-faint);cursor:pointer}
.ps-chip button:hover{color:var(--danger)}
.ps-pick-box input,.ps-pick-box input:focus{flex:1 1 40px;min-width:40px;width:auto;border:0;outline:0;background:transparent!important;
  padding:6px 2px;min-height:0;height:30px;font:inherit;font-size:var(--t-sm);box-shadow:none!important;border-radius:0}
.ps-pick-box input:only-of-type:first-child{flex-basis:100%}
.ps-all{color:var(--ink-faint);font-size:var(--t-sm);padding:6px 4px}
.ps-caret{position:absolute;right:12px;top:50%;width:11px;height:7px;transform:translateY(-50%);color:var(--ink-faint)}
.ps-pick-list{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:40;max-height:280px;overflow:auto;margin:0;padding:6px;list-style:none;
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius-sm);box-shadow:var(--shadow-pop)}
.ps-pick-list button{display:flex;align-items:center;gap:10px;width:100%;padding:7px 9px;border:0;background:none;border-radius:var(--radius-xs);
  font:inherit;text-align:left;cursor:pointer;color:var(--ink)}
.ps-pick-list button:hover{background:var(--green-tint)}
.ps-pick-list small{display:block;font-size:var(--t-xs);color:var(--ink-faint)}
.ps-av{width:30px;height:30px;flex:0 0 30px;border-radius:50%;background:var(--green-tint);color:var(--green-deep);display:grid;place-items:center;
  font-size:11px;font-weight:700}
.ps-none{padding:10px;color:var(--ink-faint);font-size:var(--t-sm)}
.ps-hint{display:flex;align-items:center;gap:8px;margin:14px 2px 0;color:var(--ink-soft);font-size:var(--t-sm)}
.ps-hint .ico{width:17px;height:17px;color:var(--green-ink)}

@media (max-width:1100px){
  .ps-grid{grid-template-columns:1fr}
  .ps-hero-art{opacity:.15}
}
@media (max-width:639.98px){
  .ps-hero{padding:16px}
  .ps-hero h1{font-size:20px}
  .ps-hero-art{display:none}
  .ps-flow{flex-direction:column;align-items:stretch;padding:14px 10px}
  .ps-flow li{font-size:11px}
  .ps-side,.ps-main{padding:14px}
  .ps-th{display:none}
  .ps-tr{grid-template-columns:36px minmax(0,1fr) auto;padding:12px 10px}
  .ps-tr .ps-pick{grid-column:1 / -1}
  .ps-count{grid-row:1;grid-column:3}
  .ps-n{margin-left:0}
}
`;
