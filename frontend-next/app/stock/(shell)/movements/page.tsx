"use client";

import { useState } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import Paginator from "@/stockmod/components/Paginator";
import SortHead, { SortBar, useSort } from "@/stockmod/components/SortHead";
import { Filter, FilterBar, withCount } from "@/stockmod/components/FilterBar";
import RecordCard, { CardList } from "@/stockmod/components/RecordCard";
import ShopIssueDialog from "@/stockmod/components/ShopIssueDialog";
import DateRangeField from "@/stockmod/components/DateRangeField";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count, dateTime, money, shortName } from "@/stockmod/lib/format";
import type { MovementRow, Page, Person } from "@/stockmod/lib/api";

type Counts = Record<string, number>;
type List = Page<MovementRow> & { counts: Counts };

type SortKey = "date" | "type" | "product" | "qty" | "cost" | "doc";
const NATURAL_ASC: readonly SortKey[] = ["type", "product", "doc"];

/**
 * The sort chooser above the table, and the only place เอกสาร can still be
 * sorted from now that the reference number is drawn inside the ประเภท cell
 * rather than in a column of its own. Slimming a table must not quietly delete
 * a sort with the header that carried it.
 */
function sorts(money: boolean): readonly { col: SortKey; label: string }[] {
  return [
    { col: "date", label: "วันที่" },
    { col: "type", label: "ประเภท" },
    { col: "product", label: "สินค้า" },
    { col: "doc", label: "เอกสารอ้างอิง" },
    { col: "qty", label: "จำนวน" },
    ...(money ? ([{ col: "cost", label: "ต้นทุน/ชิ้น" }] as const) : []),
  ];
}

const TYPES = [
  { key: "", label: "ทั้งหมด", countKey: "all" },
  { key: "IN", label: "รับเข้า", countKey: "IN" },
  { key: "OUT", label: "จ่ายออก", countKey: "OUT" },
  { key: "SCRAP", label: "ตัดเสีย", countKey: "SCRAP" },
  { key: "RETURN", label: "รับคืน", countKey: "RETURN" },
  { key: "ADJUST", label: "ปรับยอด", countKey: "ADJUST" },
  { key: "RX_ORDER", label: "สั่งตัด RX", countKey: "RX_ORDER" },
  /* สามชนิดท้ายไม่ใช่การเคลื่อนของ แต่เป็นตัวเลขเงินที่มีคนกรอกในวันนั้น —
     จำนวนเป็นศูนย์เสมอ และวันที่คือวันที่กรอก ไม่ใช่วันที่ของออกไป */
  { key: "COST", label: "ลงต้นทุน RX", countKey: "COST" },
  { key: "PRICE", label: "แก้ราคาขาย", countKey: "PRICE" },
  { key: "SETTLE", label: "รับเงินจากสาขา", countKey: "SETTLE" },
] as const;

/** ใครเป็นคนเอาของไป — คนละคำถามกับ "ของขยับแบบไหน" ข้างบน */
const WHO = [
  { value: "", label: "ทุกคน" },
  { value: "branch", label: "สาขาอื่นเบิก" },
  { value: "owed", label: "ยังค้างเงิน" },
] as const;

/**
 * The ledger — and, since every row is a transaction the books are built from,
 * the place each one has to explain itself.
 *
 * Two people can be involved in one row and the screen shows both: whoever keyed
 * it, and whoever actually took the goods. Where a branch took them, the row also
 * carries whether the money has come back yet, because a withdrawal awaiting
 * payment is not the same transaction as one that has been paid for.
 */
