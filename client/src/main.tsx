import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { DevToolsToggle } from './components/DevToolsToggle.js';
import './styles.css';

// DevToolsToggle renders a floating button + overlay on top of the game,
// always visible, no room/join required. It's a sibling of App, not part of
// it, so the LOBBY→SHOP→PLAY flow (App.tsx) is never touched by this.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <DevToolsToggle />
  </React.StrictMode>,
);
