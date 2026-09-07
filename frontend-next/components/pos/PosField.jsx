'use client';
/**
 * ช่องกรอกหน้าตาแบบ POS เดิม — ป้ายอยู่บน ช่องพื้นเทามีไอคอนอยู่ข้างใน
 *
 * ไอคอนไม่ได้ใส่เพื่อความสวย: หน้านี้มีช่องกรอกสิบกว่าช่องเรียงกันเป็นตาราง
 * พนักงานกวาดตาหา "ช่องรับเงิน" ด้วยรูปเร็วกว่าอ่านป้ายทีละบรรทัด และนี่คือ
 * วิธีที่ระบบเดิมทำ ซึ่งคนที่ร้านชินมือแล้ว
 *
 * ใช้ของ POS เท่านั้น ไม่ใช่ `Field` กลางของแอป เพราะหน้าตาคนละชุดกันโดยตั้งใจ
 */
export function PosField({ label, icon, children, className = '' }) {
  return (
    <div className={className}>
      {label && <span className="pos-lab">{label}</span>}
      <div className="pos-f">
        {icon && <span className="pos-ico" aria-hidden="true">{icon}</span>}
        {children}
      </div>
    </div>
  );
}

/** ช่องที่ระบบคำนวณให้ ไม่ใช่ช่องกรอก — ยอดรวม (ครีม) และเงินทอน (เขียว) */
export function PosOut({ label, icon, tone, children }) {
  return (
    <div>
      {label && <span className="pos-lab">{label}</span>}
      <div className="pos-f">
        {icon && <span className="pos-ico" aria-hidden="true">{icon}</span>}
        <div className={`pos-out ${tone}`}>{children}</div>
      </div>
    </div>
  );
}
