"use client";

import { useState } from "react";
import Link from "next/link";
import { can as may, useActor, WorkHead } from "@/stockmod/components/AppShell";
import DateRangeField from "@/stockmod/components/DateRangeField";
import Paginator from "@/stockmod/components/Paginator";
import SortHead, { SortBar, useSort } from "@/stockmod/components/SortHead";
import Select from "@/stockmod/components/Select";
import RecordCard, { CardList } from "@/stockmod/components/RecordCard";
import SettlementEditDialog from "@/stockmod/components/SettlementEditDialog";
import { useToast } from "@/stockmod/components/Toaster";
import { api, type BranchRow, type Page, type SettlementRow, type SettlementSummary } from "@/stockmod/lib/api";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count, date, money } from "@/stockmod/lib/format";
import { settlementFileName, settlementSheets, settlementTitle } from "@/stockmod/lib/settlementBook";

type List = Page<SettlementRow> & { summary: SettlementSummary };

type SortKey = "issued" | "branch" | "taken" | "product" | "qty" | "cost";
const NATURAL_ASC: readonly SortKey[] = ["branch", "taken", "product"];

const SORTS: readonly { col: SortKey; label: string }[] = [
  { col: "issued", label: "วันที่เบิก" },
  { col: "branch", label: "สาขา" },
  { col: "taken", label: "ผู้รับของ" },
  { col: "product", label: "สินค้า" },
  { col: "qty", label: "จำนวน" },
  { col: "cost", label: "ต้นทุน" },
];

/**
 * ช่วงวันที่เบิก — "ทุกช่วงเวลา" คือหน้าตาเดิมของหน้านี้ก่อนมีตัวกรอง
 *
 * ช่องเลือกวันที่ขึ้นเฉพาะตอนมีช่วงจริง เพราะ `DateRangeField` ต้องมีวันที่ให้วาดเสมอ ·
 * ช่องที่แสดง "1 ก.ย. – 12 ก.ย." ทั้งที่ตารางกำลังนับทุกใบ คือช่องที่โกหก
 */
type Span = "all" | "this" | "last" | "custom";
const SPANS: readonly { key: Span; label: string }[] = [
  { key: "all", label: "ทุกช่วงเวลา" },
  { key: "this", label: "เดือนนี้" },
  { key: "last", label: "เดือนที่แล้ว" },
  { key: "custom", label: "กำหนดเอง" },
];

/** `2026-09-04` ตามเวลาท้องถิ่น — toISOString ให้วันของ UTC ซึ่งเป็นเมื่อวานก่อนเจ็ดโมงเช้า */
const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** เดือนนี้ (0) ถึงวันนี้ หรือเดือนก่อน ๆ (-1) ทั้งเดือน */
function monthOf(offset: number): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: iso(first), to: iso(last) };
}

/**
 * ของที่สาขาอื่นเบิกไป และเป็นต้นทุนของร้านเท่าไร
 *
 * หน้านี้เคยเป็นสมุดหนี้: สาขาเบิกของไปแล้วค้างเงินไว้ มีปุ่มรับเงิน มีตัดหนี้สูญ
 * มีคอลัมน์กำไร · ตอนนี้ไม่ใช่แล้ว ร้านนับให้แค่ต้นทุน ส่วนเงินและกำไรเป็นงานของ
 * บัญชี ซึ่งคิดเองจากไฟล์ Excel ที่ส่งออกจากแดชบอร์ด หรือจากปุ่ม Excel ของหน้านี้
 * ที่ให้รายการทีละใบพร้อมหมายเหตุ (ร้านขอไว้ 12 ก.ย. 2026)
 *
 * ไม่มีปุ่มเรื่องเงินบนหน้านี้แล้ว (รับเงิน · ตัดหนี้สูญ) แต่ใบที่คีย์ผิดยังต้องแก้ได้ —
 * ร้านขอไว้ 12 ก.ย. 2026: "แก้ไขได้ หรือกดยกเลิกแล้วคีย์ใหม่" · ปุ่มแก้ไขเปิด
 * `SettlementEditDialog` ซึ่งแก้ได้ สาขา ผู้รับของ วันที่เบิก หมายเหตุ และยกเลิกใบ
 * พร้อมคืนของเข้าล็อตเดิม · สินค้ากับจำนวนแก้ตรง ๆ ไม่ได้ ต้องยกเลิกแล้วเบิกใหม่ ไม่งั้น
 * ต้นทุนของใบกับยอดล็อตจะไม่ตรงกัน (เหตุผลเต็มอยู่ในหัวไฟล์ของ dialog)
 *
 * ตัวเลขสองก้อนข้างบนยังเป็นคำตอบหลักของหน้านี้: เบิกไปกี่ใบ เป็นทุนเท่าไร
 *
 * ยังยิง `status=pending` เหมือนเดิม ไม่ใช่เพราะยังมีเรื่อง "ค้าง" อยู่ แต่เพราะ
 * ไม่มีอะไรมาปิดใบเบิกอีกแล้ว ทุกใบจึงค้างตลอดไป — ตัวกรองนี้จึงแปลว่า "ทุกใบที่
 * สาขาเบิก" พอดี และตัดใบที่ถูกยกเลิกออกให้ด้วย ซึ่งเป็นสิ่งที่ต้องการอยู่แล้ว
 */
