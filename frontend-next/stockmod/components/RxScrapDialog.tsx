"use client";

import { useState } from "react";
import TaskDialog from "./TaskDialog";
import { useToast } from "./Toaster";
import { api, ApiError, type RxOrderRow } from "@/stockmod/lib/api";
import { shortName } from "@/stockmod/lib/format";

type Out = { replacement: { id: number; referenceDoc: string } | null };

/**
 * เลนส์สั่งตัดเจียร์เสีย และการเปิดใบใหม่แทน — ร้านขอไว้ 30 ก.ย. 2026
 *
 * เลนส์สั่งตัดไม่มีล็อต หน้าตัดของเสียจึงตัดมันไม่ได้ · กดที่นี่แล้วใบเดิมปิดเป็นของเสีย
 * (ต้นทุนของเลนส์ไปนับเป็นของเสียในแดชบอร์ด พร้อมชื่อคนทำ) และหน้าร้านเห็นที่การ์ดเลนส์ของเคส
 *
 * จะเปิดใบสั่งใหม่แทนไหม คนกดเป็นคนเลือก — สองปุ่ม ไม่ใช่ช่องติ๊กที่ตั้งค่าไว้ให้: ไม่ใช่ทุกครั้ง
 * ที่จะสั่งรุ่นเดิมค่าเดิม และใบสั่งที่เปิดเองโดยไม่มีใครตั้งใจคือเลนส์ที่ร้านต้องจ่ายเงิน ·
 * ไม่เปิดตอนนี้ กดทีหลังได้จากแถวของใบที่เสีย (`mode="reorder"`)
 *
 * ใบใหม่ได้รุ่นเลนส์ ค่าสายตา และราคาขายของใบเดิม ต้นทุนรอบัญชีลงใหม่ · เลนส์ที่ผู้ขายเคลมให้
 * เขียนไว้ในหมายเหตุของใบใหม่ แล้วลงต้นทุนตามจริง
 */
export default function RxScrapDialog({
  row,
  mode,
  onClose,
  onSaved,
}: {
  row: RxOrderRow;
  /** `scrap` = เลนส์เพิ่งเสีย · `reorder` = ใบนี้เสียไปแล้ว มาเปิดใบใหม่แทนทีหลัง */
  mode: "scrap" | "reorder";
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [by, setBy] = useState("");
  const [why, setWhy] = useState("");
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const doc = row.referenceDoc ?? row.sku;
  const where = row.caseCode ? `เคส ${row.caseCode}` : null;

  async function send(reorder: boolean) {
    if (mode === "scrap" && by.trim() === "") {
      setProblem("กรอกชื่อคนที่ทำของเสียก่อน");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const out =
        mode === "scrap"
          ? await api.post<Out>(`/rx/${row.id}/scrap`, {
              scrap_by: by.trim(),
              note: why.trim() || null,
              reorder,
              reorder_note: reorder ? newNote.trim() || null : null,
            })
          : await api.post<Out>(`/rx/${row.id}/reorder`, { note: newNote.trim() || null });

      const next = out.replacement?.referenceDoc ?? null;
      if (mode === "reorder") {
        toast.success({
          text: `เปิดใบสั่ง ${next ?? ""} แทน ${doc} แล้ว`,
          detail: [where, "รอฝ่ายบัญชีลงต้นทุน"].filter(Boolean).join(" · "),
        });
      } else {
        toast.warning({
          text: `บันทึกเลนส์ ${doc} เจียร์เสียแล้ว`,
          detail: [next ? `เปิดใบใหม่แทนเป็น ${next}` : "ยังไม่ได้เปิดใบใหม่แทน", where]
            .filter(Boolean)
            .join(" · "),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  }

  const noteField = (
    <div className="field">
      <label className="field__label" htmlFor="rxs-newnote">
        หมายเหตุของใบใหม่
      </label>
      <input
        id="rxs-newnote"
        className="input"
        value={newNote}
        onChange={(e) => setNewNote(e.target.value)}
        placeholder="เช่น เคลมจากซัพพลาย"
        maxLength={400}
        disabled={busy}
        autoComplete="off"
        autoFocus={mode === "reorder"}
      />
      <span className="field__help">
        ใบใหม่ใช้รุ่นเลนส์ ค่าสายตา และราคาขายของใบเดิม · ต้นทุนรอฝ่ายบัญชีลงใหม่
      </span>
    </div>
  );

  return (
    <TaskDialog
      eyebrow={mode === "scrap" ? "เลนส์เจียร์เสีย" : "เปิดใบใหม่แทนใบที่เจียร์เสีย"}
      title={doc}
      head={[shortName(row.name), where].filter(Boolean).join(" · ")}
      onClose={() => (busy ? undefined : onClose())}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          /* Enter ไม่ส่งฟอร์มตอนเจียร์เสีย — มีสองปุ่มที่ทำคนละอย่าง ต้องกดเลือกเอง */
          if (mode === "reorder") void send(true);
        }}
        noValidate
      >
        {mode === "scrap" ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor="rxs-by">
                ใครทำเสีย · ต้องกรอก
              </label>
              <input
                id="rxs-by"
                className="input"
                value={by}
                onChange={(e) => setBy(e.target.value)}
                placeholder="ชื่อคนที่เจียร์"
                maxLength={120}
                disabled={busy}
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="rxs-why">
                สาเหตุที่เสีย
              </label>
              <input
                id="rxs-why"
                className="input"
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder="เช่น เลนส์หลวม · เลนส์แตก"
                maxLength={400}
                disabled={busy}
                autoComplete="off"
              />
            </div>
          </>
        ) : null}

        {noteField}

        {problem ? (
          <div className="notice notice--error" role="alert">
            {problem}
          </div>
        ) : null}

        {mode === "scrap" ? (
          <>
            <p className="field__help">
              ใบ {doc} จะปิดเป็นของเสีย ต้นทุนของเลนส์นับเป็นของเสีย และหน้าร้านเห็นที่เคส — ย้อนกลับไม่ได้
            </p>
            <div className="chips">
              <button type="button" className="btn btn--primary" onClick={() => void send(true)} disabled={busy}>
                {busy ? "กำลังบันทึก…" : "เจียร์เสีย + เปิดใบใหม่แทน"}
              </button>
              <button type="button" className="btn btn--danger" onClick={() => void send(false)} disabled={busy}>
                เจียร์เสีย ยังไม่สั่งใหม่
              </button>
              <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
                ยกเลิก
              </button>
            </div>
          </>
        ) : (
          <div className="chips">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "กำลังบันทึก…" : "เปิดใบใหม่แทน"}
            </button>
            <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
              ยกเลิก
            </button>
          </div>
        )}
      </form>
    </TaskDialog>
  );
}
