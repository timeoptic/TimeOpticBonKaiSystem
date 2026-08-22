/** Corner notifications. `useToast()` gives you { ok, err }. */
import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext({ ok: () => {}, err: () => {} });

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const push = useCallback((message, kind) => {
    const id = ++seq.current;
    setItems((cur) => [...cur, { id, message, kind }]);
    setTimeout(() => {
      setItems((cur) => cur.filter((t) => t.id !== id));
    }, kind === 'err' ? 5200 : 2800);
  }, []);

  const value = {
    ok: useCallback((m) => push(m, 'ok'), [push]),
    err: useCallback(
      (e) => push(typeof e === 'string' ? e : e?.message || 'เกิดข้อผิดพลาด', 'err'),
      [push]
    ),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
