// Classify a hand into a Move from MediaPipe's 21 landmarks. Pure geometry — no
// trained model needed. A finger is "extended" when its tip is farther from the
// wrist than its PIP joint. Counting extended fingers maps to RPS:
//   0 extended → rock, 2 (index+middle) → scissors, 4–5 → paper.
// This is deliberately simple and tweakable live; adjust thresholds if a
// particular hand/camera misreads.
import type { Move } from '@app/shared';

/** A single landmark as returned by MediaPipe HandLandmarker (normalized 0..1). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

// MediaPipe hand landmark indices.
const WRIST = 0;
const TIPS = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const PIPS = { thumb: 2, index: 6, middle: 10, ring: 14, pinky: 18 };

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

type Finger = keyof typeof TIPS;

function isExtended(lm: Landmark[], finger: Finger): boolean {
  const wrist = lm[WRIST];
  const tip = lm[TIPS[finger]];
  const pip = lm[PIPS[finger]];
  // Extended when the tip sits farther from the wrist than the mid joint.
  return dist(tip, wrist) > dist(pip, wrist) * 1.05;
}

export interface Classification {
  move: Move | null;
  confidence: number;
  extendedCount: number;
}

/**
 * Classify a hand. Returns null move when the pose is ambiguous (caller should
 * keep the last confident reading rather than flip-flopping).
 */
export function classifyHand(lm: Landmark[] | undefined): Classification {
  if (!lm || lm.length < 21) return { move: null, confidence: 0, extendedCount: 0 };

  const fingers: Finger[] = ['index', 'middle', 'ring', 'pinky'];
  const extended = fingers.filter((f) => isExtended(lm, f));
  const count = extended.length;

  // Rock: no fingers extended.
  if (count === 0) return { move: 'rock', confidence: 0.9, extendedCount: 0 };

  // Scissors: exactly index + middle up, ring + pinky down.
  if (count === 2 && extended.includes('index') && extended.includes('middle')) {
    return { move: 'scissors', confidence: 0.9, extendedCount: 2 };
  }

  // Paper: most/all fingers extended.
  if (count >= 3) return { move: 'paper', confidence: 0.85, extendedCount: count };

  // Ambiguous (e.g. 1 finger up) — no confident call.
  return { move: null, confidence: 0.3, extendedCount: count };
}
