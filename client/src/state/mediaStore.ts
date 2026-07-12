// Warms the camera + ASL detector model ONCE, at app load — not per round.
// SpellArena used to own its own getUserMedia() call and its own
// createAslDetector()+init(), both of which re-ran (permission prompt + model
// reload) every single time it mounted/unmounted between rounds. This store
// holds the one shared stream + one shared (already-initialized) detector
// instance so SpellArena just attaches to what's already warm.
import { create } from 'zustand';
import { createAslDetector, type AslDetector } from '@app/asl';

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'denied' | 'error';

interface MediaStore {
  stream: MediaStream | null;
  cameraStatus: CameraStatus;
  detector: AslDetector | null;
  detectorReady: boolean;
  warm: () => Promise<void>;
  /** Re-attempt camera access only (e.g. after the user grants permission
   *  they'd previously denied) — the "Enable camera" fallback button. */
  retryCamera: () => Promise<void>;
}

let warmStarted = false;

/** Draw the bundled hand photo to a canvas for detector.warmup() — a frame
 *  guaranteed to contain a hand, so MediaPipe compiles its landmark-stage
 *  shaders at page load instead of mid-round. */
async function loadWarmupHandCanvas(): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = '/asl-model/warmup-hand.jpg';
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return canvas;
}

async function acquireCamera(set: (partial: Partial<MediaStore>) => void): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    set({ cameraStatus: 'error' });
    return;
  }
  set({ cameraStatus: 'starting' });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    set({ stream, cameraStatus: 'ready' });
  } catch (err) {
    const denied = err instanceof DOMException && err.name === 'NotAllowedError';
    set({ cameraStatus: denied ? 'denied' : 'error' });
  }
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  stream: null,
  cameraStatus: 'idle',
  detector: null,
  detectorReady: false,

  warm: async () => {
    if (warmStarted) return;
    warmStarted = true;

    // Independent — camera permission and the TF.js model load concurrently.
    const detectorPromise = (async () => {
      // 0.75/500ms (was 0.85/600ms): the higher bar meant players whose hands
      // the model knows less well never got a letter to commit at all —
      // slightly more misreads is a far better failure mode than silence.
      const detector = createAslDetector({
        minConfidence: 0.75,
        holdMs: 500,
        modelUrl: '/asl-model/model.json',
      });
      try {
        await detector.init();
        set({ detector });
      } catch {
        set({ detector: null, detectorReady: false }); // SpellArena falls back to keyboard entry
      }
    })();

    await Promise.all([acquireCamera(set), detectorPromise]);

    // Force full shader compilation NOW. MediaPipe's landmark stage only
    // compiles the first time a hand is actually FOUND, so we warm with a
    // bundled hand image — warming against an empty camera frame left the
    // multi-second freeze to hit the moment the player first raised a hand
    // in-round (frozen timer, black video, ~10s of "not detected").
    // detectorReady is only set after this, so the server's SPELL_READY gate
    // holds the round until this client can genuinely detect.
    const { detector } = get();
    if (!detector) return;
    try {
      const canvas = await loadWarmupHandCanvas().catch(() => undefined);
      await detector.warmup(canvas);
    } catch {
      // Best-effort — worst case the compile stall happens in-round as before.
    }
    set({ detectorReady: true });
  },

  retryCamera: () => acquireCamera(set),
}));
