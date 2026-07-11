// Entry screen: create a match (get a room code) or join one by code. Once two
// players are in, each readies up to start the match.
import { useState } from 'react';
import { createMatch, joinMatch, setReady } from '../hooks/useSocket.js';
import { useGameStore } from '../state/gameStore.js';

export function Lobby() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const match = useGameStore((s) => s.match);
  const roomCode = useGameStore((s) => s.roomCode);
  const me = useGameStore((s) => s.me());
  const opponent = useGameStore((s) => s.opponent());
  const error = useGameStore((s) => s.error);

  // Pre-join: choose create or join.
  if (!roomCode) {
    return (
      <div className="panel">
        <h3>Join a match</h3>
        <div className="row">
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button className="primary" disabled={!name} onClick={() => createMatch(name)}>
            Create match
          </button>
          <span className="muted">or</span>
          <input
            placeholder="Room code"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button disabled={!name || code.length < 4} onClick={() => joinMatch(code, name)}>
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
