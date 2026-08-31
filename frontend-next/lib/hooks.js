'use client';

/** Small hooks shared across pages. */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Delay a fast-changing value (search boxes). */
export function useDebounced(value, ms = 240) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/**
 * Run an async loader and track its state.
 *
 * `deps` behaves like a useEffect dependency list. `reload()` re-runs it, which
 * is how pages refresh after a write. Results from a superseded run are
 * discarded so a slow response cannot overwrite a newer one.
 */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const runId = useRef(0);

  useEffect(() => {
    const my = ++runId.current;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    Promise.resolve()
      .then(loader)
      .then((data) => {
        if (!alive || my !== runId.current) return;
        setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (!alive || my !== runId.current) return;
        setState({ data: null, error, loading: false });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/**
 * Uncontrolled-form helper: read a <form> into a plain object, the same way
 * the old formData() did — checkboxes become 1/0.
 */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    out[el.name] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
  }
  return out;
}

/** Wrap a submit handler with preventDefault + form reading. */
export function onSubmit(handler) {
  return (e) => {
    e.preventDefault();
    handler(readForm(e.currentTarget), e.currentTarget);
  };
}
