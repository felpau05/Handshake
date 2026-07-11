// @cuhack/asl-detector — turns a <video> element into a stream of ASL letter
// events. Client-side only (MediaPipe in the browser). Emits one deduped
// LetterEvent per intentional letter; 24 letters (no J/Z). It does NOT do word
// assembly, spacing, delete, or UI — that is the consuming app's job.
//
//   import { createAslDetector } from '@cuhack/asl-detector';
//   const detector = createAslDetector({ minConfidence: 0.85, holdMs: 600 });
//   await detector.init();
//   detector.attachVideo(videoEl);
//   detector.on('letter', (e) => { /* { letter, confidence, timestamp } */ });
//   detector.start();
import { AslDetector, type AslDetectorOptions } from './detector.js';

export function createAslDetector(options?: AslDetectorOptions): AslDetector {
  return new AslDetector(options);
}

export { AslDetector } from './detector.js';
export type { AslDetectorOptions, LetterEvent, DetectorEvent } from './detector.js';
export { LETTERS } from './classifier/types.js';
export type { Letter, Landmark, Classification, LandmarkClassifier } from './classifier/types.js';
export { GeometryLetterClassifier } from './classifier/geometry.js';
export { TfjsLetterClassifier } from './classifier/tfjs.js';
