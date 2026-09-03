"use client";

import { useState } from "react";
import { can, useActor } from "./AppShell";
import TaskDialog from "./TaskDialog";
import { IconTrash } from "./Icon";
import { useToast } from "./Toaster";
import { api, ApiError, type RxOrderRow } from "@/stockmod/lib/api";
import { money } from "@/stockmod/lib/format";

/**
 * แก้ใบสั่งตัดที่เปิดไปแล้ว และเอามันออกเมื่อเปิดผิดใบ
 *
 * ใบสั่งตัดถูกอ่านออกมาจากใบสั่งกระดาษด้วยตาคน แล้วพิมพ์ซ้ำอีกครั้ง จุดที่ผิดจึง
 * ไม่ใช่ข้อยกเว้น — ค่าสายตาสลับข้าง เลขใบพิมพ์ตก คนละคนไข้ · จนถึงตอนนี้ใบที่
 * เปิดผิดไม่มีทางออกเลย มันค้างอยู่ในสมุดตลอดไปและฝ่ายบัญชีต้องจำเองว่าใบไหน
 * ไม่นับ
 *
 * ป็อปอัพ ไม่ใช่แถวที่กางออก: หน้านี้เป็นสมุด คนเปิดมาเพื่อกวาดตาหาใบของลูกค้า
 * คนหนึ่ง แถวที่กางออกจะดันใบที่เหลือหายจากจอพอดีตอนที่ยังต้องเทียบกับใบข้าง ๆ
 *
 * สองอย่างที่จงใจไม่อยู่ในฟอร์มนี้:
 *   รุ่นเลนส์  เปลี่ยนรุ่นคือคนละใบ ไม่ใช่ใบเดิมที่พิมพ์ผิด — ให้ลบแล้วเปิดใหม่
 *   ต้นทุน    ลงได้ครั้งเดียวและเป็นของฝ่ายบัญชี ช่องของมันอยู่ในตารางที่เดิม
 */
