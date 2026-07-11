# Trained model assets

The detector loads its classifier from this folder. After running the training
page (`npm -w asl run train`) you'll download three files — put them **here**:

- `model.json` — tfjs model topology
- `model.weights.bin` — trained weights (referenced by model.json)
- `labels.json` — array of letters in softmax output order, e.g. `["A","B","C",...]`

Until these exist, `detector.init()` will throw a clear "train one first" error.
The MediaPipe hand-landmark model itself is loaded from a CDN by default, so it
does not need to live here (see `src/landmarks.ts` to vendor it for offline use).
