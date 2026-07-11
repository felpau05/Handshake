# @cuhack/asl-detector

Turns a `<video>` element into a stream of ASL alphabet **letter events**, fully
in the browser (MediaPipe Hand Landmarker). It recognizes the **24 static ASL
letters** (the alphabet minus **J** and **Z**, which require motion). It does
**not** assemble words, handle spacing/delete, or render UI — that is the
consuming app's job.

## Usage

```ts
import { createAslDetector } from '@cuhack/asl-detector';

const detector = createAslDetector({ minConfidence: 0.85, holdMs: 600 });
await detector.init();            // loads the model
detector.attachVideo(videoEl);    // an <video> playing a camera stream
detector.on('letter', (e) => {
  // e = { letter: 'A', confidence: 0.88, timestamp: 12345.6 }
  console.log('signed', e.letter);
});
detector.start();
// ... later
detector.stop();       // pause
detector.destroy();    // release the model + camera pipeline
```

## Contract

- Emits **one** `LetterEvent` per *intentional* letter — a letter must be held
  above `minConfidence` continuously for `holdMs` to fire. No per-frame spam, no
  duplicates while a pose is held (release or change pose to repeat a letter).
- 24 letters only; J/Z are never emitted.
- Requires camera access and a **secure context** (HTTPS or `localhost`).

## Options

| Option | Default | Meaning |
|---|---|---|
| `minConfidence` | `0.85` | Minimum classifier confidence to consider a pose |
| `holdMs` | `600` | How long a letter must be held before it fires |
| `landmarker` | CDN | Override MediaPipe wasm/model URLs (for offline bundling) |
| `classifier` | geometry | Inject a custom `LandmarkClassifier` (e.g. a trained model) |

## Classifier accuracy

The default `GeometryLetterClassifier` uses landmark heuristics — no model, fully
offline, but rough on lookalike letters (A/S/T, U/V/R). For higher accuracy, train
a small model on 21×3 landmark vectors → 24 classes, export to TF.js, bundle it,
and pass a `TfjsLetterClassifier` via the `classifier` option. The detector
depends only on the `LandmarkClassifier` interface, so nothing else changes.

## Offline model assets

By default MediaPipe assets load from a CDN. For a reliable live demo, download
the wasm bundle + `hand_landmarker.task`, ship them with this package, and pass
`landmarker: { wasmPath, modelUrl }` pointing at the local copies.
