'use client';
/**
 * Wraps a page's content in a Suspense boundary. Required by every page that
 * calls next/navigation's useSearchParams() — Next 15 errors at build time
 * (static export) if that hook is used without one. See the cases-domain
 * plan's Architecture note for why this exists as a shared component instead
 * of being repeated per page.
 */
import { Suspense } from 'react';
import { Loading } from './ui.jsx';

export function QueryParamPage({ children, fallback = <Loading /> }) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}
