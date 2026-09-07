"use client";

import { useState } from "react";
import Link from "next/link";
import { can as may, useActor, WorkHead } from "@/stockmod/components/AppShell";
import Paginator from "@/stockmod/components/Paginator";
import SortHead, { SortBar, useSort } from "@/stockmod/components/SortHead";
import Select from "@/stockmod/components/Select";
import RecordCard, { CardList } from "@/stockmod/components/RecordCard";
import { type BranchRow, type Page, type SettlementRow, type SettlementSummary } from "@/stockmod/lib/api";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count, date, money } from "@/stockmod/lib/format";

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
 * ของที่สาขาอื่นเบิกไป และเป็นต้นทุนของร้านเท่าไร
 *
 * หน้านี้เคยเป็นสมุดหนี้: สาขาเบิกของไปแล้วค้างเงินไว้ มีปุ่มรับเงิน มีตัดหนี้สูญ
 * มีคอลัมน์กำไร · ตอนนี้ไม่ใช่แล้ว ร้านนับให้แค่ต้นทุน ส่วนเงินและกำไรเป็นงานของ
 * บัญชี ซึ่งคิดเองจากไฟล์ Excel ที่ส่งออกจากแดชบอร์ด
 *
 * ผลคือหน้านี้อ่านอย่างเดียว ไม่มีปุ่มที่เปลี่ยนอะไรได้เลย — และตัวเลขสองก้อน
 * ข้างบนคือคำตอบทั้งหมดที่หน้านี้มีหน้าที่ตอบ: เบิกไปกี่ใบ เป็นทุนเท่าไร
 *
 * ยังยิง `status=pending` เหมือนเดิม ไม่ใช่เพราะยังมีเรื่อง "ค้าง" อยู่ แต่เพราะ
 * ไม่มีอะไรมาปิดใบเบิกอีกแล้ว ทุกใบจึงค้างตลอดไป — ตัวกรองนี้จึงแปลว่า "ทุกใบที่
 * สาขาเบิก" พอดี และตัดใบที่ถูกยกเลิกออกให้ด้วย ซึ่งเป็นสิ่งที่ต้องการอยู่แล้ว
 */
export default function SettlementsPage() {
  const actor = useActor();
  const [branch, setBranch] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const { sort, dir, sortBy } = useSort<SortKey>("issued", NATURAL_ASC);

  // ทุกคอลัมน์บนจอนี้เป็นต้นทุน จึงไม่มีรุ่นย่อให้คนที่ดูราคาทุนไม่ได้ · API
  // ปฏิเสธคำขอตั้งแต่ต้นอยู่แล้ว บอกตรงนี้ดีกว่าปล่อยให้มาถึงเป็น "โหลดไม่ได้"
  const allowed = may.seeBranchMoney(actor);

  const branches = useApi<{ branches: BranchRow[] }>(allowed ? "/branches" : null);
  const list = useApi<List>(
    allowed
      ? `/settlements${qs({ status: "pending", branch, q: applied, sort, dir, page })}`
      : null,
  );

  function refine(fn: () => void) {
    fn();
    setPage(1);
  }

  const pick = (c: SortKey) => sortBy(c, () => setPage(1));

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
        <div className="empty">
          <p className="empty__title">ยังไม่มีสาขาไหนเบิกของ</p>
          <p className="empty__body">
            รายการจะมาโผล่ที่นี่เมื่อมีสาขาอื่นมาเบิกของ — ทำได้ที่{" "}
            <Link href="/stock" className="grid__link">
              หน้าเบิก/ตัดสต็อก
            </Link>
          </p>
        </div>
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
                  r.issuedByName ? { label: "บันทึกโดย", value: r.issuedByName } : null,
                ]}
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
                    </td>
                    <td className="grid__num">
                      {money(r.costTotal)}
                      {r.costUnknownQty > 0 ? (
                        <span className="grid__sub grid__sub--warn">
                          +{count(r.costUnknownQty)} ชิ้นไม่รู้ต้นทุน
                        </span>
                      ) : null}
                    </td>
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
    </main>
  );
}
