'use client';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { CustomerFormView } from '../CustomerFormView.jsx';

export default function EditCustomerPage() {
  return (
    <QueryParamPage>
      <CustomerFormView editing />
    </QueryParamPage>
  );
}
