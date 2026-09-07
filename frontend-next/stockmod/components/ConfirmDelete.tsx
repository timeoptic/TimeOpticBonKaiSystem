"use client";

import TaskDialog from "./TaskDialog";

/**
 * ถามก่อนลบ — ของที่ลบแล้วไม่มีปุ่มเรียกกลับ
 *
 * ปุ่มถังขยะในตารางอยู่ติดกับปุ่มอื่นเสมอ และคนกดมักถือของอยู่อีกมือ · การกดพลาด
 * หนึ่งครั้งกับการยืนยันหนึ่งครั้ง ต่างกันแค่จังหวะเดียว แต่กันเรื่องที่แก้คืนไม่ได้
 *
 * แยกออกมาเป็นตัวเดียวเพราะมีสองที่ที่ลบล็อตได้ (ในลิ้นชักสินค้า และในรายการล็อต
 * ใต้สินค้า) และกล่องยืนยันสองใบที่ถามคนละแบบ คือกล่องที่คนอ่านใบหนึ่งแล้วเดา
 * อีกใบ · ไม่ผูกกับ "ล็อต" ในตัวมันเอง — ตัวเรียกเป็นคนบอกว่ากำลังลบอะไร
 */
export default function ConfirmDelete({
  title,
  eyebrow = "ยืนยันการลบ",
  what,
  detail,
  busy,
  problem,
  onConfirm,
  onClose,
}: {
  /** ชื่อของสิ่งที่กำลังจะถูกลบ ขึ้นเป็นหัวกล่อง */
  title: string;
  eyebrow?: string;
  /** ประโยคเดียวที่บอกว่าการกดยืนยันจะทำอะไร */
  what: string;
  /** รายละเอียดที่ช่วยยืนยันว่าเป็นตัวที่ตั้งใจจะลบจริง เช่น วันที่รับเข้าและจำนวน */
  detail?: string;
  busy: boolean;
  problem: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <TaskDialog eyebrow={eyebrow} title={title} onClose={onClose}>
      <div className="confirm-delete">
        <p>{what}</p>
        {detail ? <p className="field__help">{detail}</p> : null}
        <p className="field__help">ลบแล้วเรียกคืนไม่ได้</p>

        {problem ? (
          <div className="notice notice--error" role="alert">
            {problem}
          </div>
        ) : null}

        <div className="chips">
          <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          {/* ปุ่มยืนยันเป็นปุ่มอันตราย ไม่ใช่ปุ่มหลักสีปกติ — สีของปุ่มคือสิ่งที่คน
              อ่านก่อนข้อความ และกล่องนี้มีอยู่เพื่อให้จังหวะนั้นสะดุด */}
          <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={busy}>
            {busy ? "กำลังลบ…" : "ลบ"}
          </button>
        </div>
      </div>
    </TaskDialog>
  );
}
