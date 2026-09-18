"use client";

import { useEffect, useState } from "react";
import TaskDialog from "./TaskDialog";
import QtyField from "./QtyField";
import DateField from "./DateField";
import SupplierSelect, { supplierIdOf } from "./SupplierSelect";
import { can, useActor } from "./AppShell";
import { useToast } from "./Toaster";
import { api, ApiError, type MovementRow } from "@/stockmod/lib/api";
import { useApi } from "@/stockmod/lib/useApi";
import { count, date, shortName } from "@/stockmod/lib/format";

type Receipt = {
  id: number;
  lotId: number;
  lotNumber: string;
  sku: string;
  name: string;
  quantity: number;
  remaining: number;
  used: number;
  receivedDate: string;
  expiryDate: string | null;
  supplierId: number | null;
  costPerUnit: number | null;
  note: string | null;
};

/**
 * แก้การรับเข้าที่คีย์ผิด — ร้านขอ 18 ก.ย. 2026 ("มีแก้การเบิกแล้ว อยากได้แก้การรับเข้าด้วย")
 *
 * แก้ได้: จำนวนที่รับ · วันที่รับ · ผู้ขาย · วันหมดอายุ · ต้นทุน/ชิ้น (เฉพาะคนลงต้นทุนได้) · หมายเหตุ
 * แก้จำนวนหรือวันที่ต้องบอกเหตุผล — ต่อท้ายไว้ในแถวรับเข้า ตัวเลขที่ถูกแก้ต้องอ่านออกว่าถูกแก้
 * จำนวนแก้ให้ต่ำกว่าของที่ออกจากล็อตไปแล้วไม่ได้ · กติกาจริงอยู่ที่ Receiving::editReceipt
 */
