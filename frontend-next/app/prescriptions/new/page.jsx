'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { PrescriptionFormView } from '../PrescriptionFormView.jsx';

export default function NewPrescriptionPage() {
  return (
    <QueryParamPage>
      <PrescriptionFormView editing={false} />
    </QueryParamPage>
  );
}
