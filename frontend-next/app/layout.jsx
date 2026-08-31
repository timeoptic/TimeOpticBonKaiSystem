import './globals.css';
import { Providers } from './providers.jsx';

export const metadata = {
  title: 'TimeOptic — ระบบจัดการร้านแว่นตา',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230b8282'><path fill-rule='evenodd' d='M6.4 10.5a4.6 4.6 0 1 0 4.5 5.4h2.2a4.6 4.6 0 1 0 .3-2H10.6a4.6 4.6 0 0 0-4.2-3.4zm0 2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zm11.2 0a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z'/><path d='M4.3 11.6 2.4 11 4 6.2l1.9.6zm15.4 0 1.9-.6L19.9 6.2l-1.9.6z'/></svg>",
  },
};

// จอโทรศัพท์ที่มีติ่ง/ขอบโค้ง: ให้หน้าเว็บกินเต็มจอ แล้วค่อยเว้นระยะปลอดภัย
// ด้วย env(safe-area-inset-*) ใน globals.css เอง
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    // ส่วนขยายเบราว์เซอร์ (เช่น Scribe recorder) แปะ attribute ของตัวเองลงบน <html>
    // ก่อน React hydrate — ทำให้ dev overlay ขึ้น hydration mismatch ทั้งที่โค้ดเราไม่ได้ผิด
    // suppressHydrationWarning ที่นี่กันแค่ attribute ของแท็กนี้แท็กเดียว ไม่ได้ปิดทั้งหน้า
    <html lang="th" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
