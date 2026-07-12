// Required login gate — rendered instead of the game until a session exists
// (see main.tsx). Register captures a Solana devnet payout address up front
// (editable later); login is just email + password.
import { useState } from 'react';
import { useAuthStore } from '../state/authStore.js';
import { WalletBalance } from './WalletBalance.js';

export function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, displayName, walletAddress);
      }
    } catch {
      // error is already surfaced via the store
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app" style={{ maxWidth: '420px' }}>
      <h1 className="title">
        Gamemaster <span>RPS</span>
      </h1>
      <div className="panel">
        <h3>{mode === 'login' ? 'Log in' : 'Create an account'}</h3>
        <p className="muted">You need an account to play — it's how your wins and Solana payouts follow you between matches.</p>

        <form onSubmit={handleSubmit}>
          <div className="row" style={{ marginBottom: '0.5rem' }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>
          <div className="row" style={{ marginBottom: '0.5rem' }}>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={{ width: '100%' }}
            />
          </div>

          {mode === 'register' && (
            <>
              <div className="row" style={{ marginBottom: '0.5rem' }}>
                <input
                  placeholder="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  style={{ width: '100%' }}
                />
              </div>
              <div className="row" style={{ marginBottom: '0.5rem' }}>
                <input
                  placeholder="Solana devnet wallet address (optional, can add later)"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </>
          )}

          {error && <p className="delta-lose">{error}</p>}

          <button type="submit" className="primary" disabled={submitting} style={{ width: '100%', marginTop: '0.5rem' }}>
            {submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="muted" style={{ marginTop: '0.75rem' }}>
          {mode === 'login' ? (
            <>
              No account yet?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); }}>
                Create one
              </a>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); }}>
                Log in
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** Small always-visible bar once logged in: name, wallet (editable), logout. */
export function AccountBar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateWallet = useAuthStore((s) => s.updateWallet);
  const error = useAuthStore((s) => s.error);
  const [editingWallet, setEditingWallet] = useState(false);
  const [walletInput, setWalletInput] = useState(user?.walletAddress ?? '');
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  async function saveWallet() {
    setSaving(true);
    try {
      await updateWallet(walletInput.trim());
      setEditingWallet(false);
    } catch {
      // error surfaced via store
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <strong>{user.displayName}</strong> <span className="muted">({user.email})</span>
        <div className="muted" style={{ marginTop: '0.25rem' }}>
          {editingWallet ? (
            <span className="row" style={{ gap: '0.5rem' }}>
              <input
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
                placeholder="Solana devnet wallet address"
                style={{ minWidth: '260px' }}
              />
              <button onClick={saveWallet} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditingWallet(false)}>Cancel</button>
            </span>
          ) : (
            <>
              Wallet: {user.walletAddress ?? 'not set'}{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setEditingWallet(true); }}>
                edit
              </a>
              {user.walletAddress && (
                <>
                  {' · '}
                  <WalletBalance />
                </>
              )}
            </>
          )}
        </div>
        {error && <p className="delta-lose">{error}</p>}
      </div>
      <button onClick={() => logout()}>Log out</button>
    </div>
  );
}
