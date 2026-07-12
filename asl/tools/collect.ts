// Dev-only data-collection page. Uses the SAME extractor + normalization as the
// runtime module (no train/serve skew), logs labeled 63-dim vectors, and lets
// you download them as landmarks.json for the training page to consume.
import { HandLandmarkExtractor } from '../src/landmarks.js';
import { normalizeLandmarks } from '../src/normalize.js';

// Full alphabet. J and Z are motion signs (see INTEGRATION.md) — collected here
// as a single static frame anyway, which means their vector overlaps I / D
// respectively. Expect I/J and D/Z confusion until/unless a motion-aware path exists.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Control gestures — collected exactly like letters (single-hand static pose,
// same normalization), just labeled as actions the consumer treats specially
// instead of typing. Selected with number keys so they don't clash with A–Z.
//   👍 thumbs up  → SUBMIT     (key 1)
//   👎 thumbs down → BACKSPACE (key 2)
const CONTROLS = [
  { key: '1', label: 'SUBMIT', emoji: '👍' },
  { key: '2', label: 'BACKSPACE', emoji: '👎' },
];
const ALL_LABELS = [...LETTERS, ...CONTROLS.map((c) => c.label)];

interface Sample {
  label: string;
  vector: number[];
}

const STORAGE_KEY = 'asl-collect-samples';

let samples: Sample[] = [];
let currentLabel: string | null = null;
let recording = false;
let saveTimer: number | undefined;

function loadFromStorage(): Sample[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Debounced — recording pushes a sample every animation frame, so we don't
// want to synchronously stringify+write the whole array 30x/sec.
function scheduleSave(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
    } catch (err) {
      hintEl.textContent = `⚠️ Auto-save failed (${err instanceof Error ? err.message : err}) — download a backup now.`;
    }
  }, 400);
}

samples = loadFromStorage();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const labelEl = $('label');
const hintEl = $('hint');
const statusEl = $('status');
const totalEl = $('total');
const countsEl = $('counts');
const loadInput = $<HTMLInputElement>('load');

function counts(): Record<string, number> {
  const c: Record<string, number> = {};
  for (const l of ALL_LABELS) c[l] = 0;
  for (const s of samples) c[s.label] = (c[s.label] ?? 0) + 1;
  return c;
}

function render(): void {
  labelEl.textContent = currentLabel ?? '—';
  totalEl.textContent = String(samples.length);
  const c = counts();
  countsEl.innerHTML = [
    ...LETTERS.map(
      (l) => `<div class="cell ${c[l] > 0 ? 'has' : ''}"><b>${l}</b>${c[l]}</div>`,
    ),
    ...CONTROLS.map(
      (ctl) =>
        `<div class="cell ${c[ctl.label] > 0 ? 'has' : ''}" title="${ctl.label} (key ${ctl.key})"><b>${ctl.emoji}</b>${c[ctl.label]}</div>`,
    ),
  ].join('');
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

function clearLabel(): void {
  if (!currentLabel) return;
  const n = samples.filter((s) => s.label === currentLabel).length;
  if (!n) return;
  if (!confirm(`Delete all ${n} samples for "${currentLabel}"?`)) return;
  samples = samples.filter((s) => s.label !== currentLabel);
  render();
  scheduleSave();
}

function resetAll(): void {
  if (!samples.length) return;
  if (!confirm(`Delete ALL ${samples.length} samples across every letter? This cannot be undone.`)) return;
  samples = [];
  render();
  scheduleSave();
}

async function loadFile(file: File): Promise<void> {
  const loaded: Sample[] = JSON.parse(await file.text());
  samples.push(...loaded);
  render();
  scheduleSave();
}

window.addEventListener('keydown', (e) => {
  const key = e.key.toUpperCase();
  const control = CONTROLS.find((c) => c.key === e.key);
  if (LETTERS.includes(key)) {
    currentLabel = key;
    render();
  } else if (control) {
    currentLabel = control.label;
    render();
  } else if (e.key === ' ') {
    e.preventDefault();
    recording = true;
    render();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    samples.pop();
    render();
    scheduleSave();
  } else if (e.key === 'Delete') {
    e.preventDefault();
    clearLabel();
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
$('clear').addEventListener('click', clearLabel);
$('reset').addEventListener('click', resetAll);
loadInput.addEventListener('change', async () => {
  const files = Array.from(loadInput.files ?? []);
  for (const file of files) await loadFile(file);
  loadInput.value = '';
});

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
        scheduleSave();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

main().catch((err) => {
  hintEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