export default function ReceiptEditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: MovementRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const mayCost = can.enterCost(useActor());
  const loaded = useApi<{ receipt: Receipt }>(`/movements/${row.id}/receipt`);
  const suppliers = useApi<{ suppliers: { id: number; name: string }[] }>("/suppliers");

  const [ready, setReady] = useState(false);
  const [qty, setQty] = useState("");
  const [received, setReceived] = useState("");
  const [supplier, setSupplier] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const r = loaded.status === "ready" ? loaded.data.receipt : null;

  useEffect(() => {
    if (!r || ready) return;
    setQty(String(r.quantity));
    setReceived(r.receivedDate);
    setSupplier(r.supplierId === null ? "" : String(r.supplierId));
    setExpiry(r.expiryDate ?? "");
    setCost(r.costPerUnit === null ? "" : String(r.costPerUnit));
    setNote(r.note ?? "");
    setReady(true);
  }, [r, ready]);

  const n = Number(qty);
  const qtyChanged = r !== null && n !== r.quantity;
  const dateChanged = r !== null && received !== r.receivedDate;
  const needsReason = (qtyChanged || dateChanged) && reason.trim() === "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!r) return;
    if (!Number.isInteger(n) || n < 1) {
      setProblem("จำนวนที่รับเข้าต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
      return;
    }
    if (n < r.used) {
      setProblem(`ล็อตนี้ออกไปแล้ว ${count(r.used)} ชิ้น แก้จำนวนให้น้อยกว่านั้นไม่ได้`);
      return;
    }
    if (needsReason) {
      setProblem("แก้จำนวนหรือวันที่รับต้องบอกเหตุผลด้วย");
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      // ส่งเฉพาะช่องที่เปลี่ยน — ช่องที่ไม่ได้แตะไม่ควรไปเขียนทับของเดิม
      const body: Record<string, unknown> = {};
      if (qtyChanged) body.quantity = n;
      if (dateChanged) body.received_date = received;
      if (qtyChanged || dateChanged) body.reason = reason.trim();
      const supplierNow = await supplierIdOf(supplier);
      if (supplierNow !== r.supplierId) body.supplier_id = supplierNow;
      if ((expiry || null) !== r.expiryDate) body.expiry_date = expiry || null;
      if (mayCost && cost.trim() !== (r.costPerUnit === null ? "" : String(r.costPerUnit))) {
        body.cost_per_unit = cost.trim() || null;
      }
      if ((note.trim() || null) !== (r.note ?? null)) body.note = note.trim() || null;

      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      await api.post(`/movements/${row.id}/receipt`, body);
      toast.success({ text: `แก้การรับเข้า ${r.lotNumber} แล้ว`, detail: shortName(r.name) });
      onSaved();
      onClose();
    } catch (err) {
      setProblem(ApiError.is(err) ? err.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <TaskDialog
      eyebrow="แก้ไขการรับเข้า"
      title={shortName(row.productName) || row.sku || "—"}
      head={
        r ? (
          <>
            {r.sku} · ล็อต {r.lotNumber} · รับเข้า {date(r.receivedDate)} {count(r.quantity)} ชิ้น
            {r.used > 0 ? ` · ออกไปแล้ว ${count(r.used)} ชิ้น` : ""}
          </>
        ) : undefined
      }
      onClose={onClose}
    >
      {loaded.status === "loading" ? <div className="skeleton" /> : null}
      {loaded.status === "error" ? (
        <div className="notice notice--error" role="alert">
          {loaded.error}
        </div>
      ) : null}

      {r && ready ? (
        <form onSubmit={save} noValidate>
          <div className="formgrid">
            <QtyField
              id="re-qty"
              value={qty}
              onChange={setQty}
              disabled={busy}
              label="จำนวนที่รับเข้า"
              help={r.used > 0 ? `ต่ำสุด ${count(r.used)} — ออกจากล็อตไปแล้วเท่านั้น` : undefined}
            />
            <div className="field">
              <label className="field__label" htmlFor="re-date">
                วันที่รับเข้า
              </label>
              <DateField id="re-date" value={received} onChange={setReceived} disabled={busy} clearable={false} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="re-sup">
                ผู้ขาย
              </label>
              <SupplierSelect
                id="re-sup"
                value={supplier}
                onChange={setSupplier}
                disabled={busy || suppliers.status !== "ready"}
                suppliers={suppliers.status === "ready" ? suppliers.data.suppliers : []}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="re-exp">
                วันหมดอายุ
              </label>
              <DateField id="re-exp" value={expiry} onChange={setExpiry} disabled={busy} placeholder="ไม่มีวันหมดอายุ" />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="re-cost">
                ต้นทุนต่อชิ้น (฿)
              </label>
              <input
                id="re-cost"
                className="input"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                disabled={busy || !mayCost}
                placeholder={mayCost ? "เว้นว่างถ้าใบกำกับยังไม่มา" : "ฝ่ายบัญชีเป็นคนลง"}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="re-note">
                หมายเหตุของล็อต
              </label>
              <input
                id="re-note"
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                maxLength={500}
                autoComplete="off"
              />
            </div>
          </div>

          {qtyChanged || dateChanged ? (
            <div className="field">
              <label className="field__label" htmlFor="re-why">
                เหตุผลที่แก้ (จำเป็น)
              </label>
              <input
                id="re-why"
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
                maxLength={300}
                placeholder="เช่น นับผิดตอนรับ ใบส่งของเขียน 5 กล่อง"
                autoComplete="off"
              />
              <span className="field__help">ต่อท้ายไว้ในรายการรับเข้า — คนที่ดูย้อนหลังจะเห็นว่าแก้อะไร จากเท่าไร</span>
            </div>
          ) : null}

          {problem ? (
            <div className="notice notice--error" role="alert">
              {problem}
            </div>
          ) : null}

          <div className="chips">
            <button type="submit" className="btn btn--primary" disabled={busy || needsReason}>
              {busy ? "กำลังบันทึก…" : "บันทึก"}
            </button>
            <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
              ปิด
            </button>
          </div>
        </form>
      ) : null}
    </TaskDialog>
  );
}
