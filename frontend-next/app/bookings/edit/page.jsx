'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { BookingFormView } from '../BookingFormView.jsx';

export default function EditBookingPage() {
  return (
    <QueryParamPage>
      <BookingFormView editing />
    </QueryParamPage>
  );
}
