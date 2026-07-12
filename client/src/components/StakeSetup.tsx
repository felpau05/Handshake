// STAKE phase: confirm the fixed entry fee before the match. The amount is
// NOT player-chosen — it's a flat SOL wager set server-side (env
// SOLANA_BET_SOL). Winner gains it, loser loses it — settled for real on
// Solana devnet at match end.
import { useState } from 'react';
import { setStake } from '../hooks/useSocket.js';
import { useGameStore } from '../state/gameStore.js';
import { WalletBalance } from './WalletBalance.js';

export function StakeSetup() {
  const stake = useGameStore((s) => s.match?.stake ?? 0);
  const me = useGameStore((s) => s.me());
  const opponent = useGameStore((s) => s.opponent());
  const [locked, setLocked] = useState(false);

  const confirm = () => {
    setStake(stake);
    setLocked(true);
  };

  return (
    <div className="panel">
      <h3>Entry fee</h3>
      <p className="muted">Winner takes the pot; loser's entry fee goes to them. Settled for real on Solana devnet.</p>
      <div className="countdown" style={{ color: 'var(--accent)', textAlign: 'center', margin: '0.5rem 0' }}>
        {stake} SOL
      </div>
      <WalletBalance />
      <button className="primary" style={{ width: '100%', marginTop: '0.75rem' }} onClick={confirm} disabled={locked}>
        {locked ? 'Locked in — waiting for opponent…' : `Confirm entry (${stake} SOL) & ready up`}
      </button>
      <div className="grid-2" style={{ marginTop: '0.5rem' }}>
        <div>
          <div className="muted">You</div>
          <strong>{me?.displayName ?? '—'}</strong> {me?.ready ? '✓' : ''}
        </div>
        <div>
          <div className="muted">Opponent</div>
          <strong>{opponent?.displayName ?? 'waiting…'}</strong> {opponent?.ready ? '✓' : ''}
        </div>
      </div>
    </div>
  );
}
