// Public + internal types for the ASL detector module.

/** A single hand landmark from MediaPipe (image-normalized coords, 0..1). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** Which hand MediaPipe thinks it saw. Used to canonicalize left→right. */
export type Handedness = 'Left' | 'Right';

/**
 * One recognized letter. Emitted exactly once per intentional letter — the
 * stability filter guarantees no per-frame duplicates. This is THE contract a
 * consumer depends on.
 */
export interface LetterEvent {
  /** Single uppercase letter, e.g. "A". */
  letter: string;
  /** Model confidence at the moment of commit, 0..1. */
  confidence: number;
  /** Wall-clock time of the emit (Date.now(), epoch ms). */
  timestamp: number;
}

export interface AslDetectorOptions {
  /** Minimum softmax probability to consider a prediction. Default 0.85. */
  minConfidence?: number;
  /** How long a letter must be held steady before it commits, ms. Default 600. */
  holdMs?: number;
  /** Hand-absent / low-confidence gap that "releases" so a letter can repeat, ms. Default 300. */
  releaseMs?: number;
  /** MediaPipe WASM directory. Defaults to the jsdelivr CDN (see landmarks.ts). */
  wasmPath?: string;
  /** MediaPipe hand_landmarker.task URL. Defaults to Google's CDN. */
  handModelPath?: string;
  /** URL of OUR trained tfjs classifier's model.json. Default './model/model.json'. */
  modelUrl?: string;
}
