/**
 * โครงนอกสุด — มีแค่ <html> กับ <body>
 *
 * ไม่มี CSS ไม่มี provider ตั้งใจให้ว่าง เพราะแอปนี้มีสองฝั่งที่หน้าตาคนละชุด
 * กันจริง ๆ: หน้าร้านอยู่ที่ `/` (กลุ่ม `(frontdesk)`) และคลังกับต้นทุนอยู่ที่
 * `/stock` แต่ละฝั่ง import สไตล์และ provider ของตัวเองใน layout ของกลุ่มมัน
 * อะไรที่วางไว้ตรงนี้จะไปโผล่ทั้งสองฝั่ง ซึ่งเกือบทุกครั้งไม่ใช่สิ่งที่ต้องการ
 */
export const metadata = {
  title: 'TIMEOPTIC @ สาขาบ่อนไก่ — ระบบจัดการร้านแว่นตา',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230b8282'><path fill-rule='evenodd' d='M6.4 10.5a4.6 4.6 0 1 0 4.5 5.4h2.2a4.6 4.6 0 1 0 .3-2H10.6a4.6 4.6 0 0 0-4.2-3.4zm0 2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zm11.2 0a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z'/><path d='M4.3 11.6 2.4 11 4 6.2l1.9.6zm15.4 0 1.9-.6L19.9 6.2l-1.9.6z'/></svg>",
  },
};

// จอโทรศัพท์ที่มีติ่ง/ขอบโค้ง: ให้หน้าเว็บกินเต็มจอ แล้วค่อยเว้นระยะปลอดภัย
// ด้วย env(safe-area-inset-*) ใน globals.css ของแต่ละฝั่งเอง
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * ฟอนต์ของทั้งระบบ โหลดที่นี่ที่เดียว
 *
 * เป็นข้อยกเว้นเดียวของกฎ "layout รากต้องว่าง" — ฟอนต์ไม่ใช่สไตล์ที่ชนกัน
 * มันคือทรัพยากรที่ทั้งสองฝั่งใช้ตัวเดียวกัน โหลดซ้ำสองที่ก็ได้ไฟล์เดิม
 *
 * Anuphan (Cadson Demak) มีทั้งไทยและละตินในไฟล์เดียว ไทยเป็นแบบไม่มีหัว ละติน
 * ทรงเรขาคณิต — อ่านออกว่าเป็นเครื่องมือที่แม่นยำ ซึ่งตรงกับงานวัดสายตามากกว่า
 * ฟอนต์ UI ทั่วไป · ทั้งระบบเป็นภาษาไทย ฟอนต์ที่ไม่มีไทยจึงไม่ใช่ตัวเลือกตั้งแต่ต้น
 * ตัวเลขในตารางใช้ tabular-nums ของ Anuphan เอง ไม่ต้องมีฟอนต์ mono มาช่วยเรียงหลัก
 * mono เหลือไว้เฉพาะรหัสเคส/SKU ซึ่งเป็นรหัส ไม่ใช่ตัวเลขที่เอามาบวกกัน
 *
 * `preconnect` สองบรรทัดมาก่อน เพราะไฟล์ฟอนต์อยู่คนละโดเมนกับ CSS ที่ประกาศมัน
 * ถ้าไม่บอกไว้ เบราว์เซอร์จะเสียเวลาเปิดการเชื่อมต่อตอนที่รู้ตัวว่าต้องใช้แล้ว
 */
const FONT_CSS =
  'https://fonts.googleapis.com/css2' +
  '?family=Anuphan:wght@300;400;500;600;700' +
  '&display=swap';

export default function RootLayout({ children }) {
  return (
    // ส่วนขยายเบราว์เซอร์ (เช่น Scribe recorder) แปะ attribute ของตัวเองลงบน <html>
    // ก่อน React hydrate — ทำให้ dev overlay ขึ้น hydration mismatch ทั้งที่โค้ดเราไม่ได้ผิด
    // suppressHydrationWarning ที่นี่กันแค่ attribute ของแท็กนี้แท็กเดียว ไม่ได้ปิดทั้งหน้า
    <html lang="th" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_CSS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
