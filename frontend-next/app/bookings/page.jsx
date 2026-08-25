'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/apiClient.js';
import { useAsync } from '../../lib/hooks.js';
import { useBookingLabels } from '../../contexts/MetaContext.jsx';
import { Badge, Card, Loading, PageHead } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { QueryParamPage } from '../../components/QueryParamPage.jsx';
import { BookingStatusBadge } from '../../components/BookingStatusBadge.jsx';
import { daysInMonth, leadOffset, shiftMonth } from '../../lib/calendar.js';
import { TH_DOW, TH_MONTHS } from '../../lib/constants.js';
import { bookingName, dateOnly, fmtDate, hhmm, todayISO } from '../../lib/format.js';

function BookingCalendarInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { serviceLabel, channelLabel } = useBookingLabels();

  const monthParam = params.get('month');
  const [month, setMonth] = useState(
    /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam : todayISO().slice(0, 7)
  );
  const [selected, setSelected] = useState(params.get('date') || todayISO());

  const cal = useAsync(() => api.get('/api/bookings/calendar', { month }), [month]);
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
  for (const d of cal.data?.days || []) byDate[dateOnly(d.d)] = d;

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<div className="cal-cell cal-blank" key={'b' + i} />);
  for (let d = 1; d <= totalDays; d++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = byDate[iso];
    const dow = new Date(y, m - 1, d).getDay();
    const busy = Number(info?.arrived || 0) + Number(info?.in_service || 0);
    const cls = [
      iso === today ? 'today' : '',
      iso === selected ? 'selected' : '',
      dow === 0 || dow === 6 ? 'weekend' : '',
      info ? 'has' : '',
    ].filter(Boolean).join(' ');

    cells.push(
      <div className={`cal-cell ${cls}`} key={iso} onClick={() => setSelected(iso)}>
        <div className="cal-date">{d}</div>
        {info && (
          <div className="cal-badges">
            {Number(info.pending) ? <span className="cal-b b-blue" title="รอมา">{info.pending}</span> : null}
            {busy ? <span className="cal-b b-warn" title="มาถึง/กำลังบริการ">{busy}</span> : null}
            {Number(info.done) ? <span className="cal-b b-ok" title="เสร็จสิ้น">{info.done}</span> : null}
            {Number(info.no_show) ? <span className="cal-b b-danger" title="ไม่มา">{info.no_show}</span> : null}
          </div>
        )}
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
            <Link className="btn btn-ghost" href="/settings">⚙️ ตั้งค่าแจ้งเตือน</Link>
          </>
        )}
      />

      <div className="card">
        <div className="card-head">
          <button type="button" className="btn btn-sm btn-light" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <h2>{`${TH_MONTHS[m - 1]} ${y + 543}`}</h2>
          <button type="button" className="btn btn-sm btn-light" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
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
              <div className="row" style={{ marginTop: 12, fontSize: 12 }}>
                <span><span className="cal-b b-blue">{' '}</span> รอมา</span>
                <span><span className="cal-b b-warn">{' '}</span> มาถึง/กำลังบริการ</span>
                <span><span className="cal-b b-ok">{' '}</span> เสร็จสิ้น</span>
                <span><span className="cal-b b-danger">{' '}</span> ไม่มาตามนัด</span>
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
          <DataTable
            columns={[
              { label: 'เวลา', render: (b) => <b>{hhmm(b.booking_time)}</b>, cls: 'nowrap' },
              { label: 'ระยะ', render: (b) => b.duration_min + ' น.', cls: 'num' },
              { label: 'รหัส', key: 'booking_code', cls: 'mono' },
              { label: 'ลูกค้า', render: bookingName },
              { label: 'เบอร์โทร', key: 'phone', cls: 'nowrap' },
              { label: 'บริการ', render: (b) => serviceLabel(b.service_type) },
              { label: 'ช่องทาง', render: (b) => channelLabel(b.channel) },
              { label: 'ผู้ดูแล', key: 'assigned_name' },
              { label: 'สถานะ', render: (b) => <BookingStatusBadge b={b} /> },
              {
                label: 'แจ้งเตือน',
                render: (b) => (b.reminder_sent_at
                  ? <Badge kind="ok">✓ ส่งแล้ว</Badge>
                  : <span className="muted">{`ก่อน ${b.reminder_minutes} น.`}</span>),
              },
              { label: 'บันทึกเบื้องต้น', render: (b) => (b.intake_note || '').slice(0, 60) },
              {
                label: '',
                cls: 'nowrap',
                render: (b) => (b.case_id
                  ? <Link className="btn btn-sm btn-light" href={'/cases/detail?id=' + b.case_id}>{'🗂 ' + b.case_code}</Link>
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
