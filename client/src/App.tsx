// Top-level app. Wires the socket, then renders the right view for the current
// server phase. State always comes from the server (the store mirrors it), so
// both laptops render the same thing.
import { useCallback, useState } from 'react';
import type { CaptureWinnerPhotoPayload } from '@app/shared';
import { useSocket, leaveMatch } from './hooks/useSocket.js';
import { useGameStore } from './state/gameStore.js';
import { Lobby } from './components/Lobby.js';
import { StakeSetup } from './components/StakeSetup.js';
import { PromptReveal } from './components/PromptReveal.js';
import { SpellArena } from './components/SpellArena.js';
import { ResultView } from './components/ResultView.js';
import { VoicePlayer } from './components/VoicePlayer.js';
import { Leaderboard } from './components/Leaderboard.js';
import { WinnerPhotoCapture } from './components/WinnerPhotoCapture.js';

export default function App() {
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0);
  const [amWinner, setAmWinner] = useState(false);

  const playerId = useGameStore((s) => s.playerId);
  const onWinnerPhoto = useCallback(
    (p: CaptureWinnerPhotoPayload) => setAmWinner(p.playerId === playerId),
    [playerId],
  );
  useSocket(onWinnerPhoto);

  const match = useGameStore((s) => s.match);
  const phase = match?.phase ?? 'LOBBY';

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

      {phase === 'STAKE' && (
        <div className="grid-2">
          <StakeSetup />
          <VoicePlayer />
        </div>
      )}

      {phase === 'PROMPT' && (
        <>
          <VoicePlayer />
          <PromptReveal />
        </>
      )}

      {phase === 'SPELL' && (
        <>
          <VoicePlayer />
          <SpellArena />
        </>
      )}

      {phase === 'RESOLVE' && (
        <>
          <VoicePlayer />
          <ResultView />
        </>
      )}

      {phase === 'MATCH_END' && (
        <>
          <VoicePlayer />
          <div className="grid-2">
            <WinnerPhotoCapture
              isWinner={amWinner}
              onProcessed={() => setLeaderboardRefresh((n) => n + 1)}
            />
            <Leaderboard refresh={leaderboardRefresh} />
          </div>
          {/* Post-game lingers as long as they want; this is the way back. */}
          <button
            className="primary"
            style={{ marginTop: '1rem' }}
            onClick={() => {
              setAmWinner(false);
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
