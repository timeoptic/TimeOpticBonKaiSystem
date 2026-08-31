/**
 * Pure month-grid date math for the booking calendar. Extracted from
 * frontend/src/pages/bookings/BookingCalendar.jsx, where this logic lived
 * inline in JSX and so could never be unit tested.
 */

/**
 * Number of days in `month` (1-based). `new Date(year, month, 0)` looks 0-based, but
 * because JS Date months are internally 0-based, passing our 1-based `month` as the
 * 0-based slot means "day 0 of the following month" — i.e. the last day of the month
 * we actually want — which is exactly the day count we're after.
 */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Day of week (0=Sun..6=Sat) the month's 1st falls on — how many blank lead cells a grid needs. */
export function leadOffset(year, month) {
  return new Date(year, month - 1, 1).getDay();
}

/** 'YYYY-MM' shifted by delta months, e.g. shiftMonth('2026-12', 1) -> '2027-01'. */
export function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
