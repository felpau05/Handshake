// MATCH_END: if this client is the winner, capture a webcam frame, POST it to
// /api/photo (server turns it into a themed AI portrait + records the win), and
// show the resulting avatar. Non-winners just see the outcome.
import { useEffect, useRef, useState } from 'react';
import { useCamera } from '../hooks/useCamera.js';
import { useGameStore } from '../state/gameStore.js';

interface Props {
  isWinner: boolean;
  /** Called after the avatar is generated so the leaderboard can refresh. */
  onProcessed?: () => void;
}

export function WinnerPhotoCapture({ isWinner, onProcessed }: Props) {
  const { videoRef, status, start } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const me = useGameStore((s) => s.me());

  useEffect(() => {
    if (isWinner) void start();
  }, [isWinner, start]);

  const capture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !me) return;
    setBusy(true);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL('image/jpeg', 0.85);

    try {
      const res = await fetch('/api/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: me.playerId,
          displayName: me.displayName,
          photo,
          // Coins/win-loss are already settled server-side at MATCH_END; this
          // request only attaches the AI portrait as the avatar.
        }),
      });
      const data: { avatarUrl: string } = await res.json();
      setAvatarUrl(data.avatarUrl);
      onProcessed?.();
    } catch {
      /* leave avatar unset; leaderboard still updates server-side on retry */
    } finally {
      setBusy(false);
    }
  };

  if (!isWinner) {
    return (
      <div className="panel">
        <h3>Match over</h3>
        <p className="muted">Better luck next time — the winner is getting their portrait made!</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>🏆 You won the match!</h3>
      {!avatarUrl ? (
        <>
          <div className="camera-wrap">
            <video ref={videoRef} playsInline muted />
          </div>
          <canvas ref={canvasRef} width={512} height={512} hidden />
          <button
            className="primary"
            style={{ width: '100%', marginTop: '0.75rem' }}
            onClick={capture}
            disabled={status !== 'ready' || busy}
          >
            {busy ? 'Creating your trophy portrait…' : 'Capture winner photo'}
          </button>
        </>
      ) : (
        <>
          <p className="muted">Your trophy portrait — now your leaderboard avatar:</p>
          <img src={avatarUrl} alt="Winner portrait" style={{ width: '100%', borderRadius: 12 }} />
        </>
      )}
    </div>
  );
}
