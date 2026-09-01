"use client";

import { useEffect, useRef } from "react";
import ProductForm from "./ProductForm";
import { IconClose } from "./Icon";
import backdropClose from "./backdrop";
import type { CreatedLot } from "@/stockmod/lib/api";

/**
 * Adding a product, in a dialog over whatever you were doing.
 *
 * It lives here rather than on the catalogue page because a new product is
 * usually discovered while receiving stock — a lens arrives in a power the shop
 * has never held before, and that power is part of what the product *is*. Making
 * someone leave the delivery, add the product elsewhere and navigate back is how
 * specs end up half-filled or the product gets typed twice.
 */
export default function NewProductDialog({
  onClose,
  onSaved,
  title = "เพิ่มสินค้าเข้าคลัง",
  receive = false,
  make,
  presetType,
  onUseExisting,
  initialQty,
  askQty,
}: {
  onClose: () => void;
  onSaved: (id: number, lot?: CreatedLot) => void;
  title?: string;
  /** Fix the kind of goods, so a screen only ever adds what it can act on. */
  make?: "stock" | "custom";
  /** Skip the type chooser when the screen already knows what is being added. */
  presetType?: string;
  /** Offer "use the one that already exists" when a copy would duplicate it. */
  onUseExisting?: (id: number) => void;
  /** Also take the delivery's first lot in, in the same save. */
  receive?: boolean;
  /** จำนวนตั้งต้นของล็อตแรก — หน้าร้านส่ง "0" มา เพราะของยังไม่มาถึง */
  initialQty?: string;
  /** ถามจำนวนที่รับเข้าไหม — หน้าร้านไม่ถาม คนเปิดออเดอร์ไม่ได้ถือของอยู่ */
  askQty?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);

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
            <p className="drawer__eyebrow">สินค้าใหม่</p>
            <h2 className="drawer__title">{title}</h2>
          </div>
          <button
            type="button"
            className="btn btn--quiet btn--small btn--icon"
            onClick={() => ref.current?.close()}
          >
            <IconClose />
            ปิด
          </button>
        </header>
        <section className="drawer__section">
          <ProductForm
            receive={receive}
            make={make}
            presetType={presetType}
            initialQty={initialQty}
            askQty={askQty}
            onUseExisting={onUseExisting}
            onSaved={onSaved}
            onCancel={() => ref.current?.close()}
          />
        </section>
      </div>
    </dialog>
  );
}
