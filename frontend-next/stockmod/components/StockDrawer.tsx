"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, type ProductDetail } from "@/stockmod/lib/api";
import { can, useActor } from "./AppShell";
import { useToast } from "./Toaster";
import ProductForm from "./ProductForm";
import LensDetail from "./LensDetail";
import { IconClose, IconTrash } from "./Icon";
import useScrollLock from "@/stockmod/lib/scrollLock";
import ConfirmDelete from "./ConfirmDelete";
import RecordCard, { CardList } from "./RecordCard";
import StockLines from "./StockLines";
import LotEditDialog from "./LotEditDialog";
import { count, date, money, shortName } from "@/stockmod/lib/format";
import { stockHref } from "@/stockmod/lib/paths";

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
  /** แผงรับของเข้าเปิดอยู่ไหม — อยู่ในลิ้นชักนี้เอง ไม่ต้องปิดแล้วไปหาที่อื่น */
  const [receiving, setReceiving] = useState(false);
  /** แผงแก้ราคาขาย / ขั้นต่ำเปิดอยู่ไหม */
  const [quick, setQuick] = useState(false);
  const toast = useToast();

  async function removeProduct() {
    try {
      await api.post(`/products/${productId}/delete`);
      toast.success({ text: `ลบสินค้า ${detail?.sku ?? ""} แล้ว`, detail: detail?.name });
      onChanged();
      ref.current?.close();
    } catch (e) {
      /* toast ไม่ใช่แถบบนหัวลิ้นชัก — ปุ่มลบอยู่ล่างสุดของแผงแก้ไข ส่วนแถบเดิม
         ขึ้นบนหัว ซึ่งบนมือถือคือนอกจอ · คนกดจึงเห็นแค่ว่ากดแล้วไม่มีอะไรเกิด */
      toast.error({
        text: `ลบสินค้า ${detail?.sku ?? ""} ไม่สำเร็จ`,
        detail: ApiError.is(e) ? e.message : "ลองใหม่อีกครั้ง",
      });
      setConfirmDelete(false);
    }
  }

  const load = () =>
    api
      .get<{ product: ProductDetail }>(`/products/${productId}`)
      .then(({ product }) => setDetail(product))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่ได้"));

  useScrollLock(true);

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
    >
      <div className="drawer__inner">
        <header className="drawer__head">
          <div>
            <p className="drawer__eyebrow">{detail?.sku ?? "กำลังโหลด"}</p>
            <h2 className="drawer__title">{detail ? shortName(detail.name) : "…"}</h2>
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
            {/* ลบอยู่เหนือฟอร์ม ไม่ใช่ใต้ฟอร์ม
                ใต้ฟอร์มแปลว่าต้องไถผ่านทั้งฟอร์มถึงจะเจอ ซึ่งบนมือถือคือครึ่งหน้าจอ ·
                เหตุผลเดิมที่วางไว้ล่างคือกันนิ้วที่เล็ง "ปิด" แล้วพลาดมาโดน — ที่นี่ยัง
                ห่างจากปุ่มปิดหนึ่งบล็อก และยังต้องกดยืนยันอีกครั้งอยู่ดี */}
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

            <ProductForm
              product={detail}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                toast.success({ text: `แก้สินค้า ${detail.sku} แล้ว`, detail: detail.name });
                load();
                onChanged();
              }}
            />

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
              {!detail.isCustomMade ? (
                <div className="readout__cell readout__cell--coral">
                  <p className="readout__label">ขั้นต่ำ</p>
                  <p className="readout__figure">{count(detail.minStock)}</p>
                  <p className="readout__note">
                    {detail.minStock > 0 ? "เหลือเท่านี้แล้วแจ้งเตือน" : "0 = เตือนเมื่อของหมด"}
                  </p>
                </div>
              ) : null}
            </section>

            {/* ราคาขายกับขั้นต่ำแก้ที่นี่ แทนดินสอบนแถวรายการ (ร้านขอไว้ 14 ก.ย. 2026) —
                สองช่องนี้เปลี่ยนบ่อยกว่าส่วนอื่นของสินค้า จึงไม่ต้องเปิดฟอร์มสินค้าทั้งก้อน */}
            {can.editCatalog(actor) ? (
              quick ? (
                <PriceMinEdit
                  product={detail}
                  onCancel={() => setQuick(false)}
                  onSaved={() => {
                    setQuick(false);
                    load();
                    onChanged();
                  }}
                />
              ) : (
                <div className="chips">
                  <button type="button" className="btn btn--small" onClick={() => setQuick(true)}>
                    {detail.isCustomMade ? "แก้ราคาขาย" : "แก้ราคา / ขั้นต่ำ"}
                  </button>
                </div>
              )
            ) : null}

            {/* The movements themselves live on their own pages now. What is
                offered here depends on the product, so an action that could
                only be refused is never shown. */}
            <section className="drawer__section">
              <h3 className="drawer__legend">ทำรายการกับสินค้านี้</h3>
              <div className="chips">
                {!detail.isCustomMade && detail.onHand > 0 ? (
                  <Link href="/stock" className="btn btn--primary btn--small">
                    เบิก / ตัดสต็อก
                  </Link>
                ) : null}
                {/* รับของเข้ามีปุ่มที่นี่แล้ว
                    เดิมไม่มี ด้วยเหตุผลว่าลิ้นชักนี้เปิดจากแถวที่กางอยู่แล้ว และ
                    ปุ่ม "+ รับเข้าล็อตใหม่" อยู่บนแถวที่กางนั้น — ห่างไปแค่คลิกเดียว
                    ข้างหลัง · บนมือถือไม่มีแถวให้กาง การ์ดเปิดลิ้นชักนี้ตรง ๆ
                    เหตุผลเดิมจึงหมดอายุ และทางรับของเข้าก็ขาดไปทั้งเส้น */}
                {!detail.isCustomMade && can.editCatalog(actor) ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => setReceiving(true)}
                  >
                    + รับเข้าล็อตใหม่
                  </button>
                ) : null}
                {/* Same screen, two different sentences. A made-to-order lens
                    has no other way of being got; a stocked one that has run
                    out is being *specially ordered*, which is a decision about
                    a supplier and not a change to what the product is. Calling
                    both "เปิดใบสั่งตัด RX" read as though the frame in your hand
                    had turned into a bespoke lens because it sold out. */}
                {detail.isCustomMade || detail.onHand === 0 ? (
                  <Link href="/stock/rx" className="btn btn--small">
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
                  สินค้านี้หมดสต็อก — กด “+ รับเข้าล็อตใหม่” ข้างบน
                  หรือถ้าลูกค้ารออยู่ ให้สั่งพิเศษกับผู้ขายเป็นรายใบ ระบบเก็บใบสั่งพิเศษไว้ที่หน้า RX
                  ที่เดียวกับใบสั่งตัด แต่สินค้าไม่ได้เปลี่ยนเป็นสินค้าสั่งตัด — พอรับล็อตใหม่เข้ามาก็ตัดจากสต็อกตามเดิม
                </p>
              ) : null}
            </section>

            {receiving ? (
              <section className="drawer__section">
                <h3 className="drawer__legend">รับล็อตใหม่เข้าคลัง</h3>
                {/* แผงเดียวกับที่กางใต้แถวสินค้าบนจอกว้าง — กติกาการรับของ
                    (ต้นทุน วันหมดอายุ ผู้ขาย) จึงมีที่เดียว */}
                <StockLines
                  product={detail as never}
                  startReceiving
                  onChanged={() => {
                    load();
                    onChanged();
                  }}
                  onDetails={() => setReceiving(false)}
                />
              </section>
            ) : null}

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
                <>
                {/* บนมือถือ ล็อตหนึ่งใบ = การ์ดหนึ่งใบ · แผงแก้ไขไม่กางใต้แถวเหมือน
                    ตาราง เพราะลิ้นชักนี้เองก็เป็นแผ่นเต็มจออยู่แล้ว กางซ้อนเข้าไป
                    อีกชั้นจะไม่เหลือที่ให้เห็นว่ากำลังแก้ล็อตใบไหน */}
                <CardList label="ล็อตของสินค้านี้">
                  {live.map((l) => (
                    <DrawerLotCard
                      key={l.id}
                      lot={l}
                      product={detail}
                      money={money$}
                      onDone={() => {
                        load();
                        onChanged();
                      }}
                    />
                  ))}
                </CardList>

                <div className="tablewrap wide-only">
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
                          product={detail}
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
                </>
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
                      {g.balanceAfter !== null ? <span className="log__left"> → เหลือ {count(g.balanceAfter)}</span> : null}
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
                <Link href={stockHref(`/movements?q=${encodeURIComponent(detail.sku)}`)} className="grid__link">
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
 * ล็อตหนึ่งใบในลิ้นชักสินค้า บนมือถือ
 *
 * แก้ไขผ่านกล่อง LotEditDialog ตัวเดียวกับที่หน้าล็อตใช้ ไม่ได้เขียนแผงแก้ไข
 * ขึ้นใหม่ — กติกาการปรับยอด (เกินที่รับเข้าต้องมีเหตุผล) จะได้มีที่เดียว
 */
