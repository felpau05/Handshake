// Entry screen: create a match (get a room code) or join one by code. Once two
// players are in, each readies up to start the match.
import { useState } from 'react';
import { createMatch, joinMatch, setReady } from '../hooks/useSocket.js';
import { useGameStore } from '../state/gameStore.js';
import { useAuthStore } from '../state/authStore.js';

export function Lobby() {
  const [code, setCode] = useState('');
  const match = useGameStore((s) => s.match);
  const roomCode = useGameStore((s) => s.roomCode);
  const me = useGameStore((s) => s.me());
  const opponent = useGameStore((s) => s.opponent());
  const error = useGameStore((s) => s.error);
  // You're signed in, so the match uses your account's username automatically.
  const username = useAuthStore((s) => s.user?.displayName ?? 'Player');

  // Pre-join: choose create or join.
  if (!roomCode) {
    return (
      <div className="panel">
        <h3>Play a match</h3>
        <p className="muted">
          Playing as <strong>{username}</strong>
        </p>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button className="primary" onClick={() => createMatch(username)}>
            Create match
          </button>
          <span className="muted">or</span>
          <input
            placeholder="Room code"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button disabled={code.length < 4} onClick={() => joinMatch(code, username)}>
            Join
          </button>
        </div>
        {error && <p className="delta-lose">{error}</p>}
      </div>
    );
  }

  // In lobby: show room code + ready-up.
  return (
    <div className="panel">
      <h3>Lobby</h3>
      <p>
        Share this room code with the other laptop: <span className="roomcode">{roomCode}</span>
      </p>
      <div className="grid-2">
        <div>
          <div className="muted">You</div>
          <strong>{me?.displayName ?? '—'}</strong> {me?.ready ? '✓ ready' : ''}
        </div>
        <div>
          <div className="muted">Opponent</div>
          <strong>{opponent?.displayName ?? 'waiting…'}</strong> {opponent?.ready ? '✓ ready' : ''}
        </div>
      </div>
      <button
        className="primary"
        style={{ marginTop: '0.75rem' }}
        disabled={!opponent || me?.ready}
        onClick={() => setReady(true)}
      >
        {me?.ready ? 'Waiting for opponent…' : "I'm ready"}
      </button>
      {!opponent && <p className="muted">Waiting for a second player to join {match?.roomCode}…</p>}
    </div>
  );
}
