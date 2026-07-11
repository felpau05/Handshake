// Demo consumer of the drop-in detector. Shows the intended integration shape:
// create → init → attach a <video> → subscribe → start. Word-building is done
// HERE (the consumer's job), not inside the module.
import { createAslDetector } from '../src/index.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const statusEl = $('status');
const wordEl = $('word');
const lastEl = $('last');

let word = '';

$('clear').addEventListener('click', () => {
  word = '';
  wordEl.textContent = '';
});

async function main(): Promise<void> {
  // Show the camera feed in the page's own <video>, then hand it to the detector.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  // Reused canvas for grabbing a snapshot on each committed letter. Cheap: it
  // only fires on commit (not per frame), so there's no measurable slowdown.
  const capturesEl = document.getElementById('captures')!;
  const snap = document.createElement('canvas');
  const sctx = snap.getContext('2d')!;

  function captureFrame(letter: string, confidence: number): void {
    snap.width = video.videoWidth;
    snap.height = video.videoHeight;
    // Mirror to match the on-screen (selfie) view.
    sctx.save();
    sctx.translate(snap.width, 0);
    sctx.scale(-1, 1);
    sctx.drawImage(video, 0, 0, snap.width, snap.height);
    sctx.restore();
    const url = snap.toDataURL('image/jpeg', 0.7);

    const fig = document.createElement('figure');
    fig.style.cssText = 'margin:0;text-align:center';
    const img = document.createElement('img');
    img.src = url;
    img.width = 120;
    img.style.cssText = 'border-radius:6px;display:block';
    const cap = document.createElement('figcaption');
    cap.textContent = `${letter} · ${(confidence * 100).toFixed(0)}%`;
    cap.style.cssText = 'font-size:13px;color:#9ae6b4;margin-top:2px';
    // Click a thumbnail to download that frame.
    const a = document.createElement('a');
    a.href = url;
    a.download = `asl-${letter}-${Date.now()}.jpg`;
    a.appendChild(img);
    fig.appendChild(a);
    fig.appendChild(cap);
    capturesEl.prepend(fig);
  }

  const detector = createAslDetector({ minConfidence: 0.85, holdMs: 600 });
  await detector.init();
  detector.attachVideo(video);
  const eventsEl = document.getElementById('events')!;
  let firstEvent = true;
  detector.on('letter', (e) => {
    word += e.letter;
    wordEl.textContent = word;
    lastEl.textContent = `committed "${e.letter}" @ ${(e.confidence * 100).toFixed(0)}%`;
    captureFrame(e.letter, e.confidence);

    // Show the exact payload a backend consumer would receive.
    const line = JSON.stringify(e);
    if (firstEvent) {
      eventsEl.textContent = line;
      firstEvent = false;
    } else {
      eventsEl.textContent = `${line}\n${eventsEl.textContent}`;
    }
  });

  // Live diagnostics: is this a DETECTION problem or a CLASSIFICATION problem?
  const hudHand = document.getElementById('hud-hand')!;
  const hudPred = document.getElementById('hud-pred')!;
  const hudConf = document.getElementById('hud-conf')!;
  const hudRate = document.getElementById('hud-rate')!;
  const window100: boolean[] = [];
  detector.on('frame', (f) => {
    hudHand.textContent = f.handDetected ? 'YES' : 'no';
    (hudHand as HTMLElement).style.color = f.handDetected ? '#9ae6b4' : '#fc8181';
    hudPred.textContent = f.letter ?? '—';
    hudConf.textContent = f.handDetected ? `${(f.confidence * 100).toFixed(0)}%` : '—';
    (hudConf as HTMLElement).style.color = f.confidence >= 0.85 ? '#9ae6b4' : '#f6ad55';
    window100.push(f.handDetected);
    if (window100.length > 100) window100.shift();
    const rate = (window100.filter(Boolean).length / window100.length) * 100;
    hudRate.textContent = `${rate.toFixed(0)}%`;
  });

  detector.start();
  statusEl.textContent = 'Running — fingerspell a letter and hold it steady.';
}

main().catch((err) => {
  statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
