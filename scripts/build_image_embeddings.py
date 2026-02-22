#!/usr/bin/env python3
"""
Build image embeddings for assets using google/siglip2-base-patch16-224.

Reads all images from assets/, encodes them with SigLIP2, and saves:
  - assets/embeddings/image_embeddings.npy  (shape: [N, D])
  - assets/embeddings/image_index.json      (list of filenames, same order as rows)

Requires: pip install torch "transformers>=4.49" pillow numpy
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

# Image extensions to include
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def main() -> int:
    EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)

    image_paths = sorted(
        p for p in ASSETS_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )
    if not image_paths:
        print(f"No images found in {ASSETS_DIR}", file=sys.stderr)
        return 1

    print(f"Loading model {MODEL_ID}...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModel.from_pretrained(
        MODEL_ID,
        dtype=torch.float16 if device == "cuda" else torch.float32,
        attn_implementation="sdpa",
    ).eval().to(device)
    # FixRes 224 model uses same vision input as SigLIP v1: (B, C, H, W). Siglip2ImageProcessor
    # returns patch sequences (3D); use SiglipImageProcessor for 4D pixel_values.
    image_processor = SiglipImageProcessor.from_pretrained(MODEL_ID)

    embeddings_list = []
    index = []

    for path in image_paths:
        try:
            image = Image.open(path).convert("RGB")
        except Exception as e:
            print(f"Skipping {path.name}: {e}", file=sys.stderr)
            continue

        # Image-only inputs (no text)
        inputs = image_processor(images=[image], return_tensors="pt").to(device)
        with torch.no_grad():
            out = model.get_image_features(**inputs)
        # get_image_features returns BaseModelOutputWithPooling; use pooled embedding
        feats = out.pooler_output if out.pooler_output is not None else out.last_hidden_state[:, 0]
        feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
        embeddings_list.append(feats.cpu().float().numpy())
        index.append(path.name)

    if not embeddings_list:
        print("No images could be processed.", file=sys.stderr)
        return 1

    embeddings = np.vstack(embeddings_list)

    np.save(EMBEDDINGS_DIR / "image_embeddings.npy", embeddings)

    with open(EMBEDDINGS_DIR / "image_index.json", "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2)

    print(f"Saved embeddings for {len(index)} images to {EMBEDDINGS_DIR}")
    print(f"  image_embeddings.npy: shape {embeddings.shape}")
    print(f"  image_index.json: {index}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
