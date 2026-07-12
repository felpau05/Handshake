// Top-level auth gate: checks the session once on mount, then renders either
// the required login screen or the game + its always-on account bar. Kept separate from App.tsx so the LOBBY→SHOP→PLAY flow itself never
// has to know about auth.
import { useEffect } from 'react';
import App from './App.js';
import { AccountBar, Login } from './components/Login.js';
import { useAuthStore } from './state/authStore.js';
import { useMediaWarmup } from './hooks/useMediaWarmup.js';

export function Root() {
  const status = useAuthStore((s) => s.status);
  const checkSession = useAuthStore((s) => s.checkSession);

  // Starts the camera + loads the ASL model the moment the page loads,
  // regardless of login state — by the time a match actually reaches SPELL,
  // both are already warm instead of adding a fresh startup delay each round.
  useMediaWarmup();

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
    </>
  );
}
