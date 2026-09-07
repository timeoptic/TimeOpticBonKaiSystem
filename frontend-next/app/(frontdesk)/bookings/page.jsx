'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync } from '../../../lib/hooks.js';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { useBookingLabels } from '../../../contexts/MetaContext.jsx';
import { Badge, Card, Loading, PageHead } from '../../../components/ui.jsx';
import { PagedTable } from '../../../components/Pager.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { BookingStatusBadge } from '../../../components/BookingStatusBadge.jsx';
import { MonthPicker } from '../../../components/MonthPicker.jsx';
import { daysInMonth, leadOffset, shiftMonth } from '../../../lib/calendar.js';
import { TH_DOW } from '../../../lib/constants.js';
import { bookingName, dateOnly, fmtDate, hhmm, todayISO } from '../../../lib/format.js';
import { isAdminUp } from '../../../lib/roles.js';
import { Icon } from '../../../components/Icon.jsx';

// Port of public/js/views/bookings.js's STATUS_CLASS — colors a booking pill
// (and, elsewhere, its detail-page badge) by status.
const STATUS_CLASS = {
  booked: 'blue', confirmed: 'blue', arrived: 'warn', in_service: 'warn',
  done: 'ok', no_show: 'danger', cancelled: 'gray',
};

function BookingCalendarInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { actor } = useAuth();
  const { serviceLabel, channelLabel } = useBookingLabels();

  const monthParam = params.get('month');
  const [month, setMonth] = useState(
    /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam : todayISO().slice(0, 7)
  );
  const [selected, setSelected] = useState(params.get('date') || todayISO());

  const [y0, m0] = month.split('-').map(Number);
  const monthFrom = `${y0}-${String(m0).padStart(2, '0')}-01`;
  const monthTo = `${y0}-${String(m0).padStart(2, '0')}-${String(daysInMonth(y0, m0)).padStart(2, '0')}`;

  // Real booking rows for the visible month, grouped per day — not aggregate
  // counts — so each cell can show actual time+customer pills, matching
  // public/js/views/bookings.js's dayCell()/pill() rendering.
  const cal = useAsync(
    () => api.get('/api/bookings', { from: monthFrom, to: monthTo, limit: 1000 }),
    [monthFrom, monthTo]
  );
  const day = useAsync(() => api.get('/api/bookings', { date: selected, limit: 200 }), [selected]);

  const goToday = () => {
    setMonth(todayISO().slice(0, 7));
    setSelected(todayISO());
  };

  const [y, m] = month.split('-').map(Number);
  const totalDays = daysInMonth(y, m);
  const lead = leadOffset(y, m);
  const today = todayISO();

  const byDate = {};
  for (const b of cal.data || []) (byDate[dateOnly(b.booking_date)] ||= []).push(b);

  const pill = (b) => (
    <div
      key={b.id}
      className={`cal-ev ${STATUS_CLASS[b.status] || 'gray'}`}
      title={`${hhmm(b.booking_time)} ${bookingName(b)}`}
      onClick={(e) => { e.stopPropagation(); router.push('/bookings/detail?id=' + b.id); }}
    >
      <span className="cal-ev-t">{hhmm(b.booking_time)}</span>
      <span className="cal-ev-n">{bookingName(b)}</span>
    </div>
  );

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<div className="cal-cell cal-blank" key={'b' + i} />);
  for (let d = 1; d <= totalDays; d++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const list = byDate[iso] || [];
    const evs = list.slice(0, 3);
    const more = list.length - evs.length;
    const dow = new Date(y, m - 1, d).getDay();
    const cls = [
      iso === today ? 'today' : '',
      iso === selected ? 'selected' : '',
      dow === 0 || dow === 6 ? 'weekend' : '',
      list.length ? 'has' : '',
    ].filter(Boolean).join(' ');

    cells.push(
      <div className={`cal-cell ${cls}`} key={iso} onClick={() => setSelected(iso)}>
        <div className="cal-date">{d}</div>
        <div className="cal-evs">
          {evs.map(pill)}
          {more > 0 ? <div className="cal-more">{`+ อีก ${more} คิว`}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        icon="📅"
        title="Queue Booking"
        subtitle="ปฏิทินจองคิวลูกค้า"
        actions={(
          <>
            <Link className="btn btn-ghost" href="/bookings/new">+ จองคิวใหม่</Link>
            {/* /settings เป็นหน้าของแอดมิน (ดู ADMIN_PATHS) — พนักงานขายกดแล้วเจอแต่หน้า
                "เมนูนี้สำหรับผู้ดูแลระบบ" จึงไม่วาดปุ่มให้ตั้งแต่แรก · ด่านจริงอยู่ที่ API */}
            {isAdminUp(actor)
              ? <Link className="btn btn-ghost" href="/settings"><Icon name="gear" /> ตั้งค่าแจ้งเตือน</Link>
              : null}
          </>
        )}
      />

      <div className="card">
        <div className="card-head">
          <button type="button" className="btn btn-sm btn-light" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="เดือนก่อนหน้า">‹</button>
          {/* หัวเรื่องเป็นปุ่ม — กดแล้วเลือกเดือน/ปีได้ทันที ไม่ต้องกดลูกศรทีละเดือน
              เพราะคิวที่ต้องย้อนกลับไปดูอยู่ห่างจากวันนี้หลายสิบเดือน */}
          <MonthPicker value={month} onChange={setMonth} />
          <button type="button" className="btn btn-sm btn-light" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="เดือนถัดไป">›</button>
          <div className="right">
            <button type="button" className="btn btn-sm btn-light" onClick={goToday}>วันนี้</button>
          </div>
        </div>
        <div className="card-body">
          {cal.loading ? <Loading text="กำลังโหลดปฏิทิน…" /> : (
            <>
              <div className="cal-grid cal-dow">
                {TH_DOW.map((d) => <div className="cal-dowcell" key={d}>{d}</div>)}
              </div>
              <div className="cal-grid">{cells}</div>
              <div className="cal-legend">
                <span><i className="dot blue" />รอมา</span>
                <span><i className="dot warn" />มาถึง/กำลังบริการ</span>
                <span><i className="dot ok" />เสร็จสิ้น</span>
                <span><i className="dot danger" />ไม่มาตามนัด</span>
              </div>
            </>
          )}
        </div>
      </div>

      <Card
        title={'คิววันที่ ' + fmtDate(selected)}
        badge={<Badge kind="gray">{`${day.data?.length ?? 0} คิว`}</Badge>}
        right={(
          <Link className="btn btn-sm btn-accent" href={`/bookings/new?date=${selected}`}>+ จองคิววันนี้</Link>
        )}
        tight
      >
        {day.loading ? <Loading text="กำลังโหลดคิว…" /> : (
          <PagedTable
            /* คิววันใหม่คือคนละชุด — remount ทิ้งเลขหน้าเดิม ไม่งั้นวันที่มีคิวน้อยกว่า
               จะเปิดมาค้างอยู่หน้า 2 ที่ว่างเปล่า */
            key={selected}
            columns={[
              { label: 'เวลา', render: (b) => <b>{hhmm(b.booking_time)}</b>, cls: 'nowrap', mobile: 'title' },
              { label: 'ระยะ', render: (b) => b.duration_min + ' น.', cls: 'num', mobile: 'body' },
              { label: 'รหัส', key: 'booking_code', cls: 'mono', mobile: 'meta' },
              { label: 'ลูกค้า', render: bookingName, mobile: 'title' },
              { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap', mobile: 'subtitle' },
              { label: 'บริการ', render: (b) => serviceLabel(b.service_type), mobile: 'body' },
              { label: 'ช่องทาง', render: (b) => channelLabel(b.channel), mobile: 'meta' },
              { label: 'ผู้ดูแล', key: 'assigned_name', mobile: 'meta' },
              { label: 'สถานะ', render: (b) => <BookingStatusBadge b={b} />, mobile: 'status' },
              {
                label: 'แจ้งเตือน',
                mobile: 'meta',
                render: (b) => (b.reminder_sent_at
                  ? <Badge kind="ok"><Icon name="check" /> ส่งแล้ว</Badge>
                  : <span className="muted">{`ก่อน ${b.reminder_minutes} น.`}</span>),
              },
              { label: 'บันทึกเบื้องต้น', render: (b) => (b.intake_note || '').slice(0, 60), mobile: 'meta' },
              {
                label: '',
                mobile: 'extra',
                cls: 'nowrap',
                render: (b) => (b.case_id
                  ? <Link className="btn btn-sm btn-light" href={'/cases/detail?id=' + b.case_id}><Icon name="board" /> {b.case_code}</Link>
                  : <span className="muted">—</span>),
              },
            ]}
            rows={day.data || []}
            onRowClick={(b) => router.push('/bookings/detail?id=' + b.id)}
            empty="ยังไม่มีคิวในวันนี้"
          />
        )}
      </Card>
    </div>
  );
}

export default function BookingCalendarPage() {
  return (
    <QueryParamPage>
      <BookingCalendarInner />
    </QueryParamPage>
  );
}