export default function RxEditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: RxOrderRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const actor = useActor();
  const toast = useToast();

  const [doc, setDoc] = useState(row.referenceDoc ?? "");
  const [eye, setEye] = useState<"" | "left" | "right">(row.eyeSide ?? "");
  const [sph, setSph] = useState(row.sph === null ? "" : String(row.sph));
  const [cyl, setCyl] = useState(row.cyl === null ? "" : String(row.cyl));
  const [axis, setAxis] = useState(row.axis === null ? "" : String(row.axis));
  const [add, setAdd] = useState(row.add ?? "");
  const [price, setPrice] = useState(row.salePrice === null ? "" : String(row.salePrice));
  const [note, setNote] = useState(row.note ?? "");

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* ขั้นยืนยันของการลบ อยู่ในหน้าต่างเดียวกัน ไม่ใช่ป็อปอัพซ้อนป็อปอัพ — กล่อง
     ที่เด้งทับกล่องบนแท็บเล็ตคือกล่องที่กดผ่านโดยไม่อ่าน */
  const [confirming, setConfirming] = useState(false);
  const [why, setWhy] = useState("");

  /**
   * ใบนี้มีตัวเลขเงินผูกอยู่แล้วหรือยัง — ตัวเดียวที่ตัดสินว่าปุ่มล่างคือ "ลบ"
   * หรือ "ยกเลิก" · กติกาเดียวกับที่ `Rx::remove` ใช้ตัดสินฝั่งเซิร์ฟเวอร์
   * ตรงนี้มีไว้ให้คนอ่านออกก่อนกด ไม่ใช่ให้ระบบตัดสิน
   */
  const bound = !row.awaitingCost || row.salePrice !== null;
  const mayRemove = bound ? can.enterCost(actor) : true;
  const label = bound ? "ยกเลิกใบสั่งนี้" : "ลบใบสั่งนี้";

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/rx/${row.id}/update`, {
        reference_doc: doc.trim(),
        eye_side: eye,
        sph: sph.trim(),
        cyl: cyl.trim(),
        axis: axis.trim(),
        add: add.trim(),
        sale_price: price.trim(),
        note: note.trim() || null,
      });
      toast.success({
        text: `แก้ใบสั่งตัด ${doc.trim() || row.sku} แล้ว`,
        detail: row.name,
      });
      onSaved();
      onClose();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setProblem(null);
    try {
      const out = await api.post<{ mode: "deleted" | "cancelled" }>(`/rx/${row.id}/delete`, {
        note: why.trim() || null,
      });
      /* ลบกับยกเลิกไม่ใช่เรื่องเดียวกัน และคนกดควรรู้ว่าเพิ่งเกิดอันไหน —
         ใบที่ "ยกเลิก" ยังอยู่ในสมุดและยังตามอ่านได้ ซึ่งเป็นสิ่งที่คนกดปุ่มชื่อ
         "ยกเลิก" ไม่ได้เดาไว้เสมอไป */
      if (out.mode === "deleted") {
        toast.success({ text: `ลบใบสั่งตัด ${row.referenceDoc ?? row.sku} แล้ว`, detail: row.name });
      } else {
        toast.warning({
          text: `ยกเลิกใบสั่งตัด ${row.referenceDoc ?? row.sku} แล้ว`,
          detail: "ใบนี้มีตัวเลขเงินลงไปแล้ว จึงไม่ได้ถูกลบ — ยังอ่านย้อนหลังได้ที่หน้าความเคลื่อนไหว",
          link: { href: "/movements", label: "ดูความเคลื่อนไหว" },
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setProblem(ApiError.is(e) ? e.message : "เอาใบสั่งออกไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <TaskDialog
      eyebrow="แก้ไขใบสั่งตัด RX"
      title={row.referenceDoc ?? row.sku}
      head={
        <>
          {row.name}
          {row.salePrice !== null ? ` · ขาย ${money(row.salePrice)}` : ""}
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
      <div className="field">
        <label className="field__label" htmlFor="rxe-doc">
          เลขใบสั่ง
        </label>
        <input
          id="rxe-doc"
          className="input"
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />
      </div>

      <div className="field">
        <span className="field__label">ข้างตา</span>
        {/* ปุ่มสามปุ่ม ไม่ใช่ dropdown — มีสามคำตอบและทั้งสามต้องเห็นพร้อมกัน
            คนที่มาแก้ตรงนี้ส่วนใหญ่มาเพราะสลับข้าง การเห็นข้างที่ถูกอยู่ข้าง ๆ
            ข้างที่ผิดคือสิ่งที่ทำให้จับผิดได้ในครั้งเดียว */}
        <div className="chips chips--bar" role="group" aria-label="ข้างตา">
          {([
            ["", "ไม่ระบุ"],
            ["left", "ซ้าย (L)"],
            ["right", "ขวา (R)"],
          ] as const).map(([v, text]) => (
            <button
              key={v || "none"}
              type="button"
              className="chip"
              aria-current={eye === v ? "true" : undefined}
              onClick={() => setEye(v)}
              disabled={busy}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="formgrid">
        <div className="field">
          <label className="field__label" htmlFor="rxe-sph">
            SPH
          </label>
          <input
            id="rxe-sph"
            className="input"
            inputMode="decimal"
            value={sph}
            onChange={(e) => setSph(e.target.value)}
            placeholder="-2.25"
            disabled={busy}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="rxe-cyl">
            CYL
          </label>
          <input
            id="rxe-cyl"
            className="input"
            inputMode="decimal"
            value={cyl}
            onChange={(e) => setCyl(e.target.value)}
            placeholder="-0.50"
            disabled={busy}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="rxe-axis">
            AXIS
          </label>
          <input
            id="rxe-axis"
            className="input"
            inputMode="numeric"
            value={axis}
            onChange={(e) => setAxis(e.target.value)}
            placeholder="0–180"
            disabled={busy}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="rxe-add">
            ADD
          </label>
          <input
            id="rxe-add"
            className="input"
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            placeholder="+2.00"
            disabled={busy}
            autoComplete="off"
          />
        </div>
      </div>
      <span className="field__help">
        เว้นว่างได้ทุกช่อง — ใบที่เปิดไว้ก่อนใบสั่งกระดาษมาถึงเป็นเรื่องปกติ
        ช่องว่างบอกว่ายังไม่ได้วัด ซึ่งตรงกว่าเลขศูนย์
      </span>

      <div className="field">
        <label className="field__label" htmlFor="rxe-price">
          ราคาขาย (฿)
        </label>
        <input
          id="rxe-price"
          className="input"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="เว้นว่าง = ยังไม่ตั้งราคา"
          disabled={busy}
          autoComplete="off"
        />
        <span className="field__help">
          แก้ได้ตลอด และทุกครั้งที่แก้จะมีบรรทัดในสมุดบอกว่าใครแก้ จากเท่าไรเป็นเท่าไร
        </span>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="rxe-note">
          หมายเหตุ
        </label>
        <input
          id="rxe-note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น ชื่อลูกค้า หรือเลขงานของร้าน"
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

      {/* แถบล่าง คนละก้อนกับฟอร์ม — ปุ่มที่เอาของออกไม่ควรอยู่ติดปุ่มบันทึก
          จนกดพลาดได้ และต้องอ่านออกว่ามันทำอะไรก่อนจะแตะ */}
      {mayRemove ? (
        <div className="drawer__danger">
          {!confirming ? (
            <>
              <p className="drawer__legend">{label}</p>
              <p className="field__help">
                {bound
                  ? "ใบนี้มีตัวเลขเงินลงไปแล้ว จึงลบทิ้งไม่ได้ — จะถูกทำเครื่องหมายว่ายกเลิก หายจากสมุดใบสั่ง แต่ยังอ่านย้อนหลังได้ที่หน้าความเคลื่อนไหว"
                  : "ใบนี้ยังไม่มีต้นทุนและยังไม่ตั้งราคา ไม่มีตัวเลขไหนที่ใครอ้างอิงไปแล้ว จึงลบทิ้งได้จริง"}
              </p>
              <button
                type="button"
                className="btn btn--danger btn--small"
                onClick={() => setConfirming(true)}
                disabled={busy}
              >
                <IconTrash /> {label}
              </button>
            </>
          ) : (
            <>
              <p className="drawer__legend">{label} — ยืนยัน</p>
              {bound ? (
                <div className="field">
                  <label className="field__label" htmlFor="rxe-why">
                    เหตุผลที่ยกเลิก · ต้องกรอก
                  </label>
                  <input
                    id="rxe-why"
                    className="input"
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    placeholder="เช่น ลูกค้ายกเลิกงาน · เปิดซ้ำสองใบ"
                    disabled={busy}
                    autoComplete="off"
                    autoFocus
                  />
                </div>
              ) : (
                <p className="field__help">ใบสั่ง {row.referenceDoc ?? row.sku} จะหายไปถาวร</p>
              )}
              <div className="chips">
                <button
                  type="button"
                  className="btn btn--danger btn--small"
                  onClick={remove}
                  disabled={busy || (bound && why.trim() === "")}
                >
                  {busy ? "กำลังทำ…" : bound ? "ยืนยันยกเลิก" : "ยืนยันลบ"}
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
      ) : (
        <p className="field__help">
          ใบนี้ลงตัวเลขเงินไปแล้ว การยกเลิกเป็นสิทธิ์ของฝ่ายบัญชีขึ้นไป
        </p>
      )}
    </TaskDialog>
  );
}
