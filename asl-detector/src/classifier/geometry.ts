// Geometry-based ASL letter classifier — the offline baseline. It maps finger
// extension / spread / orientation heuristics on the 21 MediaPipe landmarks to a
// best-guess letter. It is deliberately simple and debuggable, and it is honest
// about ambiguity: many ASL letters share a handshape (A/S/T, U/V/R), so those
// return lower confidence. For higher accuracy, drop in a trained model via the
// TfjsLetterClassifier — the detector depends only on the LandmarkClassifier
// interface, so nothing else changes.
import type { Classification, Landmark, LandmarkClassifier, Letter } from './types.js';

// Landmark indices (MediaPipe hand).
const WRIST = 0;
const THUMB = { mcp: 2, ip: 3, tip: 4 };
const FINGERS = {
  index: { mcp: 5, pip: 6, tip: 8 },
  middle: { mcp: 9, pip: 10, tip: 12 },
  ring: { mcp: 13, pip: 14, tip: 16 },
  pinky: { mcp: 17, pip: 18, tip: 20 },
} as const;

type FingerName = keyof typeof FINGERS;
const FINGER_NAMES: FingerName[] = ['index', 'middle', 'ring', 'pinky'];

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** A compact description of the hand pose the letter rules read from. */
interface HandFeatures {
  extended: Record<FingerName, boolean>;
  thumbExtended: boolean;
  /** count of extended non-thumb fingers */
  count: number;
  /** normalized gap between index and middle fingertips (spread) */
  indexMiddleGap: number;
  /** true when the four fingertips are curled near the thumb tip (C/O family) */
  fingertipsNearThumb: boolean;
  /** index vs middle tip horizontal cross (R detection) */
  indexMiddleCrossed: boolean;
  handSize: number;
}

function extractFeatures(lm: Landmark[]): HandFeatures {
  const wrist = lm[WRIST];
  const handSize = dist(wrist, lm[FINGERS.middle.mcp]) || 1;

  const extended = {} as Record<FingerName, boolean>;
  for (const f of FINGER_NAMES) {
    const { pip, tip } = FINGERS[f];
    // Extended when the tip is meaningfully farther from the wrist than the PIP.
    extended[f] = dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.06;
  }
  const count = FINGER_NAMES.filter((f) => extended[f]).length;

  // Thumb extended: tip is laterally away from the index MCP relative to hand size.
  const thumbExtended =
    dist(lm[THUMB.tip], lm[FINGERS.index.mcp]) > handSize * 0.6 &&
    dist(lm[THUMB.tip], wrist) > dist(lm[THUMB.ip], wrist) * 1.02;

  const indexMiddleGap = dist(lm[FINGERS.index.tip], lm[FINGERS.middle.tip]) / handSize;

  // C/O family: all four fingertips curled toward the thumb tip.
  const avgTipToThumb =
    FINGER_NAMES.reduce((s, f) => s + dist(lm[FINGERS[f].tip], lm[THUMB.tip]), 0) /
    (FINGER_NAMES.length * handSize);
  const fingertipsNearThumb = avgTipToThumb < 0.7;

  // R: index and middle extended but tips crossed horizontally.
  const indexMiddleCrossed =
    extended.index &&
    extended.middle &&
    Math.sign(lm[FINGERS.index.tip].x - lm[FINGERS.middle.tip].x) !==
      Math.sign(lm[FINGERS.index.mcp].x - lm[FINGERS.middle.mcp].x);

  return {
    extended,
    thumbExtended,
    count,
    indexMiddleGap,
    fingertipsNearThumb,
    indexMiddleCrossed,
    handSize,
  };
}

export class GeometryLetterClassifier implements LandmarkClassifier {
  classify(landmarks: Landmark[]): Classification {
    if (!landmarks || landmarks.length < 21) return { letter: null, confidence: 0 };
    const f = extractFeatures(landmarks);
    const e = f.extended;
    const hi = (letter: Letter): Classification => ({ letter, confidence: 0.85 });
    const lo = (letter: Letter): Classification => ({ letter, confidence: 0.55 });

    // ── 4 fingers extended ─────────────────────────────────────────────────
    if (f.count === 4) return f.thumbExtended ? lo('B') : hi('B');

    // ── 3 fingers extended ─────────────────────────────────────────────────
    if (f.count === 3) {
      if (e.index && e.middle && e.ring) return hi('W');
      // index+middle+pinky etc. are rare; fall back low.
      return lo('W');
    }

    // ── 2 fingers extended ─────────────────────────────────────────────────
    if (f.count === 2) {
      if (e.index && e.middle) {
        if (f.indexMiddleCrossed) return hi('R');
        if (f.thumbExtended) return lo('K'); // K: V-shape with thumb between
        return f.indexMiddleGap > 0.5 ? hi('V') : hi('U'); // spread=V, together=U
      }
      return lo('U');
    }

    // ── 1 finger extended ──────────────────────────────────────────────────
    if (f.count === 1) {
      if (e.index) {
        if (f.thumbExtended) return hi('L'); // L: index up + thumb out
        return hi('D'); // D: index up, others curled
      }
      if (e.pinky) return f.thumbExtended ? hi('Y') : hi('I'); // Y: thumb+pinky, I: pinky
      if (e.middle || e.ring) return lo('D');
    }

    // ── 0 fingers extended (fist / curved family) ──────────────────────────
    if (f.count === 0) {
      if (f.fingertipsNearThumb) return f.thumbExtended ? hi('C') : hi('O');
      if (f.thumbExtended) return hi('A'); // A: fist, thumb alongside
      return lo('S'); // S/E/M/N/T all look like a closed fist — S is the guess
    }

    return { letter: null, confidence: 0.2 };
  }
}
