'use client';
/**
 * The two labels a case carries, side by side.
 *
 *   ประเภทลูกค้า  which book of work it belongs to — Sight First or the shop's
 *                own. Shown only for Sight First: "ลูกค้า" is the default and a
 *                badge on every single row says nothing.
 *   ประเภทงาน     what the job is — ตัดแว่นใหม่ / เปลี่ยนเลนส์ / ซ่อม / ตรวจสายตา.
 *
 * They were one column until they were not, and three screens each drew their
 * own version of that one badge. One component so they cannot drift apart again.
 */
import { Badge } from './ui.jsx';

export const SIGHT_FIRST = 'sight_first';

export function CaseTags({ row }) {
  const sightFirst = row?.customer_category === SIGHT_FIRST;
  const job = row?.case_type;
  if (!sightFirst && !job) return null;
  return (
    <>
      {sightFirst ? <Badge kind="blue">SightFirst</Badge> : null}
      {job ? <Badge kind="gray">{job}</Badge> : null}
    </>
  );
}
