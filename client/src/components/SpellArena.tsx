// SPELL phase UI. Owns everything the ASL detector does not: word assembly from
// letter events, wave-to-delete (+ Backspace fallback), the countdown, and
// submit. The detector is a black box that emits deduped LetterEvents; this
// component turns them into a word and sends only the final string to the
// server. The camera stream and the detector's model are both warmed once at
// app load (see mediaStore/useMediaWarmup) — this component only attaches to
// what's already ready, so re-mounting between rounds costs nothing.
import { useEffect, useRef, useState } from 'react';
import { HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import type { LetterEvent } from '@app/asl';
import { useMediaStore } from '../state/mediaStore.js';
import { useWaveDelete } from '../hooks/useWaveDelete.js';
import { submitWord, sendSpellProgress } from '../hooks/useSocket.js';
import { useGameStore } from '../state/gameStore.js';

export function SpellArena() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stream = useMediaStore((s) => s.stream);
  const cameraStatus = useMediaStore((s) => s.cameraStatus);
  const retryCamera = useMediaStore((s) => s.retryCamera);
  const detector = useMediaStore((s) => s.detector);
  const detectorReady = useMediaStore((s) => s.detectorReady);

  const [word, setWord] = useState('');
  const [tracking, setTracking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawerRef = useRef<DrawingUtils | null>(null);

  const prompt = useGameStore((s) => s.match?.prompt ?? '');
  const deadline = useGameStore((s) => s.match?.phaseDeadline ?? null);
  const me = useGameStore((s) => s.me());
  const opponent = useGameStore((s) => s.opponent());

  const deleteLast = () => setWord((w) => w.slice(0, -1));

  // Attach the already-warm stream to this mount's own <video> element.
  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  // Point the shared (already-initialized) detector at this mount's video.
  // reset() clears stability state left over from a previous round; stop()
  // on cleanup pauses it (NOT destroy — the model stays loaded for next time).
  useEffect(() => {
    if (!detector || !detectorReady || cameraStatus !== 'ready' || !videoRef.current) return;
    const video = videoRef.current;
    detector.attachVideo(video);
    detector.reset();

    const onLetter = (e: LetterEvent) => setWord((w) => (w.length < 20 ? w + e.letter : w));
    const unsubLetter = detector.on('letter', onLetter);

    let unsubFrame: (() => void) | null = null;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      drawerRef.current = new DrawingUtils(ctx);
      unsubFrame = detector.on('frame', (f) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (f.landmarks) {
          const color = f.confidence >= 0.85 ? '#22c55e' : '#f59e0b';
          const pts = f.landmarks.map((l) => ({ ...l, visibility: 0 }));
          drawerRef.current!.drawConnectors(pts, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 3 });
          drawerRef.current!.drawLandmarks(pts, { color: '#fff', fillColor: color, radius: 3 });
        }
      });
    }

    detector.start();
    setTracking(true);
    return () => {
      unsubLetter();
      unsubFrame?.();
      detector.stop();
      setTracking(false);
    };
  }, [detector, detectorReady, cameraStatus]);

  // Wave-to-delete on the same video.
  useWaveDelete(videoRef, cameraStatus === 'ready', deleteLast);

  // Keyboard: Backspace deletes, letters type (fallback), Enter submits.
  useEffect(() => {
    if (submitted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Backspace') {
        e.preventDefault();
        deleteLast();
      } else if (e.key === 'Enter') {
        doSubmit();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        setWord((w) => (w.length < 20 ? w + e.key.toUpperCase() : w));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  // Report length so the opponent sees progress (word itself stays local).
  useEffect(() => {
    if (!submitted) sendSpellProgress(word.length);
  }, [word, submitted]);

  const doSubmit = () => {
    if (submitted) return;
    setSubmitted(true);
    submitWord(word);
  };

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>
          Prompt: <span style={{ color: 'var(--accent)' }}>{prompt}</span>
        </h3>
        <Countdown deadline={deadline} onExpire={doSubmit} />
      </div>

      <div className="camera-wrap">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        <div className="move-badge">
          {tracking ? 'tracking ✓' : cameraStatus === 'ready' ? 'loading…' : cameraStatus}
        </div>
      </div>

      {cameraStatus !== 'ready' && (
        <button className="primary" style={{ marginTop: '0.75rem' }} onClick={retryCamera}>
          Enable camera
        </button>
      )}

      <div className="word-display">{word || <span className="muted">sign your word…</span>}</div>

      <div className="gesture-buttons">
        <button onClick={deleteLast} disabled={submitted || !word}>⌫ Delete (wave / Backspace)</button>
        <button className="primary" onClick={doSubmit} disabled={submitted}>
          {submitted ? 'Submitted ✓' : 'Submit word'}
        </button>
      </div>

      <p className="muted">
        Hold a letter sign to add it; wave your hand or press Backspace to delete. No autocorrect —
        spell a real word related to <strong>{prompt}</strong>. J and Z aren't supported.
      </p>

      <div className="grid-2" style={{ marginTop: '0.5rem' }}>
        <div>
          <div className="muted">You{me ? ` (${me.displayName})` : ''}</div>
          <div className="coins">{word.length} letters</div>
        </div>
        <div>
          <div className="muted">{opponent?.displayName ?? 'Opponent'}</div>
          <div className="coins">{opponent?.submittedWord != null ? 'submitted ✓' : 'spelling…'}</div>
        </div>
      </div>
    </div>
  );
}

function Countdown({ deadline, onExpire }: { deadline: number | null; onExpire: () => void }) {
  const [left, setLeft] = useState<number | null>(null);
  const firedRef = useRef(false);
  useEffect(() => {
    firedRef.current = false;
    if (!deadline) {
      setLeft(null);
      return;
    }
    const tick = () => {
      const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire();
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);
  if (left === null) return null;
  return <span className="phase-pill">{left}s</span>;
}
