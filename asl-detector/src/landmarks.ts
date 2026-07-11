// Thin wrapper around MediaPipe HandLandmarker: load the model once, then pull
// the first detected hand's 21 landmarks from a video frame. Kept separate from
// the detector so the model-loading concern is isolated and swappable.
//
// Model assets: by default these load from a CDN. For an offline-safe demo, set
// `wasmPath`/`modelUrl` to locally-bundled copies (ship them with this package).
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from './classifier/types.js';

const DEFAULT_WASM =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const DEFAULT_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export interface LandmarkerOptions {
  wasmPath?: string;
  modelUrl?: string;
}

export class HandLandmarkSource {
  private landmarker: HandLandmarker | null = null;

  constructor(private readonly opts: LandmarkerOptions = {}) {}

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(this.opts.wasmPath ?? DEFAULT_WASM);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.opts.modelUrl ?? DEFAULT_MODEL, delegate: 'GPU' },
      numHands: 1,
      runningMode: 'VIDEO',
    });
  }

  /** Detect the first hand's landmarks in the current video frame, or null. */
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null {
    if (!this.landmarker || video.readyState < 2) return null;
    const result = this.landmarker.detectForVideo(video, timestampMs);
    const hand = result.landmarks?.[0];
    return hand ? (hand as Landmark[]) : null;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
