"use client";

import { useState } from "react";
import { can, useActor, WorkHead } from "@/app/components/AppShell";
import { useToast } from "@/app/components/Toaster";
import Paginator from "@/app/components/Paginator";
import SortHead, { SortBar, useSort } from "@/app/components/SortHead";
import LensFilters from "@/app/components/LensFilters";
import LensCells from "@/app/components/LensCells";
import ProductCell from "@/app/components/ProductCell";
import NewProductDialog from "@/app/components/NewProductDialog";
import StockDrawer from "@/app/components/StockDrawer";
import StockLines from "@/app/components/StockLines";
import InlineEdit from "@/app/components/InlineEdit";
import { api, ApiError } from "@/lib/api";
import { qs, useApi } from "@/lib/useApi";
import { count, money } from "@/lib/format";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABEL,
  type Page,
  type ProductRow,
  type Summary,
} from "@/lib/api";

/**
 * This screen is about stock, so it lists only goods that have any.
 *
 * A made-to-order lens is never received, never counted and never on a shelf —
 * it is ordered against one customer's job and goes straight to them. Listing
 * it here put rows with no quantity, no lot and no cost among rows that have
 * all three, and every column had to grow a dash to explain itself. Those live
 * on the RX screen, which is the one place that knows what to do with them.
 */
const ONLY_STOCK = "ready";

/**
 * What the lot list used to answer, asked here instead.
 *
 * "Which lots are still waiting on an invoice" is a question about the shop,
 * not about one product, and it was the reason the lot screen existed. Asked
 * of products, the answer is the row you would open to do something about it —
 * which is this row, with its lots underneath.
 */
const STATES = [
  { key: "", label: "ทั้งหมด" },
  { key: "in", label: "มีของ" },
  { key: "awaiting-cost", label: "รอต้นทุน" },
  { key: "expiring", label: "ใกล้หมดอายุ" },
  { key: "low", label: "ต่ำกว่าขั้นต่ำ" },
  { key: "out", label: "หมดสต็อก" },
] as const;

/**
 * The three of those that are a job rather than a view.
 *
 * "มีของ" and "หมดสต็อก" describe the shelf; these three say something is wrong
 * with it and name what to do — order more, chase an invoice, sell it before it
 * expires. They keep their tally in the accent the rest of the app warns in, so
 * the one chip worth pressing today can be found without reading all eleven.
 *
 * Colour rather than a row of their own: pulling them out into a second group
 * made the bar clearer and taller, and taller was the thing that was wrong
 * with it.
 */
const ALERTS: readonly string[] = ["low", "awaiting-cost", "expiring"];

type StateCounts = Record<string, number>;

type SortKey =
  | "added" | "sku" | "name" | "brand" | "onhand" | "price" | "type" | "eye"
  | "index" | "design" | "coating" | "sph";
const NATURAL_ASC: readonly SortKey[] = [
  "sku", "name", "brand", "type", "eye", "index", "design", "coating", "sph",
];

/** The same columns the table headers offer, named for the toolbar chooser.
 *
 * "เพิ่มล่าสุด" has no header of its own — it is not a column, it is the order
 * the rows arrived in — so the chooser is the only place it can be named. It is
 * also the default, which is why it leads the list. */
