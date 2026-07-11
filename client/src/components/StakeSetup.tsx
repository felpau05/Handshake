// STAKE phase: set the flat wager before the match (replaces the old powerup
// shop). Either player can pick; readying locks it in and starts the first
// prompt. Winner gains the stake, loser loses it — settled on Solana at the end.
import { useState } from 'react';
import { STAKE_OPTIONS } from '@app/shared';
import { setStake } from '../hooks/useSocket.js';
import { useGameStore } from '../state/gameStore.js';

export function StakeSetup() {
  const currentStake = useGameStore((s) => s.match?.stake ?? STAKE_OPTIONS[1]);
  const me = useGameStore((s) => s.me());
  const opponent = useGameStore((s) => s.opponent());
  const [choice, setChoice] = useState<number>(currentStake);
  const [locked, setLocked] = useState(false);

  const confirm = () => {
    setStake(choice);
    setLocked(true);
  };

  return (
    <div className="panel">
      <h3>Set the stake</h3>
      <p className="muted">Winner gains this many coins; loser loses them.</p>
      <div className="gesture-buttons">
        {STAKE_OPTIONS.map((s) => (
          <button
            key={s}
            className={choice === s ? 'primary' : ''}
            onClick={() => !locked && setChoice(s)}
            disabled={locked}
          >
            {s} coins
          </button>
        ))}
      </div>
      <button className="primary" style={{ width: '100%', marginTop: '0.75rem' }} onClick={confirm} disabled={locked}>
        {locked ? 'Locked in — waiting for opponent…' : `Wager ${choice} & ready up`}
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