export default function MovementsPage() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [type, setType] = useState("");
  const [who, setWho] = useState("");
  const [page, setPage] = useState(1);
  /** ช่วงวันที่ของรายการ — ว่างทั้งคู่ = ทุกวัน · API รับ from/to อยู่แล้ว */
  const [range, setRange] = useState({ from: "", to: "" });
  const { sort, dir, sortBy } = useSort<SortKey>("date", NATURAL_ASC);

  const actor = useActor();
  const money$ = can.seeCost(actor);
  /* แก้ / ยกเลิกการเบิกของร้านเอง (TimeOptic) — สิทธิ์เดียวกับฝั่งสาขาที่ API ตรวจ
     (`Roles::settleBranch`) ตามที่ร้านเลือกไว้ 12 ก.ย. 2026 · ถามชื่อสิทธิ์ตรง ๆ ไม่ได้เพิ่ม
     เข้า `can` ใน AppShell เพราะไฟล์นั้นอยู่ในก้อนที่ทุกหน้าของคลังโหลดร่วมกัน */
  const maySettle = actor.perms.includes("branch.settle");
  const people = useApi<{ people: Person[] }>(maySettle ? "/people" : null);
  const [editing, setEditing] = useState<MovementRow | null>(null);
  const onEdit = maySettle ? setEditing : undefined;
  const list = useApi<List>(`/movements${qs({ type, q: applied, who, from: range.from, to: range.to, sort, dir, page })}`);
  const rows = list.status === "ready" ? list.data.rows : [];
  const counts: Counts = list.status === "ready" ? list.data.counts : {};

  function refine(fn: () => void) {
    fn();
    setPage(1);
  }

  const pick = (c: SortKey) => sortBy(c, () => setPage(1));

  return (
    <main className="work-main">
      <WorkHead
        title="ความเคลื่อนไหว"
        lede="ทุกครั้งที่ของเข้าหรือออกจากคลัง เรียงจากใหม่ไปเก่า · ใช้เป็นรายการตั้งต้นของบัญชี"
      >
        <form
          className="toolsearch"
          onSubmit={(e) => {
            e.preventDefault();
            refine(() => setApplied(q.trim()));
          }}
        >
          <label className="sr-only" htmlFor="mv-q">
            ค้นหาความเคลื่อนไหว
          </label>
          <input
            id="mv-q"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="เลขเอกสาร SKU ล็อต ชื่อคน สาขา หรือหมายเหตุ"
            autoComplete="off"
          />
          <button type="submit" className="btn btn--primary">
            ค้นหา
          </button>
        </form>
      </WorkHead>

      {/* Every tile counts the whole ledger, not the page on screen — a figure
          that changes when you turn the page is not a summary of anything. */}
      <section className="readout readout--tight" aria-label="สรุปจำนวนรายการ">
        <div className="readout__cell readout__cell--pear">
          <p className="readout__label">ตรงกับเงื่อนไข</p>
          <p className="readout__figure">
            {count(list.status === "ready" ? list.data.total : 0)}
          </p>
          <p className="readout__note">จาก {count(counts.all ?? 0)} รายการทั้งหมด</p>
        </div>
        <div className="readout__cell readout__cell--mint">
          <p className="readout__label">รับเข้า</p>
          <p className="readout__figure">{count((counts.IN ?? 0) + (counts.RETURN ?? 0))}</p>
          <p className="readout__note">รายการ · รับเข้าและรับคืน</p>
        </div>
        <div className="readout__cell readout__cell--cyan">
          <p className="readout__label">จ่ายออก</p>
          <p className="readout__figure">{count(counts.OUT ?? 0)}</p>
          <p className="readout__note">รายการ · ขายและเบิก</p>
        </div>
        <div className="readout__cell readout__cell--coral">
          <p className="readout__label">ของเสีย</p>
          <p
            className={
              (counts.SCRAP ?? 0) > 0
                ? "readout__figure readout__figure--signal"
                : "readout__figure"
            }
          >
            {count(counts.SCRAP ?? 0)}
          </p>
          <p className="readout__note">รายการ · ไม่นับเป็นต้นทุนขาย</p>
        </div>
      </section>

      {/* สิบชนิดกับอีกสามตัวเลือกผู้เบิก เคยเป็นชิปสิบสามปุ่มพาดสองบรรทัดก่อนถึง
          แถวแรกของสมุด · เหตุผลเดิมของชิป — กดครั้งเดียว เห็นคำตอบโดยไม่ต้องเปิด
          อะไร — ใช้ไม่ได้แล้วเมื่อสิ่งที่เห็นมีมากเกินกว่าจะกวาดตาอ่าน
          จำนวนที่เคยอยู่บนชิปย้ายเข้าไปอยู่ในตัวเลือกแต่ละบรรทัด จึงไม่หายไปไหน */}
      {/* ตัวกรองกับเรียงตามอยู่แถวเดียวกัน — สองแถวซ้อนกันคือความสูงสองเท่า
          ก่อนถึงแถวแรกของสมุด โดยไม่ได้บอกอะไรเพิ่ม */}
      <div className="toolsband">
        <FilterBar>
          <Filter
            id="mv-type"
            label="ประเภท"
            value={type}
            onChange={(v) => refine(() => setType(v))}
            options={TYPES.map((t) => ({
              value: t.key,
              label: withCount(
                t.label,
                list.status === "ready" ? (counts[t.countKey] ?? 0) : undefined,
              ),
            }))}
          />

          {/* การเบิกของสาขาตัดขวางประเภทข้างบน ไม่ใช่ประเภทหนึ่งในนั้น — แถวเดียว
              เป็นได้ทั้ง "จ่ายออก" และ "สาขาอื่นเบิก" พร้อมกัน จึงเป็นคนละช่อง */}
          <Filter
            id="mv-who"
            label="ผู้เบิก"
            value={who}
            onChange={(v) => refine(() => setWho(v))}
            options={WHO}
          />
        </FilterBar>

        {/* ไม่มีปุ่มกลับด้าน — ทุกคอลัมน์ในตารางข้างล่างกดเรียงได้ และกดซ้ำก็กลับด้าน
            อยู่แล้ว ปุ่มบนแถบนี้จึงเป็นทางที่สองไปหาสิ่งเดียวกัน */}
        {/* นอกแถบตัวกรองที่พับบนมือถือ — ปฏิทินกดได้ทันที (ร้านขอ 18 ก.ย. 2026) */}
        <DateRangeField
          from={range.from}
          to={range.to}
          clearable
          placeholder="ทุกวัน"
          onApply={(r) => refine(() => setRange(r))}
        />
        <SortBar
          id="mov"
          columns={sorts(money$)}
          sort={sort}
          dir={dir}
          onSort={pick}
          dirToggle={false}
        />
      </div>

      {list.status === "loading" ? <div className="skeleton" /> : null}

      {list.status === "error" ? (
        <div className="empty">
          <p className="empty__title">โหลดความเคลื่อนไหวไม่ได้</p>
          <p className="empty__body">{list.error}</p>
          <button type="button" className="btn" onClick={list.reload}>
            ลองใหม่
          </button>
        </div>
      ) : null}

      {list.status === "ready" && rows.length === 0 ? (
        <div className="empty">
          <p className="empty__title">ไม่มีความเคลื่อนไหวที่ตรงกับเงื่อนไขนี้</p>
          <button
            type="button"
            className="btn"
            onClick={() =>
              refine(() => {
                setType("");
                setWho("");
                setQ("");
                setApplied("");
              })
            }
          >
            ล้างตัวกรอง
          </button>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <>
          {/* บนมือถือ แถวกลายเป็นการ์ด — ดู RecordCard ว่าทำไมไม่ใช่ตารางที่เลื่อนข้าง */}
          <CardList label="ความเคลื่อนไหวสต็อก">
            {rows.map((r) => (
              <MovementCard key={r.id} row={r} money={money$} onEdit={onEdit} />
            ))}
          </CardList>

          <div className="tablewrap wide-only">
            <table className="grid">
              <caption className="sr-only">ความเคลื่อนไหวสต็อกเรียงจากใหม่ไปเก่า</caption>
              <thead>
                <tr>
                  {/* Six columns, not eight. เอกสาร sits under the ประเภท chip —
                      the paper and the action it authorised belong together —
                      and ราคาขาย sits under the ต้นทุน it is compared against.
                      Both still sort, from the chooser above the table. */}
                  <SortHead label="วันที่" col="date" sort={sort} dir={dir} onSort={pick} />
                  <SortHead label="ประเภท / เอกสาร" col="type" sort={sort} dir={dir} onSort={pick} />
                  <SortHead label="สินค้า" col="product" sort={sort} dir={dir} onSort={pick} />
                  <SortHead label="จำนวน" col="qty" sort={sort} dir={dir} onSort={pick} num />
                  {/* ราคาขาย is readable by every role, cost is not — so the
                      column is named for whichever figure the viewer will get. */}
                  {money$ ? (
                    <SortHead label="ต้นทุน / ราคาขาย" col="cost" sort={sort} dir={dir} onSort={pick} num />
                  ) : (
                    <th scope="col" className="grid__num">ราคาขาย/ชิ้น</th>
                  )}
                  <th scope="col">ใครเบิก</th>
                  {maySettle ? (
                    <th scope="col">
                      <span className="sr-only">แก้ไข</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
<Row key={r.id} row={r} money={money$} onEdit={onEdit} />
                ))}
              </tbody>
            </table>
          </div>

          <Paginator
            page={list.data!.page}
            perPage={list.data!.perPage}
            total={list.data!.total}
            onPage={setPage}
            label="รายการ"
          />
        </>
      ) : null}

      {editing && people.status === "ready" ? (
        <ShopIssueDialog
          row={editing}
          people={people.data.people}
          onClose={() => setEditing(null)}
          onSaved={list.reload}
        />
      ) : null}
    </main>
  );
}

