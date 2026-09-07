'use client';
/**
 * ผู้ใช้และสิทธิ์ — บัญชีที่เข้าใช้งานได้ ทั้งหน้าร้านและคลัง
 *
 * ── ทำไมหน้านี้ถึงย้ายมาอยู่กลุ่ม (frontdesk) ─────────────────────────────
 * เดิมหน้านี้เขียนด้วยคอมโพเนนต์ของฝั่งคลังทั้งใบ อยู่ในกลุ่ม `(users)` ที่มี
 * layout ของตัวเองซึ่ง import สไตล์ฝั่งคลังและห่อด้วย `AppShell` ของฝั่งนั้น ·
 * ผลคือกดจากเมนูหน้าร้านแล้วแถบข้างเปลี่ยนเป็นของคลังทั้งแถบ ทั้งที่ยังทำงาน
 * เรื่องเดียวกันอยู่ · ทางแก้ที่ไม่ต้องรื้อ CSS สองชุดให้ชนกันคือเขียนหน้านี้ใหม่
 * ด้วยของหน้าร้าน ซึ่งคือไฟล์นี้ · กลุ่ม `(users)` ถูกลบไปแล้วทั้งกลุ่ม
 *
 * ── ทำไม path ของ API ยังขึ้นต้นด้วย /stock-api ──────────────────────────
 * ตาราง `admins` กับกฎสิทธิ์ทั้งชุดอยู่ในโค้ดฝั่งคลัง (`stock/api/src/Service/
 * Users.php`, `Roles.php`) และเส้นทางของมันลงทะเบียนไว้ใต้ `/stock-api` · ที่ย้าย
 * คือหน้าจอ ไม่ใช่ API — ย้าย API ตามด้วยแปลว่าต้องมีสองที่ที่ตัดสินเรื่องสิทธิ์
 * ซึ่งเป็นสิ่งเดียวที่ห้ามมีสองที่
 *
 * ── สิ่งที่หน้านี้ไม่ได้ตัดสินเอง ────────────────────────────────────────
 * `AdminOnly` เป็นแค่คำอธิบายให้คนอ่าน · ด่านจริงคือ `Roles::require()` ใน API
 * ซึ่งตรวจทุกคำขอไม่ว่าหน้าเว็บจะวาดอะไร
 */
import { useEffect, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync } from '../../../lib/hooks.js';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';
import { Badge, Card, Field, Fieldset, FormGrid, Loading, PageHead } from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { Select } from '../../../components/Selects.jsx';
import { Icon } from '../../../components/Icon.jsx';
import { count, fmtDateTime } from '../../../lib/format.js';

/**
 * บทบาททั้งหมด เรียงจากสิทธิ์มากไปน้อย
 *
 * `rank` ตรงกับ `Roles::RANK` ฝั่ง API และใช้กรองรายการนี้ให้เหลือเฉพาะบทบาทที่
 * คนที่กำลังกรอกฟอร์มตั้งให้คนอื่นได้จริง — API ปฏิเสธอยู่แล้วถ้าตั้งเกินตัว
 * แต่การโชว์ตัวเลือกที่จะถูกปฏิเสธแน่ ๆ คือการหลอกให้กดแล้วเจอ error
 */
const ROLES = [
  { key: 'superuser', rank: 4, label: 'ผู้ดูแลระบบ', note: 'ทุกอย่างของเจ้าของร้าน บวกงานระบบ' },
  { key: 'owner', rank: 3, label: 'เจ้าของร้าน', note: 'เห็นและทำได้ทุกอย่างในร้าน' },
  { key: 'admin', rank: 2, label: 'แอดมิน', note: 'จัดการผู้ใช้ ต้นทุน แคตตาล็อก และแดชบอร์ด ทั้งสองฝั่ง' },
  { key: 'sales', rank: 1, label: 'พนักงานขาย', note: 'เข้าระบบแล้วอยู่หน้าร้าน ไม่เห็นต้นทุน' },
  { key: 'stock', rank: 1, label: 'พนักงานคลัง', note: 'เข้าระบบแล้วอยู่ฝั่งคลัง ไม่เห็นต้นทุน' },
];

const RANK_OF = Object.fromEntries(ROLES.map((r) => [r.key, r.rank]));

