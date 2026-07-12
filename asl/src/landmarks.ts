// MediaPipe HandLandmarker wrapper — the off-the-shelf model that turns a video
// frame into 21 hand keypoints. This step is NOT trained; only the MLP on top of
// its output is. Ported from the RPS client's useHandTracking hook.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark, Handedness } from './types.js';

// Defaults load from CDN so the module works with zero setup (matches the RPS
// client). For an offline / self-hosted drop-in, vendor these into ./model and
// pass wasmPath + handModelPath — see INTEGRATION.md.
export const DEFAULT_WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
export const DEFAULT_HAND_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export interface HandReading {
  landmarks: Landmark[];
  handedness: Handedness;
}

export class HandLandmarkExtractor {
  private landmarker: HandLandmarker | null = null;

  constructor(
    private wasmPath: string = DEFAULT_WASM_PATH,
    private modelPath: string = DEFAULT_HAND_MODEL_PATH,
  ) {}

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(this.wasmPath);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.modelPath, delegate: 'GPU' },
      numHands: 1,
      runningMode: 'VIDEO',
    });
  }

  /** Detect a single hand for the given frame (video, or a canvas — used by
   *  warmup to force full shader compilation with a known hand image), or
   *  null if none is visible. */
  detect(source: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): HandReading | null {
    if (!this.landmarker) return null;
    const result = this.landmarker.detectForVideo(source, timestampMs);
    const landmarks = result.landmarks?.[0] as Landmark[] | undefined;
    if (!landmarks) return null;
    const label = result.handednesses?.[0]?.[0]?.categoryName as
      | Handedness
      | undefined;
    return { landmarks, handedness: label ?? 'Right' };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
