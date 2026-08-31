'use client';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { OrderFormView } from '../OrderFormView.jsx';

export default function NewOrderPage() {
  return (
    <QueryParamPage>
      <OrderFormView editing={false} />
    </QueryParamPage>
  );
}
