// Dev-only data-collection page. Uses the SAME extractor + normalization as the
// runtime module (no train/serve skew), logs labeled 63-dim vectors, and lets
// you download them as landmarks.json for the training page to consume.
import { HandLandmarkExtractor } from '../src/landmarks.js';
import { normalizeLandmarks } from '../src/normalize.js';

// 24 static letters — J and Z need motion, out of scope for the single-frame MLP.
const LETTERS = 'ABCDEFGHIKLMNOPQRSTUVWXY'.split('');

interface Sample {
  label: string;
  vector: number[];
}

const samples: Sample[] = [];
let currentLabel: string | null = null;
let recording = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const labelEl = $('label');
const hintEl = $('hint');
const statusEl = $('status');
const totalEl = $('total');
const countsEl = $('counts');

function counts(): Record<string, number> {
  const c: Record<string, number> = {};
  for (const l of LETTERS) c[l] = 0;
  for (const s of samples) c[s.label] = (c[s.label] ?? 0) + 1;
  return c;
}

function render(): void {
  labelEl.textContent = currentLabel ?? '—';
  totalEl.textContent = String(samples.length);
  const c = counts();
  countsEl.innerHTML = LETTERS.map(
    (l) =>
      `<div class="cell ${c[l] > 0 ? 'has' : ''}"><b>${l}</b>${c[l]}</div>`,
  ).join('');
  hintEl.innerHTML = recording
    ? '<span class="rec">● recording…</span>'
    : currentLabel
    ? `Ready — hold <kbd>Space</kbd> to record "${currentLabel}"`
    : 'Press a letter key to pick a target.';
}

function download(): void {
  const blob = new Blob([JSON.stringify(samples)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'landmarks.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

window.addEventListener('keydown', (e) => {
  const key = e.key.toUpperCase();
  if (LETTERS.includes(key)) {
    currentLabel = key;
    render();
  } else if (e.key === ' ') {
    e.preventDefault();
    recording = true;
    render();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    samples.pop();
    render();
  } else if (key === 'S') {
    download();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    recording = false;
    render();
  }
});
$('download').addEventListener('click', download);

async function main(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const extractor = new HandLandmarkExtractor();
  await extractor.init();
  hintEl.textContent = 'Ready — press a letter key.';
  render();

  const tick = () => {
    if (video.readyState >= 2) {
      const reading = extractor.detect(video, performance.now());
      statusEl.textContent = reading ? `hand: ${reading.handedness}` : 'no hand';
      if (recording && reading && currentLabel) {
        const vec = normalizeLandmarks(reading.landmarks, reading.handedness);
        samples.push({ label: currentLabel, vector: Array.from(vec) });
        render();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

main().catch((err) => {
  hintEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
