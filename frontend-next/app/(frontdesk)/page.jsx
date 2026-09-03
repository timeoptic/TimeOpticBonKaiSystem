'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync } from '../../lib/hooks.js';
import { Badge, Card, Kpi, Kpis, Loading, PageHead } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { stageInfo } from '../../lib/constants.js';
import { custName, fmtDate, fmtDateTime, hhmm, money } from '../../lib/format.js';
import { Icon } from '../../components/Icon.jsx';

const TILES = [
  ['📅', 'ปฏิทินจองคิว', 'Queue Booking', '/bookings'],
  ['➕', 'เปิดเคสใหม่', 'New Case', '/cases/new'],
  ['👥', 'ลูกค้าใหม่', 'New Customer', '/customers/new'],
  ['👁', 'วัดสายตา', 'Eye Exam', '/exam'],
  ['📦', 'ส่งมอบ', 'Delivery', '/delivery'],
  ['📜', 'ประวัติการสั่งซื้อ', 'Order History', '/orders'],
];
/* เคยมีอีกแปดใบ ตัดออกแล้วทั้งหมด ด้วยเหตุผลคนละแบบ:
     "จองคิวใหม่" · "กระดานงาน" · "เปิดออเดอร์ตัดแว่น"
       ทางเข้าซ้ำ — คิวจองมี "ปฏิทินจองคิว" ที่เปิดคิวใหม่ได้จากในปฏิทินอยู่แล้ว
       กระดานงานมีปุ่มของตัวเองอยู่หัวหน้านี้และในเมนูซ้าย ส่วนออเดอร์ตัดแว่น
       เริ่มจากเคสของลูกค้า ไม่ใช่จากเมนูหลัก
     "ขายสินค้าทั่วไป" → /sales/new  ·  "เพิ่มสินค้าเข้าคลัง" → /stock/new
       สองหน้านี้ไม่เคยมีอยู่จริง กดแล้วได้ 404 มาตลอด · ของจริงคือ /pos กับ
       /stock/receive/ ซึ่งอยู่ในเมนูซ้ายและเมนูของฝั่งคลังอยู่แล้ว
     "รายจ่าย" · "รายรับ" · "รายงาน"
       เป็นงานของแอดมิน (ดู ADMIN_PATHS ใน lib/roles.js) พนักงานขายกดแล้วเจอ
       หน้า "เมนูนี้สำหรับผู้ดูแลระบบ" — ไทล์ที่กดแล้วโดนปฏิเสธไม่ใช่ทางลัด
       แอดมินยังเข้าได้จากเมนูซ้าย กลุ่ม "การเงิน" กับ "ข้อมูลระบบ"
   หน้าที่ของแถบนี้คือทางลัดของงานหน้าร้านที่แตะทุกวัน ไม่ใช่สารบัญของทั้งระบบ */

function MinsAway({ value }) {
  const m = Number(value);
  if (!Number.isFinite(m)) return null;
  if (m < -5) return <span className="muted">ผ่านไปแล้ว</span>;
  if (m < 0) return <Badge kind="warn">ถึงเวลาแล้ว</Badge>;
  return <Badge kind={m <= 15 ? 'danger' : m <= 60 ? 'warn' : 'gray'}>{m} นาที</Badge>;
}