const SORTS: readonly { col: SortKey; label: string }[] = [
  { col: "added", label: "เพิ่มล่าสุด" },
  { col: "sku", label: "SKU" },
  { col: "name", label: "ชื่อสินค้า" },
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
 * the contact lenses. Wanting to see one kind means hiding the other four.
 *
 * Chips, on the same line as the stock filters rather than a line below them.
 * Both are one tap and both show their answer without being opened, which is
 * what a picker gives up; what they cost is height, and height is paid for once
 * by putting the two groups on one wrapping row and making every chip shorter
 * rather than by hiding either group behind a dropdown.
 */
const TYPES = [
  { key: "", label: "ทุกชนิด" },
  ...PRODUCT_TYPES.map((t) => ({ key: t as string, label: PRODUCT_TYPE_LABEL[t] })),
];

/**
 * The catalogue index — what exists, how much of it, and what it is worth.
 *
 * A reference screen, not a working one: the day's actual work happens on the
 * task pages. Opening a row gives the product's own detail, its lots and its
 * history; the movements it can start from there are corrections, not routine.
 */
export default function ProductsPage() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");

  const [ptype, setPtype] = useState("");
  const [lindex, setLindex] = useState("");
  const [design, setDesign] = useState("");
  const [coating, setCoating] = useState("");
  const [page, setPage] = useState(1);
  const { sort, dir, sortBy } = useSort<SortKey>("added", NATURAL_ASC);
  const [openId, setOpenId] = useState<number | null>(null);

  /** Which product's lots are unfolded. One at a time — this is a table. */
  const [openRow, setOpenRow] = useState<number | null>(null);
  /**
   * A product to unfold with its receiving form already open.
   *
   * Set when the add-product dialog says "what you want is a lot under the one
   * that already exists" and that offer is taken. Cleared as soon as the fold
   * is toggled by hand, so reopening the row later gives the row, not the form
   * again.
   */
  const [receiveInto, setReceiveInto] = useState<number | null>(null);
  const [state, setState] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const actor = useActor();
  const toast = useToast();
  // Whole columns and tiles go away rather than being drawn empty: a dash where
  // a number belongs reads as missing data, not as "not yours to see".
  const money$ = can.seeCost(actor);
  const summary = useApi<Summary>("/summary");
  const list = useApi<Page<ProductRow> & { stateCounts?: StateCounts }>(
    `/products${qs({ q: applied, make: ONLY_STOCK, type: ptype, index: lindex, design, coating, state, sort, dir, page, counts: "1" })}`,
  );

  const counts = list.status === "ready" ? list.data.stateCounts : undefined;

  function reload() {
    list.reload();
    summary.reload();
  }

  // Any change to what is being looked for starts again from the top. Staying
  // on page 7 of a different result set shows a page that means nothing.
  function refine(fn: () => void) {
    fn();
    setPage(1);
  }

  const pick = (c: SortKey) => sortBy(c, () => setPage(1));

  /**
   * Whether the lens columns and the lens filters are worth their space.
   *
   * Driven by what is on screen rather than by a setting: a list with no lens in
   * it gets neither, and a list narrowed to lenses gets both without anyone
   * turning anything on. Kept shown once a lens filter is in use, or clearing
   * the last lens out of view would take the control away with it.
   */
  /**
   * The lens columns are for comparing lenses, so they wait until that is what
   * the list is.
   *
   * They used to appear whenever a single lens was anywhere on the page, which
   * on a mixed list meant two wide columns of dashes: a shop stocks four lenses
   * and thirty other things, and thirty rows paid for the four. Filtered to
   * lenses every row fills them and the comparison is the point of the screen.
   *
   * On a mixed list the same facts still travel with the lens — printed under
   * its name, where they cost nothing from the rows that have none.
   */
  const lensCols = ptype === "Lens";
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

  return (
    <main className="work-main">
      <WorkHead
        title="สินค้าและสต็อก"
        lede="กดที่แถวสินค้าเพื่อดูล็อตของมัน — แก้จำนวน ลงต้นทุน หรือรับของเข้าล็อตใหม่ได้ตรงนั้น"
      >
        <form
          className="toolsearch"
          onSubmit={(e) => {
            e.preventDefault();
            refine(() => setApplied(q.trim()));
          }}
        >
          <label className="sr-only" htmlFor="p-q">
            ค้นหาสินค้า
          </label>
          <input
            id="p-q"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SKU ชื่อสินค้า หรือแบรนด์"
            autoComplete="off"
          />
          <button type="submit" className="btn btn--primary">
            ค้นหา
          </button>
        </form>
        {can.editCatalog(actor) ? (
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            เพิ่มสินค้า
          </button>
        ) : null}
      </WorkHead>

      {summary.status === "ready" ? (
        <section className="readout" aria-label="สรุปตัวเลข">
          <div className="readout__cell readout__cell--pear">
            <p className="readout__label">สินค้าทั้งหมด</p>
            <p className="readout__figure">{count(summary.data.products)}</p>
            <p className="readout__note">รายการในแคตตาล็อก</p>
          </div>
          <div className="readout__cell readout__cell--mint">
            <p className="readout__label">คงคลังรวม</p>
            <p className="readout__figure">{count(summary.data.onHand)}</p>
            <p className="readout__note">ชิ้น จาก {count(summary.data.lots)} ล็อต</p>
          </div>
          {money$ ? (
            <div className="readout__cell readout__cell--cyan">
              <p className="readout__label">มูลค่าต้นทุนคงเหลือ</p>
              <p className="readout__figure">{money(summary.data.stockValue ?? 0)}</p>
              <p className="readout__note">บาท · นับเฉพาะล็อตที่รู้ต้นทุน</p>
            </div>
          ) : null}
          <div className="readout__cell readout__cell--coral">
            <p className="readout__label">ล็อตรอใบกำกับ</p>
            <p
              className={
                summary.data.lotsMissingCost > 0
                  ? "readout__figure readout__figure--signal"
                  : "readout__figure"
              }
            >
              {count(summary.data.lotsMissingCost)}
            </p>
            <p className="readout__note">ล็อตที่ยังไม่รู้ต้นทุน · ใบสั่ง RX นับแยกที่หน้า RX</p>
          </div>
        </section>
      ) : null}

      <div className="listtools">
        {/* Left and right stopped being a filter here when the made-to-order
            lenses moved to the RX screen: a side belongs to a customer’s job,
            and nothing this screen lists has one. */}
        <SortBar id="prod" columns={SORTS} sort={sort} dir={dir} onSort={pick} />
      </div>

      {/* Both filters on one wrapping row, in short chips.
          They used to be two full-height rows stacked under the sort strip,
          which is three bands of controls before the first product. Chips are
          still the right control — one tap, and the answer is readable without
          opening anything — so what changed is their height and their line,
          not what they are. The separator is there so the two groups still read
          as two questions when they share a line. */}
      <div className="chipbar">
        <div className="chips chips--tight" role="group" aria-label="กรองตามสถานะสต็อก">
          {STATES.map((s) => {
            const n = counts?.[s.key || "all"];
            // A job rather than a view, and only while it has something in it.
            // Zero of something is not a warning, so it is not drawn as one.
            const job = ALERTS.includes(s.key) && (n ?? 0) > 0;
            return (
              <button
                key={s.key}
                type="button"
                className={job ? "chip chip--alert" : "chip"}
                aria-current={state === s.key ? "true" : undefined}
                onClick={() => refine(() => setState(s.key))}
              >
                {s.label}
                {n !== undefined ? <span className="chip__count">{count(n)}</span> : null}
              </button>
            );
          })}
        </div>

        <span className="chipbar__sep" aria-hidden="true" />

        <div className="chips chips--tight" role="group" aria-label="กรองตามชนิดสินค้า">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              className="chip"
              aria-current={ptype === t.key ? "true" : undefined}
              onClick={() => chooseType(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {lensFilters ? (
        <LensFilters
          index={lindex}
          design={design}
          coating={coating}
          onIndex={(v) => refine(() => setLindex(v))}
          onDesign={(v) => refine(() => setDesign(v))}
          onCoating={(v) => refine(() => setCoating(v))}
          // Whatever else the table is narrowed by, so a chip's tally is a
          // count of rows this screen would actually show.
          scope={{ q: applied, make: ONLY_STOCK }}
        />
      ) : null}

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
          <p className="empty__title">ไม่มีสินค้าที่ตรงกับเงื่อนไขนี้</p>
          <p className="empty__body">
            ลองล้างตัวกรอง แล้วค้นด้วยชื่อหรือ SKU แทน
          </p>
          <button
            type="button"
            className="btn"
            onClick={() =>
              refine(() => {
                setQ("");
                setApplied("");
                setPtype("");
                setLindex("");
                setDesign("");
                setCoating("");
                setState("");
              })
            }
          >
            ล้างตัวกรอง
          </button>
        </div>
      ) : null}

      {list.status === "ready" && list.data.rows.length > 0 ? (
        <>
          <div className="tablewrap">
            <table className="grid">
              <caption className="sr-only">รายการสินค้า — คลิกหัวคอลัมน์เพื่อเรียงลำดับ</caption>
              <thead>
                <tr>
                  {/* SKU, แบรนด์ and ข้าง used to be three columns of their own.
                      They are inside the สินค้า cell now — still readable, still
                      sortable from the toolbar above, and no longer costing the
                      lens columns the width they need. */}
                  <SortHead label="สินค้า" col="name" sort={sort} dir={dir} onSort={pick} />
                  <SortHead label="ชนิด" col="type" sort={sort} dir={dir} onSort={pick} />
                  {lensCols ? (
                    <>
                      <SortHead label="สเปกเลนส์" col="index" sort={sort} dir={dir} onSort={pick} />
                      <SortHead label="ค่าสายตา" col="sph" sort={sort} dir={dir} onSort={pick} />
                    </>
                  ) : null}
                  <SortHead label="คงเหลือ" col="onhand" sort={sort} dir={dir} onSort={pick} num />
                  {/* Its own column rather than a second line under คงเหลือ.
                      Stacked there it was either clutter on thirty rows or, once
                      hidden until hovered, a control nobody could find. A column
                      is neither: one number per row, headed, and editable where
                      it is read. */}
                  <th scope="col" className="grid__num">ขั้นต่ำ</th>
                  {money$ ? <th scope="col" className="grid__num">ต้นทุนถัดไป</th> : null}
                  <SortHead label="ราคาขาย" col="price" sort={sort} dir={dir} onSort={pick} num />
                  <th scope="col">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <Row
                    key={r.id}
                    row={r}
                    money={money$}
                    lens={lensCols}
                    inlineSpec={!lensCols}
                    open={openRow === r.id}
                    columns={3 + (lensCols ? 2 : 0) + (money$ ? 1 : 0) + 2}
                    startReceiving={receiveInto === r.id}
                    onToggle={() => {
                      setReceiveInto(null);
                      setOpenRow(openRow === r.id ? null : r.id);
                    }}
                    onOpen={() => setOpenId(r.id)}
                    onChanged={reload}
                  />
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

      {openId !== null ? (
        <StockDrawer productId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
      ) : null}

      {creating ? (
        <NewProductDialog
          title="เพิ่มสินค้าใหม่แล้วรับเข้าเลย"
          // The first lot goes in with the same save. A new product is nearly
          // always discovered while unpacking a delivery, and the old receiving
          // screen took it in here rather than making someone come back for it.
          receive
          // Copying a product and keeping its name means the thing wanted was
          // another lot of the original, not a second product with the same
          // name. The dialog says so; this is what makes the sentence a door.
          onUseExisting={(id) => {
            setCreating(false);
            setOpenRow(id);
            setReceiveInto(id);
          }}
          onClose={() => setCreating(false)}
          onSaved={(id, lot) => {
            // Closed, said, and the new product unfolded — no green panel to
            // read and then dismiss before getting on with it.
            setCreating(false);
            reload();
            setOpenRow(id);
            toast.ok({
              text: lot ? "เพิ่มสินค้าและรับเข้าคลังแล้ว" : "เพิ่มสินค้าใหม่แล้ว",
              detail: lot
                ? `${count(lot.quantity)} ชิ้น` +
                  (lot.awaitingCost ? " · ยังไม่มีต้นทุน รอใบกำกับ" : "")
                : undefined,
            });
          }}
        />
      ) : null}
    </main>
  );
}

function Row({
  row,
  money: showCost,
  lens,
  inlineSpec,
  open,
  columns,
  startReceiving,
  onToggle,
  onOpen,
  onChanged,
}: {
  row: ProductRow;
  money: boolean;
  /** Kept in step with the two lens headers — one condition, decided by the table. */
  lens: boolean;
  /** No lens columns on screen, so a lens carries its spec under its name. */
  inlineSpec: boolean;
  /** Whether this row's lots are unfolded underneath it. */
  open: boolean;
  /** How wide the fold has to be to sit under the whole row. */
  columns: number;
  /** Unfold straight onto the receiving form rather than onto the lot list. */
  startReceiving: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const actor = useActor();
  const mayEdit = can.editCatalog(actor);
  const rx = row.isCustomMade;
  const pending = row.lotsMissingCost > 0;
  const tint = pending ? " grid__row--pending" : rx ? " grid__row--rx" : "";
  /** Below the level its owner set — 0 is silence, not a minimum that is met. */
  const low = !rx && row.minStock > 0 && row.onHand < row.minStock;

  /**
   * A figure on this row, corrected where it is read.
   *
   * The whole product form is still one click away for the rest of it; this is
   * for the two fields that change on their own — the price, and the level the
   * shop wants to keep. Both send the row's own facts and no `attributes`,
   * which the API reads as "not my subject" and leaves the spec alone.
   */
  async function patch(field: Record<string, string>, wrong: string) {
    try {
      await api.post(`/products/${row.id}/update`, {
        sku: row.sku,
        name: row.name,
        product_type: row.productType,
        category_id: row.categoryId,
        base_selling_price: String(row.basePrice),
        brand: row.brand,
        is_custom_made: row.isCustomMade,
        ...field,
      });
      onChanged();
    } catch (e) {
      throw new Error(ApiError.is(e) ? e.message : wrong);
    }
  }

  return (
    <>
    <tr
      className={`grid__row grid__row--clickable${tint}`}
      onClick={onToggle}
      tabIndex={0}
      role="button"
      aria-expanded={open}
      aria-label={`${open ? "ปิด" : "เปิด"}ล็อตของ ${row.name}`}
      onKeyDown={(e) => {
        // Only the row's own keys. The cells stop clicks from reaching here but
        // not keystrokes, so Enter to save a price or a minimum was also
        // folding the row open underneath the field that had just been used.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <ProductCell row={row} spec={inlineSpec} />
      <td>{PRODUCT_TYPE_LABEL[row.productType] ?? row.productType}</td>
      {lens ? <LensCells row={row} /> : null}
      <td className="grid__num">
        {rx ? (
          <span className="grid__muted">—</span>
        ) : (
          <span className={low ? "grid__num--signal" : undefined}>{count(row.onHand)}</span>
        )}
      </td>

      {/* Clicks on the minimum stay in the cell — the row's own click folds it. */}
      <td className="grid__num" onClick={(e) => e.stopPropagation()}>
        {rx ? (
          // Made-to-order goods hold no stock, so there is no level to keep.
          <span className="grid__muted">—</span>
        ) : (
          <>
            {/* The level is set where the shortfall is read. Anywhere else and
                nobody sets it: the moment you notice a drawer is nearly empty
                is the moment you know what it should hold, and asking someone
                to open a five-step form for one number is asking them not to. */}
            <InlineEdit
              label={`จำนวนขั้นต่ำของ ${row.name}`}
              // "" rather than "0" so the cell offers to be set instead of
              // claiming a minimum of zero, which is not a thing a shop wants.
              value={row.minStock > 0 ? String(row.minStock) : ""}
              display={count(row.minStock)}
              // A dash, because that is what every other column says for a
              // figure nobody has entered. The pencil beside it is the offer.
              empty="—"
              disabled={!mayEdit}
              onSave={(next) => patch({ min_stock: next }, "บันทึกจำนวนขั้นต่ำไม่สำเร็จ")}
            />
          </>
        )}
      </td>
      {showCost ? (
        <td className="grid__num">
          {row.nextCost === null ? (
            pending ? (
              <span className="status status--pending">รอต้นทุน</span>
            ) : (
              <span className="grid__muted">—</span>
            )
          ) : (
            money(row.nextCost)
          )}
        </td>
      ) : null}
      {/* Clicks inside the price stay there — the row's own click folds it. */}
      <td className="grid__num" onClick={(e) => e.stopPropagation()}>
        {/* 0 is how the column stores "not priced yet" — the price may be left
            blank, because stock arrives before the price list does. Drawn as an
            offer to set one rather than as a price of nothing. */}
        <InlineEdit
          label={`ราคาขายของ ${row.name}`}
          value={row.basePrice > 0 ? String(row.basePrice) : ""}
          display={money(row.basePrice)}
          empty="ตั้งราคา"
          disabled={!mayEdit}
          onSave={(next) =>
            patch({ base_selling_price: next }, "บันทึกราคาไม่สำเร็จ")
          }
        />
      </td>
      <td>
        {rx ? (
          <span className="status status--rx">สั่งตัด</span>
        ) : row.onHand <= 0 ? (
          <span className="status status--out">หมดสต็อก</span>
        ) : low ? (
          // Ahead of "มีของ", which is true and useless here: there is some, and
          // that is the thing not worth saying about a drawer running out.
          <span className="status status--low">ต่ำกว่าขั้นต่ำ</span>
        ) : (
          <span className="status status--stock">มีของ</span>
        )}
      </td>
    </tr>

    {open ? (
      <tr className="grid__row grid__row--fold">
        <td colSpan={columns} onClick={(e) => e.stopPropagation()}>
          <StockLines
            product={row}
            onChanged={onChanged}
            onDetails={onOpen}
            startReceiving={startReceiving}
          />
        </td>
      </tr>
    ) : null}
    </>
  );
}
