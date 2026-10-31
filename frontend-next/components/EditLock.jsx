'use client';
/**
 * กติกาเดียวทั้งระบบ (ร้านขอ 31 ต.ค. 2026): ข้อมูลที่บันทึกแล้วดูได้อย่างเดียว ต้องกด
 * "เปิดการแก้ไข" ก่อนถึงแก้ได้ · บันทึกหรือยกเลิกแล้วล็อกกลับ
 *
 * ในขั้นตอนของเคส ขั้นที่ยืนยันแล้วปลดจากแถบนี้ไม่ได้ ต้องกดปุ่มท้าย ProcessShell ซึ่งเปิด
 * ขั้นกลับก่อน เพราะการแก้หลังยืนยันมีผลต่อขั้นถัดไป
 *
 * กันที่หน้าจอเท่านั้น ไม่ใช่สิทธิ์ — API ยังรับคำสั่งแก้ตามเดิม
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { useProcessActions } from './ProcessShell.jsx';

export const UNLOCK_LABEL = 'เปิดการแก้ไข';

export function useEditLock(hasSaved = true) {
  const shell = useProcessActions();
  const confirmed = !!shell?.confirmed;
  const reopened = !!shell?.reopened;
  const [open, setOpen] = useState(false);
  /* key ของฟอร์ม เปลี่ยนตอนยกเลิก — ฟอร์มสร้างใหม่จากค่าที่บันทึกไว้ สิ่งที่พิมพ์ค้างจึงหายไป */
  const [formKey, setFormKey] = useState(0);

  useEffect(() => { setOpen(reopened); }, [reopened]);

  return {
    saved: !!hasSaved,
    locked: confirmed || (!!hasSaved && !open),
    canUnlock: !confirmed,
    formKey,
    unlock: () => setOpen(true),
    relock: () => setOpen(false),
    cancel: () => { setOpen(false); setFormKey((k) => k + 1); },
  };
}

/** แถบบอกสถานะ พร้อมปุ่มเปิด/ยกเลิก — รายการที่ยังไม่เคยบันทึกไม่ต้องมีแถบนี้ */
export function EditLockBar({ lock, onCancel, what = 'ข้อมูลนี้' }) {
  if (!lock.saved) return null;
  const cancel = () => { lock.cancel(); onCancel?.(); };
  return (
    <div
      className="row"
      style={{
        justifyContent: 'space-between', gap: 10, padding: '10px 14px', marginBottom: 12,
        borderRadius: 12, border: '1px solid var(--line)', background: 'var(--panel)',
      }}
    >
      <b data-testid="edit-lock-state">
        <Icon name={lock.locked ? 'lock' : 'pencil'} />{' '}
        {!lock.locked
          ? `กำลังแก้ไข ${what} — กดบันทึกเพื่อเก็บ`
          : lock.canUnlock
            ? `${what} ล็อกอยู่ — ดูได้อย่างเดียว`
            : `ขั้นนี้ยืนยันแล้ว — กด “${UNLOCK_LABEL}” ด้านล่างถ้าต้องการแก้`}
      </b>
      {lock.locked
        ? (lock.canUnlock
          ? <button type="button" className="btn btn-sm" onClick={lock.unlock}>{UNLOCK_LABEL}</button>
          : null)
        : <button type="button" className="btn btn-sm btn-light" onClick={cancel}>ยกเลิกการแก้ไข</button>}
    </div>
  );
}

/**
 * ปิดทุกช่องข้างในครั้งเดียว · display:contents ไม่ให้กล่องนี้เปลี่ยนเลย์เอาต์
 * pointerEvents กันแถวในรายการที่กดได้แต่ไม่ใช่ปุ่ม ซึ่ง disabled ไปไม่ถึง
 */
export function LockFieldset({ locked, children }) {
  return (
    <fieldset
      disabled={locked}
      className={locked ? 'edit-locked' : undefined}
      style={{ display: 'contents', pointerEvents: locked ? 'none' : undefined }}
    >
      {locked ? <style>{'.edit-locked input,.edit-locked select,.edit-locked textarea{opacity:.7}'}</style> : null}
      {children}
    </fieldset>
  );
}

/**
 * ปุ่มที่กดแล้วเขียนทันที (สถานะ สวิตช์ แนบไฟล์) — ไม่มีฟอร์มให้ล็อก จึงซ่อนไว้หลังปุ่มเปิดแทน
 * children เป็นฟังก์ชันรับ close ไว้เรียกหลังทำเสร็จ
 */
export function EditGate({ children, small = true, what = "" }) {
  const [open, setOpen] = useState(false);
  const size = small ? ' btn-sm' : '';
  if (!open) {
    return (
      <button type="button" className={`btn btn-light${size}`} onClick={() => setOpen(true)}>
        <Icon name="lock" /> {UNLOCK_LABEL}{what}
      </button>
    );
  }
  const close = () => setOpen(false);
  return (
    <>
      {typeof children === 'function' ? children(close) : children}
      <button type="button" className={`btn btn-light${size}`} onClick={close}>ยกเลิกการแก้ไข</button>
    </>
  );
}
