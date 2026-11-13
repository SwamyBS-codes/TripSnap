import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
