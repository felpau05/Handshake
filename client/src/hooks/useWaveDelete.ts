// Wave-to-delete: the ASL detector is letters-only by contract, so deleting the
// last letter is the app's job. This hook watches the SHARED detector's frame
// stream (wrist = landmark 0) and fires `onDelete` on a fast horizontal sweep.
// Keyboard Backspace (wired in SpellArena) is the guaranteed fallback.
//
// It used to run its own second HandLandmarker on the same video — that meant
// a full WASM + model download and GPU shader compile AT ROUND START (a
// multi-second main-thread freeze on slower machines) plus a duplicate
// detection pass every frame for the whole round. One landmark source now
// feeds both letter classification and wave detection.
import { useEffect, useRef } from 'react';
import type { AslDetector } from '@app/asl';

const WAVE_MIN_TRAVEL = 0.35; // fraction of frame width swept
const WAVE_WINDOW_MS = 500; // within this time window
const COOLDOWN_MS = 900; // ignore repeats right after a delete

export function useWaveDelete(
  detector: AslDetector | null,
  active: boolean,
  onDelete: () => void,
): void {
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  useEffect(() => {
    if (!active || !detector) return;
    const samples: { x: number; t: number }[] = [];
    let lastFire = 0;

    const unsubscribe = detector.on('frame', (f) => {
      const wrist = f.landmarks?.[0];
      if (!wrist) return;
      const now = performance.now();
      samples.push({ x: wrist.x, t: now });
      while (samples.length && now - samples[0].t > WAVE_WINDOW_MS) samples.shift();
      const xs = samples.map((s) => s.x);
      const travel = Math.max(...xs) - Math.min(...xs);
      if (travel >= WAVE_MIN_TRAVEL && now - lastFire > COOLDOWN_MS) {
        lastFire = now;
        samples.length = 0;
        onDeleteRef.current();
      }
    });
    return unsubscribe;
  }, [active, detector]);
}
