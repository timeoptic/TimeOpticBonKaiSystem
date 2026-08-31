"use client";

import { useState } from "react";
import Link from "next/link";
import { can as may, useActor, WorkHead } from "@/app/components/AppShell";
import Paginator from "@/app/components/Paginator";
import SortHead, { SortBar, useSort } from "@/app/components/SortHead";
import Select from "@/app/components/Select";
import {
  api,
  ApiError,
  type BranchRow,
  type Page,
  type SettlementRow,
  type SettlementSummary,
} from "@/lib/api";
import { qs, useApi } from "@/lib/useApi";
import { count, date, money } from "@/lib/format";
import DateField from "@/app/components/DateField";

type List = Page<SettlementRow> & { summary: SettlementSummary };

type SortKey = "issued" | "branch" | "taken" | "product" | "qty" | "cost" | "amount" | "profit" | "settled";
const NATURAL_ASC: readonly SortKey[] = ["branch", "taken", "product"];

/**
 * The sort chooser above the table. It carries จำนวน, which is drawn inside the
 * สินค้า cell now, and วันที่เบิก / วันที่รับเงิน, which never had headers of
 * their own — the dates live under the branch and the amount.
 *
 * The three money figures keep separate columns on purpose. This screen exists
 * to reconcile them against each other, and figures that are compared have to
 * line up.
 */
const SORTS: readonly { col: SortKey; label: string }[] = [
  { col: "issued", label: "วันที่เบิก" },
  { col: "branch", label: "สาขา" },
  { col: "taken", label: "ผู้รับของ" },
  { col: "product", label: "สินค้า" },
  { col: "qty", label: "จำนวน" },
  { col: "cost", label: "ต้นทุน" },
  { col: "amount", label: "รับเงิน" },
  { col: "profit", label: "กำไร" },
  { col: "settled", label: "วันที่รับเงิน" },
];

const STATES = [
  { key: "pending", label: "ค้างรับ" },
  { key: "settled", label: "รับเงินแล้ว" },
  { key: "written_off", label: "ตัดหนี้สูญ" },
  { key: "cancelled", label: "ยกเลิก" },
  { key: "", label: "ทั้งหมด" },
] as const;

/**
 * What other branches owe, and the moment it stops being a debt.
 *
 * A branch withdrawal is deliberately half a transaction: the stock and its cost
 * left on the day the goods did, but nothing was earned, so no amount was
 * recorded. This is where the other half lands. Entering the money here is what
 * creates the profit, dated to the day it arrived — which is why a withdrawal
 * from last month settled today counts in this month's takings.
 */
