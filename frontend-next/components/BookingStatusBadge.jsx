'use client';
/**
 * The colored status badge for a booking row, shared by the calendar's
 * day list and the booking detail page.
 * Extracted from frontend/src/pages/bookings/BookingCalendar.jsx (there it
 * was a page-level export imported cross-file by BookingDetail.jsx).
 */
import { useBookingLabels } from '../contexts/MetaContext.jsx';
import { Badge } from './ui.jsx';
import { BOOKING_STATUS_CLASS } from '../lib/constants.js';

export function BookingStatusBadge({ b }) {
  const { statusLabel } = useBookingLabels();
  return <Badge kind={BOOKING_STATUS_CLASS[b.status] || 'gray'}>{statusLabel(b.status)}</Badge>;
}
