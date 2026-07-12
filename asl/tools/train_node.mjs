// Headless trainer — a CLI twin of tools/train.ts for when you'd rather not open
// the browser. Same architecture, hyperparameters, and tfjs version as train.ts,
// so the model it emits is byte-compatible with the browser flow and with
// src/classifier.ts (tf.loadLayersModel). Uses the native tfjs-node backend
// when installed (`npm i @tensorflow/tfjs-node`) — much faster than the pure-JS
// CPU backend at 50k+ samples — and falls back to pure-JS if it's not present.
//
// Usage (run from the asl/ dir):
//   node tools/train_node.mjs data/dataset_merged.json [more.json ...]
// Writes model.json + model.weights.bin + labels.json into model/.
try {
  await import('@tensorflow/tfjs-node');
} catch {
  console.log('(@tensorflow/tfjs-node not installed — using slower pure-JS backend)');
}
import * as tf from '@tensorflow/tfjs';
import fs from 'node:fs';
import path from 'node:path';

const VECTOR_SIZE = 63;
const OUT_DIR = 'model';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node tools/train_node.mjs <samples.json> [more.json ...]');
  process.exit(1);
}

// Merge every file passed — same "select one or more" behavior as train.ts.
let samples = [];
for (const f of files) {
  const part = JSON.parse(fs.readFileSync(f, 'utf8'));
  samples.push(...part);
  console.log(`+ ${f}: ${part.length} samples`);
}
const labels = [...new Set(samples.map((s) => s.label))].sort();
console.log(`Total: ${samples.length} samples across ${labels.length} letters (${labels.join('')})`);
const perClass = labels.map((l) => `${l}:${samples.filter((s) => s.label === l).length}`);
console.log(`Per-letter: ${perClass.join('  ')}`);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const idx = (l) => labels.indexOf(l);
const data = shuffle(samples);
const split = Math.floor(data.length * 0.85);

const xTrain = tf.tensor2d(data.slice(0, split).map((s) => s.vector), [split, VECTOR_SIZE]);
const yTrain = tf.oneHot(tf.tensor1d(data.slice(0, split).map((s) => idx(s.label)), 'int32'), labels.length);
const valData = data.slice(split);
const xVal = tf.tensor2d(valData.map((s) => s.vector), [valData.length, VECTOR_SIZE]);
const yVal = tf.oneHot(tf.tensor1d(valData.map((s) => idx(s.label)), 'int32'), labels.length);

const model = tf.sequential({
  layers: [
    tf.layers.dense({ inputShape: [VECTOR_SIZE], units: 64, activation: 'relu' }),
    tf.layers.dropout({ rate: 0.2 }),
    tf.layers.dense({ units: 32, activation: 'relu' }),
    tf.layers.dense({ units: labels.length, activation: 'softmax' }),
  ],
});
model.compile({ optimizer: tf.train.adam(0.001), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

await model.fit(xTrain, yTrain, {
  epochs: 60,
  batchSize: 256,
  validationData: [xVal, yVal],
  callbacks: {
    onEpochEnd: (epoch, logs) => {
      if (epoch % 10 === 0 || epoch === 59) {
        console.log(`epoch ${epoch}: loss=${logs.loss.toFixed(3)} val_acc=${(logs.val_acc ?? logs.val_accuracy).toFixed(3)}`);
      }
    },
  },
});

// Confusion breakdown on the val set — same as train.ts.
const preds = model.predict(xVal).argMax(1).dataSync();
const truth = valData.map((s) => idx(s.label));
let correct = 0;
const confusions = {};
for (let i = 0; i < truth.length; i++) {
  if (preds[i] === truth[i]) correct++;
  else {
    const key = `${labels[truth[i]]}→${labels[preds[i]]}`;
    confusions[key] = (confusions[key] ?? 0) + 1;
  }
}
console.log(`\n✅ Val accuracy: ${((correct / truth.length) * 100).toFixed(1)}% (${correct}/${truth.length})`);
const topConf = Object.entries(confusions).sort((a, b) => b[1] - a[1]).slice(0, 12);
if (topConf.length) console.log(`Top confusions: ${topConf.map(([k, n]) => `${k}×${n}`).join('  ')}`);

// Save in tfjs LayersModel format — hand-write the artifacts (pure tfjs has no
// file:// IOHandler). Matches what the browser downloads:// handler produces.
fs.mkdirSync(OUT_DIR, { recursive: true });
await model.save(
  tf.io.withSaveHandler(async (artifacts) => {
    const modelJson = {
      modelTopology: artifacts.modelTopology,
      format: artifacts.format,
      generatedBy: artifacts.generatedBy,
      convertedBy: artifacts.convertedBy ?? null,
      weightsManifest: [{ paths: ['./model.weights.bin'], weights: artifacts.weightSpecs }],
    };
    fs.writeFileSync(path.join(OUT_DIR, 'model.json'), JSON.stringify(modelJson));
    fs.writeFileSync(path.join(OUT_DIR, 'model.weights.bin'), Buffer.from(artifacts.weightData));
    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
  }),
);
fs.writeFileSync(path.join(OUT_DIR, 'labels.json'), JSON.stringify(labels));
console.log(`\nSaved model.json + model.weights.bin + labels.json → ${OUT_DIR}/`);
