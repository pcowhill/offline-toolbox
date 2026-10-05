import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@shared/styles/base.css';
import { ErrorBoundary } from '@shared/react/ErrorBoundary';
import { App } from './App';
import { initStore } from './state/store';
import './styles.css';

void initStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
