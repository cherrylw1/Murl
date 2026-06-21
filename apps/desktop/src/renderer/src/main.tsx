import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

import '@fontsource/dotgothic16';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
