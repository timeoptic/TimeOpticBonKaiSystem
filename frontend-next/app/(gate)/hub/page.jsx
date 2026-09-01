'use client';
/**
 * เลือกว่าจะเข้าระบบไหน — สำหรับคนที่ทำงานทั้งสองฝั่ง
 *
 * พนักงานขายกับพนักงานคลังไม่เคยเห็นหน้านี้ ล็อกอินเสร็จก็ถึงที่ทำงานเลย
 * เพราะมีฝั่งเดียวให้ไป · แอดมิน เจ้าของร้าน และผู้ดูแลระบบมีสองฝั่ง เดาแทน
 * ไม่ได้ว่าวันนี้เปิดมาเพื่ออะไร จึงถามครั้งเดียวแล้วให้เลือกเอง
 *
 * ปุ่มเป็น `<a>` ไม่ใช่ `<Link>` — สองฝั่ง import CSS คนละชุด ต้องโหลดหน้าใหม่
 */
import { useEffect, useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { homeFor, isSuperuser, worksBothSides } from '../../../lib/roles.js';
import { Loading } from '../../../components/ui.jsx';

export default function HubPage() {
  const [actor, setActor] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/api/auth/me')
      .then((who) => {
        if (!alive) return;
        if (!who) {
          location.assign('/login/');
          return;
        }
        /* คนที่มีฝั่งเดียวไม่ควรมาอยู่ตรงนี้ ไม่ว่าจะมาด้วยลิงก์เก่าหรือพิมพ์เอง */
        if (!worksBothSides(who)) {
          location.assign(homeFor(who));
          return;
        }
        setActor(who);
      })
      .catch(() => location.assign('/login/'));
    return () => { alive = false; };
  }, []);

  async function signOut() {
    try {
      await api.post('/api/auth/logout', {});
    } finally {
      location.assign('/login/');
    }
  }

  if (!actor) {
    return <Loading text="กำลังตรวจสอบสิทธิ์…" />;
  }

  return (
    <div style={{ maxWidth: 640, margin: '10vh auto', padding: '0 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 30, letterSpacing: 2 }}>◎◎</div>
        <h1 style={{ margin: '6px 0 2px', fontSize: 20 }}>
          สวัสดี {actor.displayName}
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          {actor.roleLabel} · เลือกระบบที่จะเข้าใช้
        </p>
      </div>

      <div className="hub-grid">
        <a className="card hub-card" href="/">
          <div className="card-body">
            <div style={{ fontSize: 28 }}>🛍</div>
            <h2 style={{ margin: '8px 0 4px', fontSize: 18 }}>หน้าร้าน</h2>
            <p className="muted" style={{ margin: 0 }}>
              เคส ลูกค้า วัดสายตา ขาย ชำระเงิน ส่งมอบ
            </p>
          </div>
        </a>

        <a className="card hub-card" href="/stock/">
          <div className="card-body">
            <div style={{ fontSize: 28 }}>📦</div>
            <h2 style={{ margin: '8px 0 4px', fontSize: 18 }}>คลังและต้นทุน</h2>
            <p className="muted" style={{ margin: 0 }}>
              รับของ เบิก ล็อต ต้นทุน ใบสั่งตัด RX สาขา
            </p>
          </div>
        </a>
      </div>

      <p className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 16 }}>
        {isSuperuser(actor)
          ? 'บัญชีผู้ดูแลระบบ — เห็นและแก้ได้ทุกบัญชี'
          : 'สลับฝั่งได้ตลอดจากเมนูซ้ายของแต่ละระบบ'}
      </p>

      <p style={{ textAlign: 'center' }}>
        <button type="button" className="btn" onClick={signOut}>ออกจากระบบ</button>
      </p>
    </div>
  );
}
