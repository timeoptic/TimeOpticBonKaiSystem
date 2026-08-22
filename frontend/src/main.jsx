import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { MetaProvider } from './api/meta.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { ConfirmProvider } from './components/Confirm.jsx';
import './styles/app.css';

/* HashRouter keeps the #/customers/5 URLs the shop already has bookmarked, and
   means Apache needs no SPA rewrite rule to serve the built app. */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <ConfirmProvider>
          <MetaProvider>
            <App />
          </MetaProvider>
        </ConfirmProvider>
      </ToastProvider>
    </HashRouter>
  </StrictMode>
);
