// The accuracy-critical, SHARED normalization step. Imported by both the
// data-collection tool and the runtime classifier so training and serving can
// never drift apart. If you change this, you must recollect + retrain.
import type { Landmark, Handedness } from './types.js';

export const NUM_LANDMARKS = 21;
export const VECTOR_SIZE = NUM_LANDMARKS * 3; // 63

const WRIST = 0;
const MIDDLE_MCP = 9; // base knuckle of the middle finger — a stable scale reference

/**
 * Turn 21 raw MediaPipe landmarks into a 63-dim, position/scale/handedness-
 * invariant Float32Array:
 *   1. translate so the wrist sits at the origin,
 *   2. scale by |wrist → middle-finger MCP| so hand size/distance drops out,
 *   3. mirror x for left hands so the model only ever sees a right-hand pose.
 */
export function normalizeLandmarks(
  landmarks: Landmark[],
  handedness: Handedness,
): Float32Array {
  const wrist = landmarks[WRIST];
  const mid = landmarks[MIDDLE_MCP];
  const scale =
    Math.hypot(mid.x - wrist.x, mid.y - wrist.y, mid.z - wrist.z) || 1e-6;
  const mirror = handedness === 'Left' ? -1 : 1;

  const out = new Float32Array(VECTOR_SIZE);
  for (let i = 0; i < NUM_LANDMARKS; i++) {
    const lm = landmarks[i];
    out[i * 3 + 0] = (mirror * (lm.x - wrist.x)) / scale;
    out[i * 3 + 1] = (lm.y - wrist.y) / scale;
    out[i * 3 + 2] = (lm.z - wrist.z) / scale;
  }
  return out;
}
