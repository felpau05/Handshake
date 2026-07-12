# Retraining the ASL model — the routine

The common case: you collected new samples with the collect tool and have a
fresh `landmarks.json` with a few letters you want to add to the model.
Everything below runs from the `asl/` directory:

```bash
cd asl
```

## 0. Collect (if you haven't yet)

```bash
npm -w asl run collect        # from repo root; opens the vite dev server
# browser -> http://localhost:<port>/tools/collect.html
```
Press a letter (or `1` = 👍 SUBMIT, `2` = 👎 BACKSPACE), hold **Space** to
record, aim for 100+ samples per letter with varied angles/distance. Click
**Download landmarks.json** and put the file at `asl/data/landmarks.json`.

## 1. Merge into the master dataset

```bash
node tools/merge_landmarks.mjs data/landmarks.json
```

- Default is **append** — new samples stack on top of that letter's existing
  data. This is what you want 95% of the time.
- Re-recorded a letter because the old data was bad? **Replace** it instead:

```bash
node tools/merge_landmarks.mjs data/landmarks.json --replace O,C
```

The script always writes a timestamped `.bak` of the master file first and
prints per-letter counts so you can sanity-check what happened. The master
set (`data/dataset_merged.json`) is **gitignored on purpose** — it lives only
on this machine, so don't delete those backups casually.

## 2. Train

```bash
node tools/train_node.mjs data/dataset_merged.json
```

~4 minutes for the full set (57k+ samples, 60 epochs). Watch the final lines:
val accuracy should stay ≥ 99%, and the "Top confusions" list tells you which
letter pairs to collect more data for.

### Is it using my hardware properly? (yes — here's the proof)

The trainer auto-loads `@tensorflow/tfjs-node`, the **native TensorFlow C++
backend** — multi-threaded, AVX2/FMA-vectorized (you'll see a `oneDNN custom
operations are on` line at startup). That's ~20× faster than the pure-JS
fallback (4 min vs 40+). Batch size is 256 to keep per-step overhead low.

Honest note: this model is tiny (a 64→32→28 MLP), so at this size the native
CPU backend **is** the practical maximum — a GPU would not meaningfully speed
it up; the bottleneck is per-batch overhead, not raw compute.

**If you instead see** `(@tensorflow/tfjs-node not installed — using slower
pure-JS backend)`, a fresh `npm install` wiped it (it's deliberately not in
package.json — it's a 50MB native download teammates don't need). Reinstall:

```bash
npm i @tensorflow/tfjs-node --no-save   # from repo root or asl/
```

## 3. Sync the model into the game

The game loads the copy in `client/public/asl-model/`, NOT `asl/model/`:

```bash
cp model/model.json model/model.weights.bin model/labels.json ../client/public/asl-model/
```

## 4. Push ONLY the model

```bash
cd ..     # repo root
git add asl/model/model.json asl/model/model.weights.bin asl/model/labels.json \
        client/public/asl-model/model.json client/public/asl-model/model.weights.bin client/public/asl-model/labels.json
git commit -m "Retrain ASL model (<what you added, e.g. +800 O samples from paul>)"
git push
```

That `git add` list is exactly the six model files — nothing else. Do **not**
`git add .` here: your datasets, `landmarks.json`, and the `.bak` files are
gitignored, but a blanket add can still sweep in unrelated work.

## 5. Make players actually get it

The server serves a frozen build. On the hosting laptop:

```bash
npm run build     # bakes the new model into client/dist
# restart the server; players just refresh (HTML is no-store, no hard refresh needed)
```

## Quick reference

| Step | Command |
|---|---|
| Merge new samples | `node tools/merge_landmarks.mjs data/landmarks.json` |
| Replace a letter | `... --replace O` |
| Train | `node tools/train_node.mjs data/dataset_merged.json` |
| Sync to game | `cp model/model.* model/labels.json ../client/public/asl-model/` |
| Push model only | `git add asl/model/* client/public/asl-model/*` → commit → push |
| Ship to players | `npm run build` + server restart |
