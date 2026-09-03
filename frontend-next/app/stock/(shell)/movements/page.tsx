"use client";

import { useState } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import Paginator from "@/stockmod/components/Paginator";
import SortHead, { SortBar, useSort } from "@/stockmod/components/SortHead";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count, date, money } from "@/stockmod/lib/format";
import type { MovementRow, Page } from "@/stockmod/lib/api";

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
  const { sort, dir, sortBy } = useSort<SortKey>("date", NATURAL_ASC);

  const actor = useActor();
  const money$ = can.seeCost(actor);
  const list = useApi<List>(`/movements${qs({ type, q: applied, who, sort, dir, page })}`);
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

      <div className="chips chips--bar" role="group" aria-label="กรองตามประเภท">
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            className="chip"
            aria-current={type === t.key ? "true" : undefined}
            onClick={() => refine(() => setType(t.key))}
          >
            {t.key ? (
              <span
                className={`chip__dot tag--${t.key.toLowerCase().replace("_", "-")}`}
                aria-hidden="true"
              />
            ) : null}
            {t.label}
            {list.status === "ready" ? (
              <span className="chip__count">{count(counts[t.countKey] ?? 0)}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* A branch withdrawal cuts across the action types above rather than
          being one of them, so it filters separately. */}
      <div className="chips chips--bar" role="group" aria-label="กรองตามผู้เบิก">
        <button
          type="button"
          className="chip"
          aria-current={who === "" ? "true" : undefined}
          onClick={() => refine(() => setWho(""))}
        >
          ทุกคน
        </button>
        <button
          type="button"
          className="chip"
          aria-current={who === "branch" ? "true" : undefined}
          onClick={() => refine(() => setWho("branch"))}
        >
          สาขาอื่นเบิก
        </button>
        <button
          type="button"
          className="chip"
          aria-current={who === "owed" ? "true" : undefined}
          onClick={() => refine(() => setWho("owed"))}
        >
          ยังค้างเงิน
        </button>
      </div>

      <SortBar id="mov" columns={sorts(money$)} sort={sort} dir={dir} onSort={pick} />

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
          <div className="tablewrap">
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
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
<Row key={r.id} row={r} money={money$} />
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
    </main>
  );
}

function Row({ row: r, money: showMoney }: { row: MovementRow; money: boolean }) {
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
        {date(r.createdAt)}
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
        <span className="grid__name">{r.productName}</span>
        <span className="grid__sub">{r.sku}</span>
      </td>
      {/* แถวเรื่องเงินไม่มีของเคลื่อน — ขีดกลางบอกว่า "ไม่มีจำนวน" ส่วนเลข 0
          อ่านได้ว่ามีของศูนย์ชิ้นเคลื่อนที่ ซึ่งไม่ใช่เรื่องเดียวกัน */}
      <td className={r.quantity > 0 ? "grid__num grid__num--in" : "grid__num"}>
        {r.quantity === 0
          ? <span className="grid__muted">—</span>
          : r.quantity > 0 ? `+${count(r.quantity)}` : count(r.quantity)}
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
        {r.branchName ? (
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
    </tr>
  );
}
