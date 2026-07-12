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
      const detector = createAslDetector({
        minConfidence: 0.85,
        holdMs: 600,
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

    // Force the first inference NOW, against a throwaway video fed by the
    // warm stream. MediaPipe's GPU delegate and TF.js compile their shaders
    // on the first real frame — a multi-second main-thread freeze on weaker
    // machines that used to land exactly when SPELL started (frozen timer,
    // black video, no overlay). detectorReady is only set after this, so the
    // server's SPELL_READY gate holds the round until we're truly warm.
    const { stream, detector } = get();
    if (!detector) return;
    try {
      if (stream) {
        const v = document.createElement('video');
        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        await v.play().catch(() => undefined);
        detector.attachVideo(v); // SpellArena re-attaches its own <video> later
      }
      await detector.warmup();
    } catch {
      // Best-effort — worst case the compile stall happens in-round as before.
    }
    set({ detectorReady: true });
  },

  retryCamera: () => acquireCamera(set),
}));
