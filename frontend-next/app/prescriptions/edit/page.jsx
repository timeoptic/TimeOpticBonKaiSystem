'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { PrescriptionFormView } from '../PrescriptionFormView.jsx';

export default function EditPrescriptionPage() {
  return (
    <QueryParamPage>
      <PrescriptionFormView editing />
    </QueryParamPage>
  );
}
