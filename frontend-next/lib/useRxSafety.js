'use client';
/**
 * เกณฑ์แจ้งเตือนล่าสุด + ประวัติ Clinical Review ของเคส — สำหรับหน้าวัดสายตา
 *
 * โหลดไม่สำเร็จ (เช่น API เก่าบนเครื่องที่ยังไม่มีเส้นนี้) ใช้เกณฑ์เริ่มต้นแทน — การแจ้งเตือน
 * ยังทำงาน ไม่ทำให้หน้าวัดสายตาพัง · spec ข้อ 7.1, 7.4
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from './apiClient.js';
import { DEFAULT_RULES } from './rxSafety.js';

export function useRxSafety(caseId) {
  const [rules, setRules] = useState({ version: null, rules: DEFAULT_RULES });
  const [reviews, setReviews] = useState([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get('/api/settings/rx-alert-rules')
      .then((r) => { if (alive && r?.rules) setRules({ version: r.version, rules: r.rules }); })
      .catch(() => {});
    if (caseId) {
      api.get(`/api/cases/${caseId}/rx-reviews`)
        .then((r) => { if (alive && Array.isArray(r)) setReviews(r); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [caseId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...rules, reviews, reload };
}
