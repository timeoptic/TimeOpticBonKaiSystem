"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useActor, WorkHead } from "@/stockmod/components/AppShell";
import ProductPicker from "@/stockmod/components/ProductPicker";
import Select from "@/stockmod/components/Select";
import TaskDialog from "@/stockmod/components/TaskDialog";
import { useToast } from "@/stockmod/components/Toaster";
import { api, ApiError, type ProductRow } from "@/stockmod/lib/api";
import { useApi } from "@/stockmod/lib/useApi";
import { count, dateTime } from "@/stockmod/lib/format";
import { can } from "@/lib/roles.js";
import { NewOrderDialog, type RxDraft } from "@/app/stock/(shell)/rx/page";

/**
 * คำขอตัดเลนส์จากสาขา — ร้านขอไว้ 27 ต.ค. 2026
 *
 * หน้าเดียวสองฝั่ง: บัญชีสาขา (`issue.request`) กรอกคำขอและดูสถานะของตัวเอง ·
 * แอดมิน/เจ้าของร้าน (`issue.approve`) ตรวจ แก้ค่าได้ทุกช่อง แล้วกดยืนยัน ระบบจึงตัดสต็อก
 * หรือเปิดใบสั่ง RX ผ่านทางเดิม · ตีกลับมีไว้สำหรับคำขอที่ผิดทั้งใบ ไม่ใช่ให้สาขากรอกใหม่
 * เพราะค่าที่ผิดเล็กน้อยแอดมินแก้เองได้เลย
 *
 * บัญชีไม่ผูกสาขา — เลือกสาขาในฟอร์มทุกครั้ง (ไม่มี Bewell) และแอดมินเปลี่ยนได้ตอนตรวจ
 */

type Branch = { id: number; name: string };
type Item = { sku: string; quantity: number; name?: string | null; onHand?: number };
type IssueBody = { items: Item[]; reference_doc?: string | null; note?: string | null };

type Request = {
  id: number;
  code: string;
  kind: "issue" | "rx";
  status: "pending" | "approved" | "rejected" | "cancelled";
  branchId: number;
  branchName: string;
  requester: string | null;
  reviewer: string | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
  body: IssueBody & RxDraft;
  original: IssueBody & RxDraft;
  edited: boolean;
  result: { referenceDoc?: string; name?: string };
  /** ตัดแล้วแต่คลังย้อนทีหลัง (คืนของ ยกเลิก/ลบใบ RX เจียร์เสีย) — อ่านสดจากรายการจริง */
  undone: { state: "cancelled" | "partial" | "deleted" | "scrapped"; at: string | null; note: string | null } | null;
};

const UNDONE: Record<NonNullable<Request["undone"]>["state"], { label: string; cls: string }> = {
  cancelled: { label: "ยกเลิกแล้ว", cls: "status--out" },
  partial: { label: "คืนบางรายการ", cls: "status--low" },
  deleted: { label: "ใบถูกลบ", cls: "status--out" },
  scrapped: { label: "เจียร์เสีย", cls: "status--low" },
};

const STATUS: Record<Request["status"], { label: string; cls: string }> = {
  pending: { label: "รอตรวจ", cls: "status--pending" },
  approved: { label: "ตัดแล้ว", cls: "status--stock" },
  rejected: { label: "ตีกลับ", cls: "status--low" },
  cancelled: { label: "ยกเลิก", cls: "status--out" },
};

const EYE: Record<string, string> = { right: "R", left: "L" };

function rxSummary(b: RxDraft): string {
  const lens = [b.brand, b.lens_model, b.lens_design].filter(Boolean).join(" ");
  const power = [
    b.sph ? `SPH ${b.sph}` : null,
    b.cyl ? `CYL ${b.cyl}` : null,
    b.axis ? `AX ${b.axis}` : null,
    b.add ? `ADD ${b.add}` : null,
  ].filter(Boolean).join(" ");
  return [b.eye_side ? EYE[b.eye_side] : null, lens, power].filter(Boolean).join(" · ");
}