/**
 * ทางแก้ของแถวนี้ — ร้านถามไว้ 12 ก.ย. 2026 ว่าการเบิกของ TimeOptic เบิกผิดแล้วแก้ที่ไหน
 *
 * เฉพาะแถวจ่ายออก · ของสาขาแก้ที่หน้าการเบิกจากสาขา · ของที่ตัดตามเคสต้องแก้ที่หน้าเคส
 * (คืนจากฝั่งคลังแล้วเคสจะยังเชื่อว่าของอยู่กับลูกค้า) · ที่เหลือคือของที่ร้านเบิกเอง
 * แก้และยกเลิกได้ที่นี่ ยกเว้นแถวที่ยกเลิกไปแล้ว
 *
 * แถวตัดของเสียยกเลิกได้ด้วย (ร้านขอไว้ 14 ก.ย. 2026) — ของเสียไม่มีสาขาหรือเคส จึงไม่ต้อง
 * ส่งไปแก้ที่อื่น
 */
function FixAction({ row: r, onEdit }: { row: MovementRow; onEdit: (r: MovementRow) => void }) {
  if (r.actionType === "SCRAP") {
    if (r.returned) return <span className="grid__muted">ยกเลิกแล้ว</span>;
    return (
      <button type="button" className="btn btn--small" onClick={() => onEdit(r)}>
        ยกเลิก
      </button>
    );
  }
  if (r.actionType !== "OUT") return null;
  if (r.branchIssueId !== null) {
    return (
      <Link href="/stock/settlements" className="grid__link">
        แก้ที่หน้าการเบิกจากสาขา
      </Link>
    );
  }
  if (r.caseId !== null) {
    return (
      <a href={`/cases/detail?id=${r.caseId}`} className="grid__link">
        แก้ที่หน้าเคส
      </a>
    );
  }
  if (r.returned) return <span className="grid__muted">คืนแล้ว</span>;
  return (
    <button type="button" className="btn btn--small" onClick={() => onEdit(r)}>
      แก้ไข / ยกเลิก
    </button>
  );
}

