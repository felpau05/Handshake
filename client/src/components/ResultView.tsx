// RESOLVE view: shows both submitted words, whether each was valid, and who won
// the round (or that it's a tie heading to sudden death).
import { useGameStore } from '../state/gameStore.js';

export function ResultView() {
  const result = useGameStore((s) => s.lastResult);
  const mySlot = useGameStore((s) => s.mySlot);
  if (!result || !mySlot) return null;

  const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
  const mine = result.words[mySlot];
  const theirs = result.words[oppSlot];
  const iWon = result.winner === mySlot;
  const tie = result.winner === null;

  return (
    <div className="panel">
      <h3>{tie ? "Tie — sudden death!" : iWon ? 'You win the round! 🎉' : 'You lost the round.'}</h3>
      <div className="grid-2">
        <WordCard label="You" outcome={mine} />
        <WordCard label="Opponent" outcome={theirs} />
      </div>
    </div>
  );
}

function WordCard({ label, outcome }: { label: string; outcome: { word: string; valid: boolean; length: number } }) {
  return (
    <div>
      <div className="muted">{label}</div>
      <div style={{ fontSize: '1.4rem' }}>{outcome.word || '—'}</div>
      <div className={outcome.valid ? 'delta-win' : 'delta-lose'}>
        {outcome.word ? (outcome.valid ? `valid · ${outcome.length} letters` : 'invalid / unrelated') : 'no word'}
      </div>
    </div>
  );
}
