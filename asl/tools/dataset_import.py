#!/usr/bin/env python3
"""Batch-convert an ASL image dataset into landmarks.json for the training page.

Uses the MediaPipe **Tasks** HandLandmarker — the same model the browser runtime
uses (@mediapipe/tasks-vision) — plus the SAME normalization as src/normalize.ts,
so training and serving can't drift. Camera-free batch job → runs fine under WSL2.

Expected dataset layout (e.g. Kaggle "ASL Alphabet"): one folder per letter,
    <root>/A/*.jpg  <root>/B/*.jpg  ...
If <root> instead contains a single wrapper folder (Kaggle's double-nesting), it
is auto-detected. Non-letter folders (J, Z, space, del, nothing) are skipped.

Usage:
    pip install -r tools/requirements.txt
    python tools/dataset_import.py <dataset_root> -o data/dataset_landmarks.json --max-per-letter 400
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.request

# Full alphabet. J and Z are motion signs — imported here as single static frames
# anyway, so their landmark vectors will overlap I / D respectively.
LETTERS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

WRIST = 0
MIDDLE_MCP = 9  # base knuckle of the middle finger — stable scale reference

HAND_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
DEFAULT_MODEL_PATH = "model/hand_landmarker.task"


def normalize_landmarks(landmarks: list[tuple[float, float, float]], handedness: str) -> list[float]:
    """Port of normalize.ts — MUST stay byte-identical to it.

    landmarks: 21 (x, y, z) tuples from MediaPipe (image-normalized).
    handedness: 'Left' or 'Right'. Translate to wrist, scale by |wrist->mid MCP|,
    mirror x for left hands. Returns a flat 63-element list.
    """
    wx, wy, wz = landmarks[WRIST]
    mx, my, mz = landmarks[MIDDLE_MCP]
    scale = math.hypot(mx - wx, my - wy, mz - wz) or 1e-6
    mirror = -1.0 if handedness == "Left" else 1.0

    out: list[float] = []
    for x, y, z in landmarks:
        out.append((mirror * (x - wx)) / scale)
        out.append((y - wy) / scale)
        out.append((z - wz) / scale)
    return out


def iter_images(folder: str):
    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    for name in sorted(os.listdir(folder)):
        # Note: Windows ":Zone.Identifier" tag files split to ext ".Identifier" → skipped.
        if os.path.splitext(name)[1].lower() in exts:
            yield os.path.join(folder, name)


def resolve_root(root: str) -> str:
    """Return the folder that actually holds the per-letter subfolders, descending
    through a single wrapper dir if needed (Kaggle's asl_alphabet_train/asl_alphabet_train)."""
    if any(os.path.isdir(os.path.join(root, l)) for l in LETTERS):
        return root
    for child in sorted(os.listdir(root)):
        cpath = os.path.join(root, child)
        if os.path.isdir(cpath) and any(os.path.isdir(os.path.join(cpath, l)) for l in LETTERS):
            print(f"(auto-descended into wrapper folder: {child})")
            return cpath
    return root


def ensure_model(path: str) -> None:
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    print(f"Downloading hand_landmarker.task → {path} …")
    urllib.request.urlretrieve(HAND_MODEL_URL, path)


def main() -> int:
    parser = argparse.ArgumentParser(description="ASL image dataset -> landmarks.json")
    parser.add_argument("root", help="dataset root containing one subfolder per letter")
    parser.add_argument("-o", "--out", default="data/dataset_landmarks.json")
    parser.add_argument("--max-per-letter", type=int, default=0, help="0 = no cap")
    parser.add_argument("--hand-model", default=DEFAULT_MODEL_PATH)
    # 0.3 (not MediaPipe's 0.5 default) because the dataset's tightly-cropped,
    # hand-fills-frame images make cold static detection hard, especially on fists
    # (M/N/S/T). 0.3 recovers ~80% vs ~47% at 0.5, without the junk detections 0.1 lets in.
    parser.add_argument("--min-detection-confidence", type=float, default=0.3)
    args = parser.parse_args()

    root = resolve_root(args.root)
    if not any(os.path.isdir(os.path.join(root, l)) for l in LETTERS):
        print(f"ERROR: no letter folders (A, B, …) found under {args.root}", file=sys.stderr)
        return 2

    ensure_model(args.hand_model)

    # Lazy imports so normalize_landmarks/iter_images stay testable without mediapipe.
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    detector = vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=args.hand_model),
            running_mode=vision.RunningMode.IMAGE,
            num_hands=1,
            min_hand_detection_confidence=args.min_detection_confidence,
        )
    )

    samples: list[dict] = []
    for letter in LETTERS:
        folder = os.path.join(root, letter)
        if not os.path.isdir(folder):
            print(f"  {letter}: (no folder, skipped)")
            continue
        kept = missed = 0
        for path in iter_images(folder):
            if args.max_per_letter and kept >= args.max_per_letter:
                break
            try:
                image = mp.Image.create_from_file(path)
            except Exception:
                continue
            result = detector.detect(image)
            if not result.hand_landmarks:
                missed += 1
                continue
            lm = result.hand_landmarks[0]
            coords = [(p.x, p.y, p.z) for p in lm]
            handedness = "Right"
            if result.handedness:
                handedness = result.handedness[0][0].category_name
            samples.append({"label": letter, "vector": normalize_landmarks(coords, handedness)})
            kept += 1
        print(f"  {letter}: {kept} kept, {missed} no-hand")

    detector.close()
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(samples, f)
    print(f"\nWrote {len(samples)} samples -> {args.out}")
    print("Load it (and optionally your collected landmarks.json) in the training page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
