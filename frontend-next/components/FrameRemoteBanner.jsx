'use client';
/**
 * แถบเตือนกรอบจากคลังของอีกสาขา (api/services/FrameRemote.php)
 *
 * ขึ้นเฉพาะสาขาที่ตั้ง FRAME_STOCK_* ไว้ และมีรายการค้าง:
 *  - เหลือง = ยังส่งการตัด/คืนกรอบไปคลังต้นทางไม่ได้ ระบบลองส่งใหม่เอง (ทุกครั้งที่ถาม /status)
 *  - แดง    = คลังต้นทางปฏิเสธ (เช่นของหมดเพราะอีกสาขาขายชิ้นสุดท้ายไปก่อน) ต้องมีคนไปปรับยอดเอง
 *
 * การถามทุก 60 วินาทีนี้คือตัวส่งใหม่อัตโนมัติด้วย — Hostinger ไม่มีโปรเซสค้างให้รอคิว
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/apiClient.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from './Toast.jsx';

const STATE = {
  pending: 'รอส่ง',
  failed: 'คลังต้นทางปฏิเสธ',
};

export function FrameRemoteBanner() {
  const { actor } = useAuth();
  const { ok, err } = useToast();
  const [st, setSt] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSt(await api.get('/api/frame-remote/status'));
    } catch {
      /* ถามไม่ได้ก็ไม่ต้องเตือนซ้อน — หน้าอื่นจะฟ้องเรื่องเซิร์ฟเวอร์เอง */
    }
  }, []);

  useEffect(() => {
    if (!actor) return undefined;
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [actor, load]);

  if (!actor || !st?.enabled || (!st.pending && !st.failed)) return null;

  const retry = async () => {
    setBusy(true);
    try {
      const s = await api.post('/api/frame-remote/retry', {});
      setSt(s);
      if (!s.pending && !s.failed) ok('ส่งรายการกรอบไปคลังครบแล้ว');
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (id) => {
    try {
      setSt(await api.post(`/api/frame-remote/${id}/resolve`, {}));
    } catch (ex) {
      err(ex);
    }
  };

  const red = st.failed > 0;
  return (
    <div
      role="status"
      style={{
        margin: '0 0 12px', padding: '10px 14px', borderRadius: 10,
        background: red ? '#fdecec' : '#fff6db', color: red ? '#8a1c1c' : '#6b4e00',
        border: `1px solid ${red ? '#f3b4b4' : '#f0d58a'}`, fontSize: 14,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <b>คลังกรอบ{st.label}:</b>
        {st.pending > 0 && <span>ค้างส่ง {st.pending} รายการ — ระบบกำลังส่งใหม่เอง</span>}
        {st.failed > 0 && <span>ต้องตรวจ {st.failed} รายการ — ขายไปแล้วแต่คลัง{st.label}ตัดไม่ได้</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-light" onClick={() => setOpen((v) => !v)}>
          {open ? 'ซ่อน' : 'ดูรายการ'}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={retry}>
          {busy ? 'กำลังส่ง…' : 'ส่งใหม่ตอนนี้'}
        </button>
      </div>
      {open && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {(st.items || []).map((i) => {
            const failed = i.remote_state === 'failed' || i.reverse_state === 'failed';
            const what = i.reverse_state ? 'คืนกรอบ' : 'ตัดกรอบ';
            const state = STATE[i.reverse_state || i.remote_state] || i.reverse_state || i.remote_state;
            return (
              <li key={i.id} style={{ marginBottom: 4 }}>
                {what} {i.sku} {i.product_name ? `(${i.product_name})` : ''} · เคส {i.case_code || i.case_id} · {state}
                {i.remote_tries ? ` · ลองแล้ว ${i.remote_tries} ครั้ง` : ''}
                {i.remote_error ? <div className="muted" style={{ fontSize: 12 }}>{i.remote_error}</div> : null}
                {failed && (
                  <button type="button" className="btn btn-sm btn-light" style={{ marginTop: 4 }} onClick={() => resolve(i.id)}>
                    ปรับยอดที่คลัง{st.label}แล้ว — ปิดรายการ
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
