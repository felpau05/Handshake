// Small, reusable "your SOL balance" readout — used in the always-visible
// AccountBar and again on the entry-fee screen, where seeing you actually
// have enough SOL matters most.
import { useAuthStore } from '../state/authStore.js';

export function WalletBalance() {
  const user = useAuthStore((s) => s.user);
  const balance = useAuthStore((s) => s.walletBalanceSol);
  const loading = useAuthStore((s) => s.balanceLoading);

  if (!user?.walletAddress) {
    return <span className="muted">No wallet on file</span>;
  }
  if (loading && balance === null) {
    return <span className="muted">Balance: loading…</span>;
  }
  if (balance === null) {
    return <span className="muted">Balance unavailable</span>;
  }
  return (
    <span className="muted">
      Balance: <strong style={{ color: 'var(--text)' }}>{balance.toFixed(4)} SOL</strong>
    </span>
  );
}
