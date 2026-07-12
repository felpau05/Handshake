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
import type { LetterCapture } from '@app/shared';
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
  // Live per-frame diagnostics, written imperatively (30fps state updates
  // would re-render the whole panel). Shows WHY a letter isn't committing:
  // no hand at all vs. a prediction sitting under the confidence bar.
  const liveRef = useRef<HTMLSpanElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const prompt = useGameStore((s) => s.match?.prompt ?? '');
  const deadline = useGameStore((s) => s.match?.phaseDeadline ?? null);
  const me = useGameStore((s) => s.me());
  const opponent = useGameStore((s) => s.opponent());

  const deleteLast = () => setWord((w) => w.slice(0, -1));

  // Latest-value refs. Several callbacks below are registered ONCE inside
  // effects (detector letter handler, keydown listener, countdown expiry) and
  // would otherwise capture the word/doSubmit from that first render — which
  // is how timeout- and Enter-submits used to send an empty string no matter
  // what was actually spelled.
  const wordRef = useRef('');
  const doSubmitRef = useRef<(auto?: boolean) => void>(() => {});
  useEffect(() => {
    wordRef.current = word;
    doSubmitRef.current = (auto) => void doSubmit(auto);
  });

  // Per-letter captures backing the word, for the match-end signing coach.
  // `capturesRef` stays index-aligned with `word` via the reconcile effect
  // below; `pendingCaptureRef` holds the snapshot taken at the instant the
  // detector committed a letter, until that letter lands in `word`.
  const capturesRef = useRef<LetterCapture[]>([]);
  const pendingCaptureRef = useRef<LetterCapture | null>(null);
  const snapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  /** Small mirrored JPEG of the current video frame (the hand mid-sign). */
  const snapshotFrame = (): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = (snapCanvasRef.current ??= document.createElement('canvas'));
    const w = 240;
    const h = Math.round((video.videoHeight / video.videoWidth) * w);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Mirror to match the on-screen selfie view.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    return canvas.toDataURL('image/jpeg', 0.55);
  };

  // Keep captures aligned with the word: a grown word consumes the pending
  // detector capture (or records a capture-less keyboard letter); a shrunk
  // word (wave/Backspace delete) drops the tail captures with it.
  useEffect(() => {
    const captures = capturesRef.current;
    while (word.length > captures.length) {
      const letter = word[captures.length];
      const pending = pendingCaptureRef.current;
      if (pending && pending.letter === letter) {
        captures.push(pending);
        pendingCaptureRef.current = null;
      } else {
        captures.push({ letter, confidence: null, timestamp: Date.now(), image: null });
      }
    }
    if (word.length < captures.length) captures.length = word.length;
  }, [word]);

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

    // The model emits control gestures as labels alongside real letters —
    // they trigger actions here, never text. (Appending them used to paste
    // literal "SUBMIT"/"BACKSPACE" into the word.)
    const onLetter = (e: LetterEvent) => {
      if (e.letter === 'SUBMIT') {
        if (wordRef.current) doSubmitRef.current(true); // 👍 with an empty word is a misfire, ignore
        return;
      }
      if (e.letter === 'BACKSPACE') {
        deleteLast();
        return;
      }
      if (e.letter.length !== 1) return; // future control labels never leak into the word
      // Photograph the hand NOW, while it's still holding the sign that just
      // committed — by the next render it may already be moving away. The
      // reconcile effect pairs this with the letter once it lands in `word`.
      pendingCaptureRef.current = {
        letter: e.letter,
        confidence: e.confidence,
        timestamp: e.timestamp,
        image: snapshotFrame(),
      };
      setWord((w) => (w.length < 20 ? w + e.letter : w));
    };
    const unsubLetter = detector.on('letter', onLetter);

    let unsubFrame: (() => void) | null = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d')!;
      drawerRef.current = new DrawingUtils(ctx);
      unsubFrame = detector.on('frame', (f) => {
        // Size the canvas here, not at mount: videoWidth is 0 until the
        // stream's metadata loads, and a canvas sized 0×0 then would never
        // show the overlay (a race we lose on slower machines).
        if (video.videoWidth && canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (f.landmarks) {
          // Green at the commit bar (keep in sync with mediaStore minConfidence).
          const color = f.confidence >= 0.75 ? '#22c55e' : '#f59e0b';
          const pts = f.landmarks.map((l) => ({ ...l, visibility: 0 }));
          drawerRef.current!.drawConnectors(pts, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 3 });
          drawerRef.current!.drawLandmarks(pts, { color: '#fff', fillColor: color, radius: 3 });
        }
        if (liveRef.current) {
          liveRef.current.textContent = f.handDetected
            ? ` · ${f.letter ?? '?'} ${(f.confidence * 100).toFixed(0)}%`
            : ' · no hand';
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

  // Wave-to-delete rides the shared detector's frame stream — no second
  // MediaPipe instance, no shader compile at round start.
  useWaveDelete(detector, cameraStatus === 'ready' && detectorReady, deleteLast);

  // Keyboard: Backspace deletes, letters type (fallback), Enter submits.
  useEffect(() => {
    if (submitted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Backspace') {
        e.preventDefault();
        deleteLast();
      } else if (e.key === 'Enter') {
        doSubmitRef.current();
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

  // Submission used to be fire-and-forget: the UI showed "Submitted ✓"
  // regardless of whether the server actually got it, so a silently dropped
  // or rejected submission (e.g. a race with the phase timing out) looked
  // identical to a real one. Now it waits for the server's real answer and
  // only locks in on confirmed success; on failure it un-submits and shows
  // why, so the player can just hit the button again.
  const doSubmit = async (auto = false) => {
    if (submitted || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    // wordRef, not `word`: this function is also invoked through stale
    // closures (countdown expiry, Enter, the SUBMIT gesture) whose captured
    // `word` may be many letters behind.
    // Captures ride along for the match-end signing coach; the local copy is
    // kept in the store so the feedback card can show MY hand photos without
    // them round-tripping through the server.
    const captures = capturesRef.current.slice(0, wordRef.current.length);
    const ack = await submitWord(wordRef.current, captures);
    setSubmitting(false);
    if (ack.error) {
      // On the auto-submit at timeout, "window closed" just means the server's
      // own deadline beat our packet — the round is over either way; showing a
      // red "try again" for a window that no longer exists is only confusing.
      if (!auto) setSubmitError(ack.error);
      return;
    }
    useGameStore.getState().setMyCaptures(captures);
    setSubmitted(true);
  };

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>
          Prompt: <span style={{ color: 'var(--accent)' }}>{prompt}</span>
        </h3>
        <Countdown deadline={deadline} onExpire={() => doSubmitRef.current(true)} />
      </div>

      <div className="camera-wrap">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        <div className="move-badge">
          {tracking ? 'tracking ✓' : cameraStatus === 'ready' ? 'loading…' : cameraStatus}
          <span ref={liveRef} />
        </div>
      </div>

      {cameraStatus !== 'ready' && (
        <button className="primary" style={{ marginTop: '0.75rem' }} onClick={retryCamera}>
          Enable camera
        </button>
      )}

      <div className="word-display">{word || <span className="muted">sign your word…</span>}</div>

      <div className="gesture-buttons">
        <button onClick={deleteLast} disabled={submitted || submitting || !word}>⌫ Delete (wave / Backspace)</button>
        <button className="primary" onClick={() => doSubmit()} disabled={submitted || submitting}>
          {submitted ? 'Submitted ✓' : submitting ? 'Submitting…' : 'Submit word'}
        </button>
      </div>
      {submitError && (
        <p className="delta-lose">{submitError} — try again.</p>
      )}

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
      // Fire 1s BEFORE the deadline: the auto-submit races the server's own
      // timeout timer, and firing at exactly 0 loses that race over any real
      // network (the word arrives after RESOLVE started and is dropped).
      if (s <= 1 && !firedRef.current) {
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