export default function SettlementsPage() {
  const actor = useActor();
  const toast = useToast();
  const [branch, setBranch] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [span, setSpan] = useState<Span>("all");
  const [range, setRange] = useState(() => monthOf(0));
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const { sort, dir, sortBy } = useSort<SortKey>("issued", NATURAL_ASC);

  // ทุกคอลัมน์บนจอนี้เป็นต้นทุน จึงไม่มีรุ่นย่อให้คนที่ดูราคาทุนไม่ได้ · API
  // ปฏิเสธคำขอตั้งแต่ต้นอยู่แล้ว บอกตรงนี้ดีกว่าปล่อยให้มาถึงเป็น "โหลดไม่ได้"
  const allowed = may.seeBranchMoney(actor);
  /* แก้/ยกเลิกใบเบิก — สิทธิ์เดียวกับที่ API ตรวจ (`Roles::settleBranch`) · เจ้าของร้าน
     Superuser และฝ่ายบัญชี · ถามชื่อสิทธิ์ตรง ๆ ไม่ได้เพิ่มเข้า `can` ใน AppShell
     เพราะไฟล์นั้นอยู่ในก้อนที่ทุกหน้าของคลังโหลดร่วมกัน */
  const maySettle = actor.perms.includes("branch.settle");
  const [editing, setEditing] = useState<SettlementRow | null>(null);

  /* ตัวกรองชุดเดียว ใช้ทั้งตาราง การ์ดสรุป และไฟล์ Excel — ไฟล์ที่นับของคนละก้อน
     กับจอคือไฟล์ที่เอาไปเทียบแล้วเลขไม่ตรง */
  const period = span === "all" ? { from: "", to: "" } : range;
  const filter = { status: "pending", branch, q: applied, from: period.from, to: period.to };

  const branches = useApi<{ branches: BranchRow[] }>(allowed ? "/branches" : null);
  const list = useApi<List>(allowed ? `/settlements${qs({ ...filter, sort, dir, page })}` : null);

  function refine(fn: () => void) {
    fn();
    setPage(1);
  }

  function choose(next: Span) {
    refine(() => {
      setSpan(next);
      if (next === "this") setRange(monthOf(0));
      if (next === "last") setRange(monthOf(-1));
    });
  }

  const pick = (c: SortKey) => sortBy(c, () => setPage(1));

  const branchName =
    branch === "" || branches.status !== "ready"
      ? null
      : (branches.data.branches.find((b) => String(b.id) === branch)?.name ?? null);

  /**
   * ทุกใบที่ตรงกับตัวกรอง ลงเป็นไฟล์ Excel — ไม่ใช่แค่ 25 แถวของหน้าที่เปิดอยู่
   *
   * ExcelJS ถูกโหลดตอนกดเท่านั้น ก้อนนั้นใหญ่กว่าทั้งหน้านี้หลายเท่า และคนส่วนใหญ่ที่
   * เปิดหน้านี้มาดูตัวเลขไม่ได้กดส่งออก
   */
  async function exportExcel() {
    setSaving(true);
    try {
      const all = await api.get<List>(`/settlements${qs({ ...filter, sort, dir, all: 1 })}`);
      const { download } = await import("@/stockmod/lib/workbook");
      const scope = { branchName, from: period.from || null, to: period.to || null };
      await download(settlementFileName(scope), settlementTitle(scope), settlementSheets(all.rows));
    } catch (e) {
      toast.error({
        text: "สร้างไฟล์ Excel ไม่สำเร็จ",
        detail: e instanceof Error ? e.message : "ลองกดอีกครั้ง",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) {
    return (
      <main className="work-main">
        <WorkHead title="การเบิกจากสาขา" />
        <div className="empty">
          <p className="empty__title">หน้านี้เป็นของเจ้าของร้านและฝ่ายบัญชี</p>
          <p className="empty__body">
            ทั้งหน้าเป็นเรื่องต้นทุนของที่สาขาเบิกไป ซึ่งสิทธิ์ของคุณดูไม่ได้ —
            แต่บันทึกการเบิกให้สาขาได้ตามปกติที่{" "}
            <Link href="/stock" className="grid__link">
              หน้าเบิก/ตัดสต็อก
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const filtered = branch !== "" || applied !== "" || span !== "all";

  return (
    <main className="work-main">
      <WorkHead
        title="การเบิกจากสาขา"
        lede="สาขาไหนเบิกอะไรไปเท่าไร และเป็นต้นทุนของเราเท่าไร — เรื่องเงินกับกำไร บัญชีคิดเองจาก Excel"
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
        <button
          type="button"
          className="btn"
          onClick={exportExcel}
          disabled={saving || list.status !== "ready" || list.data.total === 0}
          title="ทุกใบที่ตรงกับตัวกรองตอนนี้ แยกตามสาขา พร้อมชื่อสินค้าและหมายเหตุ"
        >
          {saving ? "กำลังสร้างไฟล์…" : "Export Excel"}
        </button>
        <Link href="/stock/branches" className="btn">
          จัดการสาขา
        </Link>
      </WorkHead>

      {list.status === "ready" ? (
        <section className="readout" aria-label="สรุปการเบิกจากสาขา">
          <div className="readout__cell readout__cell--mint">
            <p className="readout__label">ใบเบิก</p>
            <p className="readout__figure">{count(list.data.summary.pendingCount)}</p>
            <p className="readout__note">รายการที่สาขาเบิกไป</p>
          </div>
          <div className="readout__cell readout__cell--cyan">
            <p className="readout__label">ต้นทุนรวม</p>
            <p className="readout__figure">{money(list.data.summary.pendingCost)}</p>
            <p className="readout__note">
              บาท · เป็นต้นทุนของเรา ไม่ใช่ยอดที่สาขาต้องจ่าย
              {list.data.summary.pendingUnknown > 0
                ? ` · อีก ${count(list.data.summary.pendingUnknown)} ชิ้นยังไม่รู้ต้นทุน`
                : ""}
            </p>
          </div>
        </section>
      ) : null}

      {/* ตัวกรองสาขากับแถบเรียงลำดับอยู่แถวเดียวกัน หัวท้ายชนขอบซ้ายขวา —
          เดิมเป็นสองแถวที่ต่างคนต่างเกาะซ้าย เหลือที่ว่างทางขวาคนละครึ่งบรรทัด
          `.listtools` เป็นแถวเดียวกับที่หน้ารายการอื่นใช้อยู่แล้ว */}
      <div className="listtools">
        <div className="chips chips--bar" role="group" aria-label="กรองตามสาขา">
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

        <div className="chips chips--tight" role="group" aria-label="ช่วงวันที่เบิก">
          {SPANS.map((s) => (
            <button
              key={s.key}
              type="button"
              className="chip chip--flat"
              aria-current={span === s.key ? "true" : undefined}
              onClick={() => choose(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {span !== "all" ? (
          <DateRangeField
            split
            id="s-range"
            from={range.from}
            to={range.to}
            onApply={(r) =>
              refine(() => {
                setRange(r);
                setSpan("custom");
              })
            }
          />
        ) : null}

        <div className="listtools__end">
          <SortBar id="settle" columns={SORTS} sort={sort} dir={dir} onSort={pick} />
        </div>
      </div>

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
        filtered ? (
          <div className="empty">
            <p className="empty__title">ไม่มีใบเบิกที่ตรงกับตัวกรองนี้</p>
            <p className="empty__body">ลองเลือกทุกสาขา ขยายช่วงวันที่ หรือล้างคำค้น</p>
          </div>
        ) : (
          <div className="empty">
            <p className="empty__title">ยังไม่มีสาขาไหนเบิกของ</p>
            <p className="empty__body">
              รายการจะมาโผล่ที่นี่เมื่อมีสาขาอื่นมาเบิกของ — ทำได้ที่{" "}
              <Link href="/stock" className="grid__link">
                หน้าเบิก/ตัดสต็อก
              </Link>
            </p>
          </div>
        )
      ) : null}

      {list.status === "ready" && list.data.rows.length > 0 ? (
        <>
          {/* บนมือถือ ใบเบิกหนึ่งใบ = การ์ดหนึ่งใบ · หน้านี้อ่านอย่างเดียว ไม่มี
              ปุ่มในแถว การ์ดจึงไม่ต้องกดได้ */}
          <CardList label="รายการที่สาขาอื่นเบิกไป">
            {list.data.rows.map((r) => (
              <RecordCard
                key={r.id}
                head={
                  <>
                    <span className="reccard__money">{money(r.costTotal)}</span>
                    {r.costUnknownQty > 0 ? (
                      <span className="reccard__when grid__sub--warn">
                        +{count(r.costUnknownQty)} ชิ้นไม่รู้ต้นทุน
                      </span>
                    ) : null}
                  </>
                }
                title={r.productName ?? r.sku}
                sub={`${r.sku} · ${count(r.quantity)} ชิ้น`}
                fields={[
                  { label: "สาขา", value: r.branchName ?? "—" },
                  r.takenBy ? { label: "ผู้รับของ", value: r.takenBy } : null,
                  { label: "เบิกเมื่อ", value: date(r.issuedAt) },
                  r.note ? { label: "หมายเหตุ", value: r.note } : null,
                  r.issuedByName ? { label: "บันทึกโดย", value: r.issuedByName } : null,
                ]}
                actions={
                  maySettle ? (
                    <button type="button" className="btn btn--small" onClick={() => setEditing(r)}>
                      เปิดการแก้ไข / ยกเลิก
                    </button>
                  ) : undefined
                }
              />
            ))}
          </CardList>

          <div className="tablewrap wide-only">
            <table className="grid">
              <caption className="sr-only">รายการที่สาขาอื่นเบิกไป</caption>
              <thead>
                <tr>
                  {/* จำนวนอยู่ในช่องสินค้า — ของหนึ่งอย่างกับจำนวนของมันคือเรื่อง
                      เดียวกัน · เหลือคอลัมน์เงินคอลัมน์เดียวคือต้นทุน */}
                  <SortHead label="สาขา / ผู้รับของ" col="branch" sort={sort} dir={dir} onSort={pick} />
                  <SortHead label="สินค้า / จำนวน" col="product" sort={sort} dir={dir} onSort={pick} />
                  <SortHead label="ต้นทุน" col="cost" sort={sort} dir={dir} onSort={pick} num />
                  {maySettle ? (
                    <th scope="col">
                      <span className="sr-only">แก้ไข</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <tr key={r.id} className="grid__row">
                    <th scope="row">
                      <span className="grid__name">{r.branchName ?? "—"}</span>
                      <span className="grid__sub">
                        {r.takenBy ? `${r.takenBy} · ` : ""}เบิก {date(r.issuedAt)}
                        {r.issuedByName ? ` · บันทึกโดย ${r.issuedByName}` : ""}
                      </span>
                    </th>
                    <td>
                      <span className="grid__name">{r.productName ?? r.sku}</span>
                      <span className="grid__sub">
                        {r.sku} · {count(r.quantity)} ชิ้น
                      </span>
                      {/* หมายเหตุคือเลขบิลหรือสิ่งที่พนักงานพิมพ์ไว้ตอนเบิก — บรรทัดเดียวกับ
                          ที่ออกไปอยู่ในไฟล์ Excel คนเทียบจอกับไฟล์จะได้เจอของเดียวกัน */}
                      {r.note ? <span className="grid__sub">หมายเหตุ: {r.note}</span> : null}
                    </td>
                    <td className="grid__num">
                      {money(r.costTotal)}
                      {r.costUnknownQty > 0 ? (
                        <span className="grid__sub grid__sub--warn">
                          +{count(r.costUnknownQty)} ชิ้นไม่รู้ต้นทุน
                        </span>
                      ) : null}
                    </td>
                    {maySettle ? (
                      <td className="grid__act">
                        <button type="button" className="btn btn--small" onClick={() => setEditing(r)}>
                          เปิดการแก้ไข / ยกเลิก
                        </button>
                      </td>
                    ) : null}
                  </tr>
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

      {/* ยกเลิกแล้วใบหายจากรายการนี้ (หน้านี้แสดงเฉพาะใบที่ยังใช้อยู่) และของกลับเข้าล็อต
          เดิม · หน้าความเคลื่อนไหวยังมีแถว "รับคืน" พร้อมเหตุผลให้ตามย้อนหลังได้ */}
      {editing && branches.status === "ready" ? (
        <SettlementEditDialog
          row={editing}
          branches={branches.data.branches}
          onClose={() => setEditing(null)}
          onSaved={list.reload}
        />
      ) : null}
    </main>
  );
}
