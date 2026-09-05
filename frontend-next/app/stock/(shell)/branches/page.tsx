"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import { useToast } from "@/stockmod/components/Toaster";
import SortHead, { SortBar, sortRows, useSort } from "@/stockmod/components/SortHead";
import { IconTrash } from "@/stockmod/components/Icon";
import Select from "@/stockmod/components/Select";
import { api, ApiError, type BranchRow } from "@/stockmod/lib/api";
import { useApi } from "@/stockmod/lib/useApi";
import { count } from "@/stockmod/lib/format";

type SortKey = "added" | "name" | "contact" | "pending" | "active";

/** The sort chooser above the table — where ติดต่อ still sorts from. */
const SORTS: readonly { col: SortKey; label: string }[] = [
  { col: "added", label: "เพิ่มล่าสุด" },
  { col: "name", label: "ชื่อสาขา" },
  { col: "contact", label: "ติดต่อ" },
  { col: "pending", label: "จำนวนใบเบิก" },
  { col: "active", label: "สถานะ" },
];
const NATURAL_ASC: readonly SortKey[] = ["name", "contact"];

const PICK: Record<SortKey, (b: BranchRow) => string | number | null> = {
  // There is no "เพิ่มล่าสุด" column to click, so the id stands in for it — the
  // only record this list carries of the order the branches were added in.
  added: (b) => b.id,
  name: (b) => b.name,
  contact: (b) => b.contact,
  pending: (b) => b.pendingCount,
  active: (b) => (b.isActive ? 1 : 0),
};

/**
 * The other shops that come and take stock from this one.
 *
 * A short list that changes once or twice a year — no search, no pages, no
 * filters. Building those would be building for a table that will never have
 * thirty rows in it.
 *
 * Nothing here deletes. A branch that closes gets switched off, because its old
 * withdrawals still have to be readable and settleable afterwards.
 */
