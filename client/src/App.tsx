// Top-level app. Wires the socket, then renders the right view for the current
// server phase. State always comes from the server (the store just mirrors it),
// so both laptops render the same thing.
import { useCallback, useState } from 'react';
import type { CaptureWinnerPhotoPayload } from '@app/shared';
import { useSocket } from './hooks/useSocket.js';
import { useGameStore } from './state/gameStore.js';
import { Lobby } from './components/Lobby.js';
import { PowerupShop } from './components/PowerupShop.js';
import { CameraView } from './components/CameraView.js';
import { CaptureCountdown } from './components/CaptureCountdown.js';
import { RoundResult } from './components/RoundResult.js';
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
  const capturing = phase === 'CAPTURE';
  const inPlay = phase === 'ROUND_INTRO' || phase === 'CAPTURE' || phase === 'RESOLVE';

  return (
    <div className="app">
      <h1 className="title">
        Gamemaster <span>RPS</span>
      </h1>

      {phase === 'LOBBY' && (
        <div className="grid-2">
          <Lobby />
          <Leaderboard refresh={leaderboardRefresh} />
        </div>
      )}

      {phase === 'SHOP' && (
        <div className="grid-2">
          <PowerupShop />
          <VoicePlayer />
        </div>
      )}

      {inPlay && (
        <>
          <VoicePlayer />
          {capturing && <CaptureCountdown deadline={match?.phaseDeadline ?? null} />}
          <div className="grid-2">
            <CameraView capturing={capturing} />
            <div>
              <ScoreBar />
              <RoundResult />
            </div>
          </div>
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
        </>
      )}
    </div>
  );
}

function ScoreBar() {
  const me = useGameStore((s) => s.me());
  const opp = useGameStore((s) => s.opponent());
  const match = useGameStore((s) => s.match);
  if (!me || !match) return null;
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="phase-pill">Round {match.round} · Best of {match.bestOf}</span>
        {match.activeTwist && <span className="phase-pill">⚡ {match.activeTwist}</span>}
      </div>
      <div className="grid-2" style={{ marginTop: '0.5rem' }}>
        <div>
          <div className="muted">{me.displayName} (you)</div>
          <div className="coins">{me.coins} coins</div>
          <div className="muted">{me.roundWins} round wins</div>
        </div>
        <div>
          <div className="muted">{opp?.displayName ?? 'Opponent'}</div>
          <div className="coins">{opp?.coins ?? 0} coins</div>
          <div className="muted">{opp?.roundWins ?? 0} round wins</div>
        </div>
      </div>
    </div>
  );
}
