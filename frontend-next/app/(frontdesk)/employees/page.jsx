'use client';
/**
 * Employee — รายชื่อพนักงาน (หน้าของแอดมิน)
 *
 * หน้าตาใหม่ 17 พ.ย. 2026 (ร้านส่งแบบมา): แถบหัวสีเขียว · การ์ดสรุปที่กดกรองได้ · แถบค้นหา + ตัวกรอง
 * · ตารางหัวเขียว · ปุ่ม ดู / แก้ไข / เพิ่มเติม ท้ายแถว · ตัวแบ่งหน้าเลขหน้า
 *
 * ข้อมูลพนักงานมีแค่ ชื่อเล่น ชื่อจริง นามสกุล เพศ วันเกิด หน้าที่ และสถานะทำงานอยู่/ลาออก
 * ตัวกรองและการ์ดจึงใช้เท่าที่มีจริง: "ทุกแผนก" ในแบบ = หน้าที่, "วันเริ่มงาน" ในแบบ = การเรียง
 * (ไม่มีวันเริ่มงานในฐาน — คอลัมน์ยังเป็นวันเกิดเหมือนเดิม) · การ์ดที่สี่ = ข้อมูลไม่ครบ
 *
 * สไตล์ทั้งหมดอยู่ในไฟล์นี้ (CSS ข้างล่าง ขึ้นต้น .em-) ไม่แตะ globals.css / component กลาง
 * — prod deploy แบบสลับรายหน้า (ไฟล์ CSS กลางของ prod ถูกเปลี่ยนชื่อด้วยมือ)
 *
 * คนที่ลาออกไม่ถูกลบ (ดู api/routes/employees.php) — ปิดใช้งาน = หายจากช่องเลือกพนักงานทุกหน้า
 * กติกาล็อกการแก้ไข (31 ต.ค. 2026): ข้อมูลที่บันทึกแล้วต้องกดเปิดก่อนแก้ — ที่นี่คือปุ่มดินสอ
 * ซึ่งเปิดป๊อปอัปแก้ไขโดยตรง ส่วนปุ่มตา (และคลิกแถว) เปิดดูอย่างเดียว
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync, onSubmit } from '../../../lib/hooks.js';
import { pageWindow } from '../../../lib/pager.js';
import { useMeta } from '../../../contexts/MetaContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { useConfirm } from '../../../components/Confirm.jsx';
import { Field, FormGrid, Loading } from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { ListSelect, Select } from '../../../components/Selects.jsx';
import { fmtDate } from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';
import { DateField } from '../../../components/DateField.jsx';

const PER_PAGE = [10, 25, 50, 100];

const STATUS_OPTS = [
  ['', 'ทุกสถานะ'],
  ['on', 'ทำงานอยู่'],
  ['off', 'ลาออก'],
  ['incomplete', 'ข้อมูลไม่ครบ'],
];

const SORT_OPTS = [
  ['name', 'เรียงตามชื่อเล่น'],
  ['id', 'ID น้อย → มาก'],
  ['id_desc', 'เพิ่มล่าสุดก่อน'],
  ['birth', 'วันเกิด (อายุมาก → น้อย)'],
];

/* ข้อมูลไม่ครบ = ขาดช่องใดช่องหนึ่งที่เอกสาร/รายงานใช้ */
const MISSING = [
  ['first_name', 'ชื่อจริง'],
  ['last_name', 'นามสกุล'],
  ['sex', 'เพศ'],
  ['birth_date', 'วันเกิด'],
];
const blank = (v) => String(v ?? '').trim() === '';
const missingOf = (r) => MISSING.filter(([k]) => blank(r[k])).map(([, l]) => l);
const isOn = (r) => !!Number(r.active);

/* หน้าที่เป็นข้อความพิมพ์เอง ("sales, optometrist" / "Trainee") — แยกด้วยจุลภาค
   แล้วเทียบแบบไม่สนตัวพิมพ์เล็กใหญ่ ป้ายแสดงขึ้นต้นด้วยตัวใหญ่ */