/**
 * แถวเดียวกัน คนละร่าง — สำหรับมือถือ
 *
 * เรียงตามลำดับที่คนอ่านจริงบนจอแคบ: นี่คือสินค้าอะไร เกิดอะไรขึ้นกับมัน เมื่อไร
 * เท่าไร ใครเอาไป · ต่างจากตารางที่เรียงตามลำดับที่เทียบข้ามแถวได้ง่าย ซึ่งเป็น
 * คนละงานกับการอ่านทีละใบ
 *
 * ตัวเลขเงินยังเดินตามสิทธิ์ชุดเดิม — คนที่ไม่เห็นต้นทุนได้บรรทัดราคาขายบรรทัด
 * เดียว ไม่ใช่บรรทัดต้นทุนที่ว่างเปล่า
 */
function MovementCard({
  row: r,
  money: showMoney,
  onEdit,
}: {
  row: MovementRow;
  money: boolean;
  onEdit?: (r: MovementRow) => void;
}) {
  const awaitingRxCost = showMoney && r.actionType === "RX_ORDER" && r.unitCost === null;
  const owed = r.branchStatus === "pending";

  const who = r.scrapBy
    ? r.scrapBy
    : r.branchName
      ? `${r.branchName}${r.takenBy ? ` · ${r.takenBy}` : ""}`
      : (r.issuedToName ?? r.actorName ?? "—");

  return (
    <RecordCard
      tone={awaitingRxCost || owed ? "pending" : undefined}
      head={
        <>
          <span className={`tag tag--${r.actionType.toLowerCase().replace("_", "-")}`}>
            {r.actionLabel}
          </span>
          <span className="reccard__when">{dateTime(r.createdAt)}</span>
        </>
      }
      title={shortName(r.productName)}
      sub={r.sku}
      fields={[
        {
          label: "จำนวน",
          value:
            r.quantity === 0 ? (
              <span className="grid__muted">—</span>
            ) : (
              <>
                {r.quantity > 0 ? (
                  <span className="grid__num--in">+{count(r.quantity)}</span>
                ) : (
                  count(r.quantity)
                )}
                <Left n={r.balanceAfter} />
              </>
            ),
        },
        showMoney && {
          label:
            r.actionType === "SETTLE"
              ? "เงินที่รับทั้งใบ"
              : r.actionType === "COST"
                ? "ต้นทุนที่เพิ่งกรอก"
                : r.actionType === "PRICE"
                  ? "ราคาขายที่เพิ่งแก้"
                  : "ต้นทุน/ชิ้น",
          value:
            r.unitCost === null ? (
              awaitingRxCost ? (
                <span className="status status--pending">รอต้นทุน</span>
              ) : (
                <span className="grid__muted">—</span>
              )
            ) : (
              money(r.unitCost)
            ),
        },
        r.salePrice !== null
          ? { label: "ราคาขาย", value: money(r.salePrice) }
          : r.basePrice === null
            ? null
            : { label: "ราคาตอนนี้", value: <span className="grid__muted">{money(r.basePrice)}</span> },
        { label: r.scrapBy ? "ทำเสียโดย" : "ใครเบิก", value: who },
        r.actorName ? { label: "บันทึกโดย", value: r.actorName } : null,
        r.referenceDoc ? { label: "เอกสาร", value: <span className="grid__doc">{r.referenceDoc}</span> } : null,
        r.notes ? { label: "หมายเหตุ", value: r.notes } : null,
      ]}
      actions={onEdit ? <FixAction row={r} onEdit={onEdit} /> : undefined}
    />
  );
}

