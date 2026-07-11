// SHOP phase UI: spend up to STARTING_TOKENS on powerups before the match. The
// catalog is hard-coded to mirror the server's powerupCatalog.ts — the server
// re-validates every purchase, so this is just the picker. Selecting locks in
// and marks the player shop-ready.
import { useMemo, useState } from 'react';
import type { Powerup } from '@app/shared';
import { purchasePowerups } from '../hooks/useSocket.js';
import { useGameStore } from '../state/gameStore.js';

// Keep in sync with server/src/game/powerupCatalog.ts (server is authoritative).
const CATALOG: Powerup[] = [
  { id: 'shield', name: 'Shield', description: 'Negate your coin loss on one lost round.', cost: 4, oneTimeUse: true },
  { id: 'double_down', name: 'Double Down', description: 'Your next round win pays double coins.', cost: 5, oneTimeUse: true },
  { id: 'tie_breaker', name: 'Tie Breaker', description: 'You win ties for the rest of the match.', cost: 6, oneTimeUse: false },
  { id: 'insight', name: "Gamemaster's Insight", description: 'Hint at a strong move before capture.', cost: 3, oneTimeUse: true },
  { id: 'steal', name: 'Coin Steal', description: 'On your next win, also take 10 coins.', cost: 7, oneTimeUse: true },
  { id: 'second_wind', name: 'Second Wind', description: 'Re-capture once if you miss the deadline.', cost: 2, oneTimeUse: true },
];

const TOKEN_BUDGET = 10;

export function PowerupShop() {
  const [selected, setSelected] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const me = useGameStore((s) => s.me());

  const spent = useMemo(
    () => selected.reduce((sum, id) => sum + (CATALOG.find((p) => p.id === id)?.cost ?? 0), 0),
    [selected],
  );
  const remaining = TOKEN_BUDGET - spent;

  const toggle = (p: Powerup) => {
    if (locked) return;
    setSelected((cur) =>
      cur.includes(p.id)
        ? cur.filter((id) => id !== p.id)
        : spent + p.cost <= TOKEN_BUDGET
          ? [...cur, p.id]
          : cur,
    );
  };

  const confirm = () => {
    purchasePowerups(selected);
    setLocked(true);
  };

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Powerup Shop</h3>
        <span className="coins">{remaining} / {TOKEN_BUDGET} tokens</span>
      </div>

      {CATALOG.map((p) => {
        const owned = selected.includes(p.id);
        const affordable = owned || spent + p.cost <= TOKEN_BUDGET;
        return (
          <div key={p.id} className={`powerup ${owned ? 'owned' : ''}`}>
            <div>
              <strong>{p.name}</strong> <span className="muted">· {p.cost} tokens</span>
              <div className="muted">{p.description}</div>
            </div>
            <button onClick={() => toggle(p)} disabled={locked || (!owned && !affordable)}>
              {owned ? 'Remove' : 'Buy'}
            </button>
          </div>
        );
      })}

      <button className="primary" style={{ width: '100%', marginTop: '0.5rem' }} onClick={confirm} disabled={locked}>
        {locked ? 'Locked in — waiting for opponent…' : 'Confirm & ready up'}
      </button>
      {me && <p className="muted">Playing as {me.displayName}</p>}
    </div>
  );
}
