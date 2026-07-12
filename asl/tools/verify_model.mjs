// Verification: load the SAVED model back (proving the artifacts are valid and
// classifier.ts can load them), then score it on the dataset and print a focused
// look at the I/J and D/Z pairs we were worried about. Read-only; writes nothing.
import * as tf from '@tensorflow/tfjs';
import fs from 'node:fs';

const modelDir = 'model';
const modelJson = JSON.parse(fs.readFileSync(`${modelDir}/model.json`, 'utf8'));
const labels = JSON.parse(fs.readFileSync(`${modelDir}/labels.json`, 'utf8'));
const weightsBuf = fs.readFileSync(`${modelDir}/model.weights.bin`);

// Custom load IOHandler — round-trips exactly what tf.loadLayersModel expects.
const model = await tf.loadLayersModel({
  load: async () => ({
    modelTopology: modelJson.modelTopology,
    weightSpecs: modelJson.weightsManifest[0].weights,
    weightData: weightsBuf.buffer.slice(weightsBuf.byteOffset, weightsBuf.byteOffset + weightsBuf.byteLength),
  }),
});
console.log('✅ Model loaded back successfully (classifier.ts will not throw).');
console.log(`   labels (${labels.length}): ${labels.join('')}`);

const samples = JSON.parse(fs.readFileSync('data/dataset_merged.json', 'utf8'));
const x = tf.tensor2d(samples.map((s) => s.vector), [samples.length, 63]);
const preds = model.predict(x).argMax(1).dataSync();

let correct = 0;
const confusion = {}; // truth -> {pred -> count}
for (let i = 0; i < samples.length; i++) {
  const truth = samples[i].label;
  const pred = labels[preds[i]];
  if (truth === pred) correct++;
  else {
    (confusion[truth] ??= {})[pred] = (confusion[truth]?.[pred] ?? 0) + 1;
  }
}
console.log(`\nWhole-set accuracy (train+val, sanity only): ${((correct / samples.length) * 100).toFixed(2)}%`);

// Focused check on the static-collision pairs.
const check = (a, b) => {
  const ab = confusion[a]?.[b] ?? 0;
  const ba = confusion[b]?.[a] ?? 0;
  console.log(`  ${a}↔${b}:  ${a}→${b} ×${ab}   ${b}→${a} ×${ba}`);
};
console.log('\nStatic-motion collision pairs:');
check('I', 'J');
check('D', 'Z');

// Any letter that's notably worse than the rest.
console.log('\nLetters with the most misreads:');
const perLetter = Object.entries(confusion)
  .map(([l, m]) => [l, Object.values(m).reduce((a, b) => a + b, 0)])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8);
for (const [l, n] of perLetter) {
  const into = Object.entries(confusion[l]).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' ');
  console.log(`  ${l}: ${n} misread  (→ ${into})`);
}
