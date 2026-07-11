// Trained-model classifier seam — the intended accuracy upgrade over geometry.
//
// This is a stub with the right shape, NOT a working model. To make it real:
//   1. Train a small classifier on flattened 21×3 hand landmarks → 24 classes
//      (e.g. a Keras MLP), export to TF.js, and bundle it under ./assets/model/.
//   2. Add `@tensorflow/tfjs` to this workspace's dependencies.
//   3. Implement load()/classify() below to run inference.
// Because the detector depends only on the LandmarkClassifier interface, wiring
// this in is a one-line change in createAslDetector — no pipeline changes.
import type { Classification, Landmark, LandmarkClassifier } from './types.js';

export interface TfjsClassifierOptions {
  /** URL/path to the bundled TF.js model.json (served from this package). */
  modelUrl: string;
}

export class TfjsLetterClassifier implements LandmarkClassifier {
  constructor(private readonly opts: TfjsClassifierOptions) {}

  async load(): Promise<void> {
    // TODO: const tf = await import('@tensorflow/tfjs');
    //       this.model = await tf.loadLayersModel(this.opts.modelUrl);
    throw new Error(
      `TfjsLetterClassifier not implemented yet. Bundle a model and implement ` +
        `load()/classify(). Falling back to GeometryLetterClassifier is recommended ` +
        `until a model exists. (modelUrl: ${this.opts.modelUrl})`,
    );
  }

  classify(_landmarks: Landmark[]): Classification {
    return { letter: null, confidence: 0 };
  }
}
