'use client';
import Link from 'next/link';
import { api } from '../../../../lib/apiClient.js';
import { useToast } from '../../../../components/Toast.jsx';
import { Badge, Card, Empty, Row, Stack } from '../../../../components/ui.jsx';
import { RxTable } from '../../../../components/RxTable.jsx';
import { RX_KIND_LABEL } from '../../../../lib/constants.js';
import { fmtDateTime } from '../../../../lib/format.js';

const HEALTH_FLAGS = [
  ['health_cataract', 'ต้อกระจก'],
  ['health_eye_surgery', 'เคยผ่าตัดตา'],
  ['health_diabetes', 'เบาหวาน'],
  ['health_bp', 'ความดัน'],
  ['health_heart', 'หัวใจ'],
];

export function RxPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const rows = c.prescriptions || [];

  const confirmRx = async (t) => {
    try {
      await api.post(`/api/prescriptions/${t.id}/confirm`, { employee_id: actorId() });
      ok('ยืนยันค่าสายตาแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <Stack>
      {rows.map((t) => {
        const flags = HEALTH_FLAGS.filter(([k]) => Number(t[k])).map(([, label]) => label);
        return (
          <Card
            key={t.id}
            title={`${RX_KIND_LABEL[t.kind] || t.kind} — ${fmtDateTime(t.test_date)}`}
            badge={t.kind === 'final' ? <Badge kind="ok">FINAL</Badge> : null}
          >
            <RxTable t={t} withPrism />
            <Row>
              {t.test_for ? <Badge kind="gray">{t.test_for}</Badge> : null}
              {t.performed_by_name ? <span className="muted">{'ผู้วัด ' + t.performed_by_name}</span> : null}
              {t.confirmed_at ? <Badge kind="ok">ยืนยันแล้ว</Badge> : null}
            </Row>
            {flags.length > 0 && (
              <p>
                <b>สุขภาพ: </b>
                {flags.join(', ')}
                {t.health_note ? ' — ' + t.health_note : ''}
              </p>
            )}
            {t.exam_note ? <p className="muted">{t.exam_note}</p> : null}
            <Row>
              <Link className="btn btn-sm btn-light" href={'/prescriptions/edit?id=' + t.id}>✎ แก้ไข</Link>
              <Link className="btn btn-sm btn-light" href={'/print/prescription?id=' + t.id}>🖨 พิมพ์</Link>
              {t.kind !== 'final' && (
                <button type="button" className="btn btn-sm btn-accent" onClick={() => confirmRx(t)}>
                  ✔ ใช้ค่านี้เป็นค่าจริง
                </button>
              )}
            </Row>
          </Card>
        );
      })}

      {rows.length === 0 && <Empty>ยังไม่มีค่าสายตาในเคสนี้</Empty>}

      <Row>
        <Link className="btn btn-accent" href={`/prescriptions/new?customer=${c.customer_id}&case=${c.id}`}>
          + บันทึกค่าสายตาใหม่
        </Link>
      </Row>
    </Stack>
  );
}