export default function SettlementsPage() {
  const actor = useActor();
  const [status, setStatus] = useState<string>("pending");
  const [branch, setBranch] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const { sort, dir, sortBy } = useSort<SortKey>("issued", NATURAL_ASC);

  // Every column on this screen is an amount of money, so there is no reduced
  // version of it to show. The API refuses the request outright; saying so here
  // is kinder than letting that refusal arrive as "โหลดรายการไม่ได้".
  const allowed = may.seeBranchMoney(actor);

  const branches = useApi<{ branches: BranchRow[] }>(allowed ? "/branches" : null);
  const list = useApi<List>(
    allowed ? `/settlements${qs({ status, branch, q: applied, sort, dir, page })}` : null,
  );

  function refine(fn: () => void) {
    fn();
    setPage(1);
  }

  const pick = (c: SortKey) => sortBy(c, () => setPage(1));

  const can = allowed;

  if (!allowed) {
    return (
      <main className="work-main">
        <WorkHead title="ค้างรับจากสาขา" />
        <div className="empty">
          <p className="empty__title">หน้านี้เป็นของเจ้าของร้านและฝ่ายบัญชี</p>
          <p className="empty__body">
            ทั้งหน้าเป็นเรื่องต้นทุนและเงินที่สาขาค้างอยู่ ซึ่งสิทธิ์ของคุณดูไม่ได้ —
            แต่บันทึกการเบิกให้สาขาได้ตามปกติที่{" "}
            <Link href="/" className="grid__link">
              หน้าเบิก/ตัดสต็อก
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="work-main">
      <WorkHead
        title="ค้างรับจากสาขา"
        lede="ของออกไปแล้ว เงินยังไม่มา — กำไรจะถูกลงในวันที่รับเงิน ไม่ใช่วันที่เบิก"
      >
        <form
          className="toolsearch"
          onSubmit={(e) => {
            e.preventDefault();
            refine(() => setApplied(q.trim()));
          }}
        >
          <label className="sr-only" htmlFor="s-q">
            ค้นหา
          </label>
          <input
            id="s-q"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="สาขา ชื่อคนรับของ หรือ SKU"
            autoComplete="off"
          />
          <button type="submit" className="btn btn--primary">
            ค้นหา
          </button>
        </form>
        <Link href="/branches" className="btn">
          จัดการสาขา
        </Link>
      </WorkHead>

      {list.status === "ready" ? (
        <section className="readout" aria-label="สรุปยอดสาขา">
          <div className="readout__cell readout__cell--coral">
            <p className="readout__label">ค้างรับ</p>
            <p
              className={
                list.data.summary.pendingCount > 0
                  ? "readout__figure readout__figure--signal"
                  : "readout__figure"
              }
            >
              {count(list.data.summary.pendingCount)}
            </p>
            <p className="readout__note">รายการที่ยังไม่ได้เงิน</p>
          </div>
          <div className="readout__cell readout__cell--cyan">
            <p className="readout__label">ต้นทุนที่ค้างอยู่</p>
            <p className="readout__figure">{money(list.data.summary.pendingCost)}</p>
            <p className="readout__note">
              บาท · เป็นต้นทุนของเรา ไม่ใช่ยอดที่สาขาต้องจ่าย
              {list.data.summary.pendingUnknown > 0
                ? ` · อีก ${count(list.data.summary.pendingUnknown)} ชิ้นยังไม่รู้ต้นทุน`
                : ""}
            </p>
          </div>
          <div className="readout__cell readout__cell--mint">
            <p className="readout__label">รับเงินเดือนนี้</p>
            <p className="readout__figure">{money(list.data.summary.monthAmount)}</p>
            <p className="readout__note">บาท จาก {count(list.data.summary.monthCount)} รายการ</p>
          </div>
          <div className="readout__cell readout__cell--pear">
            <p className="readout__label">กำไรเดือนนี้</p>
            <p className="readout__figure">{money(list.data.summary.monthProfit)}</p>
            <p className="readout__note">บาท · นับตามวันที่เงินเข้า</p>
          </div>
        </section>
      ) : null}

      <div className="chips chips--bar" role="group" aria-label="กรองสถานะ">
        {STATES.map((s) => (
          <button
            key={s.key}
            type="button"
            className="chip"
            aria-current={status === s.key ? "true" : undefined}
            onClick={() => refine(() => setStatus(s.key))}
          >
            {s.label}
          </button>
        ))}
        <span className="chips__note">·</span>
        <label className="sr-only" htmlFor="s-branch">
          กรองตามสาขา
        </label>
        <Select
          id="s-branch"
          className="input--inline"
          value={branch}
          onChange={(v) => refine(() => setBranch(v))}
          disabled={branches.status !== "ready"}
          placeholder="ทุกสาขา"
          options={[
            { value: "", label: "ทุกสาขา" },
            ...(branches.status === "ready"
              ? branches.data.branches.map((b) => ({ value: String(b.id), label: b.name }))
              : []),
          ]}
        />
      </div>

      <SortBar id="settle" columns={SORTS} sort={sort} dir={dir} onSort={pick} />

      {list.status === "loading" ? <div className="skeleton" /> : null}

      {list.status === "error" ? (
        <div className="empty">
          <p className="empty__title">โหลดรายการไม่ได้</p>
          <p className="empty__body">{list.error}</p>
          <button type="button" className="btn" onClick={list.reload}>
            ลองใหม่
          </button>
        </div>
      ) : null}

      {list.status === "ready" && list.data.rows.length === 0 ? (
        <div className="empty">
          <p className="empty__title">
            {status === "pending" ? "ไม่มีสาขาไหนค้างเงินอยู่" : "ไม่มีรายการที่ตรงกับเงื่อนไขนี้"}
          </p>
          <p className="empty__body">
            รายการจะมาโผล่ที่นี่เมื่อมีสาขาอื่นมาเบิกของ — ทำได้ที่{" "}
            <Link href="/" className="grid__link">
              หน้าเบิก/ตัดสต็อก
            </Link>
          </p>
        </div>
      ) : null}

      {list.status === "ready" && list.data.rows.length > 0 ? (
        <>
          <div className="tablewrap">
            <table className="grid">
              <caption className="sr-only">รายการที่สาขาอื่นเบิกไป</caption>
              <thead>
                <tr>
                  {/* จำนวน is inside the สินค้า cell — one item and its count are
                      one fact. The three money columns stay apart: this screen is
                      read by comparing them, and figures that are compared have
                      to line up under each other. */}
                  <SortHead label="สาขา / ผู้รับของ" col="branch" sort={sort} dir={dir} onSort={pick} />
                  <SortHead label="สินค้า / จำนวน" col="product" sort={sort} dir={dir} onSort={pick} />
                  <SortHead label="ต้นทุน" col="cost" sort={sort} dir={dir} onSort={pick} num />
                  <SortHead label="รับเงิน" col="amount" sort={sort} dir={dir} onSort={pick} num />
                  <SortHead label="กำไร" col="profit" sort={sort} dir={dir} onSort={pick} num />
                  <th scope="col">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <IssueRow key={r.id} row={r} maySettle={can} onDone={list.reload} />
                ))}
              </tbody>
            </table>
          </div>

          <Paginator
            page={list.data.page}
            perPage={list.data.perPage}
            total={list.data.total}
            onPage={setPage}
            label="รายการ"
          />
        </>
      ) : null}
    </main>
  );
}

