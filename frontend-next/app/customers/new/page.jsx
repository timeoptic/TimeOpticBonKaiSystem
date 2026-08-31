'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { CustomerFormView } from '../CustomerFormView.jsx';

export default function NewCustomerPage() {
  return (
    <QueryParamPage>
      <CustomerFormView editing={false} />
    </QueryParamPage>
  );
}
