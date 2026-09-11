"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Paginator from "./Paginator";
import SortHead, { SortBar, useSort } from "./SortHead";
import LensFilters from "./LensFilters";
import { Filter, FilterBar } from "./FilterBar";
import LensCells from "./LensCells";
import ProductCell from "./ProductCell";
import RecordCard, { CardList } from "./RecordCard";
import LensDetail from "./LensDetail";
import { can, useActor } from "./AppShell";
import { qs, useApi } from "@/stockmod/lib/useApi";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABEL,
  type LensOptions,
  type Page,
  type ProductRow,
} from "@/stockmod/lib/api";
import { count, money } from "@/stockmod/lib/format";

type SortKey =
  | "sku" | "name" | "brand" | "onhand" | "price" | "type" | "eye"
  | "index" | "design" | "coating" | "sph";
const NATURAL_ASC: readonly SortKey[] = [
  "sku", "name", "brand", "type", "eye", "index", "design", "coating", "sph",
];

/** The same columns the table headers offer, named for the toolbar chooser. */
const SORTS: readonly { col: SortKey; label: string }[] = [
  { col: "name", label: "ชื่อสินค้า" },
  { col: "sku", label: "SKU" },
  { col: "brand", label: "แบรนด์" },
  { col: "type", label: "ชนิดสินค้า" },
  { col: "eye", label: "ข้างตา" },
  { col: "index", label: "Index" },
  { col: "design", label: "ชนิดเลนส์" },
  { col: "coating", label: "Coating" },
  { col: "sph", label: "ค่าสายตา SPH" },
  { col: "onhand", label: "คงเหลือ" },
  { col: "price", label: "ราคาขาย" },
];

/**
 * The catalogue's five drawers, as a filter.
 *
 * Sorting by type only groups them; it still pages through the frames to reach
 * the contact lenses. Someone at the shelf holding a box of solution wants the
 * other four kinds gone, which is a filter, not an order.
 */
const TYPES = [
  { key: "", label: "ทุกชนิด" },
  ...PRODUCT_TYPES.map((t) => ({ key: t as string, label: PRODUCT_TYPE_LABEL[t] })),
];

const EYES = [
  { key: "", label: "ทุกข้าง" },
  { key: "left", label: "L · ตาซ้าย" },
  { key: "right", label: "R · ตาขวา" },
] as const;

/**
 * Pick the product this task is about, then get out of the way.
 *
 * Laid out as a full-width list — the same shape as the catalogue index, because
 * it is the same job: read down a table of stock and choose a row. It was
 * previously boxed inside a card with a capped height, which turned a page of
 * stock into a small scrolling window and pushed the pager out of sight.
 *
 * Nothing here is wrapped in a surface of its own: the toolbar, the table and
 * the pager sit directly on the page so the table gets the whole width, exactly
 * as it does on /products.
 *
 * `only` narrows what may be picked, so a page never offers a row its own form
 * would refuse: "ready" hides made-to-order lenses (no stock to draw, no lots to
 * receive), and "rx" shows only what may be special-ordered — made to order, or
 * stocked and run out.
 */
/**
 * The chosen product, said back.
 *
 * Up to the moment of choosing, the table was helping tell one lens from
 * another. From here the only check left is "is this the right lens", asked
 * against a job sheet — so every value is named the way the sheet names it,
 * rather than left as a row of bare figures.
 */
export function PickedSummary({ row, showName = true }: { row: ProductRow; showName?: boolean }) {
  return (
    <div className="picked__what">
      {showName ? (
      <span className="picked__name">
        {row.name}
        {row.eyeSide === "left" || row.eyeSide === "right" ? (
          <span className="eye eye--inline">
            {row.eyeSide === "left" ? "L" : "R"}
            <span className="sr-only">{row.eyeSide === "left" ? "ตาซ้าย" : "ตาขวา"}</span>
          </span>
        ) : null}
      </span>
      ) : null}
      <span className="picked__sub">
        {row.sku}
        {row.brand ? ` · ${row.brand}` : ""}
        {row.isCustomMade ? " · สั่งตัด" : ` · คงเหลือ ${count(row.onHand)}`}
      </span>
      <LensDetail row={row} />
    </div>
  );
}

