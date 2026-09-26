import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

// Text fields match :focus-visible even after a click. Track the last navigation
// method so pointer interactions do not leave a prominent keyboard focus ring.
document.documentElement.dataset.focusInput = 'pointer';
document.addEventListener('pointerdown', () => {
  document.documentElement.dataset.focusInput = 'pointer';
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    document.documentElement.dataset.focusInput = 'keyboard';
  }
}, true);

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