const roleList = (s) => String(s || '').split(/[,/]/).map((x) => x.trim()).filter(Boolean);
const roleKey = (s) => s.toLowerCase();
const roleLabel = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ไอคอนเล็กที่ชุดหลักไม่มี */
const Glyph = {
  dots: <path d="M6 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />,
  power: <path d="M11 3h2v9h-2V3zm-4.2 2.8 1.4 1.4A6 6 0 1 0 15.8 7.2l1.4-1.4A8 8 0 1 1 6.8 5.8z" />,
  briefcase: <path d="M9 3h6a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3V5a2 2 0 0 1 2-2zm0 3h6V5H9v1zM4 8v3h16V8H4zm0 5v5h16v-5h-7v1h-2v-1H4z" />,
  door: <path d="M5 3h10a2 2 0 0 1 2 2v1h-2V5H5v14h10v-1h2v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm11.6 5.4L20.2 12l-3.6 3.6-1.4-1.4 1.2-1.2H9v-2h7.4l-1.2-1.2 1.4-1.4z" />,
};
const G = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="ico">{Glyph[name]}</svg>
);

const dash = <span className="em-dash">-</span>;

function SexTag({ sex }) {
  if (sex === 'Male') return <span className="em-sex m"><span aria-hidden="true">♂</span> ชาย</span>;
  if (sex === 'Female') return <span className="em-sex f"><span aria-hidden="true">♀</span> หญิง</span>;
  return sex ? <span className="em-sex">{sex}</span> : dash;
}

function Roles({ roles }) {
  const list = roleList(roles);
  if (!list.length) return dash;
  return <span className="em-roles">{list.map((x) => <span key={x} className="em-role">{roleLabel(x)}</span>)}</span>;
}

function StatusTag({ row }) {
  return isOn(row)
    ? <span className="em-status on"><i />ทำงานอยู่</span>
    : <span className="em-status off"><i />ลาออก</span>;
}

/* แถบหัวหน้า — รูปแว่นวาดเส้นเอง (ตกแต่งอย่างเดียว) */
function Hero() {
  return (
    <div className="em-hero">
      <div className="em-hero-ic"><Icon name="users" /></div>
      <div className="em-hero-text">
        <h1>Employee</h1>
        <p>จัดการข้อมูลพนักงาน • หน้าที่ • สถานะการทำงาน</p>
      </div>
      <svg className="em-hero-art" viewBox="0 0 320 110" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 40 C 40 30, 70 28, 98 32 C 120 35, 128 52, 122 72 C 116 92, 96 98, 74 96 C 50 94, 34 84, 28 64 Z" />
          <path d="M162 34 C 188 28, 222 28, 246 34 C 266 40, 270 58, 262 76 C 254 94, 232 98, 210 96 C 186 94, 170 84, 164 64 Z" />
          <path d="M124 42 C 134 34, 150 34, 160 42" />
          <path d="M18 40 L 4 34" />
          <path d="M248 34 C 270 30, 292 34, 316 46" />
        </g>
        <path d="M40 46 C 58 40, 80 40, 98 44" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".7" />
        <path d="M180 42 C 200 37, 222 37, 240 42" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".7" />
      </svg>
    </div>
  );
}

function StatCard({ tone, icon, glyph, label, value, active, onClick }) {
  return (
    <button type="button" className={`em-stat ${tone} ${active ? 'on' : ''}`} aria-pressed={active} onClick={onClick}>
      <span className="em-stat-ic">{glyph ? <G name={glyph} /> : <Icon name={icon} />}</span>
      <span className="em-stat-body">
        <span className="em-stat-label">{label}</span>
        <span className="em-stat-value">{value} <small>คน</small></span>
      </span>
    </button>
  );
}

function RowMenu({ row, onToggle }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <span className="em-menu" ref={box}>
      <button type="button" className="em-act" aria-label="ตัวเลือกเพิ่มเติม" title="ตัวเลือกเพิ่มเติม" onClick={() => setOpen((o) => !o)}>
        <G name="dots" />
      </button>
      {open && (
        <span className="em-menu-pop" role="menu">
          <button type="button" role="menuitem" className={isOn(row) ? 'danger' : ''} onClick={() => { setOpen(false); onToggle(row); }}>
            <G name="power" /> {isOn(row) ? 'ปิดใช้งาน (ลาออก)' : 'เปิดใช้งานอีกครั้ง'}
          </button>
        </span>
      )}
    </span>
  );
}

