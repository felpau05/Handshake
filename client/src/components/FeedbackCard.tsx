// MATCH_END signing coach panel — shows THIS player's personal feedback on
// their final-round word: what Gemini thinks they were going for, which
// letters missed (highlighted in the spelled word), and per-letter handshape
// tips paired with the actual hand photo captured the moment that letter
// committed (photos live in the local store — they never round-trip through
// the server). Renders a "reviewing…" placeholder until the SPELL_FEEDBACK
// broadcast lands, and a message-only card for nonsense words.
import { useGameStore } from '../state/gameStore.js';

export function FeedbackCard() {
  const feedback = useGameStore((s) => s.feedback);
  const playerId = useGameStore((s) => s.playerId);
  const myCaptures = useGameStore((s) => s.myCaptures);

  if (!feedback) {
    return (
      <div className="panel" style={{ textAlign: 'center' }}>
        <h3>🧑‍🏫 Signing coach</h3>
        <p className="muted">Reviewing your fingerspelling — feedback in a few seconds…</p>
      </div>
    );
  }

  const mine = feedback.players.find((p) => p.playerId === playerId);
  if (!mine) return null;

  const missed = new Set(mine.misspelledIndices);

  return (
    <div className="panel">
      <h3>🧑‍🏫 Signing coach</h3>
      <p>{mine.message}</p>

      {mine.word && !mine.nonsense && (
        <div className="row" style={{ gap: '2rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.75rem' }}>you spelled</div>
            <div style={{ fontSize: '1.6rem', letterSpacing: '0.15em' }}>
              {mine.word.split('').map((ch, i) => (
                <span key={i} className={missed.has(i) ? 'delta-lose' : undefined}>{ch}</span>
              ))}
            </div>
          </div>
          {mine.intendedWord && mine.intendedWord !== mine.word.toUpperCase() && (
            <div>
              <div className="muted" style={{ fontSize: '0.75rem' }}>you were going for</div>
              <div className="delta-win" style={{ fontSize: '1.6rem', letterSpacing: '0.15em' }}>
                {mine.intendedWord}
              </div>
            </div>
          )}
        </div>
      )}

      {mine.tips.length > 0 && (
        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.6rem' }}>
          {mine.tips.map((t) => {
            const capture = myCaptures[t.index];
            return (
              <div key={t.index} className="row" style={{ gap: '0.75rem', alignItems: 'flex-start' }}>
                {capture?.image ? (
                  <img
                    src={capture.image}
                    alt={`your ${t.letter} sign`}
                    style={{ width: 84, borderRadius: 8, flexShrink: 0 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 84,
                      height: 63,
                      borderRadius: 8,
                      background: '#23273f',
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                    className="muted"
                  >
                    ⌨️
                  </div>
                )}
                <div>
                  <strong>Letter {t.letter}</strong>
                  {capture?.confidence !== null && capture?.confidence !== undefined && (
                    <span className="muted"> · read at {(capture.confidence * 100).toFixed(0)}%</span>
                  )}
                  <div className="muted">{t.tip}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
