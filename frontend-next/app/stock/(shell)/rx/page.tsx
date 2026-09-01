"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import { useToast } from "@/stockmod/components/Toaster";
import TaskDialog from "@/stockmod/components/TaskDialog";
import Paginator from "@/stockmod/components/Paginator";
import Select from "@/stockmod/components/Select";
import InlineEdit from "@/stockmod/components/InlineEdit";
import NewProductDialog from "@/stockmod/components/NewProductDialog";
import { IconTrash } from "@/stockmod/components/Icon";
import { api, ApiError, type Page, type ProductRow } from "@/stockmod/lib/api";
import { qs, useApi } from "@/stockmod/lib/useApi";
import { count, date, diopter, money } from "@/stockmod/lib/format";
import {
  ADD_LADDER,
  asOptions,
  AXIS_LADDER,
  COATING_SEED,
  CYL_LADDER,
  EYE_OPTIONS,
  INDEX_SEED,
  power,
  RX_BRANDS,
  SPH_LADDER,
} from "@/stockmod/lib/optics";

/**
 * One RX order, as the order book reports it.
 *
 * The prescription rides on the order rather than on the product: the shop
 * stocks six made-to-order lens *models*, and every job cut from one of them
 * has its own power. See `011_rx_order_details.sql` for why that moved.
 */
type Order = {
  id: number;
  sku: string;
  name: string;
  referenceDoc: string | null;
  createdAt: string;
  actorName: string | null;
  note: string | null;
  unitCost: number | null;
  salePrice: number | null;
  eyeSide: "left" | "right" | null;
  sph: number | null;
  cyl: number | null;
  axis: number | null;
  add: string | null;
};

/** Where a power starts before anyone has read one: no correction at all. */
const PLANO = "0.00";

