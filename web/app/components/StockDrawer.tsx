"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, type ProductDetail } from "@/lib/api";
import { can, useActor } from "./AppShell";
import ProductForm from "./ProductForm";
import LensDetail from "./LensDetail";
import { IconClose, IconTrash } from "./Icon";
import backdropClose from "./backdrop";
import { count, date, money } from "@/lib/format";

/**
 * One product: what it is, what is left of it, and what has happened to it.
 *
 * This used to hold the forms as well — issuing, scrapping, RX orders, receiving
 * — which put the busiest task in the shop three clicks deep and sat it next to
 * "ลบสินค้า". Those now have pages of their own and this is what remains: a
 * record to read, correct, and occasionally delete.
 *
 * The corrections that stay here are the ones that only make sense against a
 * specific row — a lot's cost or count being wrong, a product typed in twice.
 * Routine movements happen on the task pages, linked from the top.
 */
export default function StockDrawer({
  productId,
  onClose,
  onChanged,
}: {
  productId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const actor = useActor();
  const money$ = can.seeCost(actor);
  const ref = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);

  /** The lots worth a row: the ones with something left in them. */
  const live = (detail?.lots ?? []).filter((l) => l.remainingQty > 0);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function removeProduct() {
    try {
      await api.post(`/products/${productId}/delete`);
      onChanged();
      ref.current?.close();
    } catch (e) {
      setError(ApiError.is(e) ? e.message : "ลบไม่สำเร็จ");
      setConfirmDelete(false);
    }
  }

  const load = () =>
    api
      .get<{ product: ProductDetail }>(`/products/${productId}`)
      .then(({ product }) => setDetail(product))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่ได้"));

  useEffect(() => {
    ref.current?.showModal();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  return (
    <dialog
      className="drawer"
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={backdropClose}
    >
      <div className="drawer__inner">
        <header className="drawer__head">
          <div>
            <p className="drawer__eyebrow">{detail?.sku ?? "กำลังโหลด"}</p>
            <h2 className="drawer__title">{detail?.name ?? "…"}</h2>
          </div>
          <div className="chips">
            {detail && can.editCatalog(actor) && !editing ? (
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => setEditing(true)}
              >
                แก้ไข
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--quiet btn--small btn--icon"
              onClick={() => ref.current?.close()}
            >
              <IconClose />
              ปิด
            </button>
          </div>
        </header>

        {error ? <p className="notice notice--error">{error}</p> : null}

        {detail && editing ? (
          <section className="drawer__section">
            <h3 className="drawer__legend">แก้ไขสินค้า</h3>
            <ProductForm
              product={detail}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                load();
                onChanged();
              }}
            />

            {/* Deleting is only ever right for something entered by mistake, so
                it sits below the edit form rather than beside "ปิด" where a
                stray tap could reach it. */}
            <div className="drawer__danger">
              {confirmDelete ? (
                <>
                  <p className="field__help">ลบ {detail.sku} ถาวร — ทำแล้วย้อนไม่ได้</p>
                  <div className="chips">
                    <button
                      type="button"
                      className="btn btn--danger btn--small btn--icon"
                      onClick={removeProduct}
                    >
                      <IconTrash />
                      ยืนยันลบ
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet btn--small"
                      onClick={() => setConfirmDelete(false)}
                    >
                      ยกเลิก
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn--danger-quiet btn--small btn--icon"
                  onClick={() => setConfirmDelete(true)}
                >
                  <IconTrash />
                  ลบสินค้านี้
                </button>
              )}
            </div>
          </section>
        ) : null}

        {detail && !editing ? (
          <>
            {/* The lens spec, before the figures. On a shelf of one model in a
                dozen powers, "which lens is this" is the question the drawer is
                opened to answer, and the summary tiles below answer a different
                one. Draws nothing at all for a frame or a bottle of solution. */}
            <LensDetail row={detail} />

            <section className="readout readout--tight" aria-label="สรุปของสินค้านี้">
              <div className="readout__cell readout__cell--mint">
                <p className="readout__label">คงเหลือ</p>
                <p className="readout__figure">
                  {detail.isCustomMade ? "—" : count(detail.onHand)}
                </p>
                <p className="readout__note">
                  {detail.isCustomMade ? "สั่งตัด ไม่มีสต็อก" : `จาก ${count(detail.lots.length)} ล็อต`}
                </p>
              </div>
              {money$ ? (
                <div className="readout__cell readout__cell--cyan">
                  <p className="readout__label">มูลค่าต้นทุน</p>
                  <p className="readout__figure">{money(detail.stockValue ?? 0)}</p>
                  <p className="readout__note">บาท</p>
                </div>
              ) : null}
              <div className="readout__cell readout__cell--pear">
                <p className="readout__label">ราคาขาย</p>
                <p className="readout__figure">{money(detail.basePrice)}</p>
                <p className="readout__note">บาทต่อชิ้น</p>
              </div>
            </section>

            {/* The movements themselves live on their own pages now. What is
                offered here depends on the product, so an action that could
                only be refused is never shown. */}
            <section className="drawer__section">
              <h3 className="drawer__legend">ทำรายการกับสินค้านี้</h3>
              <div className="chips">
                {!detail.isCustomMade && detail.onHand > 0 ? (
                  <Link href="/" className="btn btn--primary btn--small">
                    เบิก / ตัดสต็อก
                  </Link>
                ) : null}
                {/* Receiving is not offered here. This drawer only opens
                    from a product row that is already unfolded, and the
                    "+ รับเข้าล็อตใหม่" button is on that fold — one click behind
                    this panel. A link that navigated to the page you are
                    already on did nothing, which is what it looked like. */}
                {/* Same screen, two different sentences. A made-to-order lens
                    has no other way of being got; a stocked one that has run
                    out is being *specially ordered*, which is a decision about
                    a supplier and not a change to what the product is. Calling
                    both "เปิดใบสั่งตัด RX" read as though the frame in your hand
                    had turned into a bespoke lens because it sold out. */}
                {detail.isCustomMade || detail.onHand === 0 ? (
                  <Link href="/rx" className="btn btn--small">
                    {detail.isCustomMade ? "เปิดใบสั่งตัด RX" : "สั่งพิเศษกับผู้ขาย"}
                  </Link>
                ) : null}
              </div>
              {detail.isCustomMade ? (
                <p className="field__help">
                  สินค้านี้เป็นเลนส์สั่งตัด ไม่มีสต็อกให้ตัด — เปิดใบสั่ง RX แทน
                </p>
              ) : detail.onHand === 0 ? (
                <p className="field__help">
                  สินค้านี้หมดสต็อก — ปิดหน้านี้แล้วกด “+ รับเข้าล็อตใหม่” ที่แถวสินค้า
                  หรือถ้าลูกค้ารออยู่ ให้สั่งพิเศษกับผู้ขายเป็นรายใบ ระบบเก็บใบสั่งพิเศษไว้ที่หน้า RX
                  ที่เดียวกับใบสั่งตัด แต่สินค้าไม่ได้เปลี่ยนเป็นสินค้าสั่งตัด — พอรับล็อตใหม่เข้ามาก็ตัดจากสต็อกตามเดิม
                </p>
              ) : null}
            </section>

            <section className="drawer__section">
              <h3 className="drawer__legend">ล็อตในคลัง</h3>
              {/* Only the lots that hold stock.
                  An emptied one can be neither received into nor deleted, and a
                  product reordered monthly would show a year of empty rows above
                  the one box on the shelf. What became of them is the movement
                  list further down, which is where that question belongs. */}
              {detail.lots.length === 0 ? (
                <p className="field__help">ยังไม่มีล็อตของสินค้านี้</p>
              ) : live.length === 0 ? (
                <p className="field__help">
                  ล็อตของสินค้านี้ถูกตัดออกไปหมดแล้ว — ดูว่าไปไหนได้ที่ความเคลื่อนไหวด้านล่าง
                </p>
              ) : (
                <div className="tablewrap">
                  <table className="grid">
                    <caption className="sr-only">ล็อตของสินค้านี้ เรียงจากล็อตล่าสุดไปเก่าสุด</caption>
                    <thead>
                      <tr>
                        <th scope="col">ผู้ขาย</th>
                        <th scope="col" className="grid__num">คงเหลือ</th>
                        {money$ ? <th scope="col" className="grid__num">ต้นทุน/ชิ้น</th> : null}
                        <th scope="col">รับเข้า</th>
                        <th scope="col">
                          <span className="sr-only">จัดการ</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {live.map((l) => (
                        <LotRow
                          key={l.id}
lot={l}
                          money={money$}
                          onDone={() => {
                            load();
                            onChanged();
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="drawer__section">
              <h3 className="drawer__legend">ความเคลื่อนไหวล่าสุด</h3>
              <ul className="logs">
                {detail.logs.slice(0, 12).map((g) => (
                  <li className="log" key={g.id}>
                    <span className={g.actionType === "SCRAP" ? "tag tag--scrap" : "tag"}>
                      {g.actionLabel}
                    </span>
                    <span className="log__qty">
                      {g.quantity > 0 ? `+${count(g.quantity)}` : count(g.quantity)}
                    </span>
                    <span className="log__meta">
                      {date(g.createdAt)}
                      {/* Who took it, which is what someone reading history
                          wants — the person who keyed it comes second. */}
                      {g.branchName
                        ? ` · ${g.branchName}${g.takenBy ? ` (${g.takenBy})` : ""}`
                        : g.issuedToName
                          ? ` · ${g.issuedToName}`
                          : g.actorName
                            ? ` · ${g.actorName}`
                            : ""}
                      {g.branchStatusLabel ? ` · ${g.branchStatusLabel}` : ""}
                      {g.referenceDoc ? ` · ${g.referenceDoc}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="field__help">
                <Link href={`/movements?q=${encodeURIComponent(detail.sku)}`} className="grid__link">
                  ดูความเคลื่อนไหวทั้งหมดของ {detail.sku}
                </Link>
              </p>
            </section>
          </>
        ) : null}
      </div>
    </dialog>
  );
}

/* -------------------------------------------------------------------------- */

type Lot = ProductDetail["lots"][number];

/**
 * A lot row that can be corrected in place.
 *
 * Changing the remaining quantity is a stock count, not an edit: the server
 * records an ADJUST movement for the difference, so the ledger still explains
 * the number afterwards. Deleting is only offered for a lot nothing has been
 * drawn from — anything else is history.
 */
function LotRow({ lot, money: showCost, onDone }: { lot: Lot; money: boolean; onDone: () => void }) {
  const actor = useActor();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(lot.remainingQty));
  const [cost, setCost] = useState(lot.costPerUnit === null ? "" : String(lot.costPerUnit));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const untouched = lot.remainingQty === lot.initialQty;

  /**
   * A count that finds more than was received is allowed — goods get mis-picked,
   * returned without a slip, or over-shipped — but it has to say why, and the
   * reason goes into the ledger beside the adjustment. The server insists on
   * this too; asking here just saves a round trip.
   */
  const overInitial = Number(qty) > lot.initialQty;
  const needsReason = overInitial && reason.trim() === "";

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const body: Record<string, unknown> = { remaining_qty: Number(qty) };
      // Only send the cost when this person may set it, and only when it
      // actually changed — an absent key means "leave it alone".
      if (can.enterCost(actor) && cost !== (lot.costPerUnit === null ? "" : String(lot.costPerUnit))) {
        body.cost_per_unit = cost.trim() || null;
      }
      if (reason.trim() !== "") {
        body.note = reason.trim();
      }
      await api.post(`/lots/${lot.id}/update`, body);
      setOpen(false);
      onDone();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "แก้ไขไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/lots/${lot.id}/delete`);
      onDone();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "ลบไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <>
      <tr className={showCost && lot.costPerUnit === null ? "grid__row grid__row--pending" : "grid__row"}>
        <th scope="row" className="grid__muted">{lot.supplierName ?? "ไม่ระบุผู้ขาย"}</th>
        <td className="grid__num">
          {lot.remainingQty === 0 ? (
            <span className="status status--out">หมด</span>
          ) : (
            count(lot.remainingQty)
          )}
        </td>
        {showCost ? (
          <td className="grid__num">
            {lot.costPerUnit === null ? (
              <span className="status status--pending">รอต้นทุน</span>
            ) : (
              money(lot.costPerUnit)
            )}
          </td>
        ) : null}
        <td className="grid__muted grid__when">{date(lot.receivedDate)}</td>
        <td>
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "ปิด" : "แก้"}
          </button>
        </td>
      </tr>

      {open ? (
        <tr className="grid__row">
          <td colSpan={showCost ? 6 : 5}>
            <div className="lotedit">
              <div className="field">
                <label className="field__label" htmlFor={`le-q-${lot.id}`}>
                  คงเหลือจริง
                </label>
                <input
                  id={`le-q-${lot.id}`}
                  className="input"
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  disabled={busy}
                />
                <span className="field__help">
                  รับเข้า {count(lot.initialQty)} ชิ้น · แก้แล้วระบบบันทึกเป็นการปรับยอด
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor={`le-c-${lot.id}`}>
                  ต้นทุน/ชิ้น (฿)
                </label>
                <input
                  id={`le-c-${lot.id}`}
                  className="input"
                  inputMode="decimal"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  disabled={busy || !can.enterCost(actor)}
                  placeholder={can.enterCost(actor) ? "เว้นว่างถ้ายังไม่รู้" : "ฝ่ายบัญชีเป็นคนลง"}
                />
              </div>

              <div className="field field--wide">
                <label className="field__label" htmlFor={`le-n-${lot.id}`}>
                  เหตุผลที่ปรับยอด
                  {overInitial ? <span className="field__req"> · ต้องกรอก</span> : null}
                </label>
                <input
                  id={`le-n-${lot.id}`}
                  className="input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="เช่น ตรวจนับประจำเดือน ของเกิน 1 ชิ้น"
                  disabled={busy}
                  autoComplete="off"
                  aria-invalid={needsReason ? "true" : undefined}
                />
                <span className="field__help">
                  {overInitial
                    ? `คงเหลือ ${count(Number(qty) || 0)} มากกว่าที่รับเข้า ${count(lot.initialQty)} — ` +
                      "ตรวจนับเจอของเกินได้ แต่ต้องบอกไว้ในสมุดว่าเกินมาจากไหน"
                    : "เว้นว่างได้ ถ้ากรอกจะถูกบันทึกไว้ในสมุดคู่กับการปรับยอด"}
                </span>
              </div>

              {problem ? (
                <div className="notice notice--error" role="alert">
                  {problem}
                </div>
              ) : null}

              <div className="chips">
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={save}
                  disabled={busy || needsReason}
                >
                  {busy ? "กำลังบันทึก…" : "บันทึก"}
                </button>
                {untouched && can.editCatalog(actor) ? (
                  <button
                    type="button"
                    className="btn btn--danger btn--small btn--icon"
                    onClick={remove}
                    disabled={busy}
                  >
                    <IconTrash />
                    ลบล็อตนี้
                  </button>
                ) : (
                  <span className="field__help">
                    ล็อตที่ตัดของออกไปแล้วลบไม่ได้ — ถ้าของหายให้ปรับยอด
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
