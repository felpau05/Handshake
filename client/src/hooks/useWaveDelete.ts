// Wave-to-delete: the ASL detector is letters-only by contract, so deleting the
// last letter is the app's job. This hook runs its OWN lightweight MediaPipe
// HandLandmarker on the same video and fires `onDelete` when it sees a fast
// horizontal hand sweep (a "wave"). Keyboard Backspace (wired in SpellArena) is
// the guaranteed fallback if the camera/model isn't available.
//
// Note: this is a second HandLandmarker instance alongside the detector's. That's
// acceptable per the design; if it ever costs too much, share one landmark
// source between the two.
import { useEffect, useRef } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const WAVE_MIN_TRAVEL = 0.35; // fraction of frame width swept
const WAVE_WINDOW_MS = 500; // within this time window
const COOLDOWN_MS = 900; // ignore repeats right after a delete

export function useWaveDelete(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
  onDelete: () => void,
): void {
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  useEffect(() => {
    if (!active) return;
    let landmarker: HandLandmarker | null = null;
    let rafId: number | null = null;
    let cancelled = false;
    const samples: { x: number; t: number }[] = [];
    let lastFire = 0;

    (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM);
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
          numHands: 1,
          runningMode: 'VIDEO',
        });
      } catch {
        return; // model unavailable → rely on the Backspace fallback
      }
      if (cancelled) {
        landmarker?.close();
        return;
      }

      const tick = () => {
        const video = videoRef.current;
        if (video && video.readyState >= 2 && landmarker) {
          const now = performance.now();
          const res = landmarker.detectForVideo(video, now);
          const wrist = res.landmarks?.[0]?.[0];
          if (wrist) {
            samples.push({ x: wrist.x, t: now });
            while (samples.length && now - samples[0].t > WAVE_WINDOW_MS) samples.shift();
            const xs = samples.map((s) => s.x);
            const travel = Math.max(...xs) - Math.min(...xs);
            if (travel >= WAVE_MIN_TRAVEL && now - lastFire > COOLDOWN_MS) {
              lastFire = now;
              samples.length = 0;
              onDeleteRef.current();
            }
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      landmarker?.close();
    };
  }, [active, videoRef]);
}
