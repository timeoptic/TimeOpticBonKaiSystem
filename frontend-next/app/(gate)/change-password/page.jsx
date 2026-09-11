'use client';
/**
 * ตั้งรหัสผ่านใหม่ — ขวางไว้ก่อนเข้าใช้งาน เมื่อรหัสปัจจุบันคนอื่นเป็นคนตั้งให้
 *
 * ธง `must_change_password` ขึ้นตอนที่แอดมินกดรีเซ็ตหรือตั้งรหัสให้ · รหัสแบบนั้น
 * มีคนที่สองรู้อยู่แล้ว จึงใช้ได้ครั้งเดียวเพื่อเข้ามาตั้งรหัสจริง ไม่ใช่กลายเป็น
 * รหัสถาวรที่บัญชีมีเจ้าของสองคนตลอดไป
 *
 * อยู่ในกลุ่ม `(gate)` เดียวกับหน้าล็อกอิน เพราะเป็นของทั้งสองฝั่ง — พนักงานคลัง
 * ที่ถูกรีเซ็ตรหัสก็มาที่หน้านี้ · และเพราะกลุ่มนี้ไม่มี `Providers` หน้านี้จึงไม่
 * ถูก AuthGate ของฝั่งหน้าร้านเด้งกลับเป็นวง
 *
 * API ปฏิเสธทุกเส้นอื่นด้วย 403 `password_change_required` อยู่แล้ว (ประตูใน
 * `api/index.php` กันทั้ง /api และ /stock-api) หน้านี้จึงเป็นการบอกให้คนอ่านออก
 * ว่าทำไมทุกอย่างถูกปฏิเสธ ไม่ใช่ตัวกันเอง
 */
import { useEffect, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { homeFor } from '../../../lib/roles.js';
import { Card, Field, Stack } from '../../../components/ui.jsx';

export default function ChangePasswordPage() {
  const [actor, setActor] = useState(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /* ยังไม่ได้ล็อกอินก็ตั้งรหัสไม่ได้ · เปลี่ยนไปแล้ว (ธงลง) ก็ไม่ต้องมาที่นี่ */
  useEffect(() => {
    let alive = true;
    api.get('/api/auth/me')
      .then((who) => {
        if (!alive) return;
        if (!who) location.assign('/login/');
        else if (!who.mustChangePassword) location.assign(homeFor(who));
        else setActor(who);
      })
      .catch(() => { if (alive) location.assign('/login/'); });
    return () => { alive = false; };
  }, []);

  async function submit(e) {
    e.preventDefault();
    /* ตรวจสองช่องตรงกันที่นี่ ไม่ส่งไปให้ API ตอบ — พิมพ์ผิดในช่องยืนยันเป็น
       ความผิดพลาดของนิ้ว ไม่ใช่ของบัญชี และคำตอบอยู่ตรงหน้าอยู่แล้ว */
    if (next !== confirm) {
      setError('รหัสผ่านใหม่สองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/stock-api/auth/change-password', {
        current_password: current,
        password: next,
      });
      location.assign(homeFor(actor));
    } catch (err) {
      setError(err.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
      setBusy(false);
    }
  }

  /* ทางออกของคนที่เข้ามาผิดบัญชี หรือยังไม่พร้อมตั้งรหัสตอนนี้ — ต้องออกจากระบบก่อน
     ลิงก์ไป /login/ เฉย ๆ หน้านั้นเห็น session ค้างแล้วพาวนกลับมาที่นี่อีก
     (เส้น logout เปิดให้บัญชีที่ติดธงเปลี่ยนรหัสอยู่แล้ว — requirePasswordChange ใน api/index.php) */
  async function backToLogin() {
    try {
      await api.post('/api/auth/logout', {});
    } finally {
      location.assign('/login/');
    }
  }

  if (!actor) return null;

  return (
    <div style={{ maxWidth: 380, margin: '12vh auto', padding: '0 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 30, letterSpacing: 2 }}>◎◎</div>
        <h1 style={{ margin: '6px 0 2px', fontSize: 20 }}>ตั้งรหัสผ่านใหม่</h1>
        <p className="muted" style={{ margin: 0 }}>{actor.displayName}</p>
      </div>

      <Card>
        <p className="muted" style={{ marginTop: 0 }}>
          รหัสผ่านที่ใช้อยู่ตอนนี้ตั้งโดยผู้ดูแลระบบ จึงมีคนอื่นรู้ด้วย —
          ตั้งรหัสของตัวเองก่อนจึงจะใช้งานระบบต่อได้
        </p>
        <form onSubmit={submit}>
          <Stack>
            <Field label="รหัสผ่านที่ได้รับมา">
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </Field>
            <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 10 ตัวอักษร">
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="ยืนยันรหัสผ่านใหม่">
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>

            {error ? <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div> : null}

            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่าน'}
            </button>
          </Stack>
        </form>
      </Card>

      <p style={{ textAlign: 'center' }}>
        <button type="button" className="btn" onClick={backToLogin} disabled={busy}>
          กลับไปหน้าเข้าสู่ระบบ
        </button>
      </p>
    </div>
  );
}
