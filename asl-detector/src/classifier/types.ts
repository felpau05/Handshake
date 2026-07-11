// The 24 static ASL alphabet letters. J and Z are excluded because they require
// motion and cannot be recognized from a single static hand pose.
export const LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y',
] as const;

export type Letter = (typeof LETTERS)[number];

/** A single MediaPipe hand landmark (normalized 0..1 image coords + relative z). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface Classification {
  /** Best-guess letter, or null when the pose is ambiguous. */
  letter: Letter | null;
  /** 0..1 confidence in that guess. */
  confidence: number;
}

/**
 * Turns a set of 21 hand landmarks into a letter guess. Two implementations:
 *   - GeometryLetterClassifier  (heuristics, no model, the baseline)
 *   - TfjsLetterClassifier      (trained model, the intended upgrade)
 * The detector depends only on this interface, so the model can be swapped
 * without touching the detection/debounce pipeline.
 */
export interface LandmarkClassifier {
  /** Optional async load (e.g. fetch a TF.js model). Geometry is a no-op. */
  load?(): Promise<void>;
  classify(landmarks: Landmark[]): Classification;
}
