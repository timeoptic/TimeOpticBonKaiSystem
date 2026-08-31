"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { can, useActor, WorkHead } from "@/stockmod/components/AppShell";
import { useToast } from "@/stockmod/components/Toaster";
import ProductPicker, { PickedSummary } from "@/stockmod/components/ProductPicker";
import LotEditDialog from "@/stockmod/components/LotEditDialog";
import TaskDialog from "@/stockmod/components/TaskDialog";
import QtyField from "@/stockmod/components/QtyField";
import NewProductDialog from "@/stockmod/components/NewProductDialog";
import Select from "@/stockmod/components/Select";
import { api, ApiError, type CreatedLot, type ProductRow, type ReceiveDefaults } from "@/stockmod/lib/api";
import { useApi } from "@/stockmod/lib/useApi";
import { count, date, money } from "@/stockmod/lib/format";
import DateField from "@/stockmod/components/DateField";

type Supplier = { id: number; name: string };


/**
 * Goods arriving from a supplier.
 *
 * The rule this page is built around: a second lot of something already in the
 * catalogue is the same product, so nothing about the product gets retyped. Pick
 * it and its SKU, name and brand come along — there is no field to get them
 * wrong in, which is what used to create two products for one thing.
 *
 * What genuinely differs between deliveries — lot number, supplier, cost, dates —
 * is prefilled from the last lot and left editable. Suggested, not imposed:
 * prices move and suppliers change.
 */
