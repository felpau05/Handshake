// SPELL phase UI. Owns everything the ASL detector does not: word assembly from
// letter events, wave-to-delete (+ Backspace fallback), the countdown, and
// submit. The detector is a black box that emits deduped LetterEvents; this
// component turns them into a word and sends only the final string to the server.
import { useEffect, useRef, useState } from 'react';
import { createAslDetector, type AslDetector, type LetterEvent } from '@cuhack/asl-detector';
import { useCamera } from '../hooks/useCamera.js';
import { useWaveDelete } from '../hooks/useWaveDelete.js';
import { submitWord, sendSpellProgress } from '../hooks/useSocket.js';
import { useGameStore } from '../state/gameStore.js';

export function SpellArena() {
  const { videoRef, status, start } = useCamera();
  const [word, setWord] = useState('');
  const [detectorReady, setDetectorReady] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const detectorRef = useRef<AslDetector | null>(null);

  const prompt = useGameStore((s) => s.match?.prompt ?? '');
  const deadline = useGameStore((s) => s.match?.phaseDeadline ?? null);
  const me = useGameStore((s) => s.me());
  const opponent = useGameStore((s) => s.opponent());

  const deleteLast = () => setWord((w) => w.slice(0, -1));

  // Start the camera on mount.
  useEffect(() => {
    void start();
  }, [start]);

  // Wire the ASL detector once the camera is ready.
  useEffect(() => {
    if (status !== 'ready' || detectorRef.current) return;
    const detector = createAslDetector({ minConfidence: 0.85, holdMs: 600 });
    detectorRef.current = detector;
    let disposed = false;

    const onLetter = (e: LetterEvent) => setWord((w) => (w.length < 20 ? w + e.letter : w));

    (async () => {
      try {
        await detector.init();
        if (disposed) return detector.destroy();
        detector.attachVideo(videoRef.current!);
        detector.on('letter', onLetter);
        detector.start();
        setDetectorReady(true);
      } catch {
        setDetectorReady(false); // fall back to keyboard entry
      }
    })();

    return () => {
      disposed = true;
      detector.off('letter', onLetter);
      detector.destroy();
      detectorRef.current = null;
    };
  }, [status, videoRef]);

  // Wave-to-delete on the same video.
  useWaveDelete(videoRef, status === 'ready', deleteLast);

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
        <div className="move-badge">
          {detectorReady ? 'tracking ✓' : status === 'ready' ? 'loading…' : status}
        </div>
      </div>

      {status !== 'ready' && (
        <button className="primary" style={{ marginTop: '0.75rem' }} onClick={start}>
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
