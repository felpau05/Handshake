// PROMPT phase: the gamemaster reveals the word. Brief beat before SPELL opens.
import { useGameStore } from '../state/gameStore.js';

export function PromptReveal() {
  const prompt = useGameStore((s) => s.match?.prompt ?? '');
  const suddenDeath = useGameStore((s) => s.match?.suddenDeath ?? false);
  return (
    <div className="panel" style={{ textAlign: 'center' }}>
      {suddenDeath && <div className="phase-pill">⚡ Sudden death</div>}
      <div className="muted" style={{ marginTop: '0.5rem' }}>Your prompt is</div>
      <div className="countdown" style={{ color: 'var(--accent)' }}>{prompt}</div>
      <p className="muted">Get ready to sign the biggest related word…</p>
    </div>
  );
}
