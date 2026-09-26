'use client';
/**
 * Case-detail "การขาย" (Sales) tab. Reuses OrderFormView (app/orders/OrderFormView.jsx)
 * in embedded mode so staff can open/edit the case's order inline without leaving the
 * case-detail page. `caseId`/`customerId`/`orderId` override what OrderFormView would
 * otherwise read from the query string (there isn't one here), and `onSaved` wires the
 * panel's `reload` back in so the case-detail page's KPIs/stage checks refresh after a
 * successful save — mirroring how PaymentPanel.jsx calls reload() after api.post/api.put.
 */
import { OrderFormView } from '../../../orders/OrderFormView.jsx';

export function SalesPanel({ c, reload, actorId }) {
  /* ยืนยัน / เปิดขั้นขายกลับมาแก้ เปลี่ยนสิ่งที่ออเดอร์แก้ได้ (Bewell: เลนส์ล็อกหลังยืนยันขาย —
     lens_locked) แต่ reload() โหลดแค่เคสใหม่ ฟอร์มถือออเดอร์ชุดเดิมไว้ จึงเปลี่ยน key ตาม
     สถานะขั้นขายให้ฟอร์มโหลดออเดอร์ใหม่ · ตอนสองจังหวะนี้ไม่มีอะไรค้างในฟอร์มให้หาย */
  const sales = c.processes?.sales || {};
  const salesKey = `${c.order?.id ?? 'new'}:${sales.status ?? ''}:${sales.completed_at ?? ''}`;
  return (
    <div className="stack">
      <OrderFormView
        key={salesKey}
        embedded
        editing={!!c.order}
        orderId={c.order?.id}
        caseId={c.id}
        customerId={c.customer_id}
        onSaved={reload}
        actorId={actorId}
      />
    </div>
  );
}
