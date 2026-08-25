'use client';
/**
 * Modal confirmation. `useConfirm()` returns an async function so calling code
 * reads the same as the old promise-based dialog:
 *
 *   if (!await confirm('ลบลูกค้า', '…', { danger: true })) return;
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ConfirmContext = createContext(async () => false);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((title, message, opts = {}) => new Promise((resolve) => {
    resolver.current = resolve;
    setDialog({ title, message, confirmText: opts.confirmText || 'ยืนยัน', danger: !!opts.danger });
  }), []);

  const close = useCallback((value) => {
    setDialog(null);
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div className="modal">
            <h3>{dialog.title}</h3>
            <div className="m-body"><p style={{ margin: 0 }}>{dialog.message}</p></div>
            <div className="m-foot">
              <button type="button" className="btn btn-light" onClick={() => close(false)}>ยกเลิก</button>
              <button
                type="button"
                className={`btn ${dialog.danger ? 'btn-danger' : 'btn-accent'}`}
                onClick={() => close(true)}
                autoFocus
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
