"use client";

import { useState } from "react";
import { can, useActor } from "./AppShell";
import InlineEdit from "./InlineEdit";
import Select from "./Select";
import DateField from "./DateField";
import QtyField from "./QtyField";
import { IconTrash } from "./Icon";
import ConfirmDelete from "./ConfirmDelete";
import { useToast } from "./Toaster";
import { api, ApiError, type ProductDetail, type ProductRow } from "@/stockmod/lib/api";
import { useApi } from "@/stockmod/lib/useApi";
import { count, date, money } from "@/stockmod/lib/format";

type Supplier = { id: number; name: string };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * A product's lots, opened under its row, correctable in place.
 *
 * This is where the lot list and the receiving form ended up after they stopped
 * being screens of their own. They were separate because they are separate
 * jobs; they are together because they are the same *row*. Standing in front of
 * one product, "what is on the shelf", "what did it cost", and "another box
 * arrived" are three questions about the same thing, and walking between three
 * pages to answer them was the whole complaint.
 *
 * Every figure edits where it is written. A count may be set to 0 — that is a
 * count finding nothing, not an error — and the server records the difference
 * as an ADJUST so the ledger still explains the number afterwards.
 */
export default function StockLines({
  product,
  onChanged,
  onDetails,
  startReceiving = false,
}: {
  product: ProductRow;
  /** Fired after any write, so the row above can re-read its totals. */
  onChanged: () => void;
  /** Open the product's own drawer — spec, history, edit, delete. */
  onDetails: () => void;
  /**
   * Open with the receiving form already up.
   *
   * For arriving here having *already* said "another box of this came in" —
   * from the add-product dialog, where someone copied an existing product and
   * was told that what they actually wanted was a lot under the original. That
   * sentence is only useful if pressing it lands on the form, not on the button
   * that opens it.
   *
   * Read once, as the initial state: after that the form is the person's to
   * open and close, and a prop that kept reasserting itself would reopen a form
   * they had just dismissed.
   */
  startReceiving?: boolean;
}) {
  const actor = useActor();
  const mayCost = can.enterCost(actor);
  const mayEdit = can.editCatalog(actor);

  const detail = useApi<{ product: ProductDetail }>(`/products/${product.id}`);
  const suppliers = useApi<{ suppliers: Supplier[] }>("/suppliers");

  const [receiving, setReceiving] = useState(startReceiving);
  const [spent, setSpent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* ล็อตที่กดถังขยะไว้ แต่ยังไม่ได้ยืนยัน — null = ยังไม่มีกล่องเปิดอยู่
     ปุ่มถังขยะอยู่ท้ายบรรทัดติดกับช่องกรอกที่แก้ได้ทุกช่อง การกดพลาดหนึ่งครั้ง
     ลบล็อตหายไปทั้งใบ แล้วไม่มีปุ่มเรียกกลับ */
  const [asking, setAsking] = useState<ProductDetail["lots"][number] | null>(null);
  const [removing, setRemoving] = useState(false);

  const all = detail.status === "ready" ? detail.data.product.lots : [];

  /**
   * A spent lot is history, not stock.
   *
   * It cannot be deleted — something was drawn from it, so the ledger needs it
   * — and it cannot be received into. Left in the list it grows without limit:
   * a product the shop reorders monthly shows a year of empty rows above the
   * one box actually on the shelf. Folded away instead, counted so it is
   * clearly still there, and one tap from being read.
   */
  const live = all.filter((l) => l.remainingQty > 0);
  const emptied = all.filter((l) => l.remainingQty === 0);
  const lots = spent ? all : live;

  const toast = useToast();

  function done() {
    detail.reload();
    onChanged();
  }

  async function patchLot(id: number, body: Record<string, unknown>) {
    try {
      await api.post(`/lots/${id}/update`, body);
      toast.success({ text: "แก้ล็อตแล้ว", detail: product.sku });
      done();
    } catch (e) {
      // Thrown on, not swallowed: InlineEdit shows it beside the figure that
      // was refused, which is the only place it means anything.
      throw new Error(ApiError.is(e) ? e.message : "บันทึกไม่สำเร็จ");
    }
  }

  async function removeLot(id: number) {
    setRemoving(true);
    setProblem(null);
    try {
      await api.post(`/lots/${id}/delete`);
      toast.success({ text: "ลบล็อตแล้ว", detail: product.sku });
      setAsking(null);
      done();
    } catch (e) {
      /* ค้างไว้ใน state ด้วย เพราะกล่องยืนยันยังเปิดอยู่และต้องบอกในกล่องนั้น ·
         toast คู่กันสำหรับตอนที่กล่องปิดไปแล้ว */
      const why = ApiError.is(e) ? e.message : "ลบไม่สำเร็จ";
      setProblem(why);
      toast.error({ text: "ลบล็อตไม่สำเร็จ", detail: why });
    } finally {
      setRemoving(false);
    }
  }

  if (product.isCustomMade) {
    return (
      <div className="stocklines">
        <p className="field__help">
          สินค้าสั่งตัด — ไม่เก็บเป็นล็อตในคลัง สั่งเป็นรายใบที่หน้าใบสั่งตัด RX
        </p>
      </div>
    );
  }

  return (
    <div className="stocklines">
      {detail.status === "loading" ? <div className="skeleton" /> : null}

      {detail.status === "error" ? (
        <div className="notice notice--error" role="alert">
          {detail.error}
        </div>
      ) : null}

      {detail.status === "ready" && all.length === 0 ? (
        <p className="field__help">ยังไม่มีล็อตของสินค้านี้</p>
      ) : null}

      {detail.status === "ready" && all.length > 0 && live.length === 0 && !spent ? (
        <p className="field__help">ล็อตของสินค้านี้ถูกตัดออกไปหมดแล้ว</p>
      ) : null}

      {lots.length > 0 ? (
        <ul className="stocklines__list">
          {lots.map((l) => (
            <li
              className={
                l.remainingQty === 0
                  ? "lotline lotline--spent"
                  : l.costPerUnit === null
                    ? "lotline lotline--pending"
                    : "lotline"
              }
              key={l.id}
            >
              <span className="lotline__when">
                {date(l.receivedDate)}
                <span className="lotline__who">{l.supplierName ?? "ไม่ระบุผู้ขาย"}</span>
              </span>

              <span className="lotline__cell">
                <span className="lotline__label">คงเหลือ</span>
                <InlineEdit
                  label={`คงเหลือของล็อต ${date(l.receivedDate)}`}
                  value={String(l.remainingQty)}
                  suffix="ชิ้น"
                  disabled={!mayEdit}
                  onSave={(v) => patchLot(l.id, { remaining_qty: Number(v || 0) })}
                />
                <span className="lotline__sub">รับเข้า {count(l.initialQty)}</span>
              </span>

              <span className="lotline__cell">
                <span className="lotline__label">ต้นทุน/ชิ้น</span>
                <InlineEdit
                  label={`ต้นทุนของล็อต ${date(l.receivedDate)}`}
                  value={l.costPerUnit === null ? "" : String(l.costPerUnit)}
                  display={l.costPerUnit === null ? undefined : money(l.costPerUnit)}
                  empty="รอต้นทุน"
                  placeholder="฿"
                  disabled={!mayCost}
                  onSave={(v) => patchLot(l.id, { cost_per_unit: v || null })}
                />
              </span>

              <span className="lotline__cell">
                <span className="lotline__label">หมดอายุ</span>
                <InlineEdit
                  label={`วันหมดอายุของล็อต ${date(l.receivedDate)}`}
                  value={l.expiryDate ?? ""}
                  display={l.expiryDate ? date(l.expiryDate) : undefined}
                  empty="ไม่มี"
                  placeholder="YYYY-MM-DD"
                  numeric={false}
                  disabled={!mayEdit}
                  onSave={(v) => patchLot(l.id, { expiry_date: v || null })}
                />
              </span>

              {/* Only a lot nothing has been drawn from can go — the rest is
                  history, and history is corrected by adjusting, not deleting. */}
              {mayEdit && l.remainingQty === l.initialQty ? (
                <button
                  type="button"
                  className="btn btn--danger btn--small btn--icon"
                  onClick={() => setAsking(l)}
                  aria-label={`ลบล็อตที่รับเข้า ${date(l.receivedDate)}`}
                >
                  <IconTrash />
                </button>
              ) : (
                <span className="lotline__locked">ตัดของไปแล้ว ลบไม่ได้</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {problem && asking === null ? (
        <div className="notice notice--error" role="alert">
          {problem}
        </div>
      ) : null}

      {asking !== null ? (
        <ConfirmDelete
          title={`ล็อต ${asking.lotNumber}`}
          what={`ลบล็อตนี้ของ ${product.sku} ออกจากคลัง`}
          detail={`รับเข้า ${date(asking.receivedDate)} · ${count(asking.initialQty)} ชิ้น ยังไม่ได้ตัดออกเลย`}
          busy={removing}
          problem={problem}
          onConfirm={() => void removeLot(asking.id)}
          onClose={() => {
            setProblem(null);
            setAsking(null);
          }}
        />
      ) : null}

      {receiving ? (
        <ReceiveLine
          sku={product.sku}
          suppliers={suppliers.status === "ready" ? suppliers.data.suppliers : []}
          mayCost={mayCost}
          last={lots[0] ?? null}
          onCancel={() => setReceiving(false)}
          onDone={() => {
            setReceiving(false);
            done();
          }}
        />
      ) : (
        <div className="chips">
          <button type="button" className="btn btn--small" onClick={() => setReceiving(true)}>
            + รับเข้าล็อตใหม่
          </button>

          {emptied.length > 0 ? (
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => setSpent((v) => !v)}
              aria-expanded={spent}
            >
              {spent ? "ซ่อนล็อตที่หมดแล้ว" : `ล็อตที่หมดแล้ว ${count(emptied.length)}`}
            </button>
          ) : null}

          {/* The rest of the product — its spec, its history, editing and
              deleting it — is one quiet link from here rather than a button on
              every row of the table above. */}
          <button type="button" className="btn btn--quiet btn--small" onClick={onDetails}>
            รายละเอียดสินค้า · ประวัติ
          </button>

          {live.length > 0 && live[0].costPerUnit === null ? (
            <span className="chips__note">ล็อตล่าสุดยังไม่มีต้นทุน — กด ✎ ที่ช่องต้นทุนได้เลย</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Taking a delivery in, under the product it belongs to. */
function ReceiveLine({
  sku,
  suppliers,
  mayCost,
  last,
  onCancel,
  onDone,
}: {
  sku: string;
  suppliers: Supplier[];
  mayCost: boolean;
  last: ProductDetail["lots"][number] | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  // Prefilled from the last delivery: the next one is usually the same supplier
  // at the same price, and retyping it is how a wrong one gets typed.
  const [qty, setQty] = useState("1");
  const [supplier, setSupplier] = useState("");
  const [cost, setCost] = useState(
    mayCost && last?.costPerUnit != null ? String(last.costPerUnit) : "",
  );
  const [received, setReceived] = useState(today);
  const [expiry, setExpiry] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) {
      setProblem("จำนวนที่รับเข้าต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      await api.post("/lots", {
        sku,
        quantity: n,
        supplier_id: supplier === "" ? null : Number(supplier),
        cost_per_unit: mayCost && cost.trim() ? cost.trim() : null,
        received_date: received,
        expiry_date: expiry || null,
        note: note.trim() || null,
      });
      onDone();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "รับเข้าไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <form className="receiveline" onSubmit={submit} noValidate>
      <QtyField
        id={`rl-q-${sku}`}
        value={qty}
        onChange={setQty}
        disabled={busy}
        label="จำนวนที่รับเข้า"
      />

      <div className="formgrid">
        <div className="field">
          <label className="field__label" htmlFor={`rl-s-${sku}`}>
            ผู้ขาย
          </label>
          <Select
            id={`rl-s-${sku}`}
            value={supplier}
            onChange={setSupplier}
            disabled={busy}
            placeholder="ไม่ระบุ"
            options={[
              { value: "", label: "ไม่ระบุ" },
              ...suppliers.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`rl-c-${sku}`}>
            ต้นทุนต่อชิ้น (฿)
          </label>
          <input
            id={`rl-c-${sku}`}
            className="input"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder={mayCost ? "เว้นว่างถ้าใบกำกับยังไม่มา" : "ฝ่ายบัญชีเป็นคนลง"}
            disabled={busy || !mayCost}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`rl-d-${sku}`}>
            วันที่รับเข้า
          </label>
          <DateField id={`rl-d-${sku}`} value={received} onChange={setReceived} disabled={busy} clearable={false} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`rl-e-${sku}`}>
            วันหมดอายุ
          </label>
          <DateField
            id={`rl-e-${sku}`}
            value={expiry}
            onChange={setExpiry}
            disabled={busy}
            placeholder="ไม่มีวันหมดอายุ"
          />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`rl-n-${sku}`}>
          หมายเหตุ
        </label>
        <input
          id={`rl-n-${sku}`}
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น เลขที่ใบส่งของ"
          disabled={busy}
          autoComplete="off"
        />
      </div>

      {problem ? (
        <div className="notice notice--error" role="alert">
          {problem}
        </div>
      ) : null}

      <div className="chips">
        <button type="submit" className="btn btn--primary btn--small" disabled={busy}>
          {busy ? "กำลังรับเข้า…" : "รับเข้าคลัง"}
        </button>
        <button type="button" className="btn btn--quiet btn--small" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </button>
        {last ? (
          <span className="chips__note">
            ล็อตก่อน {count(last.initialQty)} ชิ้น ·{" "}
            {last.costPerUnit === null ? "ไม่มีต้นทุน" : `${money(last.costPerUnit)} บาท/ชิ้น`}
          </span>
        ) : null}
      </div>
    </form>
  );
}
