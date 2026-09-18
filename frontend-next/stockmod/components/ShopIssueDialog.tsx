"use client";

import { useState } from "react";
import TaskDialog from "./TaskDialog";
import Select from "./Select";
import { IconTrash } from "./Icon";
import { useToast } from "./Toaster";
import { api, ApiError, type MovementRow, type Person } from "@/stockmod/lib/api";
import { count, date } from "@/stockmod/lib/format";

/**
 * แก้ไข / ยกเลิกการเบิกของร้านเอง (TimeOptic) — แถวจ่ายออกที่ไม่ผูกสาขาและไม่ได้มาจากเคส
 *
 * ร้านถามไว้ 12 ก.ย. 2026: "ถ้า TimeOptic เบิกผิดแก้อย่างไร ไม่มีที่แก้ให้เลย" · หน้าตาและ
 * เส้นแบ่งเหมือน `SettlementEditDialog` ของฝั่งสาขา ให้คนที่ใช้สองหน้าไม่ต้องจำสองแบบ:
 *
 *   แก้ได้     เลขเอกสาร · หมายเหตุ · ผู้เบิก — ของบนชั้นไม่ขยับ
 *   แก้ไม่ได้  สินค้า · จำนวน — ของที่ตัดออกจากล็อตไปแล้ว คีย์ผิดต้องยกเลิกแล้วเบิกใหม่
 *
 * ยกเลิกไม่ใช่ลบ — ของกลับเข้าล็อตเดิม และสมุดมีแถว "รับคืน" พร้อมเหตุผลให้ตามย้อนหลัง
 */
