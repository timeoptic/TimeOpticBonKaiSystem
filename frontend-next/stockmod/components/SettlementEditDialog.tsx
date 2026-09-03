"use client";

import { useState } from "react";
import TaskDialog from "./TaskDialog";
import DateField from "./DateField";
import Select from "./Select";
import { IconTrash } from "./Icon";
import { useToast } from "./Toaster";
import { api, ApiError, type BranchRow, type SettlementRow } from "@/stockmod/lib/api";
import { count, date, money } from "@/stockmod/lib/format";

/**
 * แก้รายการค้างรับ และปิดมันเมื่อสาขาเอาของมาคืน
 *
 * เส้นแบ่งของทั้งหน้าต่างนี้: **อะไรที่แก้แล้วของบนชั้นไม่ขยับ แก้ได้**
 *
 *   แก้ได้     สาขา · ผู้รับของ · วันที่เบิก · หมายเหตุ
 *              ทั้งสี่เป็นคำอธิบายของหนี้ก้อนนี้ คีย์ผิดได้เป็นเรื่องปกติ —
 *              สองสาขาชื่อคล้ายกัน คนละคนมารับ วันที่ลืมแก้ — และแก้แล้วไม่มี
 *              ชิ้นไหนย้ายที่
 *
 *   แก้ไม่ได้  สินค้า · จำนวน
 *              สองอย่างนี้คือของที่ถูกตัดออกจากล็อตไปแล้วตาม FIFO และต้นทุนของ
 *              ใบถูกแช่แข็งไว้จากล็อตพวกนั้น · แก้ตัวเลขเฉย ๆ จะได้ใบที่บอกว่า
 *              เบิกไปห้าชิ้น แต่ในคลังหายไปสอง — จึงแสดงให้อ่านอย่างเดียว พร้อม
 *              บอกทางที่ถูกไว้ข้าง ๆ คือยกเลิกแล้วเบิกใหม่
 *
 * ปุ่มล่างเป็น "ยกเลิก (สาขาคืนของ)" ไม่ใช่ "ลบ" ทุกกรณี — ใบเบิกทุกใบมีของที่
 * ออกจากชั้นไปแล้วผูกอยู่ ลบแถวทิ้งคือทำให้ของหายจากคลังโดยไม่มีบรรทัดไหน
 * อธิบาย ซึ่ง `doctor` จะจับได้ในวันรุ่งขึ้นว่ายอดล็อตไม่ตรงกับสมุด
 */
export default function SettlementEditDialog({
  row,
  branches,
  onClose,
  onSaved,
}: {
  row: SettlementRow;
  branches: BranchRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();

  const [branch, setBranch] = useState(String(row.branchId));
  const [takenBy, setTakenBy] = useState(row.takenBy ?? "");
  const [issued, setIssued] = useState(String(row.issuedAt).slice(0, 10));
  const [note, setNote] = useState(row.note ?? "");

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [why, setWhy] = useState("");

  /* สาขาที่ปิดใช้งานแล้วไม่อยู่ในตัวเลือก — ย้ายหนี้ไปให้มันไม่ได้ (API ปฏิเสธ)
     แต่ถ้าใบนี้อยู่ที่สาขานั้นอยู่แล้ว ต้องเห็นเป็นตัวเลือกของตัวเอง ไม่งั้น
     ช่องจะว่างเปล่าและการกดบันทึกจะย้ายสาขาโดยไม่ได้ตั้งใจ */
  const options = branches.filter((b) => b.isActive || b.id === row.branchId);

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/settlements/${row.id}/update`, {
        branch_id: Number(branch),
        taken_by: takenBy.trim() || null,
        issued_at: issued,
        note: note.trim() || null,
      });
      toast.success({
        text: "แก้รายการค้างรับแล้ว",
        detail: `${row.productName ?? row.sku} · ${count(row.quantity)} ชิ้น`,
      });
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
      const out = await api.post<{ issue: { returned?: { lot: string; quantity: number }[] } }>(
        `/settlements/${row.id}/cancel`,
        { note: why.trim() || null },
      );
      const back = out.issue.returned ?? [];
      const pieces = back.reduce((n, b) => n + b.quantity, 0);

      /* บอกว่าของกลับเข้าล็อตไหนไปกี่ชิ้น ไม่ใช่แค่ "ยกเลิกแล้ว" — คนกดปุ่มนี้
         กำลังทำสองอย่างพร้อมกัน (ปิดหนี้ กับ คืนของ) และอย่างที่สองคือสิ่งที่
         ต้องไปตรงกับของจริงบนชั้นในอีกสิบนาทีข้างหน้า */
      toast.warning({
        text: `ยกเลิกรายการค้างรับแล้ว — คืนของเข้าคลัง ${count(pieces)} ชิ้น`,
        detail: back.length > 0
          ? back.map((b) => `${b.lot} +${b.quantity}`).join(" · ")
          : "ใบนี้ไม่มีของที่ต้องคืนเข้าล็อต",
        link: { href: "/movements", label: "ดูความเคลื่อนไหว" },
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
      eyebrow="แก้ไขรายการค้างรับ"
      title={row.productName ?? row.sku}
      head={
        <>
          {row.sku} · {count(row.quantity)} ชิ้น · ต้นทุน {money(row.costTotal)}
          {row.costUnknownQty > 0 ? ` · ${count(row.costUnknownQty)} ชิ้นไม่รู้ต้นทุน` : ""}
        </>
      }
      onClose={onClose}
    >
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
            <label className="field__label" htmlFor="se-branch">
              สาขา
            </label>
            <Select
              id="se-branch"
              value={branch}
              onChange={setBranch}
              disabled={busy}
              options={options.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="se-taken">
              ผู้รับของ
            </label>
            <input
              id="se-taken"
              className="input"
              value={takenBy}
              onChange={(e) => setTakenBy(e.target.value)}
              placeholder="เว้นว่างได้ — หนี้ผูกกับสาขา ไม่ใช่กับชื่อ"
              disabled={busy}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="se-issued">
            วันที่เบิก
          </label>
          <DateField id="se-issued" value={issued} onChange={setIssued} disabled={busy} clearable={false} />
          <span className="field__help">
            วันที่ของออกจากคลัง — ไม่ใช่วันที่รับเงิน กำไรยังลงตามวันที่เงินเข้าเหมือนเดิม
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="se-note">
            หมายเหตุ
          </label>
          <input
            id="se-note"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น สาขาบางแคมาเบิกเอง"
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

      <div className="drawer__danger">
        {!confirming ? (
          <>
            <p className="drawer__legend">ยกเลิกรายการนี้ — สาขาเอาของมาคืน</p>
            <p className="field__help">
              ของ {count(row.quantity)} ชิ้นจะถูกคืนกลับเข้าล็อตเดิมที่มันถูกตัดออกมา
              และหนี้ก้อนนี้จะไม่กลายเป็นเงิน · ต่างจากตัดหนี้สูญ ตรงที่ไม่มีใครเบี้ยว —
              รายงานแยกสองอย่างนี้ออกจากกัน
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
              <label className="field__label" htmlFor="se-why">
                เหตุผล · ต้องกรอก
              </label>
              <input
                id="se-why"
                className="input"
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder="เช่น สาขาเอาของมาคืนครบ · คีย์จำนวนผิด"
                disabled={busy}
                autoComplete="off"
                autoFocus
              />
            </div>
            <p className="field__help">
              เบิกเมื่อ {date(row.issuedAt)} · {row.branchName ?? "—"} — ของจะกลับเข้าคลังทันทีที่กด
            </p>
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