/** The prescription as one readable line, or nothing when none was recorded. */
function rxLine(o: Order): string | null {
  const parts: string[] = [];
  if (o.eyeSide) parts.push(o.eyeSide === "left" ? "L" : "R");
  if (o.sph !== null) parts.push(`SPH ${diopter(o.sph)}`);
  if (o.cyl !== null) parts.push(`CYL ${diopter(o.cyl)}`);
  if (o.axis !== null) parts.push(`AXIS ${o.axis}`);
  if (o.add) parts.push(`ADD ${o.add}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The book of lenses ordered from a supplier rather than taken off a shelf.
 *
 * This page is a *list of orders*, not a list of products. It used to open on
 * the catalogue: click "ใบสั่งตัด RX" in the nav and the first thing on screen
 * was a table of things you could order, which answers "what shall I order?" —
 * a question nobody arrives with. The question people actually arrive with is
 * "did we order this customer's lens, what power, and has the invoice come?".
 *
 * Both halves of the job live here because they are one job: opening the order,
 * and putting the cost on it when the invoice turns up days later.
 */
export default function RxPage() {
  const actor = useActor();
  const mayCost = can.enterCost(actor);
  const toast = useToast();

  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [only, setOnly] = useState<"all" | "pending">("all");
  const [creating, setCreating] = useState(false);

  /**
   * Which half of the job is on screen: the orders, or the lenses they name.
   *
   * The models used to sit in the catalogue beside stocked goods, where every
   * column about stock had to be drawn as a dash — a made-to-order lens is
   * never received, never counted and never on a shelf. They belong with the
   * orders, which are the only thing that ever names them.
   */
  const [view, setView] = useState<"orders" | "models">("orders");

  const book = useApi<Page<Order>>(
    `/rx/orders${qs({ q: applied, pending: only === "pending" ? "1" : "", page })}`,
  );

  // Only for the count on the chip; the list itself comes from the book above.
  const pending = useApi<{ rows: unknown[] }>("/rx/awaiting-cost");

  const rows = book.status === "ready" ? book.data.rows : [];

  function reload() {
    book.reload();
    pending.reload();
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    setApplied(q.trim());
    setPage(1);
  }

  return (
    <main className="work-main">
      <WorkHead
        title="ใบสั่งตัด RX"
        lede="ใบสั่งเลนส์เฉพาะรายกับผู้ขาย — ค่าสายตาอยู่บนใบสั่ง เพราะแต่ละใบคือของลูกค้าคนละคน"
      >
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
          + เปิดใบสั่งใหม่
        </button>
        <Link href="/stock" className="btn">
          กลับไปหน้าเบิก
        </Link>
      </WorkHead>

      <div className="chips chips--bar" role="group" aria-label="ส่วนที่กำลังดู">
        <button
          type="button"
          className="chip"
          aria-current={view === "orders" ? "true" : undefined}
          onClick={() => setView("orders")}
        >
          ใบสั่ง
        </button>
        <button
          type="button"
          className="chip"
          aria-current={view === "models" ? "true" : undefined}
          onClick={() => setView("models")}
        >
          รุ่นเลนส์ที่สั่งได้
        </button>
      </div>

      {view === "models" ? <LensModels /> : null}

      {view === "orders" ? (
      <>
      <div className="chips chips--bar">
        <button
          type="button"
          className="chip"
          aria-current={only === "all" ? "true" : undefined}
          onClick={() => {
            setOnly("all");
            setPage(1);
          }}
        >
          ทั้งหมด
          {book.status === "ready" && only === "all" ? (
            <span className="chip__count">{count(book.data.total)}</span>
          ) : null}
        </button>
        <button
          type="button"
          className="chip"
          aria-current={only === "pending" ? "true" : undefined}
          onClick={() => {
            setOnly("pending");
            setPage(1);
          }}
        >
          รอลงต้นทุน
          {pending.status === "ready" ? (
            <span className="chip__count">{count(pending.data.rows.length)}</span>
          ) : null}
        </button>

        <form className="toolsearch" onSubmit={search} role="search">
          <label className="sr-only" htmlFor="rx-q">
            ค้นหาใบสั่ง
          </label>
          <input
            id="rx-q"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="เลขที่ใบสั่ง SKU หรือชื่อเลนส์"
            autoComplete="off"
          />
          <button type="submit" className="btn">
            ค้นหา
          </button>
        </form>
      </div>

      {book.status === "loading" ? <div className="skeleton" /> : null}

      {book.status === "error" ? (
        <div className="notice notice--error" role="alert">
          {book.error}
        </div>
      ) : null}

      {book.status === "ready" && rows.length === 0 ? (
        <p className="notice" role="status">
          {applied
            ? `ไม่พบใบสั่งที่ตรงกับ “${applied}”`
            : only === "pending"
              ? "ไม่มีใบสั่งที่ค้างต้นทุน"
              : "ยังไม่เคยเปิดใบสั่ง RX — กด เปิดใบสั่งใหม่ ด้านบน"}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="tablewrap">
            <table className="grid">
              <caption className="sr-only">ใบสั่งตัด RX เรียงจากใบล่าสุดไปเก่าสุด</caption>
              <thead>
                <tr>
                  <th scope="col">ใบสั่ง</th>
                  <th scope="col">เลนส์ / ค่าสายตา</th>
                  <th scope="col">เปิดเมื่อ</th>
                  <th scope="col">ต้นทุน</th>
                  <th scope="col">ราคาขาย</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <OrderRow key={r.id} row={r} mayCost={mayCost} onDone={reload} />
                ))}
              </tbody>
            </table>
          </div>

          {book.status === "ready" ? (
            <Paginator
              page={book.data.page}
              perPage={book.data.perPage}
              total={book.data.total}
              onPage={setPage}
              label="ใบสั่ง"
            />
          ) : null}
        </>
      ) : null}

      </>
      ) : null}

      {creating ? (
        <NewOrderDialog
          mayCost={mayCost}
          onClose={() => setCreating(false)}
          onSaved={(ref, awaitingCost) => {
            setCreating(false);
            reload();
            toast.ok({
              text: `เปิดใบสั่ง ${ref} แล้ว`,
              detail: awaitingCost ? "รอฝ่ายบัญชีลงต้นทุน" : undefined,
            });
          }}
        />
      ) : null}
    </main>
  );
}

/** One order in the book, with the cost field inline while it is still missing. */
function OrderRow({
  row,
  mayCost,
  onDone,
}: {
  row: Order;
  mayCost: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);


  const waiting = row.unitCost === null;
  const rx = rxLine(row);

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/rx/${row.id}/cost`, { unit_cost: value.trim() });
      onDone();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "ลงต้นทุนไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <tr className={waiting ? "grid__row grid__row--pending" : "grid__row"}>
      <th scope="row" className="grid__lot">
        {row.referenceDoc ?? "—"}
      </th>
      <td>
        <span className="grid__name">{row.name}</span>
        <span className="grid__sub grid__rx">{rx ?? "ไม่ได้บันทึกค่าสายตา"}</span>
      </td>
      <td className="grid__muted grid__when">
        {date(row.createdAt)}
        {row.actorName ? ` · ${row.actorName}` : ""}
      </td>
      <td>
        {!waiting ? (
          <span className="grid__name">{money(row.unitCost as number)}</span>
        ) : mayCost ? (
          <div className="chips">
            <label className="sr-only" htmlFor={`rxc-${row.id}`}>
              ต้นทุนของ {row.referenceDoc ?? row.sku}
            </label>
            <input
              id={`rxc-${row.id}`}
              className="input input--inline"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="฿"
              disabled={busy}
            />
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={save}
              disabled={busy || value.trim() === ""}
            >
              {busy ? "กำลังบันทึก…" : "ลงต้นทุน"}
            </button>
          </div>
        ) : (
          <span className="status status--pending">รอฝ่ายบัญชี</span>
        )}
        {problem ? (
          <div className="notice notice--error" role="alert">
            {problem}
          </div>
        ) : null}
      </td>
      <td className="grid__num">
        {row.salePrice === null ? (
          <span className="grid__muted">—</span>
        ) : (
          <>
            <span className="grid__name">{money(row.salePrice)}</span>
            {row.unitCost !== null ? (
              <span className="grid__sub">กำไร {money(row.salePrice - row.unitCost)}</span>
            ) : null}
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * Opening an order: which lens model, cut to which prescription, at what price.
 *
 * The model is picked from a short list — a shop carries a handful of
 * made-to-order lenses — and the numbers that make this job different from the
 * last one are typed here rather than baked into a new catalogue entry. When a
 * genuinely new model does turn up, it is added from this dialog: it used to
 * mean going to the receiving screen, which is a strange place to create
 * something that is never received.
 */
export function NewOrderDialog({
  mayCost,
  onClose,
  onSaved,
}: {
  mayCost: boolean;
  onClose: () => void;
  onSaved: (referenceDoc: string, awaitingCost: boolean) => void;
}) {
  /**
   * Which lens model this order is for — a catalogue id, never a typed name.
   *
   * It used to be free text, and a name that matched nothing became a product
   * called exactly that. That was fine while a product was whatever someone
   * typed; it is wrong now that a product is named by its spec. One route in
   * was quietly filing lenses with no brand, no coating and no index among a
   * catalogue where every other row reads "Zeiss SmartLife Transition-Blue
   * (1.67)" — two naming schemes in one table, one of them by accident.
   *
   * A genuinely new model is still added from here. It is added by the same
   * dialog the catalogue screen adds one with, so there is no second form to
   * keep in step and no second way for a lens to end up named.
   */
  /**
   * The lens, written out on this sheet rather than picked from a catalogue.
   *
   * Every order is a different one: a different customer, a different power,
   * often a different price for the same lens. So the sheet asks for the lens
   * the way the catalogue form asks for one — brand, model, coating, index —
   * and the API files the model once behind the scenes, matching on the
   * composed name so the same lens ordered twice stays one row in the
   * catalogue and two rows in the order book.
   */
  const [brand, setBrand] = useState("");
  const [lensModel, setLensModel] = useState("");
  const [coating, setCoating] = useState("");
  const [index, setIndex] = useState("");

  /**
   * Which of the two ways in is being used.
   *
   * Both were on screen at once, and the dialog asked for a รุ่น twice — once
   * in the picker and once in the boxes under it. Two fields with the same
   * label is a question nobody can answer confidently, whatever the help
   * text under them says. One at a time, chosen by a switch, is the same two
   * routes with only one of them asking anything.
   */

  const [eye, setEye] = useState("");
  /**
   * The two powers start at plano.
   *
   * Zero is where a reading is worked out from — the optometrist counts up or
   * down from it in quarter steps — and it is also the true value for an eye
   * that needs no correction, which is a real prescription rather than a blank
   * one. The same start the catalogue form gives a stocked lens.
   */
  const [sph, setSph] = useState(PLANO);
  const [cyl, setCyl] = useState(PLANO);
  const [axis, setAxis] = useState("");
  const [add, setAdd] = useState("");
  const [doc, setDoc] = useState("");

  /**
   * Whether the number on screen is the one the system issued.
   *
   * The shop has been numbering these by hand — RX-2026-0121 and up — so the
   * form continues that sequence instead of asking someone to remember where it
   * got to. Typing over it turns this off: a job sheet that arrives with its own
   * number should be filed under that number.
   */
  const [autoDoc, setAutoDoc] = useState(true);

  const issued = useApi<{ referenceDoc: string }>(autoDoc ? "/rx/next-doc" : null);

  useEffect(() => {
    if (autoDoc && issued.status === "ready") setDoc(issued.data.referenceDoc);
  }, [autoDoc, issued.status, issued.data]);

  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Three questions, one at a time.
   *
   * On one scroll the sheet was long enough that the last group — the one
   * carrying the money — sat below the fold and read as optional. Broken up,
   * each stop is one question the person at the counter can answer from what
   * is in front of them: what lens, what power, what it costs.
   */
  const STOPS = ["เลนส์ที่สั่ง", "ค่าสายตา", "ใบสั่งและราคา"] as const;
  const [step, setStep] = useState(0);
  const last = step === STOPS.length - 1;

  /**
   * What has to be right before the next stop.
   *
   * Checked here rather than left to the save, because a sheet that accepts a
   * blank lens on the first stop and says so on the third has made someone
   * walk further to learn less.
   */
  function blocking(): string | null {
    if (step === 0 && [brand, lensModel, coating, index].every((v) => v.trim() === "")) {
      return "บอกก่อนว่าสั่งเลนส์อะไร — กรอกอย่างน้อยหนึ่งช่อง แบรนด์ รุ่น Coating หรือ Index";
    }
    return null;
  }

  function forward() {
    const stop = blocking();
    if (stop !== null) {
      setProblem(stop);
      return;
    }
    setProblem(null);
    setStep((n) => Math.min(n + 1, STOPS.length - 1));
  }

  // What may actually be special-ordered: made to order, or stocked and run out.
  const models = useApi<Page<ProductRow>>(`/products${qs({ make: "rx", per: 500 })}`);
  const rows = models.status === "ready" ? models.data.rows : [];

  /**
   * The spellings the shop has already used, offered back in every box.
   *
   * The lens is typed on the sheet, so nothing stops the same coating being
   * typed three ways across three weeks — except offering back what has been
   * typed before, which is what these lists are.
   */
  const hints = useApi<{ brands: string[]; values: Record<string, string[]> }>(
    "/products/hints?type=Lens",
  );

  const offer = (seed: readonly string[], had: string[] | undefined) => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const v of [...seed, ...(had ?? [])]) {
      const t = v.trim();
      if (t === "" || seen.has(t)) continue;
      seen.add(t);
      out.push({ value: t, label: t });
    }
    return out;
  };

  /**
   * The name this sheet's lens composes, previewed from the API.
   *
   * The same endpoint the catalogue form previews with, so what the sheet
   * says the lens will be called is what the order files it as.
   */
  const composed = useApi<{ name: string }>(
    [brand, lensModel, coating, index].some((v) => v.trim() !== "")
      ? `/products/compose-name${qs({
          type: "Lens",
          custom: "1",
          brand,
          model: lensModel,
          coating,
          lens_index: index,
        })}`
      : null,
  );

  /**
   * Copying a lens the shop has ordered before onto this sheet.
   *
   * Not a choice of product — a starting point. Nine orders in ten are the
   * same lens as one already on the books with a different power, and reading
   * a row off the screen to type it back in underneath is the work this
   * removes. Everything it fills is still editable, because the tenth order
   * is the one that differs.
   */
  function startFrom(r: ProductRow): void {
    setBrand(r.brand ?? "");
    setLensModel(r.model ?? "");
    setCoating(r.coating ?? "");
    setIndex(r.lensIndex ?? "");
    setPrice(r.basePrice > 0 ? String(r.basePrice) : "");
    setEye(r.eyeSide ?? "");
    // A made-to-order model carries no power, so copying one leaves these at
    // plano rather than emptying boxes the sheet asks for.
    setSph(typeof r.sph === "number" ? power(r.sph) : PLANO);
    setCyl(typeof r.cyl === "number" ? power(r.cyl) : PLANO);
    setAxis(typeof r.axis === "number" ? String(r.axis) : "");
    setAdd(r.add ?? "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    // Enter inside a field submits the form; on any stop but the last that
    // means "next", not "open half an order".
    if (!last) {
      forward();
      return;
    }

    if ([brand, lensModel, coating, index].every((v) => v.trim() === "")) {
      setProblem("บอกก่อนว่าสั่งเลนส์อะไร — กรอกอย่างน้อยหนึ่งช่อง แบรนด์ รุ่น Coating หรือ Index");
      return;
    }
    if (!autoDoc && !doc.trim()) {
      setProblem("ใส่เลขที่ใบสั่งก่อน");
      return;
    }

    setBusy(true);
    setProblem(null);

    try {
      const { order } = await api.post<{
        order: { referenceDoc: string; awaitingCost: boolean };
      }>("/rx", {
        // The lens as written on this sheet. The API files the model once and
        // reuses it every time the same lens is written out again, matching on
        // the composed name — so the catalogue does not grow by one row per
        // customer, and the order still carries its own power and price.
        brand: brand.trim() || null,
        lens_model: lensModel.trim() || null,
        lens_coating: coating.trim() || null,
        lens_index: index.trim() || null,
        reference_doc: doc.trim(),
        eye_side: eye || null,
        sph: sph.trim() || null,
        cyl: cyl.trim() || null,
        axis: axis.trim() || null,
        add: add.trim() || null,
        unit_cost: mayCost && cost.trim() ? cost.trim() : null,
        sale_price: price.trim() || null,
        note: note.trim() || null,
      });

      onSaved(order.referenceDoc, order.awaitingCost);
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "เปิดใบสั่งไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <TaskDialog eyebrow="ใบสั่งตัด RX" title="เปิดใบสั่งใหม่" onClose={onClose}>
        <form className="pform" onSubmit={submit} noValidate>
          <ol className="wizard__steps" aria-label="ขั้นตอนการเปิดใบสั่ง">
            {STOPS.map((name, i) => (
              <li
                key={name}
                className="wizard__step"
                aria-current={i === step ? "step" : undefined}
              >
                <span
                  className={
                    i < step
                      ? "wizard__dot wizard__dot--done"
                      : i === step
                        ? "wizard__dot wizard__dot--now"
                        : "wizard__dot"
                  }
                  aria-hidden="true"
                >
                  {i < step ? "✓" : i + 1}
                </span>
                <span className="wizard__name">{name}</span>
              </li>
            ))}
          </ol>

          {step === 0 ? (
          <>
          {/* Started from a lens the shop has ordered before, when there is
              one. It fills the boxes below and then gets out of the way — the
              sheet is what the order is filed from, not this. */}
          <div className="copyfrom">
            <p className="field__label">เริ่มจากเลนส์ที่เคยสั่ง</p>
            <p className="field__help">
              เลือกใบเก่าที่ใกล้ที่สุด แล้วแบรนด์ รุ่น Coating Index ราคา และค่าสายตา
              จะถูกเติมลงช่องด้านล่างให้ เหลือแก้เฉพาะส่วนที่ต่างจริง — เว้นไว้ก็ได้ถ้าจะกรอกเองทั้งใบ
            </p>

            <label className="sr-only" htmlFor="rx-copy">เลนส์ที่จะคัดลอก</label>
            <Select
              id="rx-copy"
              value=""
              onChange={(id) => {
                const row = rows.find((r) => String(r.id) === id);
                if (row) startFrom(row);
              }}
              disabled={busy || models.status !== "ready"}
              placeholder={
                models.status === "ready"
                  ? "พิมพ์ชื่อรุ่น · SKU · แบรนด์"
                  : "กำลังโหลดรายการเลนส์…"
              }
              options={rows.map((r) => ({
                value: String(r.id),
                label: r.name,
                keywords: `${r.sku} ${r.brand ?? ""}`,
              }))}
            />
          </div>

          {/* The lens this sheet is for, asked the way the catalogue asks for
              one. Every order is a different one — different customer, power,
              often price — so it is written here rather than chosen from a list
              of rows someone has to keep tidy. */}
          <fieldset className="pform__set">
            <legend className="pform__legend">เลนส์ที่สั่ง</legend>
            <div className="pform__grid">
              <div className="field">
                <label className="field__label" htmlFor="rx-brand">แบรนด์</label>
                <Select
                  free
                  id="rx-brand"
                  value={brand}
                  onChange={setBrand}
                  disabled={busy}
                  placeholder="พิมพ์แบรนด์ หรือเลือกจากที่เคยสั่ง"
                  options={offer(RX_BRANDS, hints.data?.brands)}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rx-lensmodel">รุ่น</label>
                <Select
                  free
                  id="rx-lensmodel"
                  value={lensModel}
                  onChange={setLensModel}
                  disabled={busy}
                  placeholder="HiVision · SmartLife · Varilux X"
                  options={offer([], hints.data?.values?.model)}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rx-coating">Coating</label>
                <Select
                  free
                  id="rx-coating"
                  value={coating}
                  onChange={setCoating}
                  disabled={busy}
                  placeholder="เลือก หรือพิมพ์ชื่อใหม่"
                  options={offer(COATING_SEED, hints.data?.values?.coating)}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rx-index">Index</label>
                <Select
                  free
                  id="rx-index"
                  value={index}
                  onChange={setIndex}
                  disabled={busy}
                  placeholder="เลือก หรือพิมพ์ค่า"
                  options={offer(INDEX_SEED, hints.data?.values?.lens_index)}
                />
              </div>
            </div>
            <p className="field__help">
              {composed.status === "ready" && composed.data.name !== ""
                ? `ใบนี้จะถูกบันทึกเป็น: ${composed.data.name}`
                : "กรอกอย่างน้อยหนึ่งช่อง — ทุกช่องเว้นว่างได้"}
            </p>
          </fieldset>
          </>
          ) : null}

          {step === 1 ? (
          <fieldset className="pform__set">
            <legend className="pform__legend">ค่าสายตาของใบสั่งนี้</legend>
            <p className="field__help">
              ค่าของลูกค้ารายนี้ ไม่ใช่ของตัวเลนส์ — สั่งรุ่นเดียวกันคนละค่าได้ ไม่ต้องสร้างสินค้าใหม่
            </p>
            <div className="pform__grid pform__grid--rx">
              <div className="field">
                <label className="field__label" htmlFor="rx-eye">
                  ข้างตา
                </label>
                <Select id="rx-eye" value={eye} onChange={setEye} disabled={busy} options={EYE_OPTIONS} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rx-sph">
                  SPH (สายตาสั้น/ยาว)
                </label>
                {/* The same picker the catalogue asks a power with. One person,
                    one job sheet, two screens — a list on one and a bare box on
                    the other is how "-2.5" and "-2.50" end up in the same shop. */}
                <Select
                  free
                  id="rx-sph"
                  value={sph}
                  onChange={setSph}
                  disabled={busy}
                  placeholder="เลือก หรือพิมพ์ค่า"
                  options={asOptions(SPH_LADDER)}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rx-cyl">
                  CYL (สายตาเอียง)
                </label>
                {/* The same picker the catalogue asks a power with. One person,
                    one job sheet, two screens — a list on one and a bare box on
                    the other is how "-2.5" and "-2.50" end up in the same shop. */}
                <Select
                  free
                  id="rx-cyl"
                  value={cyl}
                  onChange={setCyl}
                  disabled={busy}
                  placeholder="เลือก หรือพิมพ์ค่า"
                  options={asOptions(CYL_LADDER)}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rx-axis">
                  AXIS (องศา)
                </label>
                {/* The same picker the catalogue asks a power with. One person,
                    one job sheet, two screens — a list on one and a bare box on
                    the other is how "-2.5" and "-2.50" end up in the same shop. */}
                <Select
                  free
                  id="rx-axis"
                  value={axis}
                  onChange={setAxis}
                  disabled={busy}
                  placeholder="เลือก หรือพิมพ์ค่า"
                  options={asOptions(AXIS_LADDER)}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rx-add">
                  ADD (ระยะใกล้)
                </label>
                {/* The same picker the catalogue asks a power with. One person,
                    one job sheet, two screens — a list on one and a bare box on
                    the other is how "-2.5" and "-2.50" end up in the same shop. */}
                <Select
                  free
                  id="rx-add"
                  value={add}
                  onChange={setAdd}
                  disabled={busy}
                  placeholder="เลือก หรือพิมพ์ค่า"
                  options={asOptions(ADD_LADDER)}
                />
              </div>
            </div>
          </fieldset>
          ) : null}

          {step === 2 ? (
          <fieldset className="pform__set">
            <legend className="pform__legend">ใบสั่งและราคา</legend>
            <div className="pform__grid">
            <div className="field">
              <label className="field__label" htmlFor="rx-doc">
                เลขที่ใบสั่ง
              </label>
              <input
                id="rx-doc"
                className="input"
                value={doc}
                onChange={(e) => {
                  setAutoDoc(false);
                  setDoc(e.target.value);
                }}
                placeholder={
                  autoDoc && issued.status === "loading" ? "กำลังออกเลข…" : "เช่น RX-2026-0148"
                }
                disabled={busy}
                autoComplete="off"
              />
              {autoDoc ? (
                <span className="field__help">ระบบออกเลขให้เอง — พิมพ์ทับได้ถ้าใบสั่งมีเลขของตัวเอง</span>
              ) : null}
            </div>
            <div className="field">
              <label className="field__label" htmlFor="rx-cost">
                ต้นทุนจากผู้ขาย (฿)
              </label>
              <input
                id="rx-cost"
                className="input"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder={mayCost ? "เว้นว่างได้ ลงทีหลังก็ได้" : "ฝ่ายบัญชีลงให้ทีหลัง — เปิดใบสั่งได้เลย"}
                disabled={busy || !mayCost}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="rx-price">
                ราคาขายให้ลูกค้า (฿)
              </label>
              <input
                id="rx-price"
                className="input"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="ราคาที่ตกลงกับลูกค้า"
                disabled={busy}
              />
              <span className="field__help">
                ราคาต่อใบนี้ — ใบอื่นของเลนส์รุ่นเดียวกันตั้งราคาต่างกันได้
              </span>
            </div>

            <div className="field field--wide">
              <label className="field__label" htmlFor="rx-note">
              หมายเหตุ
            </label>
            <input
              id="rx-note"
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ชื่อลูกค้า หรือเลขที่ใบสั่งขาย"
              disabled={busy}
              autoComplete="off"
              />
            </div>
            </div>
          </fieldset>

          ) : null}

          {problem ? (
            <div className="notice notice--error" role="alert">
              {problem}
            </div>
          ) : null}

          {/* Both pairs are keyed, and the keys are the point: without them
              React reconciles the two branches into one DOM button and swaps
              its type under a click that is still in flight — which is how
              "ถัดไป" on the second-to-last stop came to save instead of
              advance on the form this one is modelled on. */}
          <div className="wizard__nav">
            {step > 0 ? (
              <button
                key="back"
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  setProblem(null);
                  setStep((n) => Math.max(0, n - 1));
                }}
                disabled={busy}
              >
                ← ย้อนกลับ
              </button>
            ) : (
              <button
                key="cancel"
                type="button"
                className="btn btn--quiet"
                onClick={onClose}
                disabled={busy}
              >
                ยกเลิก
              </button>
            )}

            {last ? (
              <button key="save" type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? "กำลังเปิดใบสั่ง…" : "เปิดใบสั่ง RX"}
              </button>
            ) : (
              <button
                key="next"
                type="button"
                className="btn btn--primary"
                onClick={forward}
                disabled={busy}
              >
                ถัดไป →
              </button>
            )}
          </div>
        </form>
    </TaskDialog>
  );
}

