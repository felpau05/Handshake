import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { ElevenLabsTest } from './components/ElevenLabsTest.js';
import './styles.css';

// Dev-only escape hatch to the isolated ElevenLabs test panel — visiting
// /?test=elevenlabs renders it instead of the game, so the normal
// LOBBY→SHOP→PLAY flow (App.tsx) is never touched by this test feature.
const isTestPanel = new URLSearchParams(window.location.search).get('test') === 'elevenlabs';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTestPanel ? <ElevenLabsTest /> : <App />}
  </React.StrictMode>,
);
