'use client';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { BookingFormView } from '../BookingFormView.jsx';

export default function NewBookingPage() {
  return (
    <QueryParamPage>
      <BookingFormView editing={false} />
    </QueryParamPage>
  );
}
