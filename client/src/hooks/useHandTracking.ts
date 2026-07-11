// The demo-critical piece: run MediaPipe HandLandmarker on the webcam video each
// animation frame, classify the hand to a Move, and expose the current stable
// reading + raw landmarks (for the debug overlay). Everything degrades safely —
// if the model fails to load, `ready` stays false and the UI falls back to the
// keyboard/button controls, which emit the SAME gesture event.
//
// NOTE: MediaPipe loads its WASM + model files from a CDN by default. For an
// offline-safe demo, vendor these into /public and point the paths below at
// local copies (see the TODO). The classifier itself is in gestureClassifier.ts.
import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Move } from '@app/shared';
import { classifyHand, type Landmark } from '../lib/gestureClassifier.js';

// TODO(team): for offline reliability, download these and serve from /public.
const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export interface HandTrackingState {
  ready: boolean;
  loadError: string | null;
  move: Move | null;
  confidence: number;
  landmarks: Landmark[] | null;
}

/**
 * @param videoRef the <video> element from useCamera
 * @param active   when false, the loop is paused (e.g. camera off / not in capture)
 */
export function useHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
): HandTrackingState {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastMoveRef = useRef<Move | null>(null);

  // Load the model once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
        const landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          numHands: 1,
          runningMode: 'VIDEO',
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setReady(true);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load hand tracking');
      }
    })();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  // Detection loop.
  useEffect(() => {
    if (!ready || !active) return;
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker) return;

    const tick = () => {
      if (video.readyState >= 2) {
        const result = landmarker.detectForVideo(video, performance.now());
        const hand = result.landmarks?.[0] as Landmark[] | undefined;
        const { move: m, confidence: c } = classifyHand(hand);
        setLandmarks(hand ?? null);
        // Keep the last confident reading rather than flickering to null.
        if (m) {
          lastMoveRef.current = m;
          setMove(m);
          setConfidence(c);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [ready, active, videoRef]);

  return { ready, loadError, move, confidence, landmarks };
}
