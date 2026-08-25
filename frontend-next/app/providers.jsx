'use client';
import { ToastProvider } from '../components/Toast.jsx';
import { ConfirmProvider } from '../components/Confirm.jsx';
import { MetaProvider } from '../contexts/MetaContext.jsx';
import { Shell } from '../components/Shell.jsx';

export function Providers({ children }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <MetaProvider>
          <Shell>{children}</Shell>
        </MetaProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