export default function ProductPicker({
  value,
  onPick,
  only = "all",
  label = "สินค้า",
  autoFocus = false,
  /** Sorting the list by what is left only makes sense where stock is the point. */
  defaultSort = "sku",
  perPage = 12,
  refresh = 0,
  pickLabel = "เลือก",
  reserved = {},
  requireStock = false,
  sortSlotId,
}: {
  /**
   * What the button on each row says.
   *
   * On the withdrawal screen a row does not open anything — it drops the
   * product straight into the basket — and a button that says "เลือก" for that
   * is a button that lies about what it is about to do.
   */
  pickLabel?: string;
  value: ProductRow | null;
  onPick: (p: ProductRow | null) => void;
  only?: "all" | "ready" | "custom" | "rx";
  label?: string;
  autoFocus?: boolean;
  defaultSort?: SortKey;
  perPage?: number;
  /**
   * Bumped by the page after it writes, to re-read the list.
   *
   * The list used to reload by itself: choosing a row stopped the fetch and
   * clearing the choice started a fresh one. Now the form is a dialog over the
   * list and nothing about the list changes when a row is chosen — so the page
   * that just cut the stock has to say so, or the counts on screen are the ones
   * from before the cut.
   */
  refresh?: number;
  /**
   * จำนวนที่ถูกจองไว้ในตะกร้าแล้ว แยกตาม SKU
   *
   * คอลัมน์คงเหลือหักส่วนนี้ออกก่อนแสดง เพราะเลขที่คนอ่านตอนกำลังเลือกของชิ้น
   * ถัดไปคือ "เหลือให้หยิบอีกเท่าไร" ไม่ใช่ "บนชั้นมีเท่าไรตอนเปิดหน้า" · ของ
   * ที่อยู่ในตะกร้าถูกนับไปแล้วครั้งหนึ่ง นับซ้ำในคอลัมน์นี้คือชวนให้หยิบเกิน
   *
   * ยอดจริงบนชั้นไม่ได้หายไปไหน มันอยู่บรรทัดล่างว่าตะกร้ากินไปเท่าไร เพราะเลข
   * ที่ลดลงโดยไม่บอกว่าลดเพราะอะไร อ่านเหมือนของหายจากคลัง
   */
  reserved?: Record<string, number>;
  /**
   * แถวที่ไม่เหลือของให้หยิบ ไม่ต้องมีปุ่มและกดไม่ได้
   *
   * ใช้กับหน้าจอที่การกดแถวแปลว่า "เอาของชิ้นนี้ออกจากคลัง" เท่านั้น · หน้าที่
   * เลือกสินค้าเพื่อทำอย่างอื่น — รับล็อตใหม่เข้า แก้ข้อมูล เปิดใบสั่งพิเศษ —
   * ต้องเลือกของที่หมดได้ ของที่หมดคือเหตุผลที่เปิดหน้านั้นตั้งแต่แรก จึงไม่
   * เปิดค่านี้ให้ทั้งหมดโดยปริยาย
   *
   * ตัดที่ยอดหลังหัก `reserved` ไม่ใช่ยอดบนชั้น — ของที่ตะกร้าจองไปหมดแล้วก็คือ
   * ไม่เหลือให้หยิบเหมือนกัน · คอลัมน์คงเหลือบอกไว้แล้วว่าทำไมกดไม่ได้ ปุ่มที่
   * หายไปเงียบ ๆ ข้าง ๆ ป้าย "หมด" จึงไม่ต้องอธิบายตัวเองซ้ำ
   */
  requireStock?: boolean;
  /**
   * ย้ายแถบ "เรียงตาม" ไปไว้ในกล่องที่หน้านั้นเตรียมไว้ให้ แทนที่จะอยู่ท้ายแถบ
   * เครื่องมือของรายการ
   *
   * หน้าเบิก/ตัดสต็อกมีปุ่มตะกร้าอยู่บนหัวเพจ และการเรียงลำดับเป็นของคู่กัน
   * ในสายตาคนใช้ · ส่งเป็น id ของ element ไม่ใช่ ref เพราะกล่องปลายทางอยู่
   * คนละต้นไม้ (หัวเพจเรนเดอร์โดย WorkHead) และรายการนี้ไม่ได้เป็นลูกของมัน
   */
  sortSlotId?: string;
}) {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [eye, setEye] = useState("");
  const [ptype, setPtype] = useState("");
  const [lindex, setLindex] = useState("");
  const [design, setDesign] = useState("");
  const [coating, setCoating] = useState("");
  const [page, setPage] = useState(1);
  const { sort, dir, sortBy } = useSort<SortKey>(defaultSort, NATURAL_ASC);

  /**
   * เคอร์เซอร์รออยู่ในช่องค้นหาให้เลย — เฉพาะจอกว้าง
   *
   * บนคอมพิวเตอร์ คนที่เปิดหน้าเบิกมาคือคนที่กำลังจะพิมพ์ SKU ต่อทันที การรอ
   * ให้เขาคลิกช่องก่อนทุกใบคือคลิกที่ไม่ได้ให้อะไร
   *
   * บนมือถือมันแพงกว่านั้นมาก · โฟกัสเรียกแป้นพิมพ์ขึ้นมาเองตั้งแต่หน้าโหลด
   * เสร็จ กินครึ่งจอโดยไม่มีใครขอ และแถบเมนูล่างจอซ่อนตัวเองระหว่างที่มีช่อง
   * ไหนถูกโฟกัสอยู่ (`body:has(input:focus)` ใน globals.css — กติกาที่ถูกต้อง
   * สำหรับ "กำลังพิมพ์") · สองอย่างรวมกันแปลว่าคนที่แค่เปิดหน้าเบิกผ่านมา
   * เห็นแถบล่างหายไปทั้งแถบทันที และไม่มีทางไปหน้าอื่นจนกว่าจะรู้ว่าต้องกดปิด
   * แป้นพิมพ์ก่อน — ซึ่งไม่มีอะไรบนจอบอก
   *
   * ใช้ effect ไม่ใช่ prop `autoFocus` เพราะคำถามคือ "จอกว้างแค่ไหน" ซึ่งตอบได้
   * หลัง mount เท่านั้น · ถามครั้งเดียวตอนเปิดหน้า ไม่ตามการหมุนจอ — คนที่หมุน
   * จอกลางคันไม่ได้กำลังขอให้เคอร์เซอร์กระโดด
   */
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    if (window.matchMedia("(max-width: 40rem)").matches) return;
    searchRef.current?.focus();
  }, [autoFocus]);

  /* กล่องปลายทางของแถบเรียงลำดับ — หาเจอได้หลัง mount เท่านั้น จึงเก็บเป็น state
     ให้เรนเดอร์รอบถัดไปพาแถบไปวาง · ไม่มี id ส่งมา หรือหาไม่เจอ ก็อยู่ที่เดิม */
  const [sortSlot, setSortSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSortSlot(sortSlotId ? document.getElementById(sortSlotId) : null);
  }, [sortSlotId]);

  const money$ = can.seeCost(useActor());

  // Skipped entirely once something is picked — the form below is the work now,
  // and a list of alternatives underneath it is noise.
  const list = useApi<Page<ProductRow>>(
    value === null
      ? `/products${qs({
          q: applied,
          make: only === "all" ? "" : only,
          eye,
          type: ptype,
          index: lindex,
          design,
          coating,
          sort,
          dir,
          per: perPage,
          page,
        })}`
      : null,
  );

  const { reload } = list;
  useEffect(() => {
    if (refresh > 0) reload();
  }, [refresh, reload]);

  const pick = (c: SortKey) => sortBy(c, () => setPage(1));

  /**
   * Whether the lens columns and the lens filters are worth their space.
   *
   * Driven by what is on screen rather than by a setting: a list with no lens in
   * it gets neither, and a list narrowed to lenses gets both without anyone
   * turning anything on. The filter itself keeps them shown once used, or
   * clearing the last lens out of view would take the control away with it.
   */
  /**
   * The two lens columns appear on their own, the lens filters do not.
   *
   * Columns follow the rows: a list with a lens in it shows what tells one lens
   * from the next, without anyone turning anything on. The filters are a third
   * row of controls, and three rows of controls above a table is most of a
   * tablet screen spent on chrome — so they wait until someone has actually
   * asked for lenses by pressing the chip.
   */
  const lensCols =
    list.status === "ready" && list.data.rows.some((r) => r.productType === "Lens");
  const lensFilters = ptype === "Lens";

  /** Leaving the lens aisle takes the lens filters with it, rather than leaving
   *  an invisible narrowing on a list that no longer offers a way to see it. */
  function chooseType(next: string) {
    refine(() => {
      setPtype(next);
      if (next !== "Lens") {
        setLindex("");
        setDesign("");
        setCoating("");
      }
    });
  }

  function refine(fn: () => void) {
    fn();
    setPage(1);
  }

  if (value !== null) {
    return (
      <div className="picked">
        <PickedSummary row={value} />
        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={() => {
            onPick(null);
            setQ("");
            setApplied("");
            setPage(1);
          }}
        >
          เปลี่ยนสินค้า
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="listtools">
        <form
          className="toolsearch"
          onSubmit={(e) => {
            e.preventDefault();
            refine(() => setApplied(q.trim()));
          }}
        >
          <label className="sr-only" htmlFor="pick-q">
            {label}
          </label>
          <input
            id="pick-q"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="พิมพ์ SKU ชื่อสินค้า หรือแบรนด์"
            autoComplete="off"
            ref={searchRef}
          />
          <button type="submit" className="btn btn--primary">
            ค้นหา
          </button>
          {applied ? (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() =>
                refine(() => {
                  setQ("");
                  setApplied("");
                })
              }
            >
              ล้าง
            </button>
          ) : null}
        </form>

        {/* Sort travels at the end of the bar; the narrowing moved to its own
            row below, where every filter now sits together as dropdowns.
            A page may ask for it up in its own header instead — see sortSlotId. */}
        {sortSlotId ? null : (
          <div className="listtools__end">
            <SortBar id="pick" columns={SORTS} sort={sort} dir={dir} onSort={pick} />
          </div>
        )}

      {sortSlot
        ? createPortal(
            <SortBar id="pick" columns={SORTS} sort={sort} dir={dir} onSort={pick} />,
            sortSlot,
          )
        : null}

      {/* ตัวกรองอยู่ในแถบเครื่องมือแถวเดียวกับช่องค้นหา ไม่ใช่แถวของตัวเองใต้มัน —
          ทั้งสองอย่างตัดขอบเขตของรายการข้างล่างเหมือนกัน และแถวที่สองที่มีแค่
          ดรอปดาวน์สองช่องคือความสูงที่จ่ายไปเพื่อบรรทัดว่างครึ่งบรรทัด
          ดรอปดาวน์ทั้งหมด — ข้างตา ชนิดสินค้า แล้วต่อด้วยช่องเฉพาะเลนส์ตอนเลือก
          "เลนส์" · เดิมเป็นชิปสามแถวซ้อนกันเหนือรายการสินค้า */}
      <FilterBar>
        <Filter
          id="pk-eye"
          label="ข้างตา"
          value={eye}
          onChange={(v) => refine(() => setEye(v))}
          options={EYES.map((e) => ({ value: e.key, label: e.label }))}
        />

        <Filter
          id="pk-type"
          label="ชนิดสินค้า"
          value={ptype}
          onChange={chooseType}
          options={TYPES.map((t) => ({ value: t.key, label: t.label }))}
        />

        {lensFilters ? (
          <LensFilters
            index={lindex}
            design={design}
            coating={coating}
            onIndex={(v) => refine(() => setLindex(v))}
            onDesign={(v) => refine(() => setDesign(v))}
            onCoating={(v) => refine(() => setCoating(v))}
            // `only` is the important one: this picker may be showing stock only,
            // or made-to-order only, and a count over the whole catalogue would
            // offer a choice that empties the table.
            scope={{ q: applied, eye, make: only === "all" ? "" : only }}
          />
        ) : null}
      </FilterBar>
      </div>

      {list.status === "loading" ? <div className="skeleton" /> : null}

      {list.status === "error" ? (
        <div className="empty">
          <p className="empty__title">โหลดรายการสินค้าไม่ได้</p>
          <p className="empty__body">{list.error}</p>
          <button type="button" className="btn" onClick={list.reload}>
            ลองใหม่
          </button>
        </div>
      ) : null}

      {list.status === "ready" && list.data.rows.length === 0 ? (
        <div className="empty">
          <p className="empty__title">
            {applied ? `ไม่พบสินค้าที่ตรงกับ “${applied}”` : "ไม่มีสินค้าในกลุ่มนี้"}
          </p>
          {applied || eye || ptype ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                refine(() => {
                  setQ("");
                  setApplied("");
                  setEye("");
                  setPtype("");
                })
              }
            >
              ล้างตัวกรอง
            </button>
          ) : null}
        </div>
      ) : null}

      {list.status === "ready" && list.data.rows.length > 0 ? (
        <>
          {/* บนมือถือ สินค้าหนึ่งตัว = การ์ดหนึ่งใบ · ปุ่มเลือกอยู่ล่างการ์ด และทั้ง
              ใบกดได้ด้วย เพราะบนจอสัมผัสเป้าที่ใหญ่ที่สุดคือเป้าที่กดไม่พลาด */}
          <CardList label={label}>
            {list.data.rows.map((r) => {
              const left = Math.max(0, r.onHand - (reserved[r.sku] ?? 0));
              const takeable = !requireStock || (!r.isCustomMade && left > 0);
              const spec = [r.lensIndex, r.lensDesign, r.coating].filter(Boolean).join(" · ");
              const power = [
                r.sph === null ? null : `SPH ${r.sph}`,
                r.cyl === null ? null : `CYL ${r.cyl}`,
                r.axis === null ? null : `AXIS ${r.axis}`,
                r.add ? `ADD ${r.add}` : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <RecordCard
                  key={r.id}
                  onOpen={takeable ? () => onPick(r) : undefined}
                  tone={takeable ? undefined : "muted"}
                  head={
                    r.isCustomMade ? (
                      <span className="status status--rx">สั่งตัด</span>
                    ) : r.onHand <= 0 ? (
                      <span className="status status--out">หมด</span>
                    ) : (
                      <>
                        <span className="reccard__money">{count(left)}</span>
                        {reserved[r.sku] ? (
                          <span className="reccard__when">ในตะกร้า {count(reserved[r.sku])}</span>
                        ) : null}
                      </>
                    )
                  }
                  title={r.name}
                  sub={[r.sku, r.brand].filter(Boolean).join(" · ")}
                  fields={[
                    { label: "ชนิด", value: PRODUCT_TYPE_LABEL[r.productType] ?? r.productType },
                    spec ? { label: "สเปกเลนส์", value: spec } : null,
                    power ? { label: "ค่าสายตา", value: <span className="grid__rx">{power}</span> } : null,
                    { label: "ราคาขาย", value: money(r.basePrice) },
                    money$ && r.nextCost !== null
                      ? { label: "ต้นทุนถัดไป", value: money(r.nextCost) }
                      : null,
                  ]}
                  actions={
                    takeable ? (
                      <button
                        type="button"
                        className="btn btn--primary btn--small"
                        onClick={() => onPick(r)}
                      >
                        {pickLabel}
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </CardList>

          <div className="tablewrap wide-only">
            <table className="grid">
              <caption className="sr-only">รายการสินค้าในคลัง — คลิกแถวเพื่อเลือก</caption>
              <thead>
                <tr>
                  {/* SKU, แบรนด์ and ข้าง are inside the สินค้า cell rather than
                      three columns of their own — the same table, three columns
                      narrower, with the width spent on what actually tells one
                      lens from the next. All three still sort from the toolbar. */}
                  <SortHead label="สินค้า" col="name" sort={sort} dir={dir} onSort={pick} />
                  <SortHead label="ชนิด" col="type" sort={sort} dir={dir} onSort={pick} />
                  {lensCols ? (
                    <>
                      <SortHead label="สเปกเลนส์" col="index" sort={sort} dir={dir} onSort={pick} />
                      <SortHead label="ค่าสายตา" col="sph" sort={sort} dir={dir} onSort={pick} />
                    </>
                  ) : null}
                  <SortHead label="คงเหลือ" col="onhand" sort={sort} dir={dir} onSort={pick} num />
                  <SortHead label="ราคาขาย" col="price" sort={sort} dir={dir} onSort={pick} num />
                  {money$ ? <th scope="col" className="grid__num">ต้นทุนถัดไป</th> : null}
                  <th scope="col">
                    <span className="sr-only">เลือก</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => {
                  const left = Math.max(0, r.onHand - (reserved[r.sku] ?? 0));
                  const takeable = !requireStock || (!r.isCustomMade && left > 0);

                  return (
                  <tr
                    key={r.id}
                    className={takeable ? "grid__row grid__row--clickable" : "grid__row"}
                    onClick={takeable ? () => onPick(r) : undefined}
                    tabIndex={takeable ? 0 : undefined}
                    role={takeable ? "button" : undefined}
                    aria-label={takeable ? `${pickLabel} ${r.name}` : undefined}
                    onKeyDown={
                      takeable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onPick(r);
                            }
                          }
                        : undefined
                    }
                  >
                    <ProductCell row={r} />
                    <td>{PRODUCT_TYPE_LABEL[r.productType] ?? r.productType}</td>
                    {lensCols ? <LensCells row={r} /> : null}
                    <td className="grid__num">
                      {r.isCustomMade ? (
                        <span className="status status--rx">สั่งตัด</span>
                      ) : r.onHand <= 0 ? (
                        <span className="status status--out">หมด</span>
                      ) : (
                        <>
                          {count(left)}
                          {reserved[r.sku] ? (
                            <span className="grid__reserved">
                              ในตะกร้า {count(reserved[r.sku])}
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="grid__num">{money(r.basePrice)}</td>
                    {money$ ? (
                      <td className="grid__num">
                        {r.nextCost === null ? (
                          <span className="grid__muted">—</span>
                        ) : (
                          money(r.nextCost)
                        )}
                      </td>
                    ) : null}
                    <td>
                      {takeable ? (
                        <span className="btn btn--small grid__pick" aria-hidden="true">
                          {pickLabel}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
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
    </>
  );
}