function UsersInner() {
  const { actor } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.get('/stock-api/users'), []);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const rows = data?.users || [];

  if (loading) return <Loading />;

  return (
    <>
      <PageHead icon="🔒" title="Users & Roles" subtitle="ผู้ใช้และสิทธิ์" />

      {error && (
        <Card>
          <p className="muted">{error.message}</p>
          <button type="button" className="btn" onClick={reload}>ลองใหม่</button>
        </Card>
      )}

      {!error && (
        <Card
          title="รายชื่อผู้ใช้"
          /* ปุ่มเพิ่มยืนบนหัวของรายชื่อที่มันจะเพิ่มเข้าไป แบบเดียวกับหน้าพนักงาน */
          right={(
            <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>
              <Icon name="plus" /> เพิ่มผู้ใช้
            </button>
          )}
          tight
        >
          <DataTable
            className="data-grid"
            /* บัญชีที่ปิดอยู่ยังต้องอ่านได้ (ประวัติชี้มาที่ชื่อนี้) แต่ไม่ควรอ่าน
               เท่ากับบัญชีที่ยังใช้งาน — แถบซ้ายสีเทาบอกโดยไม่ต้องอ่านคอลัมน์สถานะ */
            rowClass={(u) => (u.isActive ? '' : 'row-gray')}
            /* ไม่ตั้ง defaultSort — ลำดับที่ API ส่งมาคือลำดับที่ต้องการอยู่แล้ว
               (ใช้งานอยู่ก่อน · สิทธิ์สูงก่อน · แล้วเรียงชื่อ) การเรียงใหม่เป็น
               ของคนอ่าน กดที่หัวคอลัมน์หรือช่อง "เรียงตาม" บนมือถือ */
            sortable
            columns={[
              { label: 'ชื่อที่แสดง', key: 'displayName', mobile: 'title' },
              {
                label: 'ชื่อผู้ใช้',
                sortKey: 'username',
                cls: 'mono',
                mobile: 'subtitle',
                /* บัญชีที่ไม่มีชื่อผู้ใช้ไม่ใช่บัญชีที่กรอกไม่ครบ — มันคือชื่อที่มีไว้
                   ให้ประวัติอ้างถึงเท่านั้น บอกไปตรง ๆ ดีกว่าขีดกลางที่อ่านได้หลายแบบ */
                render: (u) => (u.username || <span className="muted">ไม่มีบัญชีล็อกอิน</span>),
              },
              {
                label: 'สิทธิ์',
                sortKey: 'role',
                mobile: 'body',
                render: (u) => <Badge kind="blue">{u.roleLabel}</Badge>,
              },
              { label: 'ตำแหน่งงาน', key: 'jobTitle', mobile: 'meta' },
              {
                label: 'สถานะ',
                sortKey: (u) => (u.isActive ? 1 : 0),
                mobile: 'status',
                render: (u) => (!u.isActive
                  ? <Badge kind="gray">ปิดใช้งาน</Badge>
                  : u.canSignIn
                    ? <Badge kind="ok">ล็อกอินได้</Badge>
                    : <Badge kind="warn">ยังไม่มีบัญชี</Badge>),
              },
              {
                label: 'รายการที่ทำ',
                sortKey: 'movements',
                cls: 'num',
                mobile: 'body',
                render: (u) => count(u.movements),
              },
              {
                label: 'เข้าล่าสุด',
                sortKey: 'lastLoginAt',
                cls: 'nowrap',
                mobile: 'body',
                render: (u) => (u.lastLoginAt
                  ? fmtDateTime(u.lastLoginAt)
                  : <span className="muted">ยังไม่เคยเข้า</span>),
              },
              {
                label: '',
                cls: 'nowrap',
                mobile: 'extra',
                render: (u) => (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => setEditing(u)}>
                    <Icon name="pencil" /> แก้ไข
                  </button>
                ),
              },
            ]}
            rows={rows}
            empty="ยังไม่มีบัญชีผู้ใช้"
          />
        </Card>
      )}

      {/* กฎอยู่ใต้คนที่กฎบังคับใช้ — "คนนี้เป็นใคร" กับ "บทบาทนั้นทำอะไรได้"
          จึงตอบได้ในจอเดียว ไม่ต้องจำข้ามหน้า */}
      <PolicyCard />

      {(creating || editing) && (
        <UserDialog
          /* key ผูกกับแถวที่กำลังแก้ — ค่าเริ่มต้นของช่องในกล่องมาจาก props ตอน
             mount ครั้งแรกเท่านั้น ถ้าวันหน้ามีทางเปิดกล่องของอีกคนโดยไม่ปิดก่อน
             จะได้ชื่อคนเก่าค้างอยู่ในช่อง · key ทำให้ React สร้างกล่องใหม่ให้แทน */
          key={editing ? editing.id : 'new'}
          user={editing}
          actor={actor}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

/**
 * ตารางสิทธิ์ของแต่ละบทบาท — อ่านจาก API ตรง ๆ
 *
 * API สร้างตารางนี้ด้วยการเรียกฟังก์ชันตรวจสิทธิ์ตัวเดียวกับที่มันใช้บังคับจริง
 * ทุกคำขอ หน้าจอจึงขัดกับโค้ดไม่ได้ · ตารางสิทธิ์ที่ค้างเก่าอยู่แย่กว่าไม่มีเลย
 * เพราะจะมีคนเชื่อมัน
 */
function PolicyCard() {
  const { data, loading, error } = useAsync(() => api.get('/api/auth/policy'), []);

  if (loading || error) {
    /* โหลดไม่ได้ก็เงียบไป — ตารางนี้เป็นของอ้างอิง ไม่ใช่งานของหน้านี้
       การ์ดแดงใต้รายชื่อที่โหลดสำเร็จแล้วอ่านได้ว่าหน้าพัง ทั้งที่ไม่ได้พัง */
    return null;
  }

  const roles = data.roles || [];

  return (
    <Card title="สิทธิ์ของแต่ละบทบาท">
      <p className="muted" style={{ marginTop: 0 }}>
        ตารางนี้สร้างจากกฎที่ API ใช้บังคับจริงทุกครั้งที่มีคำขอ — ไม่ได้พิมพ์ไว้ซ้ำ
        แก้กฎในโค้ดเมื่อไหร่ ตารางเปลี่ยนตามทันที · เปลี่ยนสิทธิ์ของแต่ละบทบาทต้องแก้ที่โค้ด
        ส่วนการกำหนดว่าใครอยู่บทบาทไหน ทำได้ในตารางผู้ใช้ด้านบน
      </p>

      {(data.groups || []).map((group) => (
        <div key={group.title} style={{ marginTop: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 'var(--t-base)' }}>{group.title}</h3>
          <DataTable
            columns={[
              {
                label: group.title,
                mobile: 'title',
                render: (row) => (
                  <>
                    <b>{row.label}</b>
                    {row.note ? <div className="muted">{row.note}</div> : null}
                  </>
                ),
              },
              ...roles.map((r) => ({
                label: r.label,
                cls: 'num',
                mobile: 'body',
                /* อย่าบอกด้วยสีอย่างเดียว และอย่าบอกด้วยเครื่องหมายอย่างเดียว —
                   ในนี้ไม่มีคลาสซ่อนข้อความไว้ให้โปรแกรมอ่านหน้าจอ (.sr-only)
                   คำว่า "ได้ / ไม่ได้" จึงเขียนไว้บนจอตรง ๆ คู่กับรูป */
                render: (row) => (row.allow[r.key]
                  ? <Badge kind="ok"><Icon name="check" /> ได้</Badge>
                  : <Badge kind="gray"><Icon name="x" /> ไม่ได้</Badge>),
              })),
            ]}
            rows={group.rows}
            rowKey={(row) => row.label}
            empty="ไม่มีข้อมูลสิทธิ์"
          />
        </div>
      ))}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * กล่องเพิ่ม/แก้บัญชี
 *
 * สามส่วนเรียงลงมา: ข้อมูลบัญชี · ตั้งรหัสผ่านใหม่ · ลบ — เรียงตามความย้อนกลับ
 * ไม่ได้ จากน้อยไปมาก ปุ่มลบจึงไม่ได้อยู่ในระยะที่นิ้วที่เล็งปุ่ม "บันทึก" จะโดน
 */
function UserDialog({ user, actor, onClose, onSaved }) {
  const isSelf = user?.id === actor?.id;
  const { ok } = useToast();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [role, setRole] = useState(user?.role ?? 'sales');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  /* แยกจาก `problem` เพราะข้อความของฟอร์มอยู่เหนือกล่องนี้ขึ้นไปสองบล็อก
     เหตุผลที่ลบไม่ได้คือสิ่งที่ต้องอ่าน — วางไว้ตรงปุ่มที่เพิ่งกด */
  const [deleteProblem, setDeleteProblem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* ตั้งบทบาทได้ไม่เกินของตัวเอง ตามกฎเดียวกับที่ API บังคับ (Roles::canGrant) */
  const grantable = ROLES.filter((r) => r.rank <= (RANK_OF[actor?.role] ?? 0));

  /* Esc ปิดกล่อง — ทางออกเดียวกับป๊อปอัปอื่นทั้งระบบ */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (user) {
        await api.post(`/stock-api/users/${user.id}/update`, {
          display_name: displayName.trim(),
          job_title: jobTitle.trim() || null,
          username: username.trim() || null,
          role,
          is_active: isActive,
        });
      } else {
        await api.post('/stock-api/users', {
          display_name: displayName.trim(),
          job_title: jobTitle.trim() || null,
          username: username.trim() || null,
          password: username.trim() ? password : null,
          role,
        });
      }
      /* บัญชีที่ไม่มีชื่อผู้ใช้เข้าระบบไม่ได้ — เป็นชื่อไว้ลงในสมุดเฉย ๆ ซึ่งเป็น
         สิ่งที่คนเพิ่งกดบันทึกมักไม่ได้ตั้งใจ ถ้าตั้งใจจะเพิ่มคนเข้าใช้งาน */
      if (username.trim() === '') {
        ok(`${user ? 'แก้' : 'เพิ่ม'}บัญชี ${displayName.trim()} แล้ว — ยังไม่มีชื่อผู้ใช้ จึงเข้าระบบไม่ได้`);
      } else if (!isActive && user) {
        ok(`แก้บัญชี ${displayName.trim()} แล้ว — บัญชีนี้ปิดใช้งานอยู่ เข้าระบบไม่ได้`);
      } else {
        ok(`${user ? 'แก้' : 'เพิ่ม'}บัญชี ${displayName.trim()} แล้ว`);
      }
      onSaved();
    } catch (ex) {
      setProblem(ex.message || 'บันทึกไม่สำเร็จ');
      setBusy(false);
    }
  }

  async function setPasswordOnly() {
    if (!user) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/stock-api/users/${user.id}/password`, { password });
      ok(`ตั้งรหัสผ่านใหม่ให้ ${user.displayName} แล้ว`);
      setPassword('');
    } catch (ex) {
      setProblem(ex.message || 'ตั้งรหัสผ่านไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  /**
   * ผ่านได้เฉพาะบัญชีที่ไม่มีประวัติชี้มาหา — API นับร่องรอยแล้วปฏิเสธที่เหลือ
   * เอง และคำปฏิเสธนั้นคือสิ่งที่ไปโผล่ใน `deleteProblem` · การถามซ้ำก่อนคือ
   * ความระวังครึ่งฝั่งของเรา: ชื่อคนหนึ่งถูกพิมพ์อยู่บนทุกรายการที่เขาเป็นคนคีย์
   */
  async function remove() {
    if (!user) return;
    setBusy(true);
    setDeleteProblem(null);
    try {
      await api.post(`/stock-api/users/${user.id}/delete`, {});
      ok(`ลบบัญชี ${user.displayName} แล้ว`);
      onSaved();
    } catch (ex) {
      setDeleteProblem(ex.message || 'ลบไม่สำเร็จ');
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-back"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <h3>{user ? `แก้ไข ${user.displayName}` : 'เพิ่มผู้ใช้'}</h3>

        <form onSubmit={save} noValidate>
          <div className="m-body">
            <div className="form-2col">
              <FormGrid>
                <Field label="ชื่อที่แสดง">
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={busy}
                    autoFocus
                    autoComplete="off"
                  />
                </Field>
                <Field label="ตำแหน่งงาน" hint="อธิบายว่าทำงานอะไร ไม่มีผลต่อสิทธิ์">
                  <input
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="เช่น technician, reception"
                    disabled={busy}
                    autoComplete="off"
                  />
                </Field>
                <Field label="ชื่อผู้ใช้">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="เว้นว่างถ้ายังไม่ต้องล็อกอิน"
                    disabled={busy}
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label="สิทธิ์"
                  hint={isSelf ? 'ลดสิทธิ์ตัวเองไม่ได้' : ROLES.find((r) => r.key === role)?.note}
                >
                  <Select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={busy || isSelf}
                    options={grantable.map((r) => [r.key, r.label])}
                  />
                </Field>

                {!user && (
                  <Field label="รหัสผ่าน" className="full">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={username.trim() ? 'อย่างน้อย 10 ตัวอักษร' : 'ไม่ต้องใส่ ถ้ายังไม่ให้ล็อกอิน'}
                      disabled={busy || !username.trim()}
                      autoComplete="new-password"
                    />
                  </Field>
                )}

                {user && (
                  <Field
                    label="สถานะ"
                    className="full"
                    hint={isSelf
                      ? 'ปิดบัญชีตัวเองไม่ได้'
                      : 'ปิดแทนการลบ เพราะประวัติต้องอ่านย้อนหลังได้ — คนที่ยังไม่เคยทำอะไรเลย ลบได้ข้างล่าง'}
                  >
                    <Select
                      value={isActive ? '1' : '0'}
                      onChange={(e) => setIsActive(e.target.value === '1')}
                      disabled={busy || isSelf}
                      options={[['1', 'ใช้งานอยู่'], ['0', 'ปิดใช้งาน']]}
                    />
                  </Field>
                )}
              </FormGrid>
            </div>

            {problem && <div className="note danger" role="alert">{problem}</div>}

            {user && (
              <Fieldset legend="ตั้งรหัสผ่านใหม่">
                <Field
                  label="รหัสผ่านใหม่"
                  hint={user.username ? null : 'ต้องตั้งชื่อผู้ใช้ก่อนจึงจะตั้งรหัสผ่านได้'}
                >
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="อย่างน้อย 10 ตัวอักษร"
                    disabled={busy || !user.username}
                    autoComplete="new-password"
                  />
                </Field>
                <button
                  type="button"
                  className="btn btn-sm btn-light"
                  onClick={setPasswordOnly}
                  disabled={busy || !password || !user.username}
                >
                  <Icon name="lock" /> ตั้งรหัสผ่าน
                </button>
              </Fieldset>
            )}

            {/* บล็อกสุดท้ายของกล่อง ใต้บล็อกรหัสผ่าน: การลบเป็นอย่างเดียวที่นี่ที่
                ย้อนไม่ได้ · บัญชีที่กำลังล็อกอินอยู่ API ปฏิเสธเองอยู่แล้ว จึงไม่เสนอ */}
            {user && !isSelf && (
              <Fieldset legend="ลบผู้ใช้">
                {deleteProblem && <div className="note danger" role="alert">{deleteProblem}</div>}
                {confirmDelete ? (
                  <>
                    <p className="muted">ลบ {user.displayName} ถาวร — ทำแล้วย้อนไม่ได้</p>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={remove}
                        disabled={busy}
                      >
                        <Icon name="trash" /> ยืนยันลบ
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        onClick={() => setConfirmDelete(false)}
                        disabled={busy}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-light"
                      onClick={() => setConfirmDelete(true)}
                      disabled={busy}
                    >
                      <Icon name="trash" /> ลบผู้ใช้นี้
                    </button>
                    <p className="muted" style={{ marginBottom: 0 }}>
                      ลบได้เฉพาะคนที่ยังไม่เคยทำรายการและไม่เคยรับของ — คนที่มีประวัติแล้วให้ปิดใช้งานแทน
                      ประวัติจะได้ยังอ่านชื่อได้
                    </p>
                  </>
                )}
              </Fieldset>
            )}
          </div>

          <div className="m-foot">
            <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
              ยกเลิก
            </button>
            <button className="btn" type="submit" disabled={busy}>
              <Icon name="check" /> {busy ? 'กำลังบันทึก…' : user ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ใช้'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* งานของแอดมิน — คนที่พิมพ์ URL เข้ามาตรง ๆ จะเห็นคำอธิบาย ไม่ใช่หน้าเปล่า */
export default function UsersPage() {
  return <AdminOnly><UsersInner /></AdminOnly>;
}
