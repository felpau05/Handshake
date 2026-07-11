// Public entry point. `createAslDetector` is the whole drop-in surface: init it,
// give it a <video>, subscribe to 'letter' events, start(). Everything runs in
// the browser; nothing is sent over the network by this module — the host wires
// the emitted LetterEvents to wherever it wants.
import { HandLandmarkExtractor } from './landmarks.js';
import { LetterClassifier } from './classifier.js';
import { StabilityFilter } from './stability.js';
import { normalizeLandmarks } from './normalize.js';
import type { AslDetectorOptions, LetterEvent } from './types.js';

export type { AslDetectorOptions, LetterEvent, Landmark, Handedness } from './types.js';
export { normalizeLandmarks, VECTOR_SIZE } from './normalize.js';
export { HandLandmarkExtractor } from './landmarks.js';
export type { HandReading } from './landmarks.js';

/** Per-frame diagnostic snapshot (raw, pre-stability). For debugging detection vs. classification. */
export interface FrameDebug {
  /** Did MediaPipe find a hand this frame? */
  handDetected: boolean;
  /** Top predicted letter (raw argmax, ignores the confidence gate), or null if no hand. */
  letter: string | null;
  /** Raw softmax confidence of that top letter, 0..1. */
  confidence: number;
}

export interface AslDetector {
  /** Load MediaPipe + the trained model. Await before start(). */
  init(): Promise<void>;
  /** Use a <video> the host already owns/renders. */
  attachVideo(video: HTMLVideoElement): void;
  /** Or let the detector open its own camera; returns the created <video>. */
  startCamera(): Promise<HTMLVideoElement>;
  /** Subscribe to recognized letters. Returns an unsubscribe fn. */
  on(event: 'letter', cb: (e: LetterEvent) => void): () => void;
  /** Subscribe to raw per-frame diagnostics (detection + top prediction). */
  on(event: 'frame', cb: (e: FrameDebug) => void): () => void;
  /** Begin the detection loop. */
  start(): void;
  /** Pause the detection loop (keeps model + camera). */
  stop(): void;
  /** Clear the stability state (e.g. between words/turns). */
  reset(): void;
  /** Stop everything and release the camera + model. */
  destroy(): void;
}

export function createAslDetector(options: AslDetectorOptions = {}): AslDetector {
  const cfg = {
    minConfidence: options.minConfidence ?? 0.85,
    holdMs: options.holdMs ?? 600,
    releaseMs: options.releaseMs ?? 300,
  };

  const extractor = new HandLandmarkExtractor(options.wasmPath, options.handModelPath);
  const classifier = new LetterClassifier(options.modelUrl ?? './model/model.json');
  const stability = new StabilityFilter(cfg);
  const listeners = new Set<(e: LetterEvent) => void>();
  const frameListeners = new Set<(e: FrameDebug) => void>();

  let video: HTMLVideoElement | null = null;
  let ownedStream: MediaStream | null = null;
  let running = false;
  let rafId: number | null = null;

  function emit(letter: string, confidence: number): void {
    const event: LetterEvent = { letter, confidence, timestamp: Date.now() };
    listeners.forEach((cb) => cb(event));
  }

  function loop(): void {
    if (!running) return;
    if (video && video.readyState >= 2) {
      const now = performance.now();
      const reading = extractor.detect(video, now);
      let letter: string | null = null;
      let confidence = 0;
      if (reading) {
        const vec = normalizeLandmarks(reading.landmarks, reading.handedness);
        const p = classifier.predict(vec);
        letter = p.letter;
        confidence = p.confidence;
      }
      if (frameListeners.size) {
        frameListeners.forEach((cb) =>
          cb({ handDetected: !!reading, letter, confidence }),
        );
      }
      const committed = stability.update(letter, confidence, now);
      if (committed) emit(committed, confidence);
    }
    rafId = requestAnimationFrame(loop);
  }

  return {
    async init() {
      await extractor.init();
      await classifier.init();
    },
    attachVideo(v) {
      video = v;
    },
    async startCamera() {
      ownedStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      const v = document.createElement('video');
      v.srcObject = ownedStream;
      v.muted = true;
      v.playsInline = true;
      await v.play();
      video = v;
      return v;
    },
    on(event: 'letter' | 'frame', cb: any) {
      const set = event === 'frame' ? frameListeners : listeners;
      set.add(cb);
      return () => set.delete(cb);
    },
    start() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
    reset() {
      stability.reset();
    },
    destroy() {
      this.stop();
      extractor.close();
      ownedStream?.getTracks().forEach((t) => t.stop());
      ownedStream = null;
      listeners.clear();
    },
  };
}
