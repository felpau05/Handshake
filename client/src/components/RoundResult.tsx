// Shows the latest resolved round: both moves, the winner, and each player's
// coin delta. Reads from the store's lastResult, scoped to the viewer's slot.
import { useGameStore } from '../state/gameStore.js';

export function RoundResult() {
  const result = useGameStore((s) => s.lastResult);
  const mySlot = useGameStore((s) => s.mySlot);
  if (!result || !mySlot) return null;

  const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
  const iWon = result.winner === mySlot;
  const tie = result.winner === null;
  const myDelta = result.coinsDelta[mySlot];

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Round {result.round}</h3>
        {result.twist && <span className="phase-pill">{result.twist}</span>}
      </div>
      <div className="grid-2">
        <div>
          <div className="muted">You played</div>
          <div style={{ fontSize: '1.4rem', textTransform: 'capitalize' }}>
            {result.moves[mySlot] ?? '—'}
          </div>
        </div>
        <div>
          <div className="muted">Opponent played</div>
          <div style={{ fontSize: '1.4rem', textTransform: 'capitalize' }}>
            {result.moves[oppSlot] ?? '—'}
          </div>
        </div>
      </div>
      <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>
        {tie ? "It's a tie!" : iWon ? 'You won the round! 🎉' : 'You lost the round.'}{' '}
        <span className={myDelta >= 0 ? 'delta-win' : 'delta-lose'}>
          {myDelta >= 0 ? '+' : ''}
          {myDelta} coins
        </span>
      </p>
    </div>
  );
}
