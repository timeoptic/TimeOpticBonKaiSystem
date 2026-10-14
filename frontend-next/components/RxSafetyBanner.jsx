'use client';
/**
 * Prescription Safety Alert — กล่องใต้ตาราง Final ในหน้าวัดสายตา
 *
 * ขณะกรอก: แจ้งข้อมูลที่ยังขาด/ผิด (เฉพาะข้อที่ระบบเดิมยังไม่ได้แจ้ง) + ตารางผลต่างจากแว่นเดิม
 * หลังยืนยัน: บอกว่าค่าชุดนี้ทบทวนแล้วหรือยัง + ประวัติการทบทวนของเคส
 * ไม่เปิด popup ไม่บล็อกอะไร — ด่านจริงอยู่ที่ปุ่มยืนยัน (RxSafetyDialog)
 * spec ข้อ 8.2
 */
import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { AlertList, CountTags, DeltaTable } from './RxSafetyParts.jsx';
import { fmtDateTime } from '../lib/format.js';

/*
 * ข้อที่หน้าวัดสายตาเดิมแจ้งและบล็อกเองอยู่แล้ว (ขอบแดง + บรรทัด "ยังยืนยันไม่ได้" + ด่านใน
 * beforeComplete) — ไม่พูดซ้ำสองที่ · ที่เหลือคือของใหม่: ADD ของเลนส์หลายระยะ, AXIS 0 เมื่อมี CYL
 * และการเทียบกับแว่นเดิมทั้งหมด
 */
const ALREADY_HANDLED = new Set(['required:sphere', 'required:va', 'required:test_for',
  'cyl_without_axis:axis', 'axis_without_cyl:cylinder', 'invalid:sphere', 'invalid:cylinder',
  'invalid:axis', 'invalid:add']);
export const newAlerts = (alerts) => alerts.filter((a) => !ALREADY_HANDLED.has(`${a.rule}:${a.field}`));

export function RxSafetyBanner({ result, confirmed, review, reviews, onPick, onRecordReview }) {
  const [showHistory, setShowHistory] = useState(false);
  const alerts = newAlerts(result.alerts);
  const counts = { info: 0, warning: 0, critical: 0, error: 0 };
  for (const a of alerts) counts[a.level] += 1;
  const needsReview = confirmed && result.counts.critical > 0 && !review;

  return (
    <div className="rxs-banner" data-testid="rx-safety-banner">
      <div className="rxs-banner-head">
        <span className="rxs-title"><Icon name="eye" /> Prescription Safety Alert</span>
        <CountTags counts={counts} />
        {!alerts.length && result.hasOld && <span className="rxs-ok-line"><Icon name="checkCircle" /> ค่าไม่เปลี่ยนถึงเกณฑ์เตือน</span>}
      </div>

      <AlertList alerts={alerts} onPick={confirmed ? undefined : onPick} />

      {result.hasOld ? (
        <div className="rxs-eyes">
          <DeltaTable eye="r" cmp={result.compare.r} />
          <DeltaTable eye="l" cmp={result.compare.l} />
        </div>
      ) : (
        <p className="rxs-note">ไม่มีค่าแว่นเดิม — เปรียบเทียบไม่ได้ (ระบบไม่ใช้ 0 แทน)</p>
      )}

      {review && (
        <p className="rxs-reviewed">
          <Icon name="checkCircle" />
          {` ทบทวนแล้วโดย ${review.reviewed_by_name || '—'} · ${fmtDateTime(review.reviewed_at)} · เหตุผล: ${review.reason}`}
        </p>
      )}
      {needsReview && (
        <div className="rxs-missing-review">
          <span><Icon name="flame" /> ค่าที่ยืนยันแล้วมีการเปลี่ยนถึงเกณฑ์ทบทวน แต่ยังไม่ได้บันทึกการทบทวน</span>
          {onRecordReview && (
            <button type="button" className="btn btn-light btn-sm" onClick={onRecordReview}>บันทึกการทบทวน</button>
          )}
        </div>
      )}

      {reviews.length > 0 && (
        <div className="rxs-history">
          <button type="button" className="rxs-link" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'ซ่อน' : 'ดู'}ประวัติการทบทวน ({reviews.length})
          </button>
          {showHistory && (
            <ul>
              {reviews.map((r) => (
                <li key={r.id}>
                  {`${fmtDateTime(r.reviewed_at)} · ${r.reviewed_by_name || '—'} · เกณฑ์ v${r.rule_version} · ${r.reason}`}
                  {r.fingerprint === result.fingerprint ? ' (ค่าปัจจุบัน)' : ' (ค่าก่อนแก้ไข)'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
