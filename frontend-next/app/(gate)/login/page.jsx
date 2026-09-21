'use client';
/**
 * หน้าเข้าสู่ระบบใบเดียวของทั้งแอป
 *
 * เมื่อก่อนมีสองใบ คนละดีไซน์ ทั้งที่ใช้ session ใบเดียวกัน (คุกกี้
 * `optic_session`) — คนที่จำได้ว่า "ระบบคลังล็อกอินที่อีกหน้า" จะงงทุกครั้งที่
 * เข้าผิดหน้า ทั้งที่ล็อกอินที่ไหนก็ใช้ได้ทั้งคู่
 *
 * ล็อกอินเสร็จแล้วไปไหนต่อ ตอบโดย API (`actor.home`) ไม่ใช่โดยหน้านี้ กฎว่า
 * บทบาทไหนทำงานฝั่งไหนอยู่ที่ `Roles::home` ที่เดียว
 *
 * เดินต่อด้วย `location.assign` ไม่ใช่ router.push เพราะสองฝั่ง import CSS
 * คนละชุด การเดินแบบ client-side จะได้สไตล์สองชุดทับกันในหน้าเดียว
 */
import { useEffect, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { homeFor } from '../../../lib/roles.js';
import { Card, Field, Stack } from '../../../components/ui.jsx';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /* ล็อกอินค้างอยู่แล้วก็ไม่ต้องล็อกอินซ้ำ — พาไปที่ทำงานของบทบาทนั้นเลย */
  useEffect(() => {
    let alive = true;
    api.get('/api/auth/me')
      .then((actor) => { if (alive && actor) location.assign(homeFor(actor)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const actor = await api.post('/api/auth/login', { username: username.trim(), password });
      location.assign(homeFor(actor));
    } catch (err) {
      setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '12vh auto', padding: '0 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 30, letterSpacing: 2 }}>◎◎</div>
        <h1 style={{ margin: '6px 0 2px', fontSize: 20 }}>TimeOptic x Bewell</h1>
        <p className="muted" style={{ margin: 0 }}>หน้าร้าน · คลังและต้นทุน</p>
      </div>

      <Card>
        <form onSubmit={submit}>
          <Stack>
            <Field label="ชื่อผู้ใช้">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </Field>
            <Field label="รหัสผ่าน">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>

            {error ? <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div> : null}

            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </Stack>
        </form>
      </Card>

      <p className="muted" style={{ textAlign: 'center', fontSize: 12 }}>
        บัญชีเดียวใช้ได้ทั้งสองระบบ
      </p>
    </div>
  );
}
