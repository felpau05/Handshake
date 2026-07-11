// Top-level auth gate: checks the session once on mount, then renders either
// the required login screen or the game + its always-on account bar / dev
// tools. Kept separate from App.tsx so the LOBBY→SHOP→PLAY flow itself never
// has to know about auth.
import { useEffect } from 'react';
import App from './App.js';
import { AccountBar, Login } from './components/Login.js';
import { DevToolsToggle } from './components/DevToolsToggle.js';
import { useAuthStore } from './state/authStore.js';

export function Root() {
  const status = useAuthStore((s) => s.status);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  if (status === 'checking') {
    return (
      <div className="app">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Login />;
  }

  return (
    <>
      <div className="app" style={{ paddingBottom: 0 }}>
        <AccountBar />
      </div>
      <App />
      <DevToolsToggle />
    </>
  );
}
