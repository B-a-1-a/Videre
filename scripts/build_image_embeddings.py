#!/usr/bin/env python3
"""
Build image and video-section embeddings for assets using google/siglip2-base-patch16-224.

- Images: one embedding per image (as before).
- Videos: each video is split into 4–5 sections by time; for each section we sample
  a few frames, encode them with SigLIP2, average the embeddings (then L2-normalize)
  and store one embedding per section. Index entries look like "video.mp4#0.0-4.0".

Saves:
  - assets/embeddings/image_embeddings.npy  (shape: [N, D])
  - assets/embeddings/image_index.json      (list of ids: image filenames + "video#start-end")

Requires: pip install torch "transformers>=4.49" pillow numpy opencv-python
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoModel, SiglipImageProcessor

# Model and paths
MODEL_ID = "google/siglip2-base-patch16-224"
REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = REPO_ROOT / "assets"
EMBEDDINGS_DIR = REPO_ROOT / "assets" / "embeddings"

# Number of sections to split each video into
VIDEO_NUM_SECTIONS = 5
# Frames to sample per section (evenly spaced in time); we average their embeddings
FRAMES_PER_SECTION = 3

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".avi", ".mkv"}


def get_video_duration_sec(path: Path) -> float:
    """Return video duration in seconds. Requires opencv-python."""
    import cv2
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    try:
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        fps = cap.get(cv2.CAP_PROP_FPS) or 1.0
        return frame_count / fps
    finally:
        cap.release()


def extract_frames_at_times(path: Path, times_sec: list[float]) -> list[Image.Image]:
    """Extract one RGB frame at each given time (seconds). Returns list of PIL Images."""
    import cv2
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    frames = []
    try:
        for t in times_sec:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
            ret, bgr = cap.read()
            if not ret or bgr is None:
                continue
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            frames.append(Image.fromarray(rgb))
    finally:
        cap.release()
    return frames


def _encode_frames(
    model, image_processor, frames: list[Image.Image], device
) -> np.ndarray:
    """Encode a list of frames and return L2-normalized average embedding (1, D)."""
    if not frames:
        return None
    embeddings = []
    for im in frames:
        inputs = image_processor(images=[im], return_tensors="pt").to(device)
        with torch.no_grad():
            out = model.get_image_features(**inputs)
        feats = out.pooler_output if out.pooler_output is not None else out.last_hidden_state[:, 0]
        embeddings.append(feats.cpu().float().numpy())
    avg = np.mean(embeddings, axis=0)
    norm = np.linalg.norm(avg, axis=-1, keepdims=True)
    if norm.any():
        avg = avg / norm
    return avg


def main() -> int:
    EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)

    image_paths = sorted(
        p for p in ASSETS_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )
    video_paths = sorted(
        p for p in ASSETS_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS
    )
    if not image_paths and not video_paths:
        print(f"No images or videos found in {ASSETS_DIR}", file=sys.stderr)
        return 1

    print(f"Loading model {MODEL_ID}...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModel.from_pretrained(
        MODEL_ID,
        dtype=torch.float16 if device == "cuda" else torch.float32,
        attn_implementation="sdpa",
    ).eval().to(device)
    image_processor = SiglipImageProcessor.from_pretrained(MODEL_ID)

    embeddings_list = []
    index = []

    # --- Images: one embedding per image ---
    for path in image_paths:
        try:
            image = Image.open(path).convert("RGB")
        except Exception as e:
            print(f"Skipping image {path.name}: {e}", file=sys.stderr)
            continue
        inputs = image_processor(images=[image], return_tensors="pt").to(device)
        with torch.no_grad():
            out = model.get_image_features(**inputs)
        feats = out.pooler_output if out.pooler_output is not None else out.last_hidden_state[:, 0]
        feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
        embeddings_list.append(feats.cpu().float().numpy())
        index.append(path.name)

    # --- Videos: split into sections, average embedding per section ---
    for path in video_paths:
        try:
            duration = get_video_duration_sec(path)
        except Exception as e:
            print(f"Skipping video {path.name}: {e}", file=sys.stderr)
            continue
        if duration <= 0:
            print(f"Skipping video {path.name}: duration <= 0", file=sys.stderr)
            continue
        n_sections = VIDEO_NUM_SECTIONS
        seg_duration = duration / n_sections
        for i in range(n_sections):
            start_sec = i * seg_duration
            end_sec = (i + 1) * seg_duration
            # Sample FRAMES_PER_SECTION times evenly in [start_sec, end_sec]
            if FRAMES_PER_SECTION == 1:
                times = [start_sec + seg_duration * 0.5]
            else:
                times = [
                    start_sec + seg_duration * (j + 1) / (FRAMES_PER_SECTION + 1)
                    for j in range(FRAMES_PER_SECTION)
                ]
            try:
                frames = extract_frames_at_times(path, times)
            except Exception as e:
                print(f"Skipping section {path.name}#{start_sec:.1f}-{end_sec:.1f}: {e}", file=sys.stderr)
                continue
            if not frames:
                continue
            emb = _encode_frames(model, image_processor, frames, device)
            if emb is not None:
                embeddings_list.append(emb)
                index.append(f"{path.name}#{start_sec:.1f}-{end_sec:.1f}")

    if not embeddings_list:
        print("No images or video sections could be processed.", file=sys.stderr)
        return 1

    embeddings = np.vstack(embeddings_list)

    np.save(EMBEDDINGS_DIR / "image_embeddings.npy", embeddings)

    with open(EMBEDDINGS_DIR / "image_index.json", "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2)

    print(f"Saved embeddings to {EMBEDDINGS_DIR}")
    print(f"  image_embeddings.npy: shape {embeddings.shape} ({len(index)} entries)")
    print(f"  image_index.json: {len([i for i in index if '#' not in i])} images, {len([i for i in index if '#' in i])} video sections")
    return 0


if __name__ == "__main__":
    sys.exit(main())
