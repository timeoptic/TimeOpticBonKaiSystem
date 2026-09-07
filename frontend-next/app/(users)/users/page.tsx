"use client";

import { useMemo, useState } from "react";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import { useToast } from "@/stockmod/components/Toaster";
import SortHead, { SortBar, sortRows, useSort } from "@/stockmod/components/SortHead";
import PolicyTable from "@/stockmod/components/PolicyTable";
import RecordCard, { CardList } from "@/stockmod/components/RecordCard";
import { IconTrash } from "@/stockmod/components/Icon";
import Select from "@/stockmod/components/Select";
import { api, ApiError } from "@/stockmod/lib/api";
import { useApi } from "@/stockmod/lib/useApi";
import { count, date } from "@/stockmod/lib/format";

type SortKey = "added" | "name" | "username" | "job" | "role" | "active" | "movements" | "lastLogin";
const NATURAL_ASC: readonly SortKey[] = ["name", "username", "job", "role"];

/** The sort chooser above the table — where ชื่อผู้ใช้, ตำแหน่งงาน and เข้าล่าสุด
 *  still sort from, now that each is drawn inside another column. */
const SORTS: readonly { col: SortKey; label: string }[] = [
  { col: "added", label: "เพิ่มล่าสุด" },
  { col: "name", label: "ชื่อ" },
  { col: "username", label: "ชื่อผู้ใช้" },
  { col: "job", label: "ตำแหน่งงาน" },
  { col: "role", label: "สิทธิ์" },
  { col: "active", label: "สถานะ" },
  { col: "movements", label: "รายการที่ทำ" },
  { col: "lastLogin", label: "เข้าล่าสุด" },
];

type User = {
  id: number;
  username: string | null;
  displayName: string;
  jobTitle: string | null;
  role: string;
  roleLabel: string;
  isActive: boolean;
  canSignIn: boolean;
  employeeId: number | null;
  lastLoginAt: string | null;
  movements: number;
};

const PICK: Record<SortKey, (u: User) => string | number | null> = {
  // There is no "เพิ่มล่าสุด" column to click, so the id stands in for it — the
  // only record this list carries of the order the accounts were opened in.
  added: (u) => u.id,
  name: (u) => u.displayName,
  username: (u) => u.username,
  job: (u) => u.jobTitle,
  role: (u) => u.roleLabel,
  active: (u) => (u.isActive ? 1 : 0),
  movements: (u) => u.movements,
  lastLogin: (u) => u.lastLoginAt,
};

/**
 * บทบาททั้งหมด เรียงจากสิทธิ์มากไปน้อย
 *
 * `rank` ตรงกับ `Roles::RANK` ฝั่ง API และใช้กรองรายการนี้ให้เหลือเฉพาะบทบาทที่
 * คนที่กำลังกรอกฟอร์มตั้งให้คนอื่นได้จริง — API ปฏิเสธอยู่แล้วถ้าตั้งเกินตัว
 * แต่การโชว์ตัวเลือกที่จะถูกปฏิเสธแน่ ๆ คือการหลอกให้กดแล้วเจอ error
 */
const ROLES = [
  { key: "superuser", rank: 4, label: "ผู้ดูแลระบบ", note: "ทุกอย่างของเจ้าของร้าน บวกงานระบบ" },
  { key: "owner", rank: 3, label: "เจ้าของร้าน", note: "เห็นและทำได้ทุกอย่างในร้าน" },
  { key: "admin", rank: 2, label: "แอดมิน", note: "จัดการผู้ใช้ ต้นทุน แคตตาล็อก และแดชบอร์ด ทั้งสองฝั่ง" },
  { key: "sales", rank: 1, label: "พนักงานขาย", note: "เข้าระบบแล้วอยู่หน้าร้าน ไม่เห็นต้นทุน" },
  { key: "stock", rank: 1, label: "พนักงานคลัง", note: "เข้าระบบแล้วอยู่ฝั่งคลัง ไม่เห็นต้นทุน" },
] as const;