export default function BranchesPage() {
  const actor = useActor();
  const mayEdit = actor.role === "owner";
  const money$ = can.seeCost(actor);
  const list = useApi<{ branches: BranchRow[] }>("/branches");
  const [adding, setAdding] = useState(false);
  const { sort, dir, sortBy } = useSort<SortKey>("added", NATURAL_ASC);

  // A dozen rows at most, all of them already here — sorting them in the browser
  // costs nothing and saves a round trip.
  const rows = useMemo(() => {
    const all = list.status === "ready" ? list.data.branches : [];
    return sortRows(all, (b) => PICK[sort](b), dir);
  }, [list, sort, dir]);

  return (
    <main className="work-main">
      <WorkHead
        title="สาขา"
        lede="รายชื่อสาขาที่มาเบิกของจากคลังนี้ได้ · ต้นทุนของที่เบิกไปอ่านได้ที่หน้าของที่สาขาเบิกไป"
      >
        {mayEdit ? (
          <button type="button" className="btn btn--primary" onClick={() => setAdding((v) => !v)}>
            {adding ? "ปิดฟอร์ม" : "เพิ่มสาขา"}
          </button>
        ) : null}
        <Link href="/stock/settlements" className="btn">
          ของที่สาขาเบิกไป
        </Link>
      </WorkHead>

      {!mayEdit ? (
        <div className="notice" role="status">
          เฉพาะเจ้าของร้านเท่านั้นที่เพิ่มหรือแก้ไขสาขาได้ — คุณดูได้อย่างเดียว
        </div>
      ) : null}

      {adding ? (
        <section className="task">
          <h2 className="drawer__legend">สาขาใหม่</h2>
          <BranchForm
            onSaved={() => {
              setAdding(false);
              list.reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </section>
      ) : null}

      {list.status === "loading" ? <div className="skeleton" /> : null}

      {list.status === "error" ? (
        <div className="empty">
          <p className="empty__title">โหลดรายชื่อสาขาไม่ได้</p>
          <p className="empty__body">{list.error}</p>
          <button type="button" className="btn" onClick={list.reload}>
            ลองใหม่
          </button>
        </div>
      ) : null}

      {list.status === "ready" && list.data.branches.length === 0 ? (
        <div className="empty">
          <p className="empty__title">ยังไม่มีสาขาในระบบ</p>
          <p className="empty__body">
            เพิ่มสาขาก่อน แล้วหน้าเบิกจะมีตัวเลือก “สาขาอื่นมาเบิก” ให้เลือก
          </p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <SortBar id="branch" columns={SORTS} sort={sort} dir={dir} onSort={sortBy} />
      ) : null}

      {rows.length > 0 ? (
        <div className="tablewrap">
          <table className="grid">
            <caption className="sr-only">รายชื่อสาขา</caption>
            <thead>
              <tr>
                {/* ติดต่อ is under the branch name it belongs to, which is a
                    column back and one less place to look. It still sorts, from
                    the chooser above the table. */}
                <SortHead label="สาขา / ติดต่อ" col="name" sort={sort} dir={dir} onSort={sortBy} />
                <SortHead label="ใบเบิก" col="pending" sort={sort} dir={dir} onSort={sortBy} num />
                <SortHead label="สถานะ" col="active" sort={sort} dir={dir} onSort={sortBy} />
                <th scope="col">
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
<BranchRowView key={b.id} branch={b} mayEdit={mayEdit} onDone={list.reload} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}

function BranchRowView({
  branch,
  mayEdit,
  onDone,
}: {
  branch: BranchRow;
  mayEdit: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        className={
          branch.pendingCount > 0
            ? "grid__row grid__row--pending"
            : branch.isActive
              ? "grid__row"
              : "grid__row grid__row--muted"
        }
      >
        <th scope="row">
          <span className="grid__name">{branch.name}</span>
          <span className="grid__sub">{branch.contact ?? "ไม่มีข้อมูลติดต่อ"}</span>
          {branch.note ? <span className="grid__sub">{branch.note}</span> : null}
        </th>
        <td className="grid__num">
          {branch.pendingCount === 0 ? (
            <span className="grid__muted">—</span>
          ) : (
            <Link href={`/stock/settlements?branch=${branch.id}`} className="grid__link">
              {count(branch.pendingCount)} รายการ
            </Link>
          )}
        </td>
        <td>
          {branch.isActive ? (
            <span className="status status--stock">เปิดใช้งาน</span>
          ) : (
            <span className="status status--out">ปิดแล้ว</span>
          )}
        </td>
        <td>
          {mayEdit ? (
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? "ปิด" : "แก้"}
            </button>
          ) : null}
        </td>
      </tr>

      {open ? (
        <tr className="grid__row">
          <td colSpan={4}>
            <div className="lotedit">
              <BranchForm
                branch={branch}
                onSaved={() => {
                  setOpen(false);
                  onDone();
                }}
                onCancel={() => setOpen(false)}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BranchForm({
  branch,
  onSaved,
  onCancel,
}: {
  branch?: BranchRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(branch?.name ?? "");
  const [contact, setContact] = useState(branch?.contact ?? "");
  const [note, setNote] = useState(branch?.note ?? "");
  const [active, setActive] = useState(branch?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const body = {
        name: name.trim(),
        contact: contact.trim() || null,
        note: note.trim() || null,
        is_active: active,
      };
      await api.post(branch ? `/branches/${branch.id}/update` : "/branches", body);
      toast.success({
        text: branch ? `แก้สาขา ${body.name} แล้ว` : `เพิ่มสาขา ${body.name} แล้ว`,
        detail: active ? undefined : "สาขานี้ปิดใช้งานอยู่ — เบิกของใหม่ไม่ได้",
      });
      onSaved();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Only ever reaches the API for a branch that never traded — the API refuses
   * the rest, by name and by count, and that refusal is what lands in
   * `problem`. Asking twice is the local half of the same care: a branch is a
   * row someone else's withdrawals point at, and the confirm is cheaper than
   * finding out which ones.
   */
  async function remove() {
    if (branch === undefined) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/branches/${branch.id}/delete`);
      toast.success({ text: `ลบสาขา ${branch.name} แล้ว` });
      onSaved();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "ลบไม่สำเร็จ");
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const id = branch ? `b-${branch.id}` : "b-new";

  return (
    <form onSubmit={save} noValidate>
      <div className="formgrid">
        <div className="field">
          <label className="field__label" htmlFor={`${id}-name`}>
            ชื่อสาขา
          </label>
          <input
            id={`${id}-name`}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-contact`}>
            ติดต่อ
          </label>
          <input
            id={`${id}-contact`}
            className="input"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="เบอร์โทร ไลน์ หรือชื่อคนที่ติดต่อได้"
            disabled={busy}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-note`}>
          หมายเหตุ
        </label>
        <input
          id={`${id}-note`}
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />
      </div>

      {branch ? (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-active`}>
            สถานะ
          </label>
          <Select
            id={`${id}-active`}
            value={active ? "1" : "0"}
            onChange={(v) => setActive(v === "1")}
            disabled={busy}
            options={[
              { value: "1", label: "เปิดใช้งาน — เบิกของได้" },
              { value: "0", label: "ปิด — เบิกใหม่ไม่ได้ แต่ประวัติยังอยู่" },
            ]}
          />
          <span className="field__help">
            ปิดสาขาที่ยังมีรายการค้างอยู่ไม่ได้ — ดูรายการได้ที่หน้าของที่สาขาเบิกไป
          </span>
        </div>
      ) : null}

      {problem ? (
        <div className="notice notice--error" role="alert">
          {problem}
        </div>
      ) : null}

      <div className="chips">
        <button type="submit" className="btn btn--primary btn--small" disabled={busy || name.trim() === ""}>
          {busy ? "กำลังบันทึก…" : branch ? "บันทึก" : "เพิ่มสาขา"}
        </button>
        <button type="button" className="btn btn--quiet btn--small" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </button>
      </div>

      {/* Below the save row, not beside it: deleting is the one thing here that
          cannot be undone, and it should not sit where a thumb aiming for
          "บันทึก" can reach it. Only for a branch that exists — there is nothing
          to delete on the form that is still creating one. */}
      {branch ? (
        <div className="drawer__danger">
          {confirmDelete ? (
            <>
              <p className="field__help">ลบ {branch.name} ถาวร — ทำแล้วย้อนไม่ได้</p>
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
                ลบสาขานี้
              </button>
              <span className="field__help">
                ลบได้เฉพาะสาขาที่ยังไม่เคยเบิกของ — ที่เคยเบิกแล้วให้ปิดใช้งานแทน ประวัติจะได้ยังอ่านได้
              </span>
            </>
          )}
        </div>
      ) : null}
    </form>
  );
}
