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
import {
  homeFor, inMoneyZone, inSystemZone, isSuperuser,
  mayUseFrontdesk, mayUseStock, worksBothSides,
} from '../../../lib/roles.js';
import { Loading } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icon.jsx';

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
    /* กว้างขึ้นจาก 640 เพราะการ์ดเป็นสามใบแล้ว — ที่ 640 ใบที่สามตกลงไปอยู่แถวล่างคนเดียว */
    <div style={{ maxWidth: 900, margin: '10vh auto', padding: '0 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 30, letterSpacing: 2 }}>◎◎</div>
        <h1 style={{ margin: '6px 0 2px', fontSize: 20 }}>
          สวัสดี {actor.displayName}
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          {actor.roleText} · เลือกระบบที่จะเข้าใช้
        </p>
      </div>

      {/* วาดเฉพาะใบที่เปิดได้จริง — การ์ดที่กดแล้วเจอ 403 แย่กว่าการ์ดที่ไม่มี */}
      <div className="hub-grid">
        {mayUseFrontdesk(actor) ? (
          <a className="card hub-card" href="/">
            <div className="card-body">
              <div className="hub-tile-icon"><Icon name="bag" /></div>
              <h2 style={{ margin: '8px 0 4px', fontSize: 18 }}>หน้าร้าน</h2>
              <p className="muted" style={{ margin: 0 }}>
                เคส ลูกค้า วัดสายตา ขาย ชำระเงิน ส่งมอบ
              </p>
            </div>
          </a>
        ) : null}

        <a className="card hub-card" href="/stock/">
          <div className="card-body">
            <div className="hub-tile-icon"><Icon name="box" /></div>
            <h2 style={{ margin: '8px 0 4px', fontSize: 18 }}>คลังและต้นทุน</h2>
            <p className="muted" style={{ margin: 0 }}>
              รับของ เบิก ล็อต ต้นทุน ใบสั่งตัด RX สาขา
            </p>
          </div>
        </a>

        {/* งานของผู้ดูแล — เงินของร้านและข้อมูลระบบ
            เคยไม่ต้องเช็คบทบาทตรงนี้ เพราะ worksBothSides เท่ากับ "เป็นแอดมิน"
            พอดี · ตั้งแต่มีบทบาทบัญชี สองอย่างนั้นไม่ใช่สิ่งเดียวกันอีกแล้ว —
            บัญชีมองเห็นหน้านี้ แต่เห็นแค่ครึ่งการเงินของการ์ดใบนี้

            พาไปที่หน้าแรกของโซนที่เขามีสิทธิ์ — ไม่ได้ทำหน้ารวมขึ้นมาใหม่ เพราะงาน
            พวกนี้อยู่ในเมนูซ้ายของหน้าร้านครบอยู่แล้ว การ์ดใบนี้มีไว้ให้เห็นตั้งแต่
            ล็อกอินว่าส่วนนี้มีอยู่ ไม่ใช่ที่อยู่ใหม่ของมัน */}
        {inMoneyZone(actor) || inSystemZone(actor) ? (
          <a className="card hub-card" href={inMoneyZone(actor) ? '/income/' : '/employees/'}>
            <div className="card-body">
              <div style={{ fontSize: 28 }}>🔐</div>
              <h2 style={{ margin: '8px 0 4px', fontSize: 18 }}>
                {inSystemZone(actor) ? 'ผู้ดูแลระบบ' : 'การเงินและรายงาน'}
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                {inSystemZone(actor)
                  ? 'รายรับ รายจ่าย พนักงาน ซัพพลายเออร์ รายงาน ตั้งค่า'
                  : 'รายรับ รายจ่าย รายงาน ซัพพลายเออร์'}
              </p>
            </div>
          </a>
        ) : null}
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