function Modal({ title, onClose, children }) {
  /* Esc ปิดป๊อปอัป — ทางออกเดียวกับกล่องยืนยันของระบบ (components/Confirm.jsx) */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function EmployeeForm({ row, busy, onSave, onClose }) {
  return (
    <form onSubmit={onSubmit(onSave)}>
      <div className="m-body">
        <div className="form-2col">
          <FormGrid>
            <Field label="ชื่อเล่น / Nickname *" className="full">
              <input name="employee_name" required autoFocus autoComplete="off" defaultValue={row?.employee_name || ''} />
            </Field>
            <Field label="ชื่อจริง"><input name="first_name" autoComplete="off" defaultValue={row?.first_name || ''} /></Field>
            <Field label="นามสกุล"><input name="last_name" autoComplete="off" defaultValue={row?.last_name || ''} /></Field>
            <Field label="เพศ"><ListSelect name="sex" kind="sex" blank="— ไม่ระบุ —" defaultValue={row ? (row.sex || '') : 'Female'} /></Field>
            <Field label="วันเกิด"><DateField name="birth_date" defaultValue={row?.birth_date || ''} /></Field>
            <Field label="หน้าที่ / Roles" className="full">
              <input name="roles" autoComplete="off" placeholder="เช่น sales, optometrist, technician" defaultValue={row?.roles || ''} />
            </Field>
          </FormGrid>
        </div>
      </div>
      <div className="m-foot">
        <button type="button" className="btn btn-light" onClick={onClose}>ยกเลิก</button>
        <button className="btn" type="submit" disabled={busy}>
          <Icon name="check" /> {busy ? 'กำลังบันทึก…' : (row ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงาน')}
        </button>
      </div>
    </form>
  );
}

function EmployeeView({ row, onEdit, onClose }) {
  const miss = missingOf(row);
  const item = (label, value) => (
    <div className="em-kv"><span>{label}</span><b>{value}</b></div>
  );
  return (
    <>
      <div className="m-body">
        <div className="em-view-head">
          <span className="em-av">{(row.employee_name || '?').slice(0, 2).toUpperCase()}</span>
          <div>
            <b>{row.employee_name}</b>
            <div className="em-view-sub">ID {row.id} · <StatusTag row={row} /></div>
          </div>
        </div>
        <div className="em-kvs">
          {item('ชื่อจริง', row.first_name || dash)}
          {item('นามสกุล', row.last_name || dash)}
          {item('เพศ', <SexTag sex={row.sex} />)}
          {item('วันเกิด', row.birth_date ? fmtDate(row.birth_date) : dash)}
          {item('หน้าที่', <Roles roles={row.roles} />)}
        </div>
        {miss.length > 0 && (
          <p className="em-miss"><Icon name="warning" /> ข้อมูลยังไม่ครบ: {miss.join(', ')}</p>
        )}
      </div>
      <div className="m-foot">
        <button type="button" className="btn btn-light" onClick={onClose}>ปิด</button>
        <button type="button" className="btn" onClick={onEdit}><Icon name="pencil" /> แก้ไขข้อมูล</button>
      </div>
    </>
  );
}

function EmployeeListInner() {
  const { reload: reloadMeta } = useMeta();
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const { data: rows, loading, reload } = useAsync(() => api.get('/api/employees'), []);

  /* กรองในเครื่อง — /api/employees คืนทั้งตาราง (หลักสิบคน) มารอบเดียวอยู่แล้ว */
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE[0]);
  const [refreshing, setRefreshing] = useState(false);

  /* ป๊อปอัป: { mode: 'view' | 'edit' | 'add', row } */
  const [dlg, setDlg] = useState(null);
  const [busy, setBusy] = useState(false);
  const close = () => setDlg(null);

  /* ตัวเลขบนการ์ดนับจากรายชื่อทั้งหมด ไม่ใช่ผลค้นหา — บอกว่า "กดแล้วจะเจอกี่คน" */
  const counts = useMemo(() => {
    const all = rows || [];
    const on = all.filter(isOn).length;
    return { '': all.length, on, off: all.length - on, incomplete: all.filter((r) => missingOf(r).length).length };
  }, [rows]);

  const roleOpts = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) {
      for (const x of roleList(r.roles)) {
        const k = roleKey(x);
        const cur = m.get(k) || { label: roleLabel(x), n: 0 };
        cur.n += 1;
        m.set(k, cur);
      }
    }
    const list = [...m.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
    return [
      ['', 'ทุกหน้าที่'],
      ...list.map(([k, v]) => [k, v.label, { hint: `${v.n} คน` }]),
      ['-', 'ไม่ระบุหน้าที่'],
    ];
  }, [rows]);

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    const out = (rows || []).filter((r) => {
      if (status === 'on' && !isOn(r)) return false;
      if (status === 'off' && isOn(r)) return false;
      if (status === 'incomplete' && !missingOf(r).length) return false;
      if (role === '-' && roleList(r.roles).length) return false;
      if (role && role !== '-' && !roleList(r.roles).some((x) => roleKey(x) === role)) return false;
      if (!q) return true;
      /* คนหน้าร้านจำพนักงานด้วยชื่อเล่น ส่วนเอกสารเก่าอ้างด้วย ID */
      return [r.id, r.employee_name, r.first_name, r.last_name, r.roles]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
    const byName = (a, b) => String(a.employee_name || '').localeCompare(String(b.employee_name || ''), 'th');
    const cmp = {
      /* ลำดับเดิมของ API: คนที่ทำงานอยู่ขึ้นก่อน แล้วตามชื่อเล่น */
      name: (a, b) => (Number(isOn(b)) - Number(isOn(a))) || byName(a, b),
      id: (a, b) => Number(a.id) - Number(b.id),
      id_desc: (a, b) => Number(b.id) - Number(a.id),
      birth: (a, b) => (!a.birth_date) - (!b.birth_date) || String(a.birth_date).localeCompare(String(b.birth_date)) || byName(a, b),
    }[sort];
    return [...out].sort(cmp);
  }, [rows, term, status, role, sort]);

  /* เปลี่ยนตัวกรอง = ผลคนละชุด กลับไปหน้า 1 เสมอ */
  useEffect(() => { setPage(1); }, [term, status, role, sort, perPage]);

  const total = shown.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const cur = Math.min(page, pages);
  const from = total ? (cur - 1) * perPage + 1 : 0;
  const to = Math.min(cur * perPage, total);

  const refresh = async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  };

  const save = async (body) => {
    setBusy(true);
    try {
      if (dlg?.mode === 'edit') {
        /* PUT เขียนทับทุกคอลัมน์ — สถานะต้องส่งค่าเดิมกลับไปด้วย */
        await api.put('/api/employees/' + dlg.row.id, { ...body, active: Number(dlg.row.active) ? 1 : 0 });
        ok('บันทึกข้อมูลพนักงานแล้ว');
      } else {
        await api.post('/api/employees', body);
        ok('เพิ่มพนักงานแล้ว');
      }
      await reloadMeta();
      setDlg(null);
      reload();
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  /* ปิดใช้งาน = เอาชื่อออกจากช่องเลือกพนักงานทุกหน้า · เปิดกลับไม่ต้องถาม ไม่มีอะไรหายไป */
  const toggle = async (r) => {
    if (isOn(r) && !await confirm(
      'ปิดใช้งานพนักงาน',
      `${r.employee_name || r.first_name || `ID ${r.id}`} จะหายจากช่องเลือกพนักงานทุกหน้า — ประวัติเดิมยังอยู่ครบ`,
      { confirmText: 'ปิดใช้งาน', danger: true },
    )) return;
    try {
      await api.put('/api/employees/' + r.id, { ...r, active: isOn(r) ? 0 : 1 });
      await reloadMeta();
      reload();
    } catch (ex) {
      err(ex);
    }
  };

  if (loading && !rows) return <Loading />;

  const filtered = !!(term.trim() || status || role);

  return (
    <div className="em-page">
      <style>{CSS}</style>
      <Hero />

      <div className="em-stats">
        <StatCard tone="green" icon="users" label="ทั้งหมด" value={counts['']} active={status === ''} onClick={() => setStatus('')} />
        <StatCard tone="green" glyph="briefcase" label="ทำงานอยู่" value={counts.on} active={status === 'on'} onClick={() => setStatus('on')} />
        <StatCard tone="amber" glyph="door" label="ลาออก" value={counts.off} active={status === 'off'} onClick={() => setStatus('off')} />
        <StatCard tone="red" icon="userX" label="ข้อมูลไม่ครบ" value={counts.incomplete} active={status === 'incomplete'} onClick={() => setStatus('incomplete')} />
      </div>

      <div className="em-tools">
        <label className="em-search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="ค้นหา ชื่อเล่น / ชื่อจริง / นามสกุล / หน้าที่ / ID"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        <div className="em-sel"><Icon name="employee" /><Select value={role} onChange={(e) => setRole(e.target.value)} options={roleOpts} /></div>
        <div className="em-sel"><Icon name="warning" /><Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTS} /></div>
        <div className="em-sel"><Icon name="calendar" /><Select value={sort} onChange={(e) => setSort(e.target.value)} options={SORT_OPTS} /></div>
        <button type="button" className={`em-icon-btn ${refreshing ? 'spin' : ''}`} aria-label="โหลดใหม่" title="โหลดใหม่" onClick={refresh}>
          <Icon name="refresh" />
        </button>
        <button type="button" className="em-add" onClick={() => setDlg({ mode: 'add' })}>
          <Icon name="plus" /> เพิ่มพนักงาน
        </button>
      </div>

      <div className="em-card">
        <div className="em-card-head">
          <h2>รายชื่อพนักงาน</h2>
          <span className="em-count">{total} คน</span>
          {filtered && (
            <button type="button" className="em-clear" onClick={() => { setTerm(''); setStatus(''); setRole(''); }}>
              <Icon name="x" /> ล้างตัวกรอง
            </button>
          )}
        </div>

        <div className="em-table">
          <DataTable
            columns={[
              { label: 'ID', key: 'id', cls: 'mono em-id', mobile: 'meta' },
              { label: 'ชื่อเล่น', cls: 'nowrap', mobile: 'title', render: (r) => <b className="em-nick">{r.employee_name}</b> },
              { label: 'ชื่อจริง', key: 'first_name', mobile: 'subtitle' },
              { label: 'นามสกุล', key: 'last_name', mobile: 'subtitle' },
              { label: 'เพศ', cls: 'nowrap', mobile: 'meta', render: (r) => <SexTag sex={r.sex} /> },
              { label: 'หน้าที่', mobile: 'body', render: (r) => <Roles roles={r.roles} /> },
              { label: 'วันเกิด', cls: 'nowrap', mobile: 'body', render: (r) => (r.birth_date ? fmtDate(r.birth_date) : dash) },
              { label: 'สถานะ', cls: 'nowrap', mobile: 'status', render: (r) => <StatusTag row={r} /> },
              {
                label: 'จัดการ',
                cls: 'nowrap em-actions-col',
                mobile: 'extra',
                render: (r) => (
                  /* คลิกแถว = เปิดดู · ปุ่มในช่องนี้ไม่ส่งคลิกต่อขึ้นไปที่แถว */
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                  <span className="em-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="em-act" aria-label="ดูข้อมูล" title="ดูข้อมูล" onClick={() => setDlg({ mode: 'view', row: r })}>
                      <Icon name="eye" />
                    </button>
                    <button type="button" className="em-act" aria-label="แก้ไขข้อมูล" title="แก้ไขข้อมูล" onClick={() => setDlg({ mode: 'edit', row: r })}>
                      <Icon name="pencil" />
                    </button>
                    <RowMenu row={r} onToggle={toggle} />
                  </span>
                ),
              },
            ]}
            rows={shown}
            page={cur}
            perPage={perPage}
            onRowClick={(r) => setDlg({ mode: 'view', row: r })}
            empty={filtered ? 'ไม่พบพนักงานที่ตรงกับที่ค้นหา' : 'ยังไม่มีพนักงาน'}
          />
        </div>

        <div className="em-foot">
          <span className="em-range">{total ? `แสดง ${from} – ${to} จาก ${total} รายการ` : 'ไม่พบรายการ'}</span>
          {pages > 1 && (
            <div className="em-pages">
              <button type="button" className="em-pg" disabled={cur === 1} aria-label="หน้าก่อนหน้า" onClick={() => setPage(cur - 1)}>‹</button>
              {pageWindow(cur, pages).map((n, i) => (n === '…'
                ? <span className="em-gap" key={`g${i}`}>…</span>
                : <button type="button" key={n} className={`em-pg ${n === cur ? 'on' : ''}`} onClick={() => setPage(n)}>{n}</button>))}
              <button type="button" className="em-pg" disabled={cur === pages} aria-label="หน้าถัดไป" onClick={() => setPage(cur + 1)}>›</button>
            </div>
          )}
          <label className="em-per">
            แสดง
            <Select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} options={PER_PAGE.map((n) => [n, String(n)])} />
            รายการ / หน้า
          </label>
        </div>
      </div>

      {dlg?.mode === 'view' && (
        <Modal title="ข้อมูลพนักงาน" onClose={close}>
          <EmployeeView row={dlg.row} onClose={close} onEdit={() => setDlg({ mode: 'edit', row: dlg.row })} />
        </Modal>
      )}
      {(dlg?.mode === 'edit' || dlg?.mode === 'add') && (
        <Modal title={dlg.mode === 'edit' ? `แก้ไขข้อมูล — ${dlg.row.employee_name}` : 'เพิ่มพนักงานใหม่'} onClose={close}>
          <EmployeeForm key={dlg.row?.id || 'new'} row={dlg.row} busy={busy} onSave={save} onClose={close} />
        </Modal>
      )}
    </div>
  );
}

