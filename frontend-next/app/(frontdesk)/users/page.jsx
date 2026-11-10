'use client';
/**
 * ผู้ใช้และสิทธิ์ — บัญชีที่เข้าใช้งานได้ ทั้งหน้าร้านและคลัง
 *
 * ── ทำไมหน้านี้ถึงอยู่กลุ่ม (frontdesk) ทั้งที่ API อยู่ฝั่งคลัง ─────────────
 * ตาราง `admins` กับกฎสิทธิ์ทั้งชุดอยู่ในโค้ดฝั่งคลัง (`stock/api/src/Service/
 * Users.php`, `Roles.php`) และเส้นทางของมันลงทะเบียนไว้ใต้ `/stock-api` · ที่ย้าย
 * มาคือหน้าจอ ไม่ใช่ API — ย้าย API ตามด้วยแปลว่าต้องมีสองที่ที่ตัดสินเรื่องสิทธิ์
 * ซึ่งเป็นสิ่งเดียวที่ห้ามมีสองที่
 *
 * ── หนึ่งคนถือได้หลายบทบาท ────────────────────────────────────────────────
 * สิทธิ์ที่ได้คือยูเนียนของทุกใบที่ถือ · ช่องเลือกบทบาทจึงเป็นเช็กบ็อกซ์ ไม่ใช่
 * ดรอปดาวน์ และมี "สิทธิ์ที่จะได้" อยู่ข้าง ๆ ที่คำนวณสดจากตารางสิทธิ์ตัวจริง
 * (`/api/auth/policy`) — คนที่กำลังติ๊กจะได้เห็นผลก่อนกดบันทึก ไม่ใช่ไปรู้ทีหลัง
 * ตอนมีคนโทรมาบอกว่าเข้าหน้านั้นไม่ได้
 *
 * ── สิ่งที่หน้านี้ไม่ได้ตัดสินเอง ────────────────────────────────────────
 * `AdminOnly` เป็นแค่คำอธิบายให้คนอ่าน · ด่านจริงคือ `Roles::require()` ใน API
 * ซึ่งตรวจทุกคำขอไม่ว่าหน้าเว็บจะวาดอะไร · รายการบทบาทที่ติ๊กได้ก็เหมือนกัน —
 * ที่กรองไว้เพราะการโชว์ตัวเลือกที่จะถูกปฏิเสธแน่ ๆ คือการหลอกให้กดแล้วเจอ error
 *
 * ── ชื่อกับตำแหน่งแก้ที่นี่ไม่ได้ ────────────────────────────────────────
 * ทั้งสองอย่างเป็นของ `employees` ที่เดียว (migration 027 บังคับที่ฐานแล้วว่า
 * บัญชีทุกใบต้องมีพนักงานรองรับ) · รับแก้ที่นี่ด้วยแปลว่ามีสองที่ที่ตั้งชื่อคน
 * คนเดียวกัน แล้ววันหนึ่งใบเสร็จกับรายงานจะพิมพ์คนละชื่อ
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync } from '../../../lib/hooks.js';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';
import { Badge, Card, Check, Field, Fieldset, FormGrid, Loading, PageHead, Row } from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { Select } from '../../../components/Selects.jsx';
import { Icon } from '../../../components/Icon.jsx';
import { fmtDateTime } from '../../../lib/format.js';

/** ป้ายบทบาทหลายใบเรียงกัน — คอลัมน์ Role ของตาราง */
function RoleTags({ names }) {
  if (!names || names.length === 0) {
    return <span className="muted">ยังไม่ได้กำหนดสิทธิ์</span>;
  }
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      {names.map((n) => <Badge key={n} kind="blue">{n}</Badge>)}
    </span>
  );
}

