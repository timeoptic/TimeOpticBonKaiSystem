'use client';
/**
 * หน้าเข้าสู่ระบบ — ขึ้นแทนทั้งแอปเมื่อยังไม่ได้ล็อกอิน
 *
 * ไม่ได้ทำเป็น route `/login` เพราะทุกหน้าต้องล็อกอินเหมือนกันหมด ถ้าเป็น route
 * จะต้องมีคนคอยเด้งกลับมาที่นี่จากทุกหน้า แล้ววันหนึ่งจะมีหน้าที่ลืมเด้ง
 */
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 380, margin: '12vh auto', padding: '0 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 34 }}>👓</div>
        <h1 style={{ margin: '6px 0 2px', fontSize: 20 }}>TimeOptic</h1>
        <p className="muted" style={{ margin: 0 }}>เข้าสู่ระบบเพื่อใช้งาน</p>
      </div>

      <form className="card stack" onSubmit={submit}>
        <label className="field">
          <span>ชื่อผู้ใช้</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label className="field">
          <span>รหัสผ่าน</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error ? <p style={{ color: 'var(--danger, #c0392b)', margin: 0 }}>{error}</p> : null}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>

      <p className="muted" style={{ textAlign: 'center', fontSize: 12 }}>
        ใช้บัญชีเดียวกับระบบคลังและต้นทุน
      </p>
    </div>
  );
}