/* งานของแอดมิน — พนักงานขายที่พิมพ์ URL เข้ามาตรง ๆ จะเห็นคำอธิบาย ไม่ใช่หน้าเปล่า */
export default function EmployeeList() {
  return <AdminOnly zone="system"><EmployeeListInner /></AdminOnly>;
}

const CSS = `
.em-page{--em-amber:#B45309;--em-amber-tint:#FEF3C7;--em-red:#BE123C;--em-red-tint:#FFE4E6}

.em-hero{position:relative;overflow:hidden;display:flex;align-items:center;gap:18px;padding:22px 24px;margin:0 0 16px;
  border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);
  background:linear-gradient(100deg,var(--card) 0%,var(--card) 42%,var(--green-tint) 72%,#CFF5D6 100%)}
.em-hero::after{content:"";position:absolute;right:-60px;top:-80px;width:340px;height:260px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(77,209,97,.22),transparent);pointer-events:none}
.em-hero-ic{width:60px;height:60px;flex:0 0 60px;border-radius:var(--radius-sm);background:var(--green-tint);
  color:var(--green-ink);display:grid;place-items:center;border:1px solid var(--green-edge)}
.em-hero-ic .ico{width:30px;height:30px}
.em-hero-text{position:relative;z-index:1;min-width:0}
.em-hero h1{margin:0;font-size:28px;font-weight:800;letter-spacing:-.5px;line-height:1.15;color:var(--ink)}
.em-hero p{margin:4px 0 0;color:var(--ink-soft);font-size:var(--t-sm)}
.em-hero-art{position:absolute;right:28px;top:50%;transform:translateY(-50%) rotate(-6deg);width:300px;height:auto;
  color:var(--green-ink);opacity:.35;z-index:1}

.em-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 16px}
.em-stat{display:flex;align-items:center;gap:16px;padding:16px 18px;text-align:left;cursor:pointer;font:inherit;color:inherit;
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius-sm);box-shadow:var(--shadow-sm);
  transition:border-color .15s,box-shadow .15s,background .15s}
.em-stat:hover{border-color:var(--green-edge)}
.em-stat.on{background:var(--green-tint);border-color:var(--green-edge);box-shadow:0 0 0 1px var(--green-edge) inset,var(--shadow-sm)}
.em-stat:focus-visible{outline:none;box-shadow:0 0 0 3px var(--green-tint),0 0 0 1px var(--green-ink) inset}
.em-stat-ic{width:48px;height:48px;flex:0 0 48px;border-radius:50%;display:grid;place-items:center}
.em-stat-ic .ico{width:24px;height:24px}
.em-stat.green .em-stat-ic{background:var(--green-tint);color:var(--green-ink)}
.em-stat.green.on .em-stat-ic{background:#fff}
.em-stat.amber .em-stat-ic{background:var(--em-amber-tint);color:var(--em-amber)}
.em-stat.red .em-stat-ic{background:var(--em-red-tint);color:var(--em-red)}
.em-stat-body{display:flex;flex-direction:column;min-width:0}
.em-stat-label{font-size:var(--t-sm);color:var(--ink-soft);font-weight:500}
.em-stat-value{font-size:28px;font-weight:800;letter-spacing:-.5px;line-height:1.15;color:var(--ink)}
.em-stat-value small{font-size:var(--t-sm);font-weight:500;color:var(--ink-soft);letter-spacing:0}

.em-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 16px}
.em-search{flex:1 1 300px;display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius-pill)}
.em-search:focus-within{border-color:var(--green-ink);box-shadow:0 0 0 3px var(--green-tint)}
.em-search .ico{width:19px;height:19px;color:var(--ink-faint);flex:0 0 auto}
.em-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;padding:10px 0;font:inherit;box-shadow:none}
.em-sel{position:relative;flex:0 1 190px;min-width:160px}
.em-sel > .ico{position:absolute;left:13px;top:50%;transform:translateY(-50%);width:18px;height:18px;color:var(--ink-soft);
  z-index:2;pointer-events:none}
.em-sel .sel-trigger{padding-left:40px;min-height:44px;background:var(--card);border-color:var(--line);border-radius:var(--radius-pill);font-weight:500}
.em-sel .sel-trigger:hover:not(:disabled){background:var(--card);border-color:var(--green-edge)}
.em-icon-btn{width:44px;height:44px;flex:0 0 44px;display:grid;place-items:center;border:1px solid var(--line);
  border-radius:50%;background:var(--card);color:var(--ink-soft);cursor:pointer}
.em-icon-btn:hover{border-color:var(--green-edge);color:var(--green-deep)}
.em-icon-btn .ico{width:19px;height:19px}
.em-icon-btn.spin .ico{animation:em-spin .7s linear infinite}
@keyframes em-spin{to{transform:rotate(360deg)}}
.em-add{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 20px;border:0;border-radius:var(--radius-pill);
  background:var(--green-deep);color:#fff;font:inherit;font-weight:700;cursor:pointer;box-shadow:var(--shadow-green);white-space:nowrap}
.em-add:hover{background:#0F561E}
.em-add .ico{width:18px;height:18px}

.em-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px 18px 0}
.em-card-head{display:flex;align-items:center;gap:10px;margin:0 2px 14px}
.em-card-head h2{margin:0;font-size:18px;font-weight:800;color:var(--ink)}
.em-count{font-size:var(--t-xs);font-weight:600;padding:3px 10px;border-radius:var(--radius-pill);background:var(--surface-alt);color:var(--ink-soft)}
.em-clear{margin-left:auto;display:inline-flex;align-items:center;gap:5px;border:0;background:none;color:var(--ink-soft);
  font:inherit;font-size:var(--t-sm);cursor:pointer;padding:4px 8px;border-radius:var(--radius-xs)}
.em-clear:hover{background:var(--surface-alt);color:var(--ink)}
.em-clear .ico{width:14px;height:14px}

.em-table{border:1px solid var(--line-soft);border-radius:var(--radius-sm);overflow:hidden}
.em-table .card,.em-table .table-wrap{border:0;box-shadow:none;margin:0;border-radius:0}
.em-table table{width:100%}
.em-table table thead th{background:var(--green-tint);color:var(--ink);font-size:var(--t-sm);font-weight:700;
  padding-top:11px;padding-bottom:11px;border-bottom:0;white-space:nowrap}
.em-table table tbody td{padding-top:8px;padding-bottom:8px;border-bottom:1px solid var(--line-soft)}
.em-table table tbody tr:last-child td{border-bottom:0}
.em-table table tbody tr{cursor:pointer}
.em-table table tbody tr:hover td{background:#F7FDF8}
.em-table td.em-id{color:var(--ink-soft)}
.em-nick{font-weight:600}
.em-table th:nth-child(5),.em-table td:nth-child(5),.em-table th:nth-child(8),.em-table td:nth-child(8),
.em-table th.em-actions-col,.em-table td.em-actions-col{text-align:center}
.em-dash{color:var(--ink-dim)}
.em-sex{display:inline-flex;align-items:center;gap:5px;font-size:var(--t-sm);white-space:nowrap}
.em-sex span{font-family:"Segoe UI Symbol","Apple Symbols","DejaVu Sans",sans-serif;font-size:17px;font-weight:700;line-height:1;
  -webkit-text-stroke:.6px currentColor}
.em-sex.m span{color:#2563EB}
.em-sex.f span{color:#DB2777}
.em-roles{display:inline-flex;flex-wrap:wrap;gap:4px}
.em-role{font-size:var(--t-xs);font-weight:600;padding:3px 10px;border-radius:var(--radius-pill);background:#E8EEFD;color:#2F4BA8;white-space:nowrap}
.em-status{display:inline-flex;align-items:center;gap:6px;font-size:var(--t-xs);font-weight:600;padding:4px 11px;
  border-radius:var(--radius-pill);white-space:nowrap}
.em-status i{width:7px;height:7px;border-radius:50%;background:currentColor}
.em-status.on{background:var(--green-tint);color:var(--green-deep)}
.em-status.off{background:var(--surface-alt);color:var(--ink-faint)}
.em-actions{display:inline-flex;align-items:center;gap:6px}
.em-act{width:36px;height:30px;display:grid;place-items:center;border:1px solid var(--line);border-radius:var(--radius-pill);
  background:var(--card);color:var(--ink-soft);cursor:pointer;padding:0}
.em-act:hover{border-color:var(--green-edge);color:var(--green-deep);background:var(--green-tint)}
.em-act .ico{width:17px;height:17px}
.em-menu{position:relative;display:inline-block}
.em-menu-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:30;min-width:200px;background:var(--card);
  border:1px solid var(--line);border-radius:var(--radius-sm);box-shadow:var(--shadow-pop);padding:6px;display:block}
.em-menu-pop button{display:flex;align-items:center;gap:9px;width:100%;padding:9px 11px;border:0;background:none;
  border-radius:var(--radius-xs);color:var(--ink);font:inherit;font-weight:500;text-align:left;cursor:pointer;white-space:nowrap}
.em-menu-pop button:hover{background:var(--green-tint);color:var(--green-deep)}
.em-menu-pop button.danger:hover{background:var(--em-red-tint);color:var(--em-red)}
.em-menu-pop .ico{width:16px;height:16px}
.em-table .card:has(.em-menu-pop),.em-table:has(.em-menu-pop),.em-table .table-wrap:has(.em-menu-pop){overflow:visible}

.em-foot{display:flex;align-items:center;flex-wrap:wrap;gap:14px;padding:16px 4px 18px}
.em-range{color:var(--ink-soft);font-size:var(--t-sm);flex:1 1 0}
.em-pages{display:flex;align-items:center;gap:6px}
.em-pg{min-width:38px;height:38px;padding:0 10px;border:1px solid var(--line);border-radius:var(--radius-xs);background:var(--card);
  font:inherit;font-weight:600;cursor:pointer;color:var(--ink)}
.em-pg:hover:not(:disabled){border-color:var(--green-edge)}
.em-pg.on{background:var(--green-deep);border-color:var(--green-deep);color:#fff}
.em-pg:disabled{opacity:.45;cursor:default}
.em-gap{padding:0 4px;color:var(--ink-faint)}
.em-per{flex:1 1 0;display:inline-flex;align-items:center;justify-content:flex-end;gap:9px;color:var(--ink-soft);font-size:var(--t-sm);white-space:nowrap}
.em-per .sel{min-width:90px}
.em-per .sel-trigger{background:var(--card);border-color:var(--line);padding-top:8px;padding-bottom:8px}

.em-view-head{display:flex;align-items:center;gap:14px;margin-bottom:16px}
.em-view-head b{font-size:18px}
.em-view-sub{display:flex;align-items:center;gap:8px;color:var(--ink-soft);font-size:var(--t-sm);margin-top:3px}
.em-av{width:48px;height:48px;flex:0 0 48px;border-radius:50%;background:var(--green-tint);color:var(--green-deep);
  display:grid;place-items:center;font-weight:800}
.em-kvs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.em-kv{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:1px solid var(--line-soft);border-radius:var(--radius-xs);background:var(--panel)}
.em-kv span{font-size:var(--t-xs);color:var(--ink-faint)}
.em-kv b{font-weight:600}
.em-miss{display:flex;align-items:center;gap:7px;margin:14px 0 0;padding:10px 12px;border-radius:var(--radius-xs);
  background:var(--em-amber-tint);color:var(--em-amber);font-size:var(--t-sm);font-weight:500}
.em-miss .ico{width:17px;height:17px}

@media (max-width:1100px){
  .em-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .em-hero-art{opacity:.18}
}
@media (max-width:639.98px){
  .em-hero{padding:16px}
  .em-hero-ic{width:46px;height:46px;flex-basis:46px}
  .em-hero h1{font-size:22px}
  .em-hero-art{display:none}
  .em-stats{gap:10px;margin-bottom:12px}
  .em-stat{padding:12px;gap:10px}
  .em-stat-ic{width:38px;height:38px;flex-basis:38px}
  .em-stat-ic .ico{width:20px;height:20px}
  .em-stat-value{font-size:22px}
  .em-search{flex-basis:100%}
  .em-sel{flex:1 1 140px;min-width:0}
  .em-add{flex:1 1 auto;justify-content:center}
  .em-card{padding:12px 12px 0}
  .em-table{border:0}
  .em-range,.em-per{flex-basis:100%;justify-content:flex-start}
  .em-kvs{grid-template-columns:1fr}
}
`;