/** One withdrawal, with the money form opening in place underneath it. */
function IssueRow({
  row,
  maySettle,
  onDone,
}: {
  row: SettlementRow;
  maySettle: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"settle" | "writeOff">("settle");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pending = row.status === "pending";

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      if (mode === "settle") {
        await api.post(`/settlements/${row.id}/settle`, {
          amount: amount.trim(),
          received_date: when,
          note: note.trim() || null,
        });
      } else {
        await api.post(`/settlements/${row.id}/write-off`, { note: note.trim() || null });
      }
      setOpen(false);
      onDone();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr className={pending ? "grid__row grid__row--pending" : "grid__row"}>
        <th scope="row">
          <span className="grid__name">{row.branchName ?? "—"}</span>
          <span className="grid__sub">
            {row.takenBy ? `${row.takenBy} · ` : ""}เบิก {date(row.issuedAt)}
            {row.issuedByName ? ` · บันทึกโดย ${row.issuedByName}` : ""}
          </span>
        </th>
        <td>
          <span className="grid__name">{row.productName ?? row.sku}</span>
          <span className="grid__sub">
            {row.sku} · {count(row.quantity)} ชิ้น
          </span>
        </td>
        <td className="grid__num">
          {money(row.costTotal)}
          {row.costUnknownQty > 0 ? (
            <span className="grid__sub grid__sub--warn">
              +{count(row.costUnknownQty)} ชิ้นไม่รู้ต้นทุน
            </span>
          ) : null}
        </td>
        <td className="grid__num">
          {row.settledAmount === null ? (
            <span className="grid__muted">—</span>
          ) : (
            <>
              {money(row.settledAmount)}
              {row.settledAt ? <span className="grid__sub">{date(row.settledAt)}</span> : null}
            </>
          )}
        </td>
        {/* Zero profit is a real answer, not a missing one: a branch that sends
            back exactly the cost has settled in full. Saying so in words stops
            it reading as a field nobody filled in. */}
        <td className="grid__num">
          {row.profit === null ? (
            <span className="grid__muted" title="ยังไม่รับเงิน จึงยังไม่มีกำไร">
              —
            </span>
          ) : row.profit === 0 ? (
            <span className="status" title="สาขาจ่ายคืนเท่าต้นทุนพอดี">
              เท่าทุน
            </span>
          ) : (
            money(row.profit)
          )}
        </td>
        <td>
          {pending ? (
            maySettle ? (
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
              >
                {open ? "ปิด" : "รับเงิน"}
              </button>
            ) : (
              <span className="status status--pending">ค้างรับ</span>
            )
          ) : (
            <span className={row.status === "settled" ? "status status--stock" : "status"}>
              {row.statusLabel}
            </span>
          )}
        </td>
      </tr>

      {open ? (
        <tr className="grid__row">
          <td colSpan={6}>
            <div className="lotedit">
              <div className="chips chips--bar" role="group" aria-label="วิธีปิดรายการ">
                <button
                  type="button"
                  className="chip"
                  aria-current={mode === "settle" ? "true" : undefined}
                  onClick={() => setMode("settle")}
                >
                  รับเงินแล้ว
                </button>
                <button
                  type="button"
                  className="chip"
                  aria-current={mode === "writeOff" ? "true" : undefined}
                  onClick={() => setMode("writeOff")}
                >
                  ตัดหนี้สูญ
                </button>
              </div>

              {mode === "settle" ? (
                <>
                  <div className="field">
                    <label className="field__label" htmlFor={`st-a-${row.id}`}>
                      ยอดเงินที่ได้รับ (฿)
                    </label>
                    <input
                      id={`st-a-${row.id}`}
                      className="input"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={busy}
                      autoComplete="off"
                    />
                    {/* A branch does not always pay a margin — quite often it
                        sends back exactly what the goods cost. That is a normal
                        outcome, not a mistake, so it gets a button rather than
                        being typed out and second-guessed. */}
                    <div className="chips">
                      <button
                        type="button"
                        className="chip chip--preset"
                        disabled={busy}
                        onClick={() => {
                          setAmount(row.costTotal.toFixed(2));
                          if (note.trim() === "") setNote("รับเท่าทุน ไม่คิดกำไร");
                        }}
                      >
                        เท่าทุน · {money(row.costTotal)}
                      </button>
                    </div>
                    <span className="field__help">
                      ต้นทุนของรายการนี้ {money(row.costTotal)} บาท — ส่วนต่างคือกำไร
                      · จ่ายคืนเท่าทุนก็ได้ ไม่จำเป็นต้องมีกำไรทุกครั้ง
                    </span>
                  </div>

                  <div className="field">
                    <label className="field__label" htmlFor={`st-d-${row.id}`}>
                      วันที่ได้รับเงิน
                    </label>
                    <DateField
                      id={`st-d-${row.id}`}
                      value={when}
                      onChange={setWhen}
                      disabled={busy}
                      clearable={false}
                    />
                    <span className="field__help">
                      กำไรจะถูกลงตามวันนี้ ไม่ใช่วันที่เบิก — ใส่วันที่เงินเข้าจริง
                    </span>
                  </div>
                </>
              ) : (
                <p className="field__help">
                  ใช้เมื่อสาขาจะไม่จ่ายแล้วจริง ๆ — ต่างจากการคืนของ ซึ่งให้ทำที่รายการเบิกเดิมแทน
                </p>
              )}

              <div className="field">
                <label className="field__label" htmlFor={`st-n-${row.id}`}>
                  หมายเหตุ{mode === "writeOff" ? " · ต้องกรอก" : ""}
                </label>
                <input
                  id={`st-n-${row.id}`}
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={mode === "writeOff" ? "เหตุผลที่ตัดหนี้สูญ" : "เช่น โอนผ่านธนาคาร"}
                  disabled={busy}
                  autoComplete="off"
                />
              </div>

              {problem ? (
                <div className="notice notice--error" role="alert">
                  {problem}
                </div>
              ) : null}

              <div className="chips">
                <button
                  type="button"
                  className={mode === "settle" ? "btn btn--primary btn--small" : "btn btn--danger btn--small"}
                  onClick={save}
                  disabled={
                    busy ||
                    (mode === "settle" ? amount.trim() === "" : note.trim() === "")
                  }
                >
                  {busy ? "กำลังบันทึก…" : mode === "settle" ? "บันทึกรับเงิน" : "ยืนยันตัดหนี้สูญ"}
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--small"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
