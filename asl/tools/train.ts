// Dev-only training page. Loads collected landmarks.json, trains a small MLP in
// the browser with TensorFlow.js, reports val accuracy + a confusion view, and
// downloads model.json / model.weights.bin / labels.json for asl/model/.
import * as tf from '@tensorflow/tfjs';
import { VECTOR_SIZE } from '../src/normalize.js';

interface Sample {
  label: string;
  vector: number[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>('file');
const trainBtn = $<HTMLButtonElement>('train');
const saveBtn = $<HTMLButtonElement>('save');
const logEl = $('log');
const loadedEl = $('loaded');
const trainStatusEl = $('trainStatus');

let samples: Sample[] = [];
let labels: string[] = [];
let model: tf.LayersModel | null = null;

function log(line: string): void {
  logEl.textContent = `${logEl.textContent}\n${line}`.trim();
  logEl.scrollTop = logEl.scrollHeight;
}

fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files ?? []);
  if (!files.length) return;
  // Merge every selected file — e.g. a big dataset import + your own collected set.
  logEl.textContent = '';
  samples = [];
  for (const file of files) {
    const part: Sample[] = JSON.parse(await file.text());
    samples.push(...part);
    log(`+ ${file.name}: ${part.length} samples`);
  }
  labels = [...new Set(samples.map((s) => s.label))].sort();
  loadedEl.textContent = ` ${samples.length} samples · ${labels.length} letters (${labels.join('')})`;
  log(`Total: ${samples.length} samples across ${labels.length} letters.`);
  const perClass = labels.map((l) => `${l}:${samples.filter((s) => s.label === l).length}`);
  log(`Per-letter: ${perClass.join('  ')}`);
  trainBtn.disabled = samples.length < labels.length * 5;
  if (trainBtn.disabled) log('⚠️ Collect more samples (need ≥5 per letter) before training.');
});

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

trainBtn.addEventListener('click', async () => {
  trainBtn.disabled = true;
  trainStatusEl.textContent = ' training…';

  const data = shuffle(samples);
  const split = Math.floor(data.length * 0.85);
  const idx = (l: string) => labels.indexOf(l);

  const xTrain = tf.tensor2d(data.slice(0, split).map((s) => s.vector), [split, VECTOR_SIZE]);
  const yTrain = tf.oneHot(tf.tensor1d(data.slice(0, split).map((s) => idx(s.label)), 'int32'), labels.length);
  const valData = data.slice(split);
  const xVal = tf.tensor2d(valData.map((s) => s.vector), [valData.length, VECTOR_SIZE]);
  const yVal = tf.oneHot(tf.tensor1d(valData.map((s) => idx(s.label)), 'int32'), labels.length);

  model = tf.sequential({
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
    batchSize: 32,
    validationData: [xVal, yVal],
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if (epoch % 10 === 0 || epoch === 59) {
          log(`epoch ${epoch}: loss=${logs?.loss?.toFixed(3)} val_acc=${logs?.val_acc?.toFixed(3)}`);
        }
      },
    },
  });

  // Confusion: which letters get mistaken for which on the val set.
  const preds = (model.predict(xVal) as tf.Tensor).argMax(1).dataSync();
  const truth = valData.map((s) => idx(s.label));
  let correct = 0;
  const confusions: Record<string, number> = {};
  for (let i = 0; i < truth.length; i++) {
    if (preds[i] === truth[i]) correct++;
    else {
      const key = `${labels[truth[i]]}→${labels[preds[i]]}`;
      confusions[key] = (confusions[key] ?? 0) + 1;
    }
  }
  log(`\n✅ Val accuracy: ${((correct / truth.length) * 100).toFixed(1)}% (${correct}/${truth.length})`);
  const topConf = Object.entries(confusions).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topConf.length) log(`Top confusions (collect more of these): ${topConf.map(([k, n]) => `${k}×${n}`).join('  ')}`);

  tf.dispose([xTrain, yTrain, xVal, yVal]);
  trainStatusEl.textContent = ' done';
  saveBtn.disabled = false;
});

saveBtn.addEventListener('click', async () => {
  if (!model) return;
  // Downloads model.json + model.weights.bin.
  await model.save('downloads://model');
  // labels.json — the softmax output order the classifier reads back.
  const blob = new Blob([JSON.stringify(labels)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'labels.json';
  a.click();
  URL.revokeObjectURL(a.href);
  log('Saved model.json, model.weights.bin, labels.json → move all three into asl/model/');
});
