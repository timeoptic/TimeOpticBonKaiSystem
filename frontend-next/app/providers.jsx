'use client';
import { ToastProvider } from '../components/Toast.jsx';
import { ConfirmProvider } from '../components/Confirm.jsx';
import { MetaProvider, useMeta } from '../contexts/MetaContext.jsx';
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

export function Providers({ children }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <MetaProvider>
          <Gate>{children}</Gate>
        </MetaProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