export default function Home() {
  const router = useRouter();
  const { data: d, error, loading } = useAsync(() => api.get('/api/dashboard'), []);

  if (loading) return <Loading />;
  if (error) {
    return (
      <Card><h2>โหลดข้อมูลไม่สำเร็จ</h2><p className="muted">{error.message}</p></Card>
    );
  }

  const s = d.stats;
  const stages = Object.entries(d.board || {});
  const bookings = d.bookings_today || [];

  const orderCols = [
    { label: 'วันที่สั่ง', render: (o) => fmtDateTime(o.order_date), cls: 'nowrap' },
    { label: 'Invoice', key: 'invoice_code', cls: 'mono' },
    { label: 'ลูกค้า', render: custName },
    { label: 'พนักงาน', render: (o) => o.employee_name || '-' },
    { label: 'เลนส์', render: (o) => o.lens_name || '-' },
    { label: 'กรอบ', render: (o) => o.frame_name || '-' },
    { label: 'นัดรับ', render: (o) => fmtDate(o.appointment_date), cls: 'nowrap' },
    { label: 'ยอดรวม', render: (o) => money(o.total_price), cls: 'num' },
    { label: 'คงเหลือ', render: (o) => money(o.balance), cls: 'num' },
  ];

  return (
    <div>
      <PageHead
        icon="👓"
        title="Main Menu"
        subtitle="เมนูหลัก"
        /* เคยมีปุ่ม "สรุปรายวัน" ชี้ไป /reports/daily ตรงนี้ — หน้านั้นยังไม่ถูก
           ย้ายมาจากแอปเดิม กดแล้วได้ 404 · ปุ่มที่พาไปหน้าเสียแย่กว่าไม่มีปุ่ม
           จะเอากลับมาเมื่อไหร่ ให้สร้างหน้าก่อนแล้วค่อยเติมลิงก์ */
        actions={<Link className="btn btn-ghost" href="/cases"><Icon name="board" /> กระดานงาน</Link>}
      />

      {/* สามใบ ไม่ใช่แปด — หน้าเมนูหลักถูกเปิดตอนเริ่มวัน คำถามตอนนั้นคือ
          "วันนี้มีใครจะมา" กับ "ค้างอยู่เท่าไหร่" ไม่ใช่ยอดเงิน
          เรื่องเงิน (รับเงิน · ขาย · รายจ่าย) ย้ายไปอยู่หน้ารายงานครบแล้ว และ
          ที่นั่นกรองช่วงวันที่กับกดดูที่มาของตัวเลขได้ ซึ่งการ์ดใบเดียวทำไม่ได้
          สินค้าคงคลังกับจำนวนลูกค้าเป็นตัวเลขที่ไม่เปลี่ยนพฤติกรรมใครในวันนั้น */}
      <Kpis>
        <Kpi
          kind="accent"
          label="คิวจองวันนี้"
          value={String(s.bookings_today ?? 0)}
          sub={`ยังไม่มา ${s.bookings_pending ?? 0} คิว`}
        />
        <Kpi label="นัดรับแว่นวันนี้" value={String(s.appointments_today)} sub="Appointment" />
        <Kpi
          kind="warn"
          label="เคสที่ยังไม่จบ"
          value={String(s.open_cases)}
          sub={s.rush_cases ? `ด่วน ${s.rush_cases} เคส` : 'ทั้งร้าน'}
        />
      </Kpis>

      {stages.length > 0 && (
        <Card title="งานค้างแต่ละขั้นตอน">
          <div className="row" style={{ gap: 10 }}>
            {stages.map(([g, n]) => {
              const info = stageInfo(g);
              return (
                <Link
                  key={g}
                  href={`/cases?stage=${g}`}
                  style={{
                    display: 'flex', gap: 9, alignItems: 'center', padding: '10px 15px',
                    borderRadius: 9, background: `${info.color}14`, color: info.color,
                    fontWeight: 700, textDecoration: 'none',
                  }}
                >
                  <Icon name={info.icon} />{' '}{info.label}
                  <span className="badge" style={{ background: info.color, color: '#fff' }}>{n}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      <Card
        title="คิวจองวันนี้ — Today's Queue"
        tight
        badge={<Badge kind="blue">{bookings.length}</Badge>}
        right={<Link className="btn btn-sm btn-light" href="/bookings">ดูปฏิทิน</Link>}
      >
        <DataTable
          columns={[
            { label: 'เวลา', cls: 'nowrap', render: (b) => <b>{hhmm(b.booking_time)}</b> },
            { label: 'อีก', cls: 'num', render: (b) => <MinsAway value={b.mins_away} /> },
            { label: 'รหัส', key: 'booking_code', cls: 'mono' },
            { label: 'ลูกค้า', render: (b) => [b.first_name, b.last_name].filter(Boolean).join(' ') || '(ไม่ระบุ)' },
            { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
            { label: 'ผู้ดูแล', key: 'assigned_name' },
            { label: 'สถานะ', key: 'status' },
            {
              label: 'แจ้งเตือน',
              render: (b) => (b.reminder_sent_at
                ? <Badge kind="ok"><Icon name="bell" /> ส่งแล้ว</Badge>
                : <span className="muted">{`ก่อน ${b.reminder_minutes} น.`}</span>),
            },
            { label: 'บันทึกเบื้องต้น', render: (b) => (b.intake_note || '').slice(0, 70) },
          ]}
          rows={bookings}
          onRowClick={(b) => router.push(`/bookings/detail?id=${b.id}`)}
          empty="วันนี้ยังไม่มีคิวจอง"
        />
      </Card>

      <div className="tiles" style={{ marginBottom: 20 }}>
        {TILES.map(([ic, th, en, to]) => (
          <Link key={to + th} className="tile" href={to}>
            <span className="t-ic"><Icon name={ic} /></span>
            <span><b>{th}</b><small>{en}</small></span>
          </Link>
        ))}
      </div>

      <Card
        title="ออเดอร์ว่าง — Unfilled Orders (ยังไม่ได้เติมเลนส์/กรอบ)"
        tight
        badge={<Badge kind="warn">{d.unfilled.length}</Badge>}
      >
        <DataTable
          columns={orderCols}
          rows={d.unfilled}
          onRowClick={(o) => router.push(`/orders/detail?id=${o.id}`)}
          empty="ไม่มีออเดอร์ที่รอของ"
        />
      </Card>

      <Card
        title="ออเดอร์ที่ยังไม่ปิดการขาย — Unclosed Orders (ของครบ รอลูกค้ารับ)"
        tight
        badge={<Badge kind="blue">{d.unclosed.length}</Badge>}
      >
        <DataTable
          columns={orderCols}
          rows={d.unclosed}
          onRowClick={(o) => router.push(`/orders/detail?id=${o.id}`)}
          empty="ไม่มีออเดอร์รอรับ"
        />
      </Card>
    </div>
  );
}
