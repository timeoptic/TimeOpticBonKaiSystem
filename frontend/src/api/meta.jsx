/**
 * /api/meta holds every dropdown the app needs — staff, case statuses,
 * suppliers, booking vocabulary. It is fetched once at boot and shared through
 * context; `reload()` refreshes it after adding an employee or supplier.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './client.js';

const EMPTY = {
  lists: {}, employees: [], statuses: [], suppliers: [],
  booking: { service_types: [], statuses: [], channels: [], intake_questions: [] },
  today: '', now: '',
};

const MetaContext = createContext({ meta: EMPTY, reload: async () => {}, ready: false, error: null });

export function MetaProvider({ children }) {
  const [meta, setMeta] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    const data = await api.get('/api/meta');
    setMeta({ ...EMPTY, ...data });
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    reload()
      .then(() => alive && setReady(true))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [reload]);

  return (
    <MetaContext.Provider value={{ meta, reload, ready, error }}>
      {children}
    </MetaContext.Provider>
  );
}

export const useMeta = () => useContext(MetaContext);

/* ------------------------- booking vocabulary ---------------------- */
export function useBookingLabels() {
  const { meta } = useMeta();
  const b = meta.booking || {};
  const of = (list, code) => ((list || []).find(([c]) => c === code) || [null, code])[1];
  return {
    serviceTypes: b.service_types || [],
    statuses: b.statuses || [],
    channels: b.channels || [],
    intakeQuestions: b.intake_questions || [],
    serviceLabel: (c) => of(b.service_types, c),
    statusLabel: (c) => of(b.statuses, c),
    channelLabel: (c) => of(b.channels, c),
  };
}