const RANK_OF: Record<string, number> = Object.fromEntries(ROLES.map((r) => [r.key, r.rank]));

export default function UsersPage() {
  const actor = useActor();
  const list = useApi<{ users: User[] }>(can.manageUsers(actor) ? "/users" : null);
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const { sort, dir, sortBy } = useSort<SortKey>("added", NATURAL_ASC);

  // Seven people, all of them already loaded — sorted here rather than by asking
  // the server to page a list that fits on one screen.
  const users = useMemo(() => {
    const all = list.status === "ready" ? list.data.users : [];
    return sortRows(all, (u) => PICK[sort](u), dir);
  }, [list, sort, dir]);

  // Every hook above this line, without exception. React matches hooks by call
  // order, so one behind a return is one that vanishes for the people who hit
  // that return — here, everybody who cannot manage accounts.
  if (!can.manageUsers(actor)) {
    return (
      <main className="work-main">
        <WorkHead title="จัดการผู้ใช้" />
        <div className="empty">
          <p className="empty__title">สิทธิ์ของคุณเข้าหน้านี้ไม่ได้</p>
          <p className="empty__body">
            แอดมิน เจ้าของร้าน และผู้ดูแลระบบเท่านั้นที่จัดการบัญชีผู้ใช้ได้ ติดต่อคนใดคนหนึ่งถ้าต้องใช้งาน
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="work-main">
      <WorkHead
        title="จัดการผู้ใช้"
        lede="ทุกคนที่ทำงานในร้านมีแถวที่นี่ — บางคนล็อกอินได้ บางคนมีไว้ให้บันทึกว่าใครทำรายการ"
      >
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
          เพิ่มผู้ใช้
        </button>
      </WorkHead>

      {list.status === "loading" ? <div className="skeleton" /> : null}

      {list.status === "error" ? (
        <div className="empty">
          <p className="empty__title">โหลดรายชื่อไม่ได้</p>
          <p className="empty__body">{list.error}</p>
          <button type="button" className="btn" onClick={list.reload}>ลองใหม่</button>
        </div>
      ) : null}

      {users.length > 0 ? (
        <SortBar id="users" columns={SORTS} sort={sort} dir={dir} onSort={sortBy} />
      ) : null}

      {users.length > 0 ? (
        <>
        {/* บนมือถือ ผู้ใช้หนึ่งคน = การ์ดหนึ่งใบ */}
        <CardList label="รายชื่อผู้ใช้ทั้งหมด">
          {users.map((u) => (
            <RecordCard
              key={u.id}
              tone={u.isActive ? undefined : "muted"}
              head={
                !u.isActive ? (
                  <span className="status status--out">ปิดใช้งาน</span>
                ) : u.canSignIn ? (
                  <span className="status status--stock">ล็อกอินได้</span>
                ) : (
                  <span className="status status--pending">ยังไม่มีบัญชี</span>
                )
              }
              title={u.displayName}
              sub={u.username ?? `#${u.id} · ไม่มีบัญชีล็อกอิน`}
              fields={[
                { label: "สิทธิ์", value: <span className="tag">{u.roleLabel}</span> },
                u.jobTitle ? { label: "ตำแหน่งงาน", value: u.jobTitle } : null,
                { label: "รายการที่ทำ", value: count(u.movements) },
                {
                  label: "เข้าล่าสุด",
                  value: u.lastLoginAt ? date(u.lastLoginAt) : <span className="grid__muted">ยังไม่เคยเข้า</span>,
                },
              ]}
              actions={
                <button type="button" className="btn btn--small" onClick={() => setEditing(u)}>
                  แก้ไขผู้ใช้
                </button>
              }
            />
          ))}
        </CardList>

        <div className="tablewrap wide-only">
          <table className="grid">
            <caption className="sr-only">รายชื่อผู้ใช้ทั้งหมด</caption>
            <thead>
              <tr>
                {/* Five columns, not eight. The username sits under the name it
                    belongs to, the job title under the role, and the last sign-in
                    under the tally of what the person has done — each next to
                    what it qualifies. Every one of them still sorts, from the
                    chooser above the table. */}
                <SortHead label="ชื่อ / ชื่อผู้ใช้" col="name" sort={sort} dir={dir} onSort={sortBy} />
                <SortHead label="สิทธิ์ / ตำแหน่งงาน" col="role" sort={sort} dir={dir} onSort={sortBy} />
                <SortHead label="สถานะ" col="active" sort={sort} dir={dir} onSort={sortBy} />
                <SortHead label="รายการที่ทำ" col="movements" sort={sort} dir={dir} onSort={sortBy} num />
                <th scope="col"><span className="sr-only">จัดการ</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.isActive ? "grid__row" : "grid__row grid__row--muted"}>
                  <th scope="row">
                    <span className="grid__name">{u.displayName}</span>
                    <span className="grid__sub">
                      {u.username ?? `#${u.id} · ไม่มีบัญชีล็อกอิน`}
                    </span>
                  </th>
                  <td>
                    <span className="tag">{u.roleLabel}</span>
                    {u.jobTitle ? <span className="grid__sub">{u.jobTitle}</span> : null}
                  </td>
                  <td>
                    {!u.isActive ? (
                      <span className="status status--out">ปิดใช้งาน</span>
                    ) : u.canSignIn ? (
                      <span className="status status--stock">ล็อกอินได้</span>
                    ) : (
                      <span className="status status--pending">ยังไม่มีบัญชี</span>
                    )}
                  </td>
                  <td className="grid__num">
                    <span className="grid__name">{count(u.movements)}</span>
                    <span className="grid__sub">
                      {u.lastLoginAt ? `เข้าล่าสุด ${date(u.lastLoginAt)}` : "ยังไม่เคยเข้า"}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="btn btn--quiet btn--small" onClick={() => setEditing(u)}>
                      แก้ไข
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : null}

      {creating ? (
        <UserDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
        />
      ) : null}

      {editing ? (
        <UserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}

      {/* The rules themselves, under the people they apply to — so "who is this
          person" and "what does that let them do" are answered on one screen. */}
      <section className="policy">
        <h2 className="drawer__legend">สิทธิ์ของแต่ละบทบาท</h2>
        <PolicyTable />
      </section>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function UserDialog({
  user,
  onClose,
  onSaved,
}: {
  user?: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const actor = useActor();
  const isSelf = user?.id === actor.id;

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [role, setRole] = useState<string>(user?.role ?? "sales");
  /* ตั้งบทบาทได้ไม่เกินของตัวเอง ตามกฎเดียวกับที่ API บังคับ (Roles::canGrant) */
  const grantable = ROLES.filter((r) => r.rank <= (RANK_OF[actor.role] ?? 0));
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /* แยกจาก `problem` เพราะ notice ของฟอร์มอยู่เหนือกล่องนี้ขึ้นไปสองบล็อก
     เหตุผลที่ลบไม่ได้คือสิ่งที่ต้องอ่าน — วางไว้ตรงปุ่มที่เพิ่งกด */
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);
  const toast = useToast();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (user) {
        await api.post(`/users/${user.id}/update`, {
          display_name: displayName.trim(),
          job_title: jobTitle.trim() || null,
          username: username.trim() || null,
          role,
          is_active: isActive,
        });
      } else {
        await api.post("/users", {
          display_name: displayName.trim(),
          job_title: jobTitle.trim() || null,
          username: username.trim() || null,
          password: username.trim() ? password : null,
          role,
        });
      }
      /* บัญชีที่ไม่มีชื่อผู้ใช้เข้าระบบไม่ได้ — เป็นชื่อไว้ลงในสมุดเฉย ๆ ซึ่งเป็น
         สิ่งที่คนเพิ่งกดบันทึกมักไม่ได้ตั้งใจ ถ้าตั้งใจจะเพิ่มคนเข้าใช้งาน */
      if (username.trim() === "") {
        toast.warning({
          text: `${user ? "แก้" : "เพิ่ม"}บัญชี ${displayName.trim()} แล้ว — ยังเข้าระบบไม่ได้`,
          detail: "ไม่มีชื่อผู้ใช้ จึงเป็นชื่อสำหรับบันทึกในสมุดเท่านั้น",
        });
      } else if (!isActive && user) {
        toast.warning({
          text: `แก้บัญชี ${displayName.trim()} แล้ว — บัญชีนี้ปิดใช้งานอยู่`,
          detail: "เข้าระบบไม่ได้จนกว่าจะเปิดใช้งานใหม่",
        });
      } else {
        toast.success({ text: `${user ? "แก้" : "เพิ่ม"}บัญชี ${displayName.trim()} แล้ว` });
      }
      onSaved();
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  }

  async function setPasswordOnly() {
    if (!user) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      await api.post(`/users/${user.id}/password`, { password });
      setDone(`ตั้งรหัสผ่านใหม่ให้ ${user.displayName} แล้ว`);
      toast.success({ text: `ตั้งรหัสผ่านใหม่ให้ ${user.displayName} แล้ว` });
      setPassword("");
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "ตั้งรหัสผ่านไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Only ever gets through for someone the ledger does not point at — the API
   * counts the traces and refuses the rest by number, and that refusal is what
   * lands in `problem`. Asking twice first is the local half of the same care:
   * a person is a name printed on every movement they keyed, and the confirm is
   * cheaper than finding out which ones the hard way.
   */
  async function remove() {
    if (!user) return;
    setBusy(true);
    setDeleteProblem(null);
    setDone(null);
    try {
      await api.post(`/users/${user.id}/delete`);
      toast.success({ text: `ลบบัญชี ${user.displayName} แล้ว` });
      onSaved();
    } catch (err) {
      setDeleteProblem(ApiError.is(err) ? err.message : "ลบไม่สำเร็จ");
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={user ? "แก้ไขผู้ใช้" : "เพิ่มผู้ใช้"}>
      <div className="modal__card">
        <header className="drawer__head" style={{ position: "static", margin: 0 }}>
          <div>
            <p className="drawer__eyebrow">{user ? `#${user.id}` : "ผู้ใช้ใหม่"}</p>
            <h2 className="drawer__title">{user ? user.displayName : "เพิ่มผู้ใช้"}</h2>
          </div>
          <button type="button" className="btn btn--quiet btn--small" onClick={onClose}>ปิด</button>
        </header>

        <form onSubmit={save} noValidate>
          <div className="formgrid">
            <div className="field">
              <label className="field__label" htmlFor="uf-name">ชื่อที่แสดง</label>
              <input id="uf-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="uf-job">ตำแหน่งงาน</label>
              <input
                id="uf-job"
                className="input"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="เช่น technician, reception"
                disabled={busy}
              />
              <span className="field__help">อธิบายว่าทำงานอะไร ไม่มีผลต่อสิทธิ์</span>
            </div>
          </div>

          <div className="formgrid">
            <div className="field">
              <label className="field__label" htmlFor="uf-user">ชื่อผู้ใช้</label>
              <input
                id="uf-user"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="เว้นว่างถ้ายังไม่ต้องล็อกอิน"
                disabled={busy}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="uf-role">สิทธิ์</label>
              <Select
                id="uf-role"
                value={role}
                onChange={setRole}
                disabled={busy || isSelf}
                options={grantable.map((r) => ({ value: r.key, label: r.label }))}
              />
              <span className="field__help">
                {isSelf ? "ลดสิทธิ์ตัวเองไม่ได้" : ROLES.find((r) => r.key === role)?.note}
              </span>
            </div>
          </div>

          {!user ? (
            <div className="field">
              <label className="field__label" htmlFor="uf-pass">รหัสผ่าน</label>
              <input
                id="uf-pass"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={username.trim() ? "อย่างน้อย 10 ตัวอักษร" : "ไม่ต้องใส่ ถ้ายังไม่ให้ล็อกอิน"}
                disabled={busy || !username.trim()}
              />
            </div>
          ) : null}

          {user ? (
            <div className="field">
              <label className="field__label" htmlFor="uf-active">สถานะ</label>
              <Select
                id="uf-active"
                value={isActive ? "1" : "0"}
                onChange={(v) => setIsActive(v === "1")}
                disabled={busy || isSelf}
                options={[
                  { value: "1", label: "ใช้งานอยู่" },
                  { value: "0", label: "ปิดใช้งาน" },
                ]}
              />
              <span className="field__help">
                {isSelf ? "ปิดบัญชีตัวเองไม่ได้" : "ปิดแทนการลบ เพราะประวัติต้องอ่านย้อนหลังได้ — คนที่ยังไม่เคยทำอะไรเลย ลบได้ข้างล่าง"}
              </span>
            </div>
          ) : null}

          {problem ? <div className="notice notice--error" role="alert">{problem}</div> : null}
          {done ? <div className="notice notice--ok" role="status">{done}</div> : null}

          <div className="chips">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "กำลังบันทึก…" : user ? "บันทึกการแก้ไข" : "เพิ่มผู้ใช้"}
            </button>
          </div>
        </form>

        {user ? (
          <div className="drawer__danger">
            <h3 className="drawer__legend">ตั้งรหัสผ่านใหม่</h3>
            <div className="formgrid" style={{ width: "100%" }}>
              <div className="field">
                <label className="field__label" htmlFor="uf-newpass">รหัสผ่านใหม่</label>
                <input
                  id="uf-newpass"
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="อย่างน้อย 10 ตัวอักษร"
                  disabled={busy || !user.username}
                />
                {!user.username ? (
                  <span className="field__help">ต้องตั้งชื่อผู้ใช้ก่อนจึงจะตั้งรหัสผ่านได้</span>
                ) : null}
              </div>
            </div>
            <button type="button" className="btn btn--small" onClick={setPasswordOnly} disabled={busy || !password || !user.username}>
              ตั้งรหัสผ่าน
            </button>
          </div>
        ) : null}

        {/* Last block on the card, below the password one: deleting is the only
            thing here that cannot be undone, and it should not sit where a thumb
            aiming for "บันทึกการแก้ไข" can reach it. Nothing to delete on the
            form that is still creating a person, and the account you are signed
            in as is refused by the API anyway — so it is not offered. */}
        {user && !isSelf ? (
          <div className="drawer__danger">
            <h3 className="drawer__legend">ลบผู้ใช้</h3>
            {deleteProblem ? (
              <div className="notice notice--error" role="alert">{deleteProblem}</div>
            ) : null}
            {confirmDelete ? (
              <>
                <p className="field__help">ลบ {user.displayName} ถาวร — ทำแล้วย้อนไม่ได้</p>
                <div className="chips">
                  <button
                    type="button"
                    className="btn btn--danger btn--small btn--icon"
                    onClick={remove}
                    disabled={busy}
                  >
                    <IconTrash />
                    ยืนยันลบ
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet btn--small"
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
                  className="btn btn--danger-quiet btn--small btn--icon"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                >
                  <IconTrash />
                  ลบผู้ใช้นี้
                </button>
                <span className="field__help">
                  ลบได้เฉพาะคนที่ยังไม่เคยทำรายการและไม่เคยรับของ — คนที่มีประวัติแล้วให้ปิดใช้งานแทน
                  ประวัติจะได้ยังอ่านชื่อได้
                </span>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
