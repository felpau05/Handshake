# ASL Fingerspelling Detector — integration guide

> Hand this file to anyone (human or a fresh Claude session) who needs to wire
> the detector into a website. It fully specifies the seam — you do **not** need
> to read the module internals.

## What it is

`@app/asl` is a **browser TypeScript module** that turns a `<video>` element into
a stream of recognized ASL fingerspelling **letter events**. Everything runs
client-side in the visitor's browser: webcam → MediaPipe hand landmarks → a
small MLP we trained → a stability filter → one clean event per intentional letter.

**It runs in the browser because each visitor uses their own webcam** — a
server-side process cannot see a remote user's camera.

### What it does NOT do (the consumer's job)
- No word assembly / spelling buffer — you append letters yourself.
- No space / delete / backspace gestures.
- No UI beyond the dev tools + demo.
- J and Z are collected/trained as single static poses (not true motion detection),
  so expect them to be less reliable and to overlap with I and D respectively.
- No networking — it emits in-process events; forward them wherever you like.

## Install / import

It's a workspace in this monorepo. From another workspace:

```ts
import { createAslDetector, type LetterEvent } from '@app/asl';
```

(If consuming outside the monorepo, copy the `asl/` folder in and depend on it, or
publish it. It needs `@mediapipe/tasks-vision` and `@tensorflow/tfjs`.)

## The one contract that matters

```ts
interface LetterEvent {
  letter: string;      // single uppercase letter, e.g. "A"
  confidence: number;  // 0..1 at the moment of commit
  timestamp: number;   // Date.now() epoch ms
}
```

Emitted **exactly once per intentional letter** — no per-frame duplicates. Holding
a pose does not spam; to type a double letter (e.g. "LL") the user briefly drops
the hand between the two.

## Public API

```ts
const detector = createAslDetector({
  minConfidence?: number, // default 0.85 — min softmax prob to accept
  holdMs?: number,        // default 600  — how long a letter must be held
  releaseMs?: number,     // default 300  — hand-absent gap that allows a repeat
  wasmPath?: string,      // MediaPipe wasm dir (default: jsdelivr CDN)
  handModelPath?: string, // hand_landmarker.task (default: Google CDN)
  modelUrl?: string,      // OUR classifier (default: './model/model.json')
});

await detector.init();                 // loads MediaPipe + the trained model
detector.attachVideo(videoElement);    // OR: const v = await detector.startCamera();
const off = detector.on('letter', (e) => { /* e: LetterEvent */ });
detector.start();                      // begin the detection loop
// detector.reset();                   // clear stability state (e.g. between words)
// detector.stop();                    // pause loop (keeps camera + model)
// detector.destroy();                 // stop + release camera
```

## Copy-paste wiring (React)

```tsx
import { useEffect, useRef, useState } from 'react';
import { createAslDetector } from '@app/asl';

export function Speller() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [word, setWord] = useState('');

  useEffect(() => {
    let detector: ReturnType<typeof createAslDetector> | null = null;
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current!.srcObject = stream;
      await videoRef.current!.play();

      detector = createAslDetector();
      await detector.init();
      detector.attachVideo(videoRef.current!);
      detector.on('letter', (e) => setWord((w) => w + e.letter)); // assembly = your job
      detector.start();
    })();
    return () => detector?.destroy();
  }, []);

  return (<><video ref={videoRef} playsInline muted /><p>{word}</p></>);
}
```

## Requirements
- A camera and a **secure context**: `getUserMedia` only works on `https://` or
  `http://localhost`. Plain `http://<lan-ip>` is blocked by browsers.
- The trained model files must be served at `modelUrl` (default `./model/model.json`,
  plus `model.weights.bin` and `labels.json` beside it). See `asl/model/README.md`.
- MediaPipe WASM + hand model load from CDN by default; pass `wasmPath`/`handModelPath`
  to self-host for offline use.

## How the model gets made (dev-time, already tooled)
You can bootstrap from a public dataset, collect your own samples, or both (recommended):

- **Dataset bootstrap** (volume, camera-free, WSL2-safe):
  `pip install -r tools/requirements.txt` then
  `python tools/dataset_import.py <dataset_root> -o data/dataset_landmarks.json`.
  Point it at an ASL *image* dataset laid out as one folder per letter (e.g. Kaggle
  "ASL Alphabet"). It runs the same MediaPipe + normalization as runtime and writes a
  `landmarks.json`. (28×28 sets like Sign-Language-MNIST are too small for MediaPipe — skip them.)
- **Self-collected** (closes the domain gap for your actual camera):
  `npm -w asl run collect` → pose letters, record, download `landmarks.json`.
- **Train**: `npm -w asl run train` → select **one or more** JSON files (dataset + collected
  merge automatically) → train → download `model.json` + `model.weights.bin` + `labels.json`
  → drop into `asl/model/`.
- **Verify live**: `npm -w asl run demo`.

Because the model eats normalized landmarks (not pixels), a model trained on someone else's
dataset transfers well to your camera — but adding ~20 of your own samples per letter noticeably
helps. Recollect + retrain the letters the training page flags as confused (M/N/S/T commonly collide).