function Row({
  row: r,
  money: showMoney,
  onEdit,
}: {
  row: MovementRow;
  money: boolean;
  onEdit?: (r: MovementRow) => void;
}) {
  // Without permission to see costs, a null cost says nothing about whether an
  // invoice is outstanding — so it must not tint the row as if it did.
  const awaitingRxCost = showMoney && r.actionType === "RX_ORDER" && r.unitCost === null;
  const owed = r.branchStatus === "pending";

  const cls =
    awaitingRxCost || owed
      ? "grid__row grid__row--pending"
      : r.actionType === "RX_ORDER"
        ? "grid__row grid__row--rx"
        : "grid__row";

  return (
    <tr className={cls}>
      <th scope="row" className="grid__muted grid__when">
        {dateTime(r.createdAt)}
      </th>

      {/* The action, the paper that authorised it, and what the person keying it
          wrote down — one cell, because they are one answer to "what was this".
          They used to be a chip here and a column at the far right of the row,
          which put the reference eight columns away from the thing it refers to. */}
      <td>
        <span className={`tag tag--${r.actionType.toLowerCase().replace("_", "-")}`}>{r.actionLabel}</span>
        {r.referenceDoc ? <span className="grid__sub grid__doc">{r.referenceDoc}</span> : null}
        {r.notes ? <span className="grid__sub">{r.notes}</span> : null}
      </td>

      <td>
        <span className="grid__name">{shortName(r.productName)}</span>
        <span className="grid__sub">{r.sku}</span>
      </td>
      {/* แถวเรื่องเงินไม่มีของเคลื่อน — ขีดกลางบอกว่า "ไม่มีจำนวน" ส่วนเลข 0
          อ่านได้ว่ามีของศูนย์ชิ้นเคลื่อนที่ ซึ่งไม่ใช่เรื่องเดียวกัน */}
      <td className={r.quantity > 0 ? "grid__num grid__num--in" : "grid__num"}>
        {r.quantity === 0
          ? <span className="grid__muted">—</span>
          : r.quantity > 0 ? `+${count(r.quantity)}` : count(r.quantity)}
        {r.quantity !== 0 ? <Left n={r.balanceAfter} block /> : null}
      </td>

      {/* One money column instead of two. Cost leads because it is the figure
          the books are kept in; the selling price follows underneath, named, so
          the two can never be mistaken for each other. Someone not allowed to
          see costs gets the selling price on its own — never a blank column
          where the cost would have been. */}
      {showMoney ? (
        <td className="grid__num">
          {r.unitCost === null ? (
            awaitingRxCost ? (
              <span className="status status--pending">รอต้นทุน</span>
            ) : (
              <span className="grid__muted">—</span>
            )
          ) : (
            <span className="grid__name">{money(r.unitCost)}</span>
          )}
          {/* คอลัมน์นี้ชื่อ "ต้นทุน/ชิ้น" ซึ่งจริงกับแถวของจริง · สองชนิดนี้ตัวเลข
              หมายถึงอย่างอื่น จึงต้องเขียนกำกับไว้ ไม่ใช่ปล่อยให้หัวคอลัมน์โกหก */}
          {r.actionType === "SETTLE" ? <span className="grid__sub">เงินที่รับทั้งใบ</span> : null}
          {r.actionType === "COST" ? <span className="grid__sub">ต้นทุนที่เพิ่งกรอก</span> : null}
          {r.actionType === "PRICE" ? <span className="grid__sub">ราคาขายที่เพิ่งแก้</span> : null}
          {/* ราคาขายบนแถวคือราคา "ณ ตอนนั้น" ถ้ามีบันทึกไว้ — ไม่ใช่ราคาปัจจุบัน
              ของสินค้า · ราคาของงานสั่งตัดเปลี่ยนได้ทุกบิล การเอาราคาปัจจุบันมา
              แปะทุกแถวย้อนหลังทำให้สมุดเล่าเรื่องผิด */}
          {r.salePrice !== null ? (
            <span className="grid__sub">ขาย {money(r.salePrice)}</span>
          ) : r.basePrice === null ? null : (
            <span className="grid__sub grid__muted">ขายตอนนี้ {money(r.basePrice)}</span>
          )}
        </td>
      ) : (
        <td className="grid__num">
          {r.salePrice !== null ? (
            <span className="grid__name">{money(r.salePrice)}</span>
          ) : r.basePrice === null ? (
            <span className="grid__muted">—</span>
          ) : (
            /* ไม่มีราคาบันทึกไว้บนแถวนี้ ก็บอกตรง ๆ ว่าที่เห็นคือราคาปัจจุบัน
               ไม่ใช่ราคาที่ขายไปจริงตอนนั้น */
            <>
              <span className="grid__muted">{money(r.basePrice)}</span>
              <span className="grid__sub">ราคาตอนนี้</span>
            </>
          )}
        </td>
      )}

      {/* Who took the goods. The person who keyed the row sits underneath in
          smaller type, because on most rows they are not the same person and
          the ledger has to be able to say which is which. */}
      <td className="grid__muted">
        {/* ของเสียบอกชื่อคนที่ทำเสียตามที่พิมพ์ไว้ตอนตัด (ร้านขอไว้ 12 ก.ย. 2026) —
            คนละคนกับคนที่คีย์ ซึ่งอยู่บรรทัดล่าง */}
        {r.scrapBy ? (
          <>
            <span className="grid__name">{r.scrapBy}</span>
            <span className="grid__sub">
              ทำเสีย{r.actorName ? ` · บันทึกโดย ${r.actorName}` : ""}
            </span>
          </>
        ) : r.branchName ? (
          <>
            <span className="grid__name">{r.branchName}</span>
            <span className="grid__sub">
              {r.takenBy ?? ""}
              {r.actorName ? `${r.takenBy ? " · " : ""}บันทึกโดย ${r.actorName}` : ""}
            </span>
          </>
        ) : r.issuedToName ? (
          <>
            <span className="grid__name">{r.issuedToName}</span>
            {r.actorName && r.actorName !== r.issuedToName ? (
              <span className="grid__sub">บันทึกโดย {r.actorName}</span>
            ) : null}
          </>
        ) : r.actorName ? (
          <>
            <span className="grid__name">{r.actorName}</span>
            <span className="grid__sub">ผู้บันทึก</span>
          </>
        ) : (
          "—"
        )}
      </td>
      {onEdit ? (
        <td className="grid__act">
          <FixAction row={r} onEdit={onEdit} />
        </td>
      ) : null}
    </tr>
  );
}

/**
 * ยอดคงเหลือหลังรายการนี้ — ร้านขอ 18 ก.ย. 2026 · "+1" หรือ "-1" อย่างเดียวไม่บอกว่าตอนนั้น
 * เหลือเท่าไร ต้องไปนับย้อนเอง · สีหม่นไว้ข้างใต้ ตัวเลขที่เคลื่อนยังเป็นเรื่องหลักของแถว
 */
function Left({ n, block = false }: { n: number | null; block?: boolean }) {
  if (n === null) return null;
  return (
    <span className={block ? "grid__sub" : "grid__muted"} style={block ? undefined : { marginInlineStart: 6 }}>
      เหลือ {count(n)}
    </span>
  );
}
