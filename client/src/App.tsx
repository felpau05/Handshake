// Top-level app. Wires the socket, then renders the right view for the current
// server phase. State always comes from the server (the store mirrors it), so
// both laptops render the same thing.
import { useState } from 'react';
import { useSocket, leaveMatch } from './hooks/useSocket.js';
import { useGameStore } from './state/gameStore.js';
import { Lobby } from './components/Lobby.js';
import { StakeSetup } from './components/StakeSetup.js';
import { PromptReveal } from './components/PromptReveal.js';
import { SpellArena } from './components/SpellArena.js';
import { ResultView } from './components/ResultView.js';
import { VoicePlayer } from './components/VoicePlayer.js';
import { Leaderboard } from './components/Leaderboard.js';

export default function App() {
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0);

  useSocket();

  const match = useGameStore((s) => s.match);
  const mySlot = useGameStore((s) => s.mySlot);
  const me = useGameStore((s) => s.me());
  const opponent = useGameStore((s) => s.opponent());
  const phase = match?.phase ?? 'LOBBY';
  const iWon = match?.matchWinner === mySlot;

  return (
    <div className="app">
      <h1 className="title">
        ASL <span>Word Battle</span>
      </h1>

      {phase === 'LOBBY' && (
        <div className="grid-2">
          <Lobby />
          <Leaderboard refresh={leaderboardRefresh} />
        </div>
      )}

      {/* Rendered once, outside the per-phase branches below: mounting a fresh
          VoicePlayer inside every phase's own block destroyed its <audio>
          element (and the "already played" tracking) on every single phase
          transition, cutting narration off mid-sentence and replaying stale
          lines. One persistent instance across STAKE→MATCH_END fixes both. */}
      {phase !== 'LOBBY' && <VoicePlayer />}

      {phase === 'STAKE' && <StakeSetup />}

      {phase === 'PROMPT' && <PromptReveal />}

      {phase === 'SPELL' && <SpellArena />}

      {phase === 'RESOLVE' && <ResultView />}

      {phase === 'MATCH_END' && (
        <>
          <div className="grid-2">
            <div className="panel" style={{ textAlign: 'center' }}>
              <h3>{iWon ? '🏆 You won the match!' : 'Match over'}</h3>
              <p className="muted">
                {iWon
                  ? `You beat ${opponent?.displayName ?? 'your opponent'}!`
                  : `${me?.displayName ?? 'You'} lost to ${opponent?.displayName ?? 'your opponent'} — better luck next time.`}
              </p>
            </div>
            <Leaderboard refresh={leaderboardRefresh} />
          </div>
          {/* Post-game lingers as long as they want; this is the way back. */}
          <button
            className="primary"
            style={{ marginTop: '1rem' }}
            onClick={() => {
              setLeaderboardRefresh((n) => n + 1);
              leaveMatch();
            }}
          >
            ← Back to lobby
          </button>
        </>
      )}
    </div>
  );
}
