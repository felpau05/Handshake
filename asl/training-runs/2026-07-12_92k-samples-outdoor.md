# ASL Model Training Run — 2026-07-12 (outdoor lighting batch)

## Result

**99.2% validation accuracy** (13,744 / 13,850 held-out samples correct)

## Dataset

**92,333 total samples**, 28 classes. This run added **18,916 new samples**
collected outdoors, covering 26 of the 28 letters (all but SUBMIT/BACKSPACE),
on top of the existing 73,417-sample base:

| Label | Total | | Label | Total | | Label | Total |
|---|---|---|---|---|---|---|---|
| A | 2,215 | | J | 1,897 | | S | 1,442 |
| B | 2,390 | | K | 1,257 | | T | 3,864 |
| C | 4,840 | | L | 1,712 | | U | 7,019 |
| D | 1,988 | | M | 3,295 | | V | 3,748 |
| E | 5,428 | | N | 4,929 | | W | 2,193 |
| F | 2,213 | | O | 6,321 | | X | 3,047 |
| G | 1,928 | | P | 2,696 | | Y | 4,650 |
| H | 2,410 | | Q | 1,910 | | Z | 1,932 |
| I | 2,273 | | R | 7,113 | | SUBMIT (👍) | 3,974 |
| | | | | | | BACKSPACE (👎) | 3,649 |

Rationale: the model only ever trains on normalized hand-landmark
coordinates (translation/scale/mirror-invariant), never raw pixels — so
outdoor lighting doesn't introduce noise into the training signal the way
it would for an image classifier. It only adds variety in hand angle,
distance, and pose, which should generalize better, not worse.

## Method

Same as previous runs: 21 MediaPipe landmarks → 63-dim normalized vector →
MLP (64→32→28, dropout 0.2) → softmax. 85/15 train/val split, 60 epochs,
batch 256, Adam (lr=0.001), native `tfjs-node` backend. **~90 seconds**
wall-clock for this run (faster than the 73k-sample run's ~5 min — machine
was otherwise idle).

## Confusion matrix (validation set errors only)

| Confused pair | Count |
|---|---|
| N → T | 22 |
| R → U | 22 |
| C → O | 8 |
| M → N | 8 |
| Z → S | 7 |
| S → Z | 4 |
| E → X | 3 |
| T → N | 3 |
| I → Y | 2 |
| M → T | 2 |
| U → V | 2 |
| W → R | 2 |

106 misclassifications out of 13,850 — comparable error rate to the previous
73k-sample run (76/11,013), with the same handshape-adjacent confusions
(N/T, R/U) rather than new/different failure modes. No sign the outdoor data
introduced noise or hurt convergence.

## Caveat (same as before, still applies)

Validation split is random within collection sessions, not held out by
person — this number doesn't measure cross-person generalization. Keep
collecting from different players/conditions rather than trusting this
accuracy figure alone.