export default function ReceivePage() {
  const actor = useActor();
  const mayCost = can.enterCost(actor);
  const toast = useToast();

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [defaults, setDefaults] = useState<ReceiveDefaults | null>(null);

  const suppliers = useApi<{ suppliers: Supplier[] }>("/suppliers");

  const [qty, setQty] = useState("1");
  const [supplierId, setSupplierId] = useState("");
  const [cost, setCost] = useState("");
  const [received, setReceived] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiry, setExpiry] = useState("");
  const [note, setNote] = useState("");

  /** Bumped after a receipt, so the list underneath shows the new counts. */
  const [refresh, setRefresh] = useState(0);

  /**
   * Whether the last lot is open for correction rather than being added to.
   *
   * Goods arrive before the invoice does, so a lot sits with no cost until the
   * paperwork turns up. The obvious move then is to open this form, type the
   * cost and save — and the form answers that the quantity must be at least
   * one, because it only knows how to receive. It was the wrong door, and
   * nothing here pointed at the right one.
   */
  const [fixingLot, setFixingLot] = useState(false);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Picking a product is what fills the form. Everything below is a suggestion
  // taken from the last delivery of this exact thing.
  useEffect(() => {
    if (product === null) {
      setDefaults(null);
      return;
    }

    let alive = true;
    api
      .get<ReceiveDefaults>(`/receive-defaults/${encodeURIComponent(product.sku)}`)
      .then((d) => {
        if (!alive) return;
        setDefaults(d);
        setQty(d.lastLot ? String(d.lastLot.quantity) : "1");
        setSupplierId(d.lastLot?.supplierId != null ? String(d.lastLot.supplierId) : "");
        setCost(mayCost && d.lastLot?.costPerUnit != null ? String(d.lastLot.costPerUnit) : "");
        setProblem(null);
      })
      .catch((e: unknown) => {
        if (alive) setProblem(e instanceof Error ? e.message : "ดึงข้อมูลสินค้าไม่ได้");
      });

    return () => {
      alive = false;
    };
  }, [product, mayCost]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (product === null) return;

    setBusy(true);
    setProblem(null);

    try {
      const { lot: created } = await api.post<{
        lot: CreatedLot;
      }>("/lots", {
        sku: product.sku,
        quantity: Number(qty),
        supplier_id: supplierId === "" ? null : Number(supplierId),
        cost_per_unit: mayCost && cost.trim() ? cost.trim() : null,
        received_date: received,
        expiry_date: expiry || null,
        note: note.trim() || null,
      });

      // Past this line the lot exists. Nothing below may throw into the catch,
      // or a received delivery would be reported as a failed one.
      setProduct(null);
      setRefresh((n) => n + 1);
      setQty("1");
      setExpiry("");
      setNote("");

      // Said in the corner and the form closed, rather than a green panel left
      // sitting above the last delivery while the next box waits.
      toast.ok({
        text: `รับ ${created.name} เข้าคลังแล้ว`,
        detail:
          `${count(created.quantity)} ชิ้น` +
          (created.awaitingCost ? " · ยังไม่มีต้นทุน รอใบกำกับ" : ""),
        link: { href: "/lots", label: "ดูล็อตทั้งหมด" },
      });
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "รับของไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="work-main">
      <WorkHead
        title="รับของเข้าคลัง"
        lede="ล็อตใหม่ของสินค้าที่มีอยู่แล้ว — ชื่อและ SKU ใช้ของเดิม ไม่ต้องพิมพ์ซ้ำ"
      >
        {/* A delivery routinely contains something the shop has never held —
            a lens in a new power, a frame in a new colour. That is a new
            product, and its spec belongs to it, so it gets typed here rather
            than by sending someone off to another screen and back. */}
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
          เพิ่มสินค้าใหม่
        </button>
        <Link href="/stock/products" className="btn">
          สินค้าทั้งหมด
        </Link>
      </WorkHead>

      {/* Same shape as the catalogue index until a product is chosen: a
          full-width stock list with its own toolbar and pager, not a table
          boxed inside a card. */}
      {product === null ? (
        <p className="notice" role="status">
          เลือกสินค้าที่จะรับเข้าจากรายการด้านล่าง — ถ้าของที่มาส่งยังไม่เคยมีในระบบ กด{" "}
          <strong>เพิ่มสินค้าใหม่</strong> ด้านบน ในนั้นคัดลอกจากสินค้าที่ใกล้เคียงได้
          กรอกสเปกกับล็อตแรก (จำนวน ต้นทุน วันที่รับเข้า) ให้ครบในหน้าเดียว แล้วกดบันทึกครั้งเดียวจบ
        </p>
      ) : null}

      <ProductPicker
        value={null}
        onPick={setProduct}
        refresh={refresh}
        only="ready"
        label="สินค้าที่รับเข้า"
        autoFocus
      />

      {product !== null ? (
        <TaskDialog
          eyebrow="รับของเข้าคลัง"
          title={product.name}
          head={<PickedSummary row={product} showName={false} />}
          onClose={() => setProduct(null)}
        >
          {product.isCustomMade ? (
            <div className="notice" role="status">
              <p>
                <strong>{product.name}</strong> เป็นสินค้าสั่งตัด — ไม่เก็บเป็นล็อตในคลัง
                จึงไม่มีอะไรให้รับเข้า
              </p>
              <p className="field__help">
                ของแบบนี้สั่งกับผู้ขายเป็นรายใบ ที่หน้า{" "}
                <Link href="/stock/rx" className="grid__link">
                  ใบสั่งตัด RX
                </Link>
              </p>
            </div>
          ) : (
          <form onSubmit={submit} noValidate>
            {defaults?.lastLot ? (
              <div className="onhand" role="status">
                ล็อตล่าสุดของสินค้านี้: <strong>{count(defaults.lastLot.quantity)} ชิ้น</strong> ·{" "}
                {defaults.lastLot.costPerUnit === null
                  ? "ยังไม่มีต้นทุน"
                  : `${money(defaults.lastLot.costPerUnit)} บาท/ชิ้น`}
                {defaults.lastLot.supplierName ? ` · ${defaults.lastLot.supplierName}` : ""} ·
                รับเข้า {date(defaults.lastLot.receivedDate)}
                {/* The way out of the wrong door: correcting that lot is a
                    different job from receiving another one, and this form
                    only does the second. */}
                {mayCost && defaults.lastLot.costPerUnit === null ? (
                  <div className="chips">
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => setFixingLot(true)}
                      disabled={busy}
                    >
                      ลงต้นทุนล็อตนั้น — ไม่เพิ่มจำนวน
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="onhand" role="status">
                สินค้านี้ยังไม่เคยมีล็อตในคลัง — ล็อตนี้จะเป็นล็อตแรก
              </div>
            )}

            <QtyField
              id="rc-qty"
              value={qty}
              onChange={setQty}
              disabled={busy}
              label="จำนวนที่รับเข้า"
              help="กดบวกลบได้ หรือพิมพ์เองถ้ารับมาเยอะ"
            />

            <div className="formgrid">
              <div className="field">
                <label className="field__label" htmlFor="rc-sup">
                  ผู้ขาย
                </label>
                <Select
                  id="rc-sup"
                  value={supplierId}
                  onChange={setSupplierId}
                  disabled={busy || suppliers.status !== "ready"}
                  placeholder="ไม่ระบุ"
                  options={[
                    { value: "", label: "ไม่ระบุ" },
                    ...(suppliers.status === "ready"
                      ? suppliers.data.suppliers.map((s) => ({ value: String(s.id), label: s.name }))
                      : []),
                  ]}
                />
                {defaults?.lastLot?.supplierName ? (
                  <span className="field__help">เติมจากล็อตก่อน — เปลี่ยนได้ถ้าสั่งเจ้าอื่น</span>
                ) : null}
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rc-cost">
                  ต้นทุนต่อชิ้น (฿)
                </label>
                <input
                  id="rc-cost"
                  className="input"
                  inputMode="decimal"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder={mayCost ? "เว้นว่างถ้าใบกำกับยังไม่มา" : "ฝ่ายบัญชีเป็นคนลง"}
                  disabled={busy || !mayCost}
                />
                {mayCost && defaults?.lastLot?.costPerUnit != null ? (
                  <span className="field__help">
                    ต้นทุนล็อตก่อน {money(defaults.lastLot.costPerUnit)} — แก้ได้ถ้าราคาเปลี่ยน
                  </span>
                ) : null}
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rc-recv">
                  วันที่รับเข้า
                </label>
                <DateField
                  id="rc-recv"
                  value={received}
                  onChange={setReceived}
                  disabled={busy}
                  clearable={false}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="rc-exp">
                  วันหมดอายุ
                </label>
                <DateField
                  id="rc-exp"
                  value={expiry}
                  onChange={setExpiry}
                  disabled={busy}
                  placeholder="ไม่มีวันหมดอายุ"
                />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="rc-note">
                หมายเหตุ
              </label>
              <input
                id="rc-note"
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="เช่น เลขที่ใบส่งของ"
                disabled={busy}
                autoComplete="off"
              />
              <span className="field__help">
                เว้นต้นทุนว่างได้ถ้าใบกำกับยังไม่มา — ระบบจะนับล็อตนั้นแยกไว้แทนที่จะคิดเป็นศูนย์
              </span>
            </div>

            {problem ? (
              <div className="notice notice--error" role="alert">
                {problem}
              </div>
            ) : null}

            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "กำลังรับเข้า…" : "รับเข้าคลัง"}
            </button>
          </form>
          )}
        </TaskDialog>
      ) : null}

      {/* Built from what the defaults already carry: the lot's own figures,
          and the product's name and code from the row that is picked. */}
      {fixingLot && product !== null && defaults?.lastLot ? (
        <LotEditDialog
          lot={{
            id: defaults.lastLot.id,
            lotNumber: defaults.lastLot.lotNumber,
            productId: product.id,
            sku: product.sku,
            productName: product.name,
            productType: product.productType,
            supplierName: defaults.lastLot.supplierName,
            costPerUnit: defaults.lastLot.costPerUnit,
            initialQty: defaults.lastLot.quantity,
            remainingQty: defaults.lastLot.remainingQty,
            receivedDate: defaults.lastLot.receivedDate,
            expiryDate: defaults.lastLot.expiryDate,
            expiringSoon: false,
            value: null,
          }}
          onClose={() => setFixingLot(false)}
          onSaved={() => {
            setFixingLot(false);
            setRefresh((n) => n + 1);
            toast.ok({ text: "แก้ไขล็อตแล้ว", link: { href: "/lots", label: "ดูล็อตทั้งหมด" } });
            // Re-read the defaults so the line above stops saying "ยังไม่มีต้นทุน".
            const picked = product;
            setProduct(null);
            setTimeout(() => setProduct(picked), 0);
          }}
        />
      ) : null}

      {creating ? (
        <NewProductDialog
          title="เพิ่มสินค้าใหม่แล้วรับเข้าเลย"
          receive
          // Only goods that can actually be received. A made-to-order lens is
          // ordered on the RX screen and never arrives as a lot.
          make="stock"
          onUseExisting={async (id) => {
            setCreating(false);
            try {
              const { product: fresh } = await api.get<{ product: ProductRow }>(`/products/${id}`);
              setProduct(fresh);
            } catch {
              setProblem("เลือกสินค้าตัวเดิมให้อัตโนมัติไม่สำเร็จ — เลือกจากรายการด้านล่างได้เลย");
            }
          }}
          onClose={() => setCreating(false)}
          onSaved={async (id, created) => {
            setCreating(false);
            // The dialog took the first lot in as part of the same save, so the
            // receipt is reported here exactly as one entered on this form is.
            if (created) {
              toast.ok({
                text: `เพิ่ม ${created.name} และรับเข้าคลังแล้ว`,
                detail:
                  `${count(created.quantity)} ชิ้น` +
                  (created.awaitingCost ? " · ยังไม่มีต้นทุน รอใบกำกับ" : ""),
                link: { href: "/lots", label: "ดูล็อตทั้งหมด" },
              });
            }
            setRefresh((n) => n + 1);

            // The product stays picked so the next lot of the same delivery
            // needs no second search — but only if it is a product this page
            // can act on at all. A made-to-order one holds no stock: handing it
            // to the receive form opens a form whose every outcome is the API
            // refusing it, which is exactly what used to happen.
            try {
              const { product: fresh } = await api.get<{ product: ProductRow }>(`/products/${id}`);
              if (fresh.isCustomMade) {
                toast.ok({
                  text: `เพิ่ม ${fresh.name} เข้าแคตตาล็อกแล้ว`,
                  detail: "สินค้าสั่งตัดไม่เก็บเป็นล็อต — ไม่ต้องรับเข้าคลัง สั่งกับผู้ขายที่หน้าใบสั่งตัด RX",
                  link: { href: "/rx", label: "ไปหน้าใบสั่งตัด RX" },
                });
                return;
              }
              setProduct(fresh);
            } catch {
              // The product saved; only the hand-off failed. Say nothing and let
              // them pick it from the list, which now contains it.
              setProblem("เพิ่มสินค้าแล้ว แต่เลือกให้อัตโนมัติไม่สำเร็จ — เลือกจากรายการด้านล่างได้เลย");
            }
          }}
        />
      ) : null}
    </main>
  );
}

/**
 * "LOT-2026-014" becomes "LOT-2026-015" so a delivery of several lots does not
 * mean retyping the prefix each time. Same rule the API uses for its own
 * suggestion; anything without a number on the end gets none.
 */
function stepLotNumber(previous: string): string | null {
  const m = /^(.*?)(\d+)$/.exec(previous);
  if (m === null) return null;
  const next = String(Number(m[2]) + 1);
  return m[1] + next.padStart(m[2].length, "0");
}
