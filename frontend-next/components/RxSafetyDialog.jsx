'use client';
/**
 * Prescription Safety Alert — หน้าต่างตอนกด "ยืนยันผลวัดสายตา"
 *
 * - มีข้อมูลผิด/ขาด → ปุ่มยืนยันกดไม่ได้ ต้องกลับไปแก้
 * - มี CRITICAL ที่ยังไม่เคยทบทวน → ต้องพิมพ์เหตุผลก่อน
 * - มีแค่ WARNING → ยืนยันต่อได้เลย
 * คลิกรายการ = ปิดหน้าต่างแล้วไปที่ช่องนั้น · spec ข้อ 8.3
 *
 * @param {{result, alerts, reviewed:boolean, onDone:(v:{ok:boolean, reason?:string, pick?:object})=>void}} props
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { AlertList, CountTags, DeltaTable } from './RxSafetyParts.jsx';

export function RxSafetyDialog({ result, alerts, reviewed, onDone }) {
  const [reason, setReason] = useState('');
  const counts = { info: 0, warning: 0, critical: 0, error: 0 };
  for (const a of alerts) counts[a.level] += 1;
  const blocked = alerts.some((a) => a.blocking);
  const needReason = counts.critical > 0 && !reviewed;
  const canConfirm = !blocked && (!needReason || reason.trim() !== '');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onDone({ ok: false }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDone]);

  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onDone({ ok: false }); }}>
      <div className="modal rxs-dialog" role="dialog" aria-modal="true" aria-labelledby="rxs-dialog-title">
        <h3 id="rxs-dialog-title"><Icon name="warning" /> Prescription Safety Alert</h3>
        <div className="m-body">
          <CountTags counts={counts} />
          <AlertList alerts={alerts} onPick={(a) => onDone({ ok: false, pick: a })} />
          {result.hasOld && (counts.warning > 0 || counts.critical > 0) && (
            <div className="rxs-eyes">
              <DeltaTable eye="r" cmp={result.compare.r} />
              <DeltaTable eye="l" cmp={result.compare.l} />
            </div>
          )}
          {blocked && (
            <p className="rxs-block-note"><Icon name="xCircle" /> ยังยืนยันไม่ได้ — กรุณาแก้ข้อมูลที่ขาดหรือผิดก่อน</p>
          )}
          {!blocked && needReason && (
            <label className="rxs-reason">
              <span>เหตุผลที่ยืนยันค่านี้หลังตรวจสอบ *</span>
              <textarea
                rows={3}
                value={reason}
                placeholder="เช่น ตรวจ VA ซ้ำแล้ว ลูกค้าเห็นชัดและใส่สบาย"
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
              <small className="muted">ระบบจะบันทึกชื่อผู้ยืนยัน เวลา และเกณฑ์เวอร์ชันที่ใช้</small>
            </label>
          )}
          {!blocked && counts.critical > 0 && reviewed && (
            <p className="rxs-reviewed"><Icon name="checkCircle" /> ค่าชุดนี้ทบทวนแล้ว — ยืนยันต่อได้</p>
          )}
          <p className="rxs-disclaimer">ระบบช่วยเตือนเพื่อให้ตรวจสอบเท่านั้น ไม่ได้วินิจฉัยว่าค่าสายตาผิด — การตัดสินใจเป็นของผู้ตรวจวัด</p>
        </div>
        <div className="m-foot">
          <button type="button" className="btn btn-light" onClick={() => onDone({ ok: false })}>ตรวจสอบอีกครั้ง</button>
          <button
            type="button"
            className={`btn ${counts.critical > 0 ? 'btn-danger' : 'btn-accent'}`}
            disabled={!canConfirm}
            onClick={() => onDone({ ok: true, reason: reason.trim() })}
          >
            ยืนยันหลังตรวจสอบ
          </button>
        </div>
      </div>
    </div>
  );
}
