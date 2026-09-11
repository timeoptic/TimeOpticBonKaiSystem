'use client';
import { useEffect } from 'react';
import { ToastProvider } from '../components/Toast.jsx';
import { ConfirmProvider } from '../components/Confirm.jsx';
import { MetaProvider, useMeta } from '../contexts/MetaContext.jsx';
import { AuthProvider, useAuth } from '../contexts/AuthContext.jsx';
import { homeFor, mayUseFrontdesk, mustChangePassword } from '../lib/roles.js';
import { Shell } from '../components/Shell.jsx';
import { Card, Loading, PageHead } from '../components/ui.jsx';

function Gate({ children }) {
  const { ready, error } = useMeta();

  if (error) {
    return (
      <Shell>
        <PageHead icon="warning" title="เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" subtitle="Cannot reach the API" />
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
 * ยังไม่ได้ล็อกอิน = ไม่วาดอะไรทั้งนั้น
 *
 * เมื่อก่อนด่านนี้อยู่ **นอก** MetaProvider เพื่อไม่ให้ /api/meta ถูกยิงก่อนรู้ว่า
 * ใครถาม · ผลข้างเคียงคือคำขอสามทอดต้องวิ่งต่อกันเป็นแถว (`auth/me` → `meta` →
 * ข้อมูลของหน้า) ซึ่งวัดจากเครื่องจริงแล้วกิน ~210ms จาก ~277ms ที่กว่าเนื้อหา
 * จะขึ้นจอ ทั้งที่ HTML กับ JS เสร็จตั้งแต่ ~60ms
 *
 * ตอนนี้ MetaProvider ครอบด่านนี้อยู่ สองคำขอแรกจึงออกพร้อมกัน · ที่ทำได้เพราะ
 * หน้าล็อกอินย้ายไปอยู่กลุ่ม `(gate)` ซึ่งไม่มี Providers ครอบแล้ว — ความกลัวเดิม
 * ที่ว่า "หน้าล็อกอินจะขึ้นเชื่อมต่อเซิร์ฟเวอร์ไม่ได้" จึงไม่มีทางเกิดอีก
 *
 * ที่ยังเหลือคือคนที่ session หมดอายุแล้วเปิด URL ของหน้าร้านตรง ๆ จะมี /api/meta
 * ตอบ 401 ค้างไว้ใน Network หนึ่งบรรทัดก่อนถูกเด้งไป /login/ — ไม่มีผลกับหน้าจอ
 * เพราะ `Gate` วาดเฉพาะตอนที่มี actor แล้วเท่านั้น
 *
 * เมื่อก่อนหน้าล็อกอินขึ้นแทนที่ทั้งแอปตรงนี้ ตอนนี้ทั้งแอปมีหน้าล็อกอินใบเดียว
 * ที่ `/login/` จึงเด้งไปที่นั่นแทน · เด้งด้วย `location.assign` ไม่ใช่ router
 * เพราะหน้านั้นอยู่คนละกลุ่ม CSS
 *
 * พนักงานคลังที่เดินมาหน้าร้านก็ถูกส่งกลับไปฝั่งของตัวเอง — ไม่ใช่ด่านกัน
 * (API ตรวจของจริงทุกคำขอ) แต่เพื่อไม่ให้ยืนอยู่หน้าจอที่ทุกปุ่มตอบว่าไม่มีสิทธิ์
 *
 * คนที่รหัสผ่านถูกคนอื่นตั้งให้ ถูกส่งไปตั้งรหัสของตัวเองก่อน · API ปฏิเสธทุก
 * เส้นด้วย 403 อยู่แล้ว ถ้าไม่เด้ง หน้าจอจะโหลดขึ้นมาแล้วทุกการ์ดขึ้นข้อความ
 * ผิดพลาดพร้อมกัน ซึ่งอ่านได้ว่าระบบพัง ไม่ใช่ว่าต้องไปเปลี่ยนรหัส
 */
function AuthGate({ children }) {
  const { actor, ready } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!actor) {
      location.assign('/login/');
    } else if (mustChangePassword(actor)) {
      location.assign('/change-password/');
    } else if (!mayUseFrontdesk(actor)) {
      location.assign(homeFor(actor));
    }
  }, [ready, actor]);

  if (!ready || !actor || mustChangePassword(actor) || !mayUseFrontdesk(actor)) {
    return <Loading text="กำลังตรวจสอบสิทธิ์…" />;
  }
  return <Gate>{children}</Gate>;
}

export function Providers({ children }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <MetaProvider>
            <AuthGate>{children}</AuthGate>
          </MetaProvider>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
