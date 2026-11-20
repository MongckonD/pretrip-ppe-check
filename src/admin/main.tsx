import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '../components/Toast';
import '../index.css';
import AdminApp from './AdminApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AdminApp />
    </ToastProvider>
  </StrictMode>,
);
