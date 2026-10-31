'use client';
/**
 * Case-detail "การขาย" (Sales) tab. Reuses OrderFormView (app/orders/OrderFormView.jsx)
 * in embedded mode so staff can open/edit the case's order inline without leaving the
 * case-detail page. `caseId`/`customerId`/`orderId` override what OrderFormView would
 * otherwise read from the query string (there isn't one here), and `onSaved` wires the
 * panel's `reload` back in so the case-detail page's KPIs/stage checks refresh after a
 * successful save — mirroring how PaymentPanel.jsx calls reload() after api.post/api.put.
 */
import { useState } from 'react';
import { OrderFormView } from '../../../orders/OrderFormView.jsx';
import { Card, Row } from '../../../../../components/ui.jsx';
import { Icon } from '../../../../../components/Icon.jsx';

export function SalesPanel({ c, reload, actorId }) {
  /* ออเดอร์ที่เปิดแล้วล็อกไว้ก่อน ต้องกด "เปิดการแก้ไข" ถึงแก้ได้ · บันทึกหรือยกเลิกแล้วล็อกกลับ
     formKey เปลี่ยนตอนยกเลิก ฟอร์มสร้างใหม่จากค่าที่บันทึกไว้ สิ่งที่แก้ค้างจึงหายไป */
  const [unlocked, setUnlocked] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const locked = !!c.order && !unlocked;

  const cancel = () => {
    setUnlocked(false);
    setFormKey((k) => k + 1);
  };

  /* ยืนยัน / เปิดขั้นขายกลับมาแก้ เปลี่ยนสิ่งที่ออเดอร์แก้ได้ (Bewell: เลนส์ล็อกหลังยืนยันขาย —
     lens_locked) แต่ reload() โหลดแค่เคสใหม่ ฟอร์มถือออเดอร์ชุดเดิมไว้ จึงเปลี่ยน key ตาม
     สถานะขั้นขายให้ฟอร์มโหลดออเดอร์ใหม่ · ตอนสองจังหวะนี้ไม่มีอะไรค้างในฟอร์มให้หาย */
  const sales = c.processes?.sales || {};
  const salesKey = `${c.order?.id ?? 'new'}:${sales.status ?? ''}:${sales.completed_at ?? ''}`;
  return (
    <div className="stack">
      {c.order ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <b data-testid="order-edit-state">
              <Icon name={locked ? 'lock' : 'pencil'} />{' '}
              {locked ? 'ออเดอร์นี้ล็อกอยู่ — ดูได้อย่างเดียว' : 'กำลังแก้ไขออเดอร์ — กด “บันทึกการแก้ไข” ด้านล่างเพื่อเก็บ'}
            </b>
            {locked
              ? <button type="button" className="btn btn-sm" onClick={() => setUnlocked(true)}>เปิดการแก้ไข</button>
              : <button type="button" className="btn btn-sm btn-light" onClick={cancel}>ยกเลิกการแก้ไข</button>}
          </Row>
        </Card>
      ) : null}
      <OrderFormView
        key={`${salesKey}:${formKey}`}
        embedded
        locked={locked}
        onUnlock={() => setUnlocked(true)}
        editing={!!c.order}
        orderId={c.order?.id}
        caseId={c.id}
        customerId={c.customer_id}
        onSaved={() => { setUnlocked(false); reload(); }}
        actorId={actorId}
      />
    </div>
  );
}
