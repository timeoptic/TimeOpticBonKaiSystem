"use client";

import { useState } from "react";
import { can, useActor } from "./AppShell";
import TaskDialog from "./TaskDialog";
import DateField from "./DateField";
import QtyField from "./QtyField";
import { api, ApiError, type LotRow } from "@/stockmod/lib/api";
import { count, date, money } from "@/stockmod/lib/format";

/**
 * Correcting a lot that is already in the cupboard.
 *
 * The cost is the reason this exists. Goods routinely arrive before the invoice
 * does, so a lot sits marked "รอต้นทุน" until the paperwork turns up — and until
 * now the only way to fill that figure in was to leave the lot list, find the
 * product in the catalogue, open its drawer and edit the lot there. People did
 * the obvious thing instead: opened the receiving form, typed the cost, and were
 * told the quantity must be at least 1. They were not trying to receive
 * anything. They were trying to correct what they already had.
 *
 * So this edits the lot in place and adds no stock: leaving the count alone
 * writes nothing to the ledger, and changing it writes an ADJUST beside the
 * reason for it — which is what a correction should look like when someone
 * reads it back.
 */
export default function LotEditDialog({
  lot,
  onClose,
  onSaved,
}: {
  lot: LotRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const actor = useActor();
  const mayCost = can.enterCost(actor);

  const [qty, setQty] = useState(String(lot.remainingQty));
  const [cost, setCost] = useState(lot.costPerUnit === null ? "" : String(lot.costPerUnit));
  const [expiry, setExpiry] = useState(lot.expiryDate ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const n = Number(qty);
  const moved = Number.isInteger(n) && n !== lot.remainingQty;
  // The server insists on a reason for a count above what was received; asking
  // here saves the round trip and says why while the number is still on screen.
  const needsReason = n > lot.initialQty && note.trim() === "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!Number.isInteger(n) || n < 0) {
      setProblem("คงเหลือต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      return;
    }
    if (needsReason) {
      setProblem(`คงเหลือมากกว่าที่รับเข้า (${count(lot.initialQty)}) — กรอกเหตุผลกำกับไว้ด้วย`);
      return;
    }

    setBusy(true);
    setProblem(null);

    try {
      const body: Record<string, unknown> = { remaining_qty: n };

      // An absent key means "leave it alone", so only what actually changed is
      // sent — and the cost only by someone allowed to name one.
      if (mayCost && cost.trim() !== (lot.costPerUnit === null ? "" : String(lot.costPerUnit))) {
        body.cost_per_unit = cost.trim() || null;
      }
      if (expiry !== (lot.expiryDate ?? "")) {
        body.expiry_date = expiry || null;
      }
      if (note.trim() !== "") {
        body.note = note.trim();
      }

      await api.post(`/lots/${lot.id}/update`, body);
      onSaved();
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "แก้ไขไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <TaskDialog
      eyebrow="แก้ไขล็อต"
      title={lot.productName}
      head={
        <span className="picked__sub">
          {lot.sku}
          {lot.supplierName ? ` · ${lot.supplierName}` : ""} · รับเข้า {date(lot.receivedDate)}{" "}
          {count(lot.initialQty)} ชิ้น
        </span>
      }
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="onhand" role="status">
          แก้รายละเอียดของล็อตที่มีอยู่แล้ว — ไม่ใช่การรับของเข้าใหม่
          {lot.costPerUnit === null ? " · ล็อตนี้ยังไม่มีต้นทุน" : ""}
        </div>

        <QtyField
          id="le-qty"
          value={qty}
          onChange={setQty}
          disabled={busy}
          label="คงเหลือตอนนี้"
          help={
            moved
              ? `ต่างจากเดิม ${n > lot.remainingQty ? "+" : ""}${count(n - lot.remainingQty)} ชิ้น — ระบบจะลง ADJUST ในสมุดให้`
              : "ไม่แตะก็ได้ ถ้าแค่มาเติมต้นทุน — ไม่เปลี่ยนคือไม่มีอะไรลงสมุด"
          }
        />

        <div className="formgrid">
          <div className="field">
            <label className="field__label" htmlFor="le-cost">
              ต้นทุนต่อชิ้น (฿)
            </label>
            <input
              id="le-cost"
              className="input"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder={mayCost ? "ใบกำกับมาแล้วก็ใส่ตรงนี้" : "ฝ่ายบัญชีเป็นคนลง"}
              disabled={busy || !mayCost}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="le-exp">
              วันหมดอายุ
            </label>
            <DateField
              id="le-exp"
              value={expiry}
              onChange={setExpiry}
              disabled={busy}
              placeholder="ไม่มีวันหมดอายุ"
            />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="le-note">
            หมายเหตุ
            {needsReason ? <span className="field__req"> · ต้องกรอก</span> : null}
          </label>
          <input
            id="le-note"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              needsReason ? "เช่น ตรวจนับเจอของเกิน ผู้ขายส่งเกินมา" : "เช่น เลขที่ใบกำกับ"
            }
            disabled={busy}
            autoComplete="off"
          />
        </div>

        {problem ? (
          <div className="notice notice--error" role="alert">
            {problem}
          </div>
        ) : null}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}
        </button>

        {lot.costPerUnit !== null && !moved ? (
          <p className="field__help">
            มูลค่าคงเหลือตอนนี้ {money(lot.costPerUnit * lot.remainingQty)} บาท
          </p>
        ) : null}
      </form>
    </TaskDialog>
  );
}
