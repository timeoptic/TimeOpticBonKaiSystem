'use client';
/**
 * API client. Port of frontend/src/api/client.js, with one addition: every
 * call is prefixed with NEXT_PUBLIC_API_ORIGIN (set in .env.local during
 * development, left empty in production) since a static export has no dev
 * proxy the way Vite's server.proxy did.
 */

function apiOrigin() {
  return process.env.NEXT_PUBLIC_API_ORIGIN || '';
}

const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== '' && v !== null && v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? '?' + s : '';
};

async function request(method, path, body, signal) {
  const res = await fetch(apiOrigin() + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get: (path, query, signal) => request('GET', path + qs(query), null, signal),
  post: (path, body) => request('POST', path, body || {}),
  put: (path, body) => request('PUT', path, body || {}),
  del: (path) => request('DELETE', path),
};
