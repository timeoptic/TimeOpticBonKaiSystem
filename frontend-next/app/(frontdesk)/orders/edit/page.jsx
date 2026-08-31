'use client';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { OrderFormView } from '../OrderFormView.jsx';

export default function EditOrderPage() {
  return (
    <QueryParamPage>
      <OrderFormView editing />
    </QueryParamPage>
  );
}
