// Loads OUR trained tfjs MLP and turns a normalized 63-dim landmark vector into
// a (letter, confidence) prediction. The model + labels are produced by
// tools/train.html and served as static assets from ./model.
import * as tf from '@tensorflow/tfjs';

export interface Prediction {
  letter: string;
  confidence: number;
}

export class LetterClassifier {
  private model: tf.LayersModel | null = null;
  private labels: string[] = [];

  constructor(private modelUrl: string) {}

  async init(): Promise<void> {
    try {
      this.model = await tf.loadLayersModel(this.modelUrl);
    } catch (err) {
      throw new Error(
        `Failed to load ASL model from "${this.modelUrl}". Train one first ` +
          `(npm -w asl run train) and place model.json/weights.bin/labels.json ` +
          `under asl/model/. Original error: ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
    }
    // labels.json lives next to model.json and gives the softmax output order.
    const labelsUrl = this.modelUrl.replace(/model\.json(\?.*)?$/, 'labels.json');
    const res = await fetch(labelsUrl);
    if (!res.ok) throw new Error(`Failed to load labels from "${labelsUrl}"`);
    this.labels = await res.json();
  }

  predict(vec: Float32Array): Prediction {
    if (!this.model) throw new Error('Classifier not initialized — call init() first');
    const input = tf.tensor2d(vec, [1, vec.length]);
    const output = this.model.predict(input) as tf.Tensor;
    const probs = output.dataSync();
    input.dispose();
    output.dispose();

    let best = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[best]) best = i;
    }
    return { letter: this.labels[best] ?? '?', confidence: probs[best] };
  }
}
