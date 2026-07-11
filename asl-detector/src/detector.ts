// The AslDetector: runs the landmark → classify loop each animation frame and
// emits ONE deduped LetterEvent per intentional letter. "Intentional" = the same
// letter classified above `minConfidence` continuously for `holdMs`. After a
// letter fires, the hand must change (a different stable letter, or drop below
// confidence) before the same letter can fire again — so holding a pose does not
// spam duplicates.
import { HandLandmarkSource, type LandmarkerOptions } from './landmarks.js';
import { GeometryLetterClassifier } from './classifier/geometry.js';
import type { Letter, LandmarkClassifier } from './classifier/types.js';

export interface LetterEvent {
  letter: Letter;
  confidence: number;
  timestamp: number;
}

export type DetectorEvent = 'letter';
type LetterListener = (e: LetterEvent) => void;

export interface AslDetectorOptions {
  /** Minimum classification confidence to consider a pose (0..1). Default 0.85. */
  minConfidence?: number;
  /** How long a letter must be held stable before it fires (ms). Default 600. */
  holdMs?: number;
  /** Override MediaPipe asset locations (for offline bundling). */
  landmarker?: LandmarkerOptions;
  /** Inject a custom classifier (e.g. a trained model). Default: geometry. */
  classifier?: LandmarkClassifier;
}

export class AslDetector {
  private readonly minConfidence: number;
  private readonly holdMs: number;
  private readonly source: HandLandmarkSource;
  private readonly classifier: LandmarkClassifier;

  private video: HTMLVideoElement | null = null;
  private running = false;
  private rafId: number | null = null;
  private listeners = new Set<LetterListener>();

  // Debounce state.
  private candidate: Letter | null = null;
  private candidateSince = 0;
  private lastFired: Letter | null = null;

  constructor(opts: AslDetectorOptions = {}) {
    this.minConfidence = opts.minConfidence ?? 0.85;
    this.holdMs = opts.holdMs ?? 600;
    this.source = new HandLandmarkSource(opts.landmarker);
    this.classifier = opts.classifier ?? new GeometryLetterClassifier();
  }

  async init(): Promise<void> {
    await this.classifier.load?.();
    await this.source.init();
  }

  attachVideo(video: HTMLVideoElement): void {
    this.video = video;
  }

  on(event: DetectorEvent, cb: LetterListener): void {
    if (event === 'letter') this.listeners.add(cb);
  }

  off(event: DetectorEvent, cb: LetterListener): void {
    if (event === 'letter') this.listeners.delete(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resetDebounce();
    const loop = () => {
      if (!this.running) return;
      this.tick(performance.now());
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.resetDebounce();
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
    this.source.close();
    this.video = null;
  }

  // ── Core loop ──────────────────────────────────────────────────────────────

  private tick(now: number): void {
    if (!this.video) return;
    const landmarks = this.source.detect(this.video, now);
    if (!landmarks) {
      // Hand left the frame — clear debounce so re-signing the same letter fires.
      this.resetDebounce();
      return;
    }

    const { letter, confidence } = this.classifier.classify(landmarks);
    if (!letter || confidence < this.minConfidence) {
      this.candidate = null;
      this.candidateSince = 0;
      // Dropping below confidence between letters allows the same letter to repeat.
      if (!letter) this.lastFired = null;
      return;
    }

    if (letter !== this.candidate) {
      // A new stable candidate begins its hold window.
      this.candidate = letter;
      this.candidateSince = now;
      return;
    }

    // Same candidate held long enough, and not already fired → emit once.
    if (letter !== this.lastFired && now - this.candidateSince >= this.holdMs) {
      this.lastFired = letter;
      this.emit({ letter, confidence, timestamp: now });
    }
  }

  private emit(e: LetterEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  private resetDebounce(): void {
    this.candidate = null;
    this.candidateSince = 0;
    this.lastFired = null;
  }
}
