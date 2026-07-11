// Leaderboard panel. Fetches GET /api/leaderboard on mount + whenever `refresh`
// changes (e.g. after a match ends). Shows the AI-generated avatar per player.
import { useEffect } from 'react';
import type { LeaderboardEntry } from '@app/shared';
import { useGameStore } from '../state/gameStore.js';

interface Props {
  refresh?: number;
}

export function Leaderboard({ refresh = 0 }: Props) {
  const entries = useGameStore((s) => s.leaderboard);
  const setLeaderboard = useGameStore((s) => s.setLeaderboard);

  useEffect(() => {
    fetch('/api/leaderboard?limit=10')
      .then((r) => r.json())
      .then((d: { players: LeaderboardEntry[] }) => setLeaderboard(d.players ?? []))
      .catch(() => undefined);
  }, [refresh, setLeaderboard]);

  return (
    <div className="panel">
      <h3>🏆 Leaderboard</h3>
      {entries.length === 0 && <p className="muted">No games played yet.</p>}
      {entries.map((e, i) => (
        <div key={e.playerId} className="leaderboard-row">
          <span className="muted" style={{ width: 20 }}>{i + 1}</span>
          {e.avatarUrl ? (
            <img src={e.avatarUrl} alt={e.displayName} />
          ) : (
            <div className="leaderboard-row" style={{ width: 42, height: 42, borderRadius: 10, background: '#23273f' }} />
          )}
          <div style={{ flex: 1 }}>
            <strong>{e.displayName}</strong>
            <div className="muted">
              {e.wins}W · {e.losses}L
            </div>
          </div>
          <span className="coins">{e.totalCoins}</span>
        </div>
      ))}
    </div>
  );
}