function DrawerLotCard({
  lot,
  product,
  money: showCost,
  onDone,
}: {
  lot: Lot;
  product: { sku: string; name: string };
  money: boolean;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <RecordCard
        tone={showCost && lot.costPerUnit === null ? "pending" : undefined}
        head={<span className="reccard__money">{count(lot.remainingQty)}</span>}
        title={lot.supplierName ?? "ไม่ระบุผู้ขาย"}
        sub={`รับเข้า ${date(lot.receivedDate)} · ${count(lot.initialQty)} ชิ้น`}
        fields={[
          showCost
            ? {
                label: "ต้นทุน/ชิ้น",
                value:
                  lot.costPerUnit === null ? (
                    <span className="status status--pending">รอต้นทุน</span>
                  ) : (
                    money(lot.costPerUnit)
                  ),
              }
            : null,
          lot.expiryDate ? { label: "หมดอายุ", value: date(lot.expiryDate) } : null,
        ]}
        actions={
          <button type="button" className="btn btn--small" onClick={() => setEditing(true)}>
            แก้ล็อตนี้
          </button>
        }
      />

      {editing ? (
        <LotEditDialog
          // ล็อตในลิ้นชักไม่มีชื่อสินค้าติดมา — กล่องแก้ล็อตเคยขึ้นหัวว่าง
          lot={{ ...lot, sku: product.sku, productName: product.name } as never}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onDone();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * ราคาขายกับขั้นต่ำ แก้ในลิ้นชัก — แทนดินสอบนแถวรายการสินค้า (ร้านขอไว้ 14 ก.ย. 2026)
 *
 * ส่งข้อมูลหลักของสินค้าเดิมไปครบ แต่ไม่ส่ง `attributes` ซึ่ง API อ่านว่า "ไม่ใช่เรื่องของฉัน"
 * แล้วปล่อยสเปกไว้ตามเดิม — แบบเดียวกับที่ดินสอบนแถวเคยทำ · สินค้าสั่งตัดไม่มีสต็อก จึงไม่มี
 * ช่องขั้นต่ำ และไม่ส่ง `min_stock` ไป (ไม่ส่ง = คงค่าเดิม)
 */
function PriceMinEdit({
  product,
  onCancel,
  onSaved,
}: {
  product: ProductDetail;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [price, setPrice] = useState(product.basePrice > 0 ? String(product.basePrice) : "");
  const [min, setMin] = useState(String(product.minStock));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!product.isCustomMade && !/^\d{1,5}$/.test(min.trim())) {
      setProblem("ขั้นต่ำต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/products/${product.id}/update`, {
        sku: product.sku,
        name: product.name,
        product_type: product.productType,
        category_id: product.categoryId,
        brand: product.brand,
        is_custom_made: product.isCustomMade,
        base_selling_price: price.trim(),
        ...(product.isCustomMade ? {} : { min_stock: min.trim() }),
      });
      toast.success({ text: `แก้ ${product.sku} แล้ว`, detail: product.name });
      onSaved();
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <section className="drawer__section">
      <h3 className="drawer__legend">{product.isCustomMade ? "แก้ราคาขาย" : "แก้ราคาขาย / ขั้นต่ำ"}</h3>
      <form onSubmit={save} noValidate>
        <div className="formgrid">
          <div className="field">
            <label className="field__label" htmlFor="pm-price">
              ราคาขาย (฿ ต่อชิ้น)
            </label>
            <input
              id="pm-price"
              className="input"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="เว้นว่าง = ยังไม่ตั้งราคา"
              disabled={busy}
              autoComplete="off"
              autoFocus
            />
          </div>
          {!product.isCustomMade ? (
            <div className="field">
              <label className="field__label" htmlFor="pm-min">
                ขั้นต่ำ (ชิ้น)
              </label>
              <input
                id="pm-min"
                className="input"
                inputMode="numeric"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
              <span className="field__help">เหลือเท่านี้หรือน้อยกว่าแล้วแจ้งเตือน · 0 = เตือนเมื่อของหมด</span>
            </div>
          ) : null}
        </div>

        {problem ? (
          <div className="notice notice--error" role="alert">
            {problem}
          </div>
        ) : null}

        <div className="chips">
          <button type="submit" className="btn btn--primary btn--small" disabled={busy}>
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
          <button type="button" className="btn btn--quiet btn--small" onClick={onCancel} disabled={busy}>
            ยกเลิก
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * ล็อตหนึ่งแถวในลิ้นชักสินค้า บนจอกว้าง
 *
 * ปุ่ม "แก้" เปิดกล่อง LotEditDialog ตัวเดียวกับการ์ดบนมือถือและหน้าล็อต — เดิมกางแผงใต้แถว
 * ที่ไม่มีช่องวันหมดอายุ และถามเหตุผลเฉพาะตอนยอดเกินที่รับเข้า · กติกา "เปลี่ยนยอดคงเหลือ
 * ต้องมีเหตุผล" (ร้านขอไว้ 14 ก.ย. 2026) จึงอยู่ที่กล่องเดียว
 *
 * ลบได้เฉพาะล็อตที่ยังไม่มีอะไรถูกตัดออก — ที่เหลือคือประวัติ แก้ด้วยการปรับยอด ไม่ใช่ลบ
 */
function LotRow({
  lot,
  product,
  money: showCost,
  onDone,
}: {
  lot: Lot;
  product: { sku: string; name: string };
  money: boolean;
  onDone: () => void;
}) {
  const actor = useActor();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  /* กดถังขยะแล้วยังไม่ลบ — ถามก่อน · การกดพลาดหนึ่งครั้งลบล็อตหายไปทั้งใบ */
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const untouched = lot.remainingQty === lot.initialQty;

  async function remove() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/lots/${lot.id}/delete`);
      toast.success({ text: `ลบล็อต ${lot.lotNumber} แล้ว` });
      setAsking(false);
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
          <div className="chips">
            <button type="button" className="btn btn--quiet btn--small" onClick={() => setEditing(true)}>
              แก้
            </button>
            {untouched && can.editCatalog(actor) ? (
              <button
                type="button"
                className="btn btn--danger-quiet btn--small btn--icon"
                onClick={() => setAsking(true)}
                aria-label={`ลบล็อต ${lot.lotNumber}`}
              >
                <IconTrash />
              </button>
            ) : null}
          </div>
        </td>
      </tr>

      {editing ? (
        <LotEditDialog
          lot={{ ...lot, sku: product.sku, productName: product.name } as never}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast.success({ text: `แก้ล็อต ${lot.lotNumber} แล้ว`, detail: product.sku });
            onDone();
          }}
        />
      ) : null}

      {asking ? (
        <ConfirmDelete
          title={`ล็อต ${lot.lotNumber}`}
          what="ลบล็อตนี้ออกจากคลัง"
          detail={`รับเข้า ${date(lot.receivedDate)} · ${count(lot.initialQty)} ชิ้น ยังไม่ได้ตัดออกเลย`}
          busy={busy}
          problem={problem}
          onConfirm={() => void remove()}
          onClose={() => {
            setProblem(null);
            setAsking(false);
          }}
        />
      ) : null}
    </>
  );
}