/**
 * The lenses this shop can special-order, and the price it lists them at.
 *
 * A short list — a handful of models the shop actually deals in — kept here
 * rather than in the catalogue because nothing about them is stock: no lot, no
 * count, no cost of goods on a shelf. What each *job* costs and sells for is on
 * its order; this is only the model's own list price, for quoting from.
 */
function LensModels() {
  const actor = useActor();
  const mayEdit = can.editCatalog(actor);
  const toast = useToast();

  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const list = useApi<Page<ProductRow>>(
    `/products${qs({ make: "custom", q: applied, page, sort: "name", dir: "asc" })}`,
  );

  const rows = list.status === "ready" ? list.data.rows : [];

  async function setPrice(row: ProductRow, next: string) {
    try {
      await api.post(`/products/${row.id}/update`, {
        sku: row.sku,
        name: row.name,
        product_type: row.productType,
        category_id: row.categoryId,
        base_selling_price: next,
        brand: row.brand,
        is_custom_made: true,
      });
      list.reload();
    } catch (e) {
      throw new Error(ApiError.is(e) ? e.message : "บันทึกราคาไม่สำเร็จ");
    }
  }

  async function remove(row: ProductRow) {
    setProblem(null);
    try {
      await api.post(`/products/${row.id}/delete`);
      list.reload();
      toast.ok({ text: `ลบรุ่น ${row.name} แล้ว` });
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "ลบไม่สำเร็จ");
    }
  }

  return (
    <>
      <div className="chips chips--bar">
        <form
          className="toolsearch"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(q.trim());
            setPage(1);
          }}
        >
          <label className="sr-only" htmlFor="rxm-q">
            ค้นหารุ่นเลนส์
          </label>
          <input
            id="rxm-q"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ชื่อรุ่น SKU หรือแบรนด์"
            autoComplete="off"
          />
          <button type="submit" className="btn">
            ค้นหา
          </button>
        </form>
        {/* เพิ่มรุ่นใหม่ทำได้ทุกบทบาท — ราคาตั้งกับปุ่มลบยังเป็นของแอดมินขึ้นไป */}
        {can.addProduct(actor) ? (
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            + เพิ่มรุ่นเลนส์
          </button>
        ) : null}
      </div>

      {list.status === "loading" ? <div className="skeleton" /> : null}

      {list.status === "error" ? (
        <div className="notice notice--error" role="alert">
          {list.error}
        </div>
      ) : null}

      {problem ? (
        <div className="notice notice--error" role="alert">
          {problem}
        </div>
      ) : null}

      {list.status === "ready" && rows.length === 0 ? (
        <p className="notice" role="status">
          {applied ? `ไม่พบรุ่นที่ตรงกับ “${applied}”` : "ยังไม่มีรุ่นเลนส์สั่งตัดในระบบ"}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="tablewrap">
            <table className="grid">
              <caption className="sr-only">รุ่นเลนส์ที่สั่งตัดได้</caption>
              <thead>
                <tr>
                  <th scope="col">รุ่นเลนส์</th>
                  <th scope="col">สเปก</th>
                  <th scope="col" className="grid__num">ราคาตั้ง</th>
                  <th scope="col">
                    <span className="sr-only">ลบ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr className="grid__row" key={r.id}>
                    <th scope="row">
                      <span className="grid__name">{r.name}</span>
                      <span className="grid__sub">
                        {r.sku}
                        {r.brand ? ` · ${r.brand}` : ""}
                      </span>
                    </th>
                    <td className="grid__muted">
                      {[r.lensIndex, r.lensDesign].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="grid__num">
                      <InlineEdit
                        label={`ราคาตั้งของ ${r.name}`}
                        value={String(r.basePrice)}
                        display={money(r.basePrice)}
                        disabled={!mayEdit}
                        onSave={(v) => setPrice(r, v)}
                      />
                    </td>
                    <td>
                      {mayEdit ? (
                        <button
                          type="button"
                          className="btn btn--danger btn--small btn--icon"
                          onClick={() => remove(r)}
                          aria-label={`ลบรุ่น ${r.name}`}
                        >
                          <IconTrash />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {list.status === "ready" ? (
            <Paginator
              page={list.data.page}
              perPage={list.data.perPage}
              total={list.data.total}
              onPage={setPage}
              label="รุ่น"
            />
          ) : null}
        </>
      ) : null}

      {adding ? (
        <NewProductDialog
          title="เพิ่มรุ่นเลนส์ใหม่"
          make="custom"
          presetType="Lens"
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
            toast.ok({ text: "เพิ่มรุ่นเลนส์แล้ว" });
          }}
        />
      ) : null}
    </>
  );
}