function UsersInner() {
  const { actor } = useAuth();
  const list = useAsync(() => api.get('/stock-api/users'), []);
  /* ตารางสิทธิ์ตัวจริงจาก API — ใช้ทั้งวาดการ์ดล่างสุด และคำนวณ "สิทธิ์ที่จะได้"
     ในกล่องแก้ไข · โหลดที่นี่ครั้งเดียวแล้วส่งลงไป ไม่ให้ทุกกล่องยิงซ้ำ */
  const policy = useAsync(() => api.get('/api/auth/policy'), []);

  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [creating, setCreating] = useState(false);

  const rows = list.data?.users || [];
  const candidates = list.data?.candidates || [];

  if (list.loading || policy.loading) return <Loading />;

  const reload = () => { list.reload(); };

  return (
    <>
      <PageHead icon="lock" title="Users & Roles" subtitle="ผู้ใช้และสิทธิ์" />

      {list.error && (
        <Card>
          <p className="muted">{list.error.message}</p>
          <button type="button" className="btn" onClick={reload}>ลองใหม่</button>
        </Card>
      )}

      {!list.error && (
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
               (ใช้งานอยู่ก่อน · สิทธิ์สูงก่อน · แล้วเรียงชื่อ) */
            sortable
            columns={[
              { label: 'ชื่อพนักงาน', key: 'displayName', mobile: 'title' },
              {
                label: 'Username',
                sortKey: 'username',
                cls: 'mono',
                mobile: 'subtitle',
                /* บัญชีที่ไม่มีชื่อผู้ใช้ไม่ใช่บัญชีที่กรอกไม่ครบ — มันคือชื่อที่มีไว้
                   ให้ประวัติอ้างถึงเท่านั้น บอกไปตรง ๆ ดีกว่าขีดกลางที่อ่านได้หลายแบบ */
                render: (u) => (u.username || <span className="muted">ไม่มีบัญชีล็อกอิน</span>),
              },
              {
                label: 'Role',
                sortKey: 'roleText',
                mobile: 'body',
                render: (u) => <RoleTags names={u.roleNames} />,
              },
              { label: 'ตำแหน่ง', key: 'jobTitle', mobile: 'meta' },
              {
                label: 'สถานะ',
                sortKey: (u) => (u.isActive ? 1 : 0),
                mobile: 'status',
                render: (u) => (!u.isActive
                  ? <Badge kind="gray">Inactive</Badge>
                  : u.mustChangePassword
                    ? <Badge kind="warn" title="รหัสถูกตั้งโดยผู้ดูแล ต้องตั้งใหม่ก่อนใช้งาน">รอตั้งรหัส</Badge>
                    : u.canSignIn
                      ? <Badge kind="ok">Active</Badge>
                      : <Badge kind="warn">ยังไม่มีบัญชี</Badge>),
              },
              {
                label: 'Last Login',
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
                  <Row>
                    <button type="button" className="btn btn-sm btn-light" onClick={() => setEditing(u)}>
                      <Icon name="pencil" /> เปิดการแก้ไข
                    </button>
                    {/* รีเซ็ตอยู่นอกกล่องแก้ไข เพราะมันเป็นงานที่มาเป็นเรื่องของ
                        ตัวเอง — "โทรมาบอกว่าลืมรหัส" ไม่ได้มาพร้อมการแก้อย่างอื่น */}
                    {u.canSignIn && (
                      <button type="button" className="btn btn-sm btn-light" onClick={() => setResetting(u)}>
                        <Icon name="lock" /> รีเซ็ตรหัส
                      </button>
                    )}
                  </Row>
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
      <PolicyCard policy={policy.data} />
      <RoleHistoryCard />

      {(creating || editing) && (
        <UserDialog
          /* key ผูกกับแถวที่กำลังแก้ — ค่าเริ่มต้นของช่องในกล่องมาจาก props ตอน
             mount ครั้งแรกเท่านั้น ถ้าวันหน้ามีทางเปิดกล่องของอีกคนโดยไม่ปิดก่อน
             จะได้ค่าคนเก่าค้างอยู่ · key ทำให้ React สร้างกล่องใหม่ให้แทน */
          key={editing ? editing.id : 'new'}
          user={editing}
          actor={actor}
          policy={policy.data}
          candidates={candidates}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}

      {resetting && (
        <ResetDialog
          key={`reset-${resetting.id}`}
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={() => { setResetting(null); reload(); }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------- ตารางสิทธิ์ */

/**
 * ตารางสิทธิ์ของแต่ละบทบาท — อ่านจาก API ตรง ๆ
 *
 * API สร้างตารางนี้จากชุดสิทธิ์ตัวเดียวกับที่มันใช้บังคับจริงทุกคำขอ หน้าจอจึง
 * ขัดกับโค้ดไม่ได้ · ตารางสิทธิ์ที่ค้างเก่าอยู่แย่กว่าไม่มีเลย เพราะจะมีคนเชื่อมัน
 */
function PolicyCard({ policy }) {
  if (!policy) return null;
  const roles = policy.roles || [];

  return (
    <Card title="สิทธิ์ของแต่ละบทบาท">
      <p className="muted" style={{ marginTop: 0 }}>
        ตารางนี้สร้างจากชุดสิทธิ์ที่ API ใช้บังคับจริงทุกครั้งที่มีคำขอ — ไม่ได้พิมพ์ไว้ซ้ำ
        แก้กฎในโค้ดเมื่อไหร่ ตารางเปลี่ยนตามทันที · คนหนึ่งคนถือได้หลายบทบาท และสิทธิ์
        ที่ได้จริงคือทุกช่องที่ติ๊กไว้ของทุกบทบาทที่ถือรวมกัน
      </p>

      {(policy.groups || []).map((group) => (
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
                    <div className="muted mono" style={{ fontSize: 'var(--t-xs)' }}>{row.perm}</div>
                    {row.note ? <div className="muted">{row.note}</div> : null}
                  </>
                ),
              },
              ...roles.map((r) => ({
                label: r.name,
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
            rowKey={(row) => row.perm}
            empty="ไม่มีข้อมูลสิทธิ์"
          />
        </div>
      ))}
    </Card>
  );
}

/**
 * ประวัติการเปลี่ยนสิทธิ์ — ดึงจากบันทึกการใช้งานเดิม ไม่มีตารางใหม่
 *
 * `ActivityLog` ดักที่ประตูเดียวของ API และบันทึกทุกคำขอที่เขียนข้อมูลพร้อม
 * ค่าก่อน→หลังอยู่แล้ว · ที่นี่แค่ถามมันด้วยตัวกรอง `entity=admins` แล้วเอา
 * ช่องที่เปลี่ยนมาแสดง — บรรทัด `roles: sales → sales+admin` มาจากช่องสังเคราะห์
 * ที่ `ActivityLog::snapshot()` ต่อให้ (ดูเหตุผลในไฟล์นั้น)
 */
function RoleHistoryCard() {
  const { data, loading, error } = useAsync(
    () => api.get('/api/logs?entity=admins&kind=audit&limit=25'),
    [],
  );

  /* โหลดไม่ได้ก็เงียบไป — การ์ดนี้เป็นของอ้างอิง ไม่ใช่งานของหน้านี้
     การ์ดแดงใต้รายชื่อที่โหลดสำเร็จแล้วอ่านได้ว่าหน้าพัง ทั้งที่ไม่ได้พัง */
  if (loading || error) return null;

  const rows = data?.rows || [];

  return (
    <Card title="ประวัติการเพิ่ม แก้ไข และเปลี่ยนสิทธิ์" tight>
      <DataTable
        columns={[
          {
            label: 'เมื่อ',
            cls: 'nowrap',
            mobile: 'subtitle',
            render: (r) => fmtDateTime(r.at),
          },
          {
            label: 'ใคร',
            mobile: 'title',
            render: (r) => (
              <>
                {r.actor_name || <span className="muted">(ไม่ทราบ)</span>}
                {r.actor_role ? <div className="muted">{r.actor_role}</div> : null}
              </>
            ),
          },
          { label: 'ทำอะไร', key: 'summary', mobile: 'body' },
          {
            label: 'ที่เปลี่ยน',
            mobile: 'body',
            render: (r) => {
              const changes = r.changes || [];
              if (changes.length === 0) return <span className="muted">—</span>;
              return (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {changes.map((c) => (
                    <li key={c.field} className="mono" style={{ fontSize: 'var(--t-xs)' }}>
                      {c.field}: {String(c.before ?? '—')} → {String(c.after ?? '—')}
                    </li>
                  ))}
                </ul>
              );
            },
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        empty="ยังไม่มีการเปลี่ยนแปลงที่บันทึกไว้"
      />
      <p className="muted" style={{ marginBottom: 0 }}>
        เก็บ 3 ปี · ดูทั้งหมดพร้อมตัวกรองได้ที่หน้า <b>บันทึกการใช้งาน</b>
      </p>
    </Card>
  );
}

/* --------------------------------------------------------------- กล่องแก้ไข */

/** ยศสูงสุดของบทบาทที่คนคนนี้ถือ — ใช้กรองบทบาทที่ติ๊กให้คนอื่นได้ */
function rankOf(policy, roleKeys) {
  const byKey = Object.fromEntries((policy?.roles || []).map((r) => [r.key, r.rank]));
  return (roleKeys || []).reduce((best, k) => Math.max(best, byKey[k] ?? 0), 0);
}

/** สิทธิ์ที่ชุดบทบาทนี้จะได้ — คำนวณจากตารางสิทธิ์ตัวจริง ไม่ได้เดาเอง */
function permsFor(policy, roleKeys) {
  const out = [];
  for (const group of policy?.groups || []) {
    const rows = group.rows.filter((r) => roleKeys.some((k) => r.allow[k]));
    if (rows.length > 0) out.push({ title: group.title, rows });
  }
  return out;
}

/**
 * กล่องเพิ่ม/แก้บัญชี
 *
 * เรียงลงมาตามความย้อนกลับไม่ได้ จากน้อยไปมาก: ข้อมูลบัญชี · สิทธิ์ · รหัสผ่าน ·
 * ยกเลิกบัญชี — ปุ่มที่อันตรายที่สุดจึงไม่ได้อยู่ในระยะที่นิ้วที่เล็ง "บันทึก" จะโดน
 */
function UserDialog({ user, actor, policy, candidates, onClose, onSaved }) {
  const isSelf = user?.id === actor?.id;
  const { ok } = useToast();

  /* ── ฟอร์มเพิ่ม: เลือกพนักงานที่มีอยู่ หรือเปิดคนใหม่ในฟอร์มเดียวกัน ──
     ชื่อกับตำแหน่งเป็นของ `employees` ที่เดียว การ "เพิ่มผู้ใช้" จึงเป็นการ
     เลือกคนก่อน แล้วค่อยให้สิทธิ์เข้าใช้งาน — สองการตัดสินใจที่แยกกันอยู่แล้ว
     ในฐาน แต่มักเกิดขึ้นในนาทีเดียวกันตอนรับคนใหม่ */
  const [employeeId, setEmployeeId] = useState('');
  const [newName, setNewName] = useState('');
  const [newJobTitle, setNewJobTitle] = useState('');
  const addingPerson = employeeId === 'new';

  const [username, setUsername] = useState(user?.username ?? '');
  const [roles, setRoles] = useState(user?.roles ?? ['sales']);
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  /* แยกจาก `problem` เพราะข้อความของฟอร์มอยู่เหนือกล่องนี้ขึ้นไปสองบล็อก
     เหตุผลที่ยกเลิกไม่ได้คือสิ่งที่ต้องอ่าน — วางไว้ตรงปุ่มที่เพิ่งกด */
  const [revokeProblem, setRevokeProblem] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  /* ติ๊กให้คนอื่นได้ไม่เกินยศสูงสุดของตัวเอง ตามกฎเดียวกับที่ API บังคับ
     (`Roles::canGrant`) — โชว์ตัวเลือกที่จะถูกปฏิเสธแน่ ๆ คือการหลอกให้กด */
  const ceiling = rankOf(policy, actor?.roles);
  const grantable = (policy?.roles || []).filter((r) => r.rank <= ceiling);

  const preview = useMemo(() => permsFor(policy, roles), [policy, roles]);

  /* Esc ปิดกล่อง — ทางออกเดียวกับป๊อปอัปอื่นทั้งระบบ */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleRole = (key) => setRoles(
    (now) => (now.includes(key) ? now.filter((r) => r !== key) : [...now, key]),
  );

  async function save(e) {
    e.preventDefault();
    if (!user && password !== confirm) {
      setProblem('รหัสผ่านสองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (user) {
        await api.post(`/stock-api/users/${user.id}/update`, {
          username: username.trim() || null,
          roles,
          is_active: isActive,
        });
        ok(isActive
          ? `แก้บัญชี ${user.displayName} แล้ว`
          : `แก้บัญชี ${user.displayName} แล้ว — บัญชีนี้ปิดใช้งานอยู่ เข้าระบบไม่ได้`);
      } else {
        /* เปิดพนักงานใหม่ก่อน แล้วค่อยให้สิทธิ์ · ถ้าขั้นที่สองล้ม พนักงานที่เพิ่ง
           สร้างยังอยู่ ซึ่งถูกแล้ว — คนคนนั้นมีตัวตนจริงและจะโผล่ในช่องเลือกรอบหน้า
           ไม่ใช่ขยะที่ต้องตามลบ */
        let empId = Number(employeeId);
        if (addingPerson) {
          const made = await api.post('/api/employees', {
            employee_name: newName.trim(),
            roles: newJobTitle.trim() || null,
          });
          empId = Number(made.id);
        }

        await api.post('/stock-api/users', {
          employee_id: empId,
          username: username.trim(),
          password,
          roles,
          is_active: isActive,
        });
        ok(`เพิ่มผู้ใช้ ${username.trim()} แล้ว`);
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
      ok(`ตั้งรหัสผ่านใหม่ให้ ${user.displayName} แล้ว — เขาต้องตั้งรหัสของตัวเองตอนเข้าครั้งถัดไป`);
      setPassword('');
      setConfirm('');
    } catch (ex) {
      setProblem(ex.message || 'ตั้งรหัสผ่านไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  /**
   * เอาสิทธิ์เข้าใช้งานคืน โดยที่คนยังอยู่ในระบบ
   *
   * ไม่มีปุ่ม "ลบผู้ใช้" อีกแล้ว — แถวใน `admins` ลบไม่ได้ เพราะทุกรายการที่คนนี้
   * เคยคีย์ชี้มาที่มัน · สิ่งที่ยกเลิกได้คือชื่อผู้ใช้ รหัสผ่าน และบทบาท
   */
  async function revoke() {
    if (!user) return;
    setBusy(true);
    setRevokeProblem(null);
    try {
      await api.post(`/stock-api/users/${user.id}/revoke`, {});
      ok(`ยกเลิกบัญชีเข้าใช้งานของ ${user.displayName} แล้ว — ชื่อยังอยู่ในประวัติ`);
      onSaved();
    } catch (ex) {
      setRevokeProblem(ex.message || 'ยกเลิกบัญชีไม่สำเร็จ');
      setConfirmRevoke(false);
      setBusy(false);
    }
  }

  const canSubmit = user
    ? true
    : (addingPerson ? newName.trim() !== '' : employeeId !== '')
      && username.trim() !== '' && password !== '' && roles.length > 0;

  return (
    <div
      className="modal-back"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal wide" role="dialog" aria-modal="true">
        <h3>{user ? `แก้ไข ${user.displayName}` : 'เพิ่มผู้ใช้งาน'}</h3>

        <form onSubmit={save} noValidate>
          <div className="m-body">
            <FormGrid>
              {user ? (
                <>
                  {/* อ่านอย่างเดียว — ทั้งสองช่องเป็นของหน้าพนักงานที่เดียว */}
                  <Field label="ชื่อ" hint="แก้ได้ที่หน้าพนักงาน">
                    <input value={user.displayName} readOnly disabled />
                  </Field>
                  <Field label="ตำแหน่ง" hint="แก้ได้ที่หน้าพนักงาน">
                    <input value={user.jobTitle || '—'} readOnly disabled />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label="พนักงาน"
                    className={addingPerson ? '' : 'full'}
                    hint="บัญชีทุกใบต้องผูกกับพนักงานหนึ่งคน"
                  >
                    <Select
                      value={employeeId}
                      onChange={(e) => setEmployeeId(e.target.value)}
                      disabled={busy}
                      options={[
                        ['', '— เลือกพนักงาน —'],
                        ...candidates.map((c) => [
                          String(c.employeeId),
                          c.jobTitle ? `${c.displayName} (${c.jobTitle})` : c.displayName,
                        ]),
                        ['new', '+ เพิ่มพนักงานใหม่…'],
                      ]}
                    />
                  </Field>
                  {addingPerson && (
                    <Field label="ชื่อ-นามสกุล">
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        disabled={busy}
                        autoFocus
                        autoComplete="off"
                      />
                    </Field>
                  )}
                  {addingPerson && (
                    <Field label="ตำแหน่ง" hint="อธิบายว่าทำงานอะไร ไม่มีผลต่อสิทธิ์">
                      <input
                        value={newJobTitle}
                        onChange={(e) => setNewJobTitle(e.target.value)}
                        placeholder="เช่น พนักงานขาย, ช่างประกอบ"
                        disabled={busy}
                        autoComplete="off"
                      />
                    </Field>
                  )}
                </>
              )}

              <Field label="Username" hint={user ? null : '3–64 ตัว ใช้ได้เฉพาะ a–z 0–9 . - _'}>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                  autoComplete="off"
                />
              </Field>

              {user ? (
                <Field
                  label="สถานะ"
                  hint={isSelf
                    ? 'ปิดบัญชีตัวเองไม่ได้'
                    : 'ปิดแทนการลบ เพราะประวัติต้องอ่านย้อนหลังได้'}
                >
                  <Select
                    value={isActive ? '1' : '0'}
                    onChange={(e) => setIsActive(e.target.value === '1')}
                    disabled={busy || isSelf}
                    options={[['1', 'เปิดใช้งาน'], ['0', 'ปิดใช้งาน']]}
                  />
                </Field>
              ) : (
                <>
                  <Field label="Password" hint="อย่างน้อย 10 ตัวอักษร">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="ยืนยัน Password">
                    <input
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      disabled={busy}
                      autoComplete="new-password"
                    />
                  </Field>
                  {/* สร้างไว้ปิดก็ได้ — คนที่จะเริ่มงานเดือนหน้าควรมีบัญชีรออยู่ได้
                      โดยที่ยังเข้าระบบไม่ได้ */}
                  <Field label="สถานะ" hint="ปิดไว้ก่อนได้ ถ้ายังไม่ถึงวันเริ่มงาน">
                    <Select
                      value={isActive ? '1' : '0'}
                      onChange={(e) => setIsActive(e.target.value === '1')}
                      disabled={busy}
                      options={[['1', 'เปิดใช้งาน'], ['0', 'ปิดใช้งาน']]}
                    />
                  </Field>
                </>
              )}
            </FormGrid>

            <Fieldset legend="กำหนดสิทธิ์">
              {isSelf && (
                <p className="muted" style={{ marginTop: 0 }}>
                  ลดสิทธิ์ของตัวเองไม่ได้ — ให้คนที่สิทธิ์สูงกว่าทำให้
                </p>
              )}
              <div className="stack">
                {grantable.map((r) => (
                  <Check
                    key={r.key}
                    checked={roles.includes(r.key)}
                    onChange={() => toggleRole(r.key)}
                  >
                    <b>{r.name}</b> <span className="muted">· {r.label} — {r.note}</span>
                  </Check>
                ))}
              </div>
              {roles.length === 0 && (
                <p className="muted" style={{ marginBottom: 0 }}>
                  ยังไม่ได้ติ๊กอะไรเลย — บัญชีที่ไม่มีสิทธิ์เข้าระบบไม่ได้
                </p>
              )}
            </Fieldset>

            {/* คนที่กำลังติ๊กเห็นผลก่อนกดบันทึก ไม่ใช่ไปรู้ทีหลังตอนมีคนโทรมาถาม */}
            {roles.length > 0 && (
              <Fieldset legend={`สิทธิ์ที่จะได้ (รวมจาก ${roles.length} บทบาท)`}>
                {preview.map((g) => (
                  <div key={g.title} style={{ marginBottom: 6 }}>
                    <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>{g.title}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {g.rows.map((row) => (
                        <Badge key={row.perm} kind="ok" title={row.perm}>{row.label}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </Fieldset>
            )}

            {problem && <div className="note danger" role="alert">{problem}</div>}

            {user && user.canSignIn && (
              <Fieldset legend="เปลี่ยนรหัสผ่าน">
                <p className="muted" style={{ marginTop: 0 }}>
                  ไม่แสดงรหัสเดิม และไม่มีทางอ่านมันได้ · รหัสที่ตั้งจากที่นี่ใช้ได้ครั้งเดียว
                  เจ้าตัวต้องตั้งรหัสของตัวเองตอนเข้าครั้งถัดไป
                </p>
                <FormGrid>
                  <Field label="Password ใหม่" hint="อย่างน้อย 10 ตัวอักษร">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="ยืนยัน Password">
                    <input
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      disabled={busy}
                      autoComplete="new-password"
                    />
                  </Field>
                </FormGrid>
                <button
                  type="button"
                  className="btn btn-sm btn-light"
                  onClick={setPasswordOnly}
                  disabled={busy || !password || password !== confirm}
                >
                  <Icon name="lock" /> เปลี่ยนรหัสผ่าน
                </button>
              </Fieldset>
            )}

            {/* บล็อกสุดท้ายของกล่อง: อย่างเดียวที่นี่ที่พาบัญชีออกจากระบบ
                บัญชีที่กำลังล็อกอินอยู่ API ปฏิเสธเองอยู่แล้ว จึงไม่เสนอ */}
            {user && user.canSignIn && !isSelf && (
              <Fieldset legend="ยกเลิกบัญชีเข้าใช้งาน">
                {revokeProblem && <div className="note danger" role="alert">{revokeProblem}</div>}
                {confirmRevoke ? (
                  <>
                    <p className="muted">
                      {user.displayName} จะเข้าระบบไม่ได้อีก และสิทธิ์ทั้งหมดถูกถอด —
                      แต่ชื่อยังอยู่ในทุกรายการที่เคยคีย์ · เปิดบัญชีใหม่ให้ทีหลังได้
                    </p>
                    <Row>
                      <button type="button" className="btn btn-sm btn-danger" onClick={revoke} disabled={busy}>
                        <Icon name="check" /> ยืนยันยกเลิกบัญชี
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        onClick={() => setConfirmRevoke(false)}
                        disabled={busy}
                      >
                        ไม่เอาแล้ว
                      </button>
                    </Row>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-light"
                      onClick={() => setConfirmRevoke(true)}
                      disabled={busy}
                    >
                      <Icon name="trash" /> ยกเลิกบัญชีเข้าใช้งาน
                    </button>
                    <p className="muted" style={{ marginBottom: 0 }}>
                      ไม่มีการลบผู้ใช้ทิ้ง — ประวัติต้องอ่านชื่อคนคีย์ได้เสมอ
                      ถ้าแค่พักงานชั่วคราว ใช้ "ปิดใช้งาน" ข้างบนแทน
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
            <button className="btn" type="submit" disabled={busy || !canSubmit}>
              <Icon name="check" /> {busy ? 'กำลังบันทึก…' : user ? 'บันทึกการแก้ไข' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ รีเซ็ตรหัสผ่าน */

/**
 * รีเซ็ตรหัสผ่าน — ระบบสุ่มให้ แล้วแสดงครั้งเดียว
 *
 * รหัสดิบอยู่ในคำตอบของคำขอนี้ที่เดียว ไม่ได้ถูกเก็บไว้ที่ไหนอีกและอ่านย้อนหลัง
 * ไม่ได้ (บันทึกการใช้งานปิดทุกช่องที่ชื่อมีคำว่า password) · ปิดหน้าต่างก่อน
 * คัดลอกแปลว่าต้องกดรีเซ็ตใหม่ ซึ่งถูกแล้ว — รหัสที่ยังอ่านย้อนหลังได้ ไม่ใช่
 * รหัสชั่วคราว
 */
function ResetDialog({ user, onClose, onDone }) {
  const { ok } = useToast();
  const [password, setPassword] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') (password ? onDone() : onClose()); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onDone, password]);

  async function run() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await api.post(`/stock-api/users/${user.id}/reset-password`, {});
      setPassword(res.password);
      ok(`รีเซ็ตรหัสผ่านของ ${user.displayName} แล้ว`);
    } catch (ex) {
      setProblem(ex.message || 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      /* คลิปบอร์ดถูกปิดในบางเบราว์เซอร์/บริบท — รหัสยังอ่านจากจอได้อยู่
         จึงไม่ขึ้นข้อความผิดพลาด แค่ไม่เปลี่ยนปุ่มเป็น "คัดลอกแล้ว" */
    }
  }

  return (
    <div
      className="modal-back"
      onClick={(e) => { if (e.target === e.currentTarget) (password ? onDone() : onClose()); }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <h3>รีเซ็ตรหัสผ่าน — {user.displayName}</h3>
        <div className="m-body">
          {password ? (
            <>
              <p>รหัสผ่านใหม่ · แสดงครั้งเดียว ปิดหน้าต่างแล้วอ่านย้อนหลังไม่ได้</p>
              <p
                className="mono"
                style={{
                  fontSize: 'var(--t-lg)', letterSpacing: 1, padding: '10px 12px',
                  background: 'var(--surface-2, #f4f4f5)', borderRadius: 8, userSelect: 'all',
                }}
              >
                {password}
              </p>
              <Row>
                <button type="button" className="btn btn-sm btn-light" onClick={copy}>
                  <Icon name={copied ? 'check' : 'clipboard'} /> {copied ? 'คัดลอกแล้ว' : 'Copy'}
                </button>
              </Row>
              <p className="muted" style={{ marginBottom: 0 }}>
                {user.displayName} ใช้รหัสนี้เข้าระบบได้ครั้งเดียว แล้วระบบจะบังคับให้ตั้งรหัสของตัวเอง
                — รหัสที่คุณเพิ่งอ่านจึงใช้ต่อไม่ได้หลังจากนั้น
              </p>
            </>
          ) : (
            <>
              <p>
                ระบบจะสุ่มรหัสใหม่ให้ · รหัสเดิมของ {user.displayName} จะใช้ไม่ได้ทันที
              </p>
              {problem && <div className="note danger" role="alert">{problem}</div>}
            </>
          )}
        </div>
        <div className="m-foot">
          {password ? (
            <button type="button" className="btn" onClick={onDone}>เสร็จแล้ว</button>
          ) : (
            <>
              <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
                ยกเลิก
              </button>
              <button type="button" className="btn" onClick={run} disabled={busy}>
                <Icon name="lock" /> {busy ? 'กำลังรีเซ็ต…' : 'ยืนยัน'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* งานของแอดมิน — คนที่พิมพ์ URL เข้ามาตรง ๆ จะเห็นคำอธิบาย ไม่ใช่หน้าเปล่า */
export default function UsersPage() {
  return <AdminOnly zone="system"><UsersInner /></AdminOnly>;
}
