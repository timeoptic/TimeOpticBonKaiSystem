import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAsync } from '../../lib/hooks.js';
import { Card, Kv, Loading, PageHead, PrintButton } from '../../components/ui.jsx';
import { RxTable } from '../../components/RxTable.jsx';
import { SHOP } from '../../lib/constants.js';
import { custName, fmtDateTime } from '../../lib/format.js';

export default function PrintPrescription() {
  const { id } = useParams();
  const { data: t, loading, error } = useAsync(
    () => api.get('/api/reports/prescription/' + id),
    [id]
  );

  if (loading) return <Loading />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  return (
    <>
      <PageHead
        icon="🖨"
        title="ใบวัดสายตา"
        subtitle={`#${t.id}`}
        actions={(
          <>
            <PrintButton />
            <Link className="btn btn-ghost no-print" to={'/customers/' + t.customer_id}>← กลับ</Link>
          </>
        )}
      />

      <div className="paper">
        <div className="doc-head">
          <div>
            <h1>EYE EXAMINATION</h1>
            <div className="shop">{SHOP.name + ' — ' + SHOP.tagline}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="shop">{'เลขที่: ' + t.id}</div>
            <div className="shop">{'วันที่: ' + fmtDateTime(t.test_date)}</div>
          </div>
        </div>

        <Kv
          style={{ marginBottom: 12 }}
          rows={[
            ['ลูกค้า', custName(t)],
            ['เบอร์โทร', t.phone || '-'],
            ['ใช้สำหรับ', t.test_for || '-'],
          ]}
        />

        <RxTable t={t} labels={['R (ขวา)', 'L (ซ้าย)']} />

        {t.notes ? <p><b>หมายเหตุ: </b>{t.notes}</p> : null}

        <div className="sign">
          <div><div className="line" />{'ผู้วัดสายตา: ' + (t.employee_name || '')}</div>
          <div><div className="line" />วันที่</div>
        </div>
      </div>
    </>
  );
}