export default function ShopIssueDialog({
  row,
  people,
  onClose,
  onSaved,
}: {
  row: MovementRow;
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  /* แถวตัดของเสีย — ยกเลิกได้อย่างเดียว (ร้านขอไว้ 14 ก.ย. 2026) · ช่องที่แก้ได้ของแถว
     จ่ายออก (ผู้เบิก) ไม่มีความหมายกับของเสีย จึงไม่มีแผงแก้ไข */
  const scrap = row.actionType === "SCRAP";

  const [doc, setDoc] = useState(row.referenceDoc ?? "");
  const [note, setNote] = useState(row.notes ?? "");
  const [who, setWho] = useState(row.issuedToId === null ? "" : String(row.issuedToId));

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [why, setWhy] = useState("");

  const pieces = Math.abs(row.quantity);

  /* คนที่ถูกเลือกไว้เดิมแต่ไม่อยู่ในรายชื่อแล้ว (ปิดบัญชีไป) ต้องยังเห็นเป็นตัวเลือกของ
     ตัวเอง ไม่งั้นช่องจะว่างและกดบันทึกแล้วชื่อหายไปโดยไม่ได้ตั้งใจ */
  const options = [
    { value: "", label: "ไม่ระบุ" },
    ...people.map((p) => ({ value: String(p.id), label: p.displayName + (p.jobTitle ? ` · ${p.jobTitle}` : "") })),
    ...(row.issuedToId !== null && !people.some((p) => p.id === row.issuedToId)
      ? [{ value: String(row.issuedToId), label: row.issuedToName ?? `ผู้ใช้ #${row.issuedToId}` }]
      : []),
  ];

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/movements/${row.id}/update`, {
        reference_doc: doc.trim() || null,
        note: note.trim() || null,
        issued_to_admin_id: who === "" ? null : Number(who),
      });
      toast.success({ text: "แก้รายการเบิกแล้ว", detail: `${row.productName ?? row.sku} · ${count(pieces)} ชิ้น` });
      onSaved();
      onClose();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setProblem(null);
    try {
      const out = await api.post<{ returned: { lot: string; quantity: number }[] }>(
        `/movements/${row.id}/cancel`,
        { note: why.trim() || null },
      );
      const back = out.returned ?? [];
      toast.warning({
        text: `${scrap ? "ยกเลิกการตัดของเสียแล้ว" : "ยกเลิกการเบิกแล้ว"} — คืนของเข้าคลัง ${count(back.reduce((n, b) => n + b.quantity, 0))} ชิ้น`,
        detail: back.map((b) => `${b.lot} +${b.quantity}`).join(" · ") || undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "ยกเลิกไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <TaskDialog
      eyebrow={scrap ? "ยกเลิกการตัดของเสีย" : "แก้ไขการเบิก · TimeOptic"}
      title={row.productName ?? row.sku ?? "—"}
      head={
        <>
          {row.sku ?? "—"} · {count(pieces)} ชิ้น · {scrap ? "ตัดเสีย" : "เบิก"} {date(row.createdAt)}
          {scrap && row.scrapBy ? ` · ทำเสียโดย ${row.scrapBy}` : ""}
          {row.actorName ? ` · บันทึกโดย ${row.actorName}` : ""}
        </>
      }
      onClose={onClose}
    >
      {scrap ? (
        <>
          <div className="onhand" role="status">
            รายการตัดของเสียแก้รายละเอียดไม่ได้ — ถ้าตัดผิดหรือของไม่ได้เสียจริง ให้ยกเลิก
            ของจะคืนเข้าล็อตเดิม แล้วค่อยตัดใหม่ให้ถูก
          </div>
          {problem ? (
            <div className="notice notice--error" role="alert">
              {problem}
            </div>
          ) : null}
        </>
      ) : (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <div className="onhand" role="status">
          แก้ได้เฉพาะคำอธิบายของรายการ — สินค้ากับจำนวนคือของที่ตัดออกจากล็อตไปแล้ว
          คีย์ผิดต้องยกเลิกแล้วเบิกใหม่
        </div>

        <div className="formgrid">
          <div className="field">
            <label className="field__label" htmlFor="si-doc">
              เลขเอกสาร
            </label>
            <input
              id="si-doc"
              className="input"
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
              maxLength={100}
              disabled={busy}
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="si-who">
              ผู้เบิก
            </label>
            <Select id="si-who" value={who} onChange={setWho} disabled={busy} placeholder="ไม่ระบุ" options={options} />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="si-note">
            หมายเหตุ
          </label>
          <input
            id="si-note"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
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
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
            ปิด
          </button>
        </div>
      </form>
      )}

      <div className="drawer__danger">
        {!confirming ? (
          <>
            <p className="drawer__legend">
              {scrap
                ? "ยกเลิกการตัดของเสียนี้ — ตัดผิด หรือของไม่ได้เสียจริง"
                : "ยกเลิกการเบิกนี้ — เบิกผิด หรือของกลับมาแล้ว"}
            </p>
            <p className="field__help">
              ของ {count(pieces)} ชิ้นจะถูกคืนกลับเข้าล็อตเดิมที่มันถูกตัดออกมา แล้วค่อย{scrap ? "ตัด" : "เบิก"}ใหม่ให้ถูก
              · หน้าความเคลื่อนไหวจะมีแถว "รับคืน" พร้อมเหตุผล
            </p>
            <button
              type="button"
              className="btn btn--danger-quiet btn--small btn--icon"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              <IconTrash /> ยกเลิกและคืนของ
            </button>
          </>
        ) : (
          <>
            <p className="drawer__legend">ยกเลิกและคืนของ — ยืนยัน</p>
            <div className="field">
              <label className="field__label" htmlFor="si-why">
                เหตุผล · ต้องกรอก
              </label>
              <input
                id="si-why"
                className="input"
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder="เช่น คีย์จำนวนผิด · หยิบผิดรุ่น"
                disabled={busy}
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="chips">
              <button
                type="button"
                className="btn btn--danger btn--small"
                onClick={cancel}
                disabled={busy || why.trim() === ""}
              >
                {busy ? "กำลังทำ…" : "ยืนยันยกเลิกและคืนของ"}
              </button>
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                ไม่เอาแล้ว
              </button>
            </div>
          </>
        )}
      </div>
    </TaskDialog>
  );
}
