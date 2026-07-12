// Client-side auth session. The actual session lives in an httpOnly cookie the
// server manages — this store just mirrors the logged-in user's public profile
// (never a token) so components can render around it.
import { create } from 'zustand';
import { socket } from '../lib/socket.js';

// The server reads the session cookie from the socket.io HANDSHAKE, not per
// event — a socket opened before login stays anonymous even after the cookie
// is set. Any auth change must force a fresh handshake, or the user hits
// "Log in before starting a match" until they hard-refresh the page.
function reconnectSocket(): void {
  socket.disconnect();
  socket.connect();
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  walletAddress: string | null;
}

interface AuthStore {
  user: AuthUser | null;
  status: 'checking' | 'authenticated' | 'anonymous';
  error: string | null;
  /** null = no wallet on file or not fetched yet; undefined never used, just absent-until-first-fetch. */
  walletBalanceSol: number | null;
  balanceLoading: boolean;
  checkSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, walletAddress: string) => Promise<void>;
  logout: () => Promise<void>;
  updateWallet: (walletAddress: string) => Promise<void>;
  fetchBalance: () => Promise<void>;
}

async function parseJsonOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  status: 'checking',
  error: null,
  walletBalanceSol: null,
  balanceLoading: false,

  checkSession: async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) return set({ user: null, status: 'anonymous' });
      const data = await res.json();
      set({ user: data.user, status: 'authenticated' });
      void get().fetchBalance();
    } catch {
      set({ user: null, status: 'anonymous' });
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await parseJsonOrThrow(res);
      set({ user: data.user, status: 'authenticated' });
      reconnectSocket();
      void get().fetchBalance();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Login failed.' });
      throw err;
    }
  },

  register: async (email, password, displayName, walletAddress) => {
    set({ error: null });
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName, walletAddress: walletAddress || undefined }),
      });
      const data = await parseJsonOrThrow(res);
      set({ user: data.user, status: 'authenticated' });
      reconnectSocket();
      void get().fetchBalance();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Registration failed.' });
      throw err;
    }
  },

  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    set({ user: null, status: 'anonymous', walletBalanceSol: null });
    reconnectSocket();
  },

  fetchBalance: async () => {
    set({ balanceLoading: true });
    try {
      const res = await fetch('/api/auth/wallet/balance', { credentials: 'include' });
      if (!res.ok) return set({ walletBalanceSol: null, balanceLoading: false });
      const data = await res.json();
      set({ walletBalanceSol: data.balanceSol ?? null, balanceLoading: false });
    } catch {
      set({ walletBalanceSol: null, balanceLoading: false });
    }
  },

  updateWallet: async (walletAddress) => {
    set({ error: null });
    try {
      const res = await fetch('/api/auth/wallet', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: walletAddress || null }),
      });
      const data = await parseJsonOrThrow(res);
      set({ user: data.user });
      void get().fetchBalance();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update wallet.' });
      throw err;
    }
  },
}));
