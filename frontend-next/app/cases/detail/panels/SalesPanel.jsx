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
  return (
    <div className="stack">
      <OrderFormView
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
