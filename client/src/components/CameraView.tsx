// Camera + hand-tracking panel. Shows the webcam with the debug landmark overlay
// and the currently-detected move. During CAPTURE it auto-commits the tracked
// move on "Go", and always offers the keyboard/button fallback (1/2/3) that
// emits the SAME gesture event — so a flaky camera never blocks play.
import { useEffect } from 'react';
import type { Move } from '@app/shared';
import { useCamera } from '../hooks/useCamera.js';
import { useHandTracking } from '../hooks/useHandTracking.js';
import { selectGesture } from '../hooks/useSocket.js';
import { GestureOverlay } from './GestureOverlay.js';

interface Props {
  /** True during the CAPTURE phase — enables tracking + gesture submission. */
  capturing: boolean;
}

const KEY_TO_MOVE: Record<string, Move> = { '1': 'rock', '2': 'paper', '3': 'scissors' };

export function CameraView({ capturing }: Props) {
  const { videoRef, status, start } = useCamera();
  const tracking = useHandTracking(videoRef, capturing && status === 'ready');

  // Keyboard fallback: 1/2/3 → same gesture event as the camera.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      const move = KEY_TO_MOVE[e.key];
      if (move) selectGesture(move, 'keyboard', 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capturing]);

  const submitTracked = () => {
    if (tracking.move) selectGesture(tracking.move, 'camera', tracking.confidence);
  };

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Your camera</h3>
        <span className="muted">{cameraLabel(status, tracking.ready)}</span>
      </div>

      <div className="camera-wrap">
        <video ref={videoRef} playsInline muted />
        <GestureOverlay landmarks={tracking.landmarks} move={tracking.move} />
      </div>

      {status !== 'ready' && (
        <button className="primary" style={{ marginTop: '0.75rem' }} onClick={start}>
          Enable camera
        </button>
      )}
      {status === 'denied' && (
        <p className="muted">
          Camera blocked. Use HTTPS/localhost (see README) — or just use the buttons/keys below.
        </p>
      )}
      {tracking.loadError && (
        <p className="muted">Hand tracking unavailable ({tracking.loadError}). Use buttons/keys.</p>
      )}

      <div className="gesture-buttons">
        <button onClick={() => selectGesture('rock', 'keyboard')} disabled={!capturing}>
          🪨 Rock <span className="muted">(1)</span>
        </button>
        <button onClick={() => selectGesture('paper', 'keyboard')} disabled={!capturing}>
          📄 Paper <span className="muted">(2)</span>
        </button>
        <button onClick={() => selectGesture('scissors', 'keyboard')} disabled={!capturing}>
          ✂️ Scissors <span className="muted">(3)</span>
        </button>
      </div>

      {capturing && tracking.move && (
        <button className="primary" style={{ marginTop: '0.5rem', width: '100%' }} onClick={submitTracked}>
          Lock in tracked move: {tracking.move}
        </button>
      )}
    </div>
  );
}

function cameraLabel(status: string, trackingReady: boolean): string {
  if (status !== 'ready') return status;
  return trackingReady ? 'tracking ✓' : 'loading tracker…';
}
