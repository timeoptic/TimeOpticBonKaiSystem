'use client';
import { useEffect } from 'react';
import { ToastProvider } from '../components/Toast.jsx';
import { ConfirmProvider } from '../components/Confirm.jsx';
import { MetaProvider, useMeta } from '../contexts/MetaContext.jsx';
import { AuthProvider, useAuth } from '../contexts/AuthContext.jsx';
import { homeFor, mayUseFrontdesk } from '../lib/roles.js';
import { Shell } from '../components/Shell.jsx';
import { Card, Loading, PageHead } from '../components/ui.jsx';

function Gate({ children }) {
  const { ready, error } = useMeta();

  if (error) {
    return (
      <Shell>
        <PageHead icon="⚠️" title="เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" subtitle="Cannot reach the API" />
        <Card>
          <p className="muted">{error.message}</p>
          <p>ตรวจสอบว่า PHP API และ MySQL/MariaDB ของ XAMPP รันอยู่</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>ลองใหม่</button>
        </Card>
      </Shell>
    );
  }

  if (!ready) {
    return <Shell><Loading text="กำลังเชื่อมต่อระบบ…" /></Shell>;
  }

  return <Shell>{children}</Shell>;
}

/**
 * ยังไม่ได้ล็อกอิน = ไม่โหลดอะไรทั้งนั้น
 *
 * อยู่นอก MetaProvider เพราะ /api/meta ก็ต้องล็อกอินเหมือนกัน ถ้าเรียงกลับกัน
 * หน้าล็อกอินจะขึ้นพร้อมข้อความ "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" ทุกครั้ง ทั้งที่
 * เซิร์ฟเวอร์ปกติดี — แค่ยังไม่รู้ว่าใครถาม
 *
 * เมื่อก่อนหน้าล็อกอินขึ้นแทนที่ทั้งแอปตรงนี้ ตอนนี้ทั้งแอปมีหน้าล็อกอินใบเดียว
 * ที่ `/login/` จึงเด้งไปที่นั่นแทน · เด้งด้วย `location.assign` ไม่ใช่ router
 * เพราะหน้านั้นอยู่คนละกลุ่ม CSS
 *
 * พนักงานคลังที่เดินมาหน้าร้านก็ถูกส่งกลับไปฝั่งของตัวเอง — ไม่ใช่ด่านกัน
 * (API ตรวจของจริงทุกคำขอ) แต่เพื่อไม่ให้ยืนอยู่หน้าจอที่ทุกปุ่มตอบว่าไม่มีสิทธิ์
 */
function AuthGate({ children }) {
  const { actor, ready } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!actor) {
      location.assign('/login/');
    } else if (!mayUseFrontdesk(actor)) {
      location.assign(homeFor(actor));
    }
  }, [ready, actor]);

  if (!ready || !actor || !mayUseFrontdesk(actor)) {
    return <Loading text="กำลังตรวจสอบสิทธิ์…" />;
  }
  return (
    <MetaProvider>
      <Gate>{children}</Gate>
    </MetaProvider>
  );
}

export function Providers({ children }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <AuthGate>{children}</AuthGate>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