function itemsSummary(b: IssueBody): string {
  return (b.items ?? []).map((i) => `${i.name ?? i.sku} ×${count(i.quantity)}`).join(", ");
}

function summary(r: Request): string {
  return r.kind === "rx" ? rxSummary(r.body) : itemsSummary(r.body);
}

export default function RequestsPage() {
  const actor = useActor();
  if (can(actor, "issue.approve")) return <ReviewDesk />;
  if (can(actor, "issue.request")) return <BranchDesk />;
  return (
    <main className="work-main">
      <WorkHead title="คำขอจากสาขา" />
      <div className="empty">
        <p className="empty__title">บัญชีนี้ไม่มีสิทธิ์ในหน้านี้</p>
      </div>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────── ฝั่งสาขา */

function BranchDesk() {
  const toast = useToast();
  const [q, applied, setQ] = useSearch();
  const mine = useApi<{ branches: Branch[]; defaultBranchId: number | null; requests: Request[] }>(
    `/issue-requests/mine${applied ? `?q=${encodeURIComponent(applied)}` : ""}`,
  );
  const [open, setOpen] = useState<"issue" | "rx" | null>(null);
  const branches = mine.status === "ready" ? mine.data.branches : [];
  const preset = mine.status === "ready" ? mine.data.defaultBranchId : null;

  async function send(kind: "issue" | "rx", branchId: number | null | undefined, body: IssueBody | RxDraft) {
    const { request } = await api.post<{ request: Request }>("/issue-requests", { kind, branch_id: branchId, body });
    setOpen(null);
    toast.success({ text: `ส่งคำขอ ${request.code} แล้ว`, detail: "รอแอดมินตรวจและยืนยันการตัด" });
    mine.reload();
  }

  async function cancel(r: Request) {
    try {
      await api.post(`/issue-requests/${r.id}/cancel`);
      toast.info({ text: `ยกเลิก ${r.code} แล้ว` });
    } catch (e) {
      toast.error({ text: ApiError.is(e) ? e.message : "ยกเลิกไม่สำเร็จ" });
    }
    mine.reload();
  }

  return (
    <main className="work-main">
      <WorkHead title="ขอตัดเลนส์" lede="เลือกสาขาในฟอร์ม — คำขอจะยังไม่ตัดสต็อกจนกว่าแอดมินจะยืนยัน">
        <button type="button" className="btn" disabled={branches.length === 0} onClick={() => setOpen("rx")}>
          ขอสั่งตัด RX
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={branches.length === 0}
          onClick={() => setOpen("issue")}
        >
          ขอเบิกเลนส์จากสต็อก
        </button>
      </WorkHead>

      <div className="listtools">
        <SearchBox q={q} setQ={setQ} />
      </div>

      {mine.status === "loading" ? <div className="skeleton" /> : null}
      {mine.status === "error" ? (
        <div className="empty">
          <p className="empty__title">โหลดคำขอไม่ได้</p>
          <p className="empty__body">{mine.error}</p>
          <button type="button" className="btn" onClick={mine.reload}>ลองใหม่</button>
        </div>
      ) : null}

      {mine.status === "ready" && mine.data.requests.length === 0 ? (
        <div className="empty">
          <p className="empty__title">{applied ? `ไม่พบคำขอที่ตรงกับ “${applied}”` : "ยังไม่มีคำขอ"}</p>
          {applied ? null : (
            <p className="empty__body">กดปุ่มด้านบนเพื่อขอเบิกเลนส์จากสต็อก หรือขอสั่งตัด RX</p>
          )}
        </div>
      ) : null}

      {mine.status === "ready" && mine.data.requests.length > 0 ? (
        <RequestTable
          rows={mine.data.requests}
          actions={(r) =>
            r.status === "pending" ? (
              <button type="button" className="btn btn--small" onClick={() => void cancel(r)}>
                ยกเลิกคำขอ
              </button>
            ) : undefined
          }
        />
      ) : null}

      {open === "issue" ? (
        <BasketDialog
          eyebrow="คำขอเบิกจากสต็อก"
          branches={branches}
          branchId={preset}
          submitLabel="ส่งคำขอ"
          onClose={() => setOpen(null)}
          onSubmit={(body, branchId) => send("issue", branchId, body)}
        />
      ) : null}

      {open === "rx" ? (
        <NewOrderDialog
          mayCost={false}
          onClose={() => setOpen(null)}
          onSaved={() => undefined}
          request={{
            initial: { branch_id: preset },
            branches,
            eyebrow: "คำขอสั่งตัด RX",
            submitLabel: "ส่งคำขอ",
            send: ({ branch_id, ...body }) => send("rx", branch_id, body),
          }}
        />
      ) : null}
    </main>
  );
}

/* ─────────────────────────────────────────────────────────── ฝั่งแอดมิน */

function ReviewDesk() {
  const toast = useToast();
  const [tab, setTab] = useState<"pending" | "done" | "all">("pending");
  const [q, applied, setQ] = useSearch();
  const list = useApi<{ requests: Request[]; branches: Branch[] }>(
    `/issue-requests?status=${tab}${applied ? `&q=${encodeURIComponent(applied)}` : ""}`,
  );
  const branches = list.status === "ready" ? list.data.branches : [];
  const [editing, setEditing] = useState<Request | null>(null);
  const [rejecting, setRejecting] = useState<Request | null>(null);
  /* คนตรวจที่ถือ issue.request ด้วย (เช่นเจ้าของร้านที่ได้บทบาท "ผู้ใช้สาขา" เพิ่ม) ส่งคำขอเองได้
     จากหน้านี้ — ร้านขอ 3 พ.ย. 2026 ให้บัญชี Japiica กดขอตัดเลนส์ได้ */
  const mayRequest = can(useActor(), "issue.request");
  const [asking, setAsking] = useState<"issue" | "rx" | null>(null);

  async function send(kind: "issue" | "rx", branchId: number | null | undefined, body: IssueBody | RxDraft) {
    const { request } = await api.post<{ request: Request }>("/issue-requests", { kind, branch_id: branchId, body });
    setAsking(null);
    toast.success({ text: `ส่งคำขอ ${request.code} แล้ว`, detail: "อยู่ในแท็บรอตรวจ" });
    list.reload();
  }

  async function approve(r: Request, branchId: number | null | undefined, body: IssueBody | RxDraft) {
    const { request } = await api.post<{ request: Request }>(`/issue-requests/${r.id}/approve`, {
      body,
      branch_id: branchId,
    });
    setEditing(null);
    toast.success({
      text: `ยืนยัน ${request.code} แล้ว — ${request.branchName}`,
      detail: request.result.referenceDoc ? `เลขเอกสาร ${request.result.referenceDoc}` : undefined,
    });
    list.reload();
  }

  return (
    <main className="work-main">
      <WorkHead
        title="คำขอจากสาขา"
        lede="ตรวจ แก้ค่าได้ทุกช่อง แล้วกดยืนยัน ระบบจึงตัดสต็อกหรือเปิดใบสั่ง RX ให้สาขานั้น"
      >
        {mayRequest ? (
          <>
            <button type="button" className="btn" disabled={branches.length === 0} onClick={() => setAsking("rx")}>
              ขอสั่งตัด RX
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={branches.length === 0}
              onClick={() => setAsking("issue")}
            >
              ขอเบิกเลนส์จากสต็อก
            </button>
          </>
        ) : null}
      </WorkHead>

      {asking === "issue" ? (
        <BasketDialog
          eyebrow="คำขอเบิกจากสต็อก"
          branches={branches}
          branchId={null}
          submitLabel="ส่งคำขอ"
          onClose={() => setAsking(null)}
          onSubmit={(body, branchId) => send("issue", branchId, body)}
        />
      ) : null}

      {asking === "rx" ? (
        <NewOrderDialog
          mayCost={false}
          onClose={() => setAsking(null)}
          onSaved={() => undefined}
          request={{
            initial: { branch_id: null },
            branches,
            eyebrow: "คำขอสั่งตัด RX",
            submitLabel: "ส่งคำขอ",
            send: ({ branch_id, ...body }) => send("rx", branch_id, body),
          }}
        />
      ) : null}

      <div className="listtools">
        <div className="chips chips--tight" role="group" aria-label="สถานะคำขอ">
          <button
            type="button"
            className="chip chip--flat"
            aria-current={tab === "pending" ? "true" : undefined}
            onClick={() => setTab("pending")}
          >
            รอตรวจ
            {tab === "pending" && list.status === "ready" ? (
              <span className="chip__count"> {count(list.data.requests.length)}</span>
            ) : null}
          </button>
          <button
            type="button"
            className="chip chip--flat"
            aria-current={tab === "done" ? "true" : undefined}
            onClick={() => setTab("done")}
          >
            ตรวจแล้ว
          </button>
          <button
            type="button"
            className="chip chip--flat"
            aria-current={tab === "all" ? "true" : undefined}
            onClick={() => setTab("all")}
          >
            ทั้งหมด
          </button>
        </div>
        <SearchBox q={q} setQ={setQ} />
      </div>

      {list.status === "loading" ? <div className="skeleton" /> : null}
      {list.status === "error" ? (
        <div className="empty">
          <p className="empty__title">โหลดคำขอไม่ได้</p>
          <p className="empty__body">{list.error}</p>
          <button type="button" className="btn" onClick={list.reload}>ลองใหม่</button>
        </div>
      ) : null}
      {list.status === "ready" && list.data.requests.length === 0 ? (
        <div className="empty">
          <p className="empty__title">
            {applied
              ? `ไม่พบคำขอที่ตรงกับ “${applied}”`
              : tab === "pending"
                ? "ไม่มีคำขอรอตรวจ"
                : tab === "done"
                  ? "ยังไม่มีคำขอที่ตรวจแล้ว"
                  : "ยังไม่มีคำขอ"}
          </p>
        </div>
      ) : null}
      {list.status === "ready" && list.data.requests.length > 0 ? (
        <RequestTable
          rows={list.data.requests}
          actions={(r) =>
            r.status === "pending" ? (
              <>
                <button type="button" className="btn btn--small" onClick={() => setRejecting(r)}>
                  ตีกลับ
                </button>
                <button type="button" className="btn btn--primary btn--small" onClick={() => setEditing(r)}>
                  ตรวจ / แก้ / ยืนยัน
                </button>
              </>
            ) : undefined
          }
        />
      ) : null}

      {editing?.kind === "issue" ? (
        <BasketDialog
          eyebrow={`ตรวจคำขอ ${editing.code} · ${editing.requester ?? ""}`}
          branches={branches}
          branchId={editing.branchId}
          initial={editing.body}
          submitLabel="ยืนยันตัด"
          onClose={() => setEditing(null)}
          onSubmit={(body, branchId) => approve(editing, branchId, body)}
        />
      ) : null}

      {editing?.kind === "rx" ? (
        <NewOrderDialog
          mayCost={false}
          onClose={() => setEditing(null)}
          onSaved={() => undefined}
          request={{
            initial: { ...editing.body, branch_id: editing.branchId },
            branches,
            eyebrow: `ตรวจคำขอ ${editing.code} · ${editing.requester ?? ""}`,
            submitLabel: "ยืนยันเปิดใบสั่ง",
            send: ({ branch_id, ...body }) => approve(editing, branch_id, body),
          }}
        />
      ) : null}

      {rejecting ? (
        <RejectDialog
          row={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            list.reload();
          }}
        />
      ) : null}
    </main>
  );
}

/** สิ่งที่ไม่ขึ้นในแถว — กดแถวแล้วกางดู */
function details(r: Request): { label: string; value: string }[] {
  return [
    r.kind === "issue" && r.status === "pending"
      ? {
          label: "คงเหลือตอนนี้",
          value: (r.body.items ?? []).map((i) => `${i.name ?? i.sku}: ${count(i.onHand ?? 0)}`).join(", "),
        }
      : null,
    r.edited && r.status === "approved" ? { label: "แอดมินแก้", value: `เดิม: ${summary({ ...r, body: r.original })}` } : null,
    r.rejectReason ? { label: "เหตุผลที่ตีกลับ", value: r.rejectReason } : null,
    r.reviewer ? { label: "ตรวจโดย", value: `${r.reviewer}${r.reviewedAt ? ` · ${dateTime(r.reviewedAt)}` : ""}` } : null,
    r.undone
      ? {
          label: "หลังตัด",
          value: [
            r.undone.state === "deleted"
              ? "คลังลบใบสั่งนี้แล้ว"
              : r.undone.state === "scrapped"
                ? "เลนส์ของใบนี้เจียร์เสีย"
                : r.undone.state === "partial"
                  ? "คลังรับของคืนบางรายการ"
                  : r.kind === "rx"
                    ? "คลังยกเลิกใบสั่งนี้"
                    : "คลังรับของคืนแล้ว",
            r.undone.at ? dateTime(r.undone.at) : null,
            r.undone.note,
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : null,
  ].filter((f): f is { label: string; value: string } => f !== null);
}

/**
 * ช่องค้นหา — ค้นที่เซิร์ฟเวอร์ (หมายเหตุ/เลขออเดอร์, เลขคำขอ, สาขา, ผู้ขอ, SKU, เลขเอกสาร)
 * พิมพ์แล้วค้นเองเมื่อหยุดพิมพ์ 350 ms
 */
function useSearch(): [string, string, (v: string) => void] {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setApplied(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  return [q, applied, setQ];
}

function SearchBox({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  return (
    <form className="toolsearch" role="search" onSubmit={(e) => e.preventDefault()}>
      <label className="sr-only" htmlFor="req-q">ค้นหาคำขอ</label>
      <input
        id="req-q"
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="เลขออเดอร์ในหมายเหตุ, REQ-, สาขา, ผู้ขอ, SKU"
        autoComplete="off"
      />
      {q ? (
        <button type="button" className="btn btn--quiet" onClick={() => setQ("")}>ล้าง</button>
      ) : null}
    </form>
  );
}

/**
 * ตารางคำขอ — แทนการ์ด (ร้านขอ 3 พ.ย. 2026: การ์ดใหญ่ คำขอเยอะแล้วเลื่อนหายาก)
 * หนึ่งคำขอหนึ่งแถว · หมายเหตุอยู่ใต้รายการเพราะเป็นที่ใส่เลขออเดอร์ · กดแถวกางรายละเอียดที่เหลือ
 */
function RequestTable({
  rows,
  actions,
}: {
  rows: Request[];
  actions: (r: Request) => React.ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="tablewrap">
      <table className="grid reqtable">
        <caption className="sr-only">คำขอตัดเลนส์</caption>
        <thead>
          <tr>
            <th scope="col">สถานะ</th>
            <th scope="col">คำขอ</th>
            <th scope="col">สาขา / ผู้ขอ</th>
            <th scope="col">รายการ · หมายเหตุ</th>
            <th scope="col" className="grid__act"><span className="sr-only">จัดการ</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const badge = r.undone ? UNDONE[r.undone.state] : STATUS[r.status];
            const more = details(r);
            const isOpen = open === r.id;
            const muted =
              r.status === "cancelled" || r.undone?.state === "cancelled" || r.undone?.state === "deleted";
            const toggle = () => setOpen(isOpen ? null : r.id);
            return (
              <Fragment key={r.id}>
                <tr
                  className={`grid__row${more.length ? " grid__row--clickable" : ""}${muted ? " grid__row--muted" : ""}`}
                  onClick={more.length ? toggle : undefined}
                >
                  <td>
                    <span className={`status ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <th scope="row">
                    <span className="grid__name grid__doc">{r.code}</span>
                    <span className="grid__sub">
                      {r.kind === "rx" ? "สั่งตัด RX" : "เบิกจากสต็อก"} · {dateTime(r.createdAt)}
                    </span>
                    {r.result.referenceDoc ? (
                      <span className="grid__sub grid__doc">{r.result.referenceDoc}</span>
                    ) : null}
                  </th>
                  <td>
                    <span className="grid__name">{r.branchName}</span>
                    {r.requester ? <span className="grid__sub">{r.requester}</span> : null}
                  </td>
                  <td className="reqtable__what">
                    <span>{summary(r)}</span>
                    {r.body.note ? <span className="reqtable__note">{r.body.note}</span> : null}
                  </td>
                  <td className="grid__act" onClick={(e) => e.stopPropagation()}>
                    <span className="reqtable__acts">
                      {actions(r)}
                      {more.length ? (
                        <button
                          type="button"
                          className="btn btn--quiet btn--small"
                          aria-expanded={isOpen}
                          aria-label={`รายละเอียด ${r.code}`}
                          onClick={toggle}
                        >
                          {isOpen ? "▴" : "▾"}
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="reqtable__more">
                    <td colSpan={5}>
                      <dl>
                        {more.map((f) => (
                          <div key={f.label}>
                            <dt>{f.label}</dt>
                            <dd>{f.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ตะกร้าเบิก — ใช้ทั้งตอนสาขากรอก และตอนแอดมินแก้ก่อนยืนยัน
 *
 * ยอดคงเหลือในรายการสินค้าหักของที่อยู่ในตะกร้าแล้ว (ProductPicker `reserved`) · ไม่กันของ
 * ระหว่างรอตรวจ ของที่ไม่พอตอนยืนยัน ระบบปฏิเสธทั้งตะกร้าและบอกว่าตัวไหนขาด
 */
function BasketDialog({
  eyebrow,
  branches,
  branchId,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  eyebrow: string;
  branches: Branch[];
  branchId: number | null;
  initial?: IssueBody;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (body: IssueBody, branchId: number) => Promise<void>;
}) {
  const [branch, setBranch] = useState(branchId === null ? "" : String(branchId));
  const [items, setItems] = useState<Item[]>(initial?.items ?? []);
  /* ช่องเลขเอกสารปิดไปแล้ว (ร้านขอ 27 ต.ค. 2026) เลขออเดอร์ใส่ในหมายเหตุ · คำขอเก่าที่เคยกรอกไว้ยังเก็บค่าเดิม */
  const doc = initial?.reference_doc ?? "";
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reserved = useMemo(
    () => Object.fromEntries(items.map((i) => [i.sku, i.quantity])),
    [items],
  );

  function add(p: ProductRow | null) {
    if (p === null) return;
    setProblem(null);
    setItems((now) =>
      now.some((i) => i.sku === p.sku)
        ? now.map((i) => (i.sku === p.sku ? { ...i, quantity: i.quantity + 1 } : i))
        : [...now, { sku: p.sku, quantity: 1, name: p.name, onHand: p.onHand }],
    );
  }

  function setQty(sku: string, raw: string) {
    const n = Math.max(0, Math.min(999, Number.parseInt(raw, 10) || 0));
    setItems((now) => now.map((i) => (i.sku === sku ? { ...i, quantity: n } : i)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const lines = items.filter((i) => i.quantity > 0);
    if (branch === "") {
      setProblem("เลือกก่อนว่าเบิกให้สาขาไหน");
      return;
    }
    if (lines.length === 0) {
      setProblem("ใส่สินค้าลงตะกร้าอย่างน้อยหนึ่งรายการ");
      return;
    }
    if (lines.length > 20) {
      setProblem("ตะกร้าใส่ได้ไม่เกิน 20 รายการต่อครั้ง");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit({
        items: lines.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        reference_doc: doc.trim() || null,
        note: note.trim() || null,
      }, Number(branch));
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <TaskDialog eyebrow={eyebrow} title="เบิกเลนส์ให้สาขา" wide onClose={onClose}>
      <form className="pform" onSubmit={submit} noValidate>
        <fieldset className="pform__set">
          <legend className="pform__legend">ในตะกร้า ({count(items.length)} รายการ)</legend>
          {items.length === 0 ? (
            <p className="field__help">ยังว่าง — ค้นหาเลนส์ด้านล่างแล้วกด "+ ใส่ตะกร้า"</p>
          ) : (
            <div className="tablewrap">
              <table className="grid">
                <caption className="sr-only">รายการในตะกร้า</caption>
                <thead>
                  <tr>
                    <th scope="col">สินค้า</th>
                    <th scope="col" className="grid__num">คงเหลือ</th>
                    <th scope="col" className="grid__num">จำนวน</th>
                    <th scope="col"><span className="sr-only">ลบ</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.sku} className="grid__row">
                      <th scope="row">
                        <span className="grid__name">{i.name ?? i.sku}</span>
                        <span className="grid__sub">{i.sku}</span>
                      </th>
                      <td className="grid__num">
                        {count(i.onHand ?? 0)}
                        {i.onHand !== undefined && i.quantity > i.onHand ? (
                          <span className="grid__sub grid__sub--warn">ไม่พอ</span>
                        ) : null}
                      </td>
                      <td className="grid__num">
                        <label className="sr-only" htmlFor={`q-${i.sku}`}>จำนวน {i.sku}</label>
                        <input
                          id={`q-${i.sku}`}
                          className="input input--inline"
                          inputMode="numeric"
                          value={String(i.quantity)}
                          onChange={(e) => setQty(i.sku, e.target.value)}
                          disabled={busy}
                          style={{ width: "5em" }}
                        />
                      </td>
                      <td className="grid__act">
                        <button
                          type="button"
                          className="btn btn--quiet btn--small"
                          onClick={() => setItems((now) => now.filter((x) => x.sku !== i.sku))}
                          disabled={busy}
                        >
                          ลบ
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </fieldset>

        <fieldset className="pform__set">
          <legend className="pform__legend">รายละเอียด</legend>
          <div className="pform__grid">
            <div className="field">
              <label className="field__label" htmlFor="req-branch">เบิกให้สาขา</label>
              <Select
                id="req-branch"
                value={branch}
                onChange={setBranch}
                disabled={busy}
                placeholder="เลือกสาขา"
                options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
              />
            </div>
            <div className="field field--wide">
              <label className="field__label" htmlFor="req-note">หมายเหตุ — ใส่เลขออเดอร์ที่นี่</label>
              <input
                id="req-note"
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="เช่น ออเดอร์ 77654 ชื่อลูกค้า"
                disabled={busy}
                autoComplete="off"
              />
            </div>
          </div>
        </fieldset>

        {problem ? (
          <div className="notice notice--error" role="alert">{problem}</div>
        ) : null}

        <div className="wizard__nav">
          <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "กำลังบันทึก…" : submitLabel}
          </button>
        </div>
      </form>

      <ProductPicker
        value={null}
        onPick={add}
        pickLabel="+ ใส่ตะกร้า"
        pickByButton
        reserved={reserved}
        requireStock
        only="ready"
        label="ค้นหาเลนส์"
        defaultSort="onhand"
      />
    </TaskDialog>
  );
}

function RejectDialog({ row, onClose, onDone }: { row: Request; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setProblem("เขียนเหตุผลก่อน สาขาจะเห็นข้อความนี้");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/issue-requests/${row.id}/reject`, { reason: reason.trim() });
      toast.info({ text: `ตีกลับ ${row.code} แล้ว` });
      onDone();
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "ตีกลับไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <TaskDialog eyebrow={`ตีกลับ ${row.code}`} title={row.branchName} head={summary(row)} onClose={onClose}>
      <form className="pform" onSubmit={submit} noValidate>
        <p className="field__help">ใช้เมื่อคำขอผิดทั้งใบ — ค่าที่ผิดนิดหน่อยแก้เองได้ที่ปุ่ม "ตรวจ / แก้ / ยืนยัน"</p>
        <div className="field field--wide">
          <label className="field__label" htmlFor="rej-reason">เหตุผล</label>
          <input
            id="rej-reason"
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            autoFocus
            autoComplete="off"
          />
        </div>
        {problem ? <div className="notice notice--error" role="alert">{problem}</div> : null}
        <div className="wizard__nav">
          <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "กำลังบันทึก…" : "ตีกลับ"}
          </button>
        </div>
      </form>
    </TaskDialog>
  );
}
