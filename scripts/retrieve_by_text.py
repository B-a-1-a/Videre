#!/usr/bin/env python3
"""
Retrieve relevant images by text query using stored SigLIP2 embeddings.

Uses nearest-neighbour search (cosine similarity) between the query text
embedding and precomputed image embeddings.

Runs fully offline after the first run: model and tokenizer are loaded from
the Hugging Face cache (local_files_only=True). The first run needs internet
to download google/siglip2-base-patch16-224.

Usage:
  python scripts/retrieve_by_text.py "a skateboard"
  python scripts/retrieve_by_text.py "random scenery" -k 3

Requires: pip install torch transformers numpy
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModel, Siglip2Tokenizer

REPO_ROOT = Path(__file__).resolve().parent.parent
EMBEDDINGS_DIR = REPO_ROOT / "assets" / "embeddings"
MODEL_ID = "google/siglip2-base-patch16-224"


def load_embeddings() -> tuple[np.ndarray, list[str]]:
    """Load saved image embeddings and index. Raises if not found."""
    emb_path = EMBEDDINGS_DIR / "image_embeddings.npy"
    index_path = EMBEDDINGS_DIR / "image_index.json"
    if not emb_path.exists() or not index_path.exists():
        raise FileNotFoundError(
            f"Embeddings not found. Run first: python scripts/build_image_embeddings.py"
        )
    embeddings = np.load(emb_path)
    with open(index_path, encoding="utf-8") as f:
        index = json.load(f)
    return embeddings, index


def get_text_embedding(model, tokenizer, text: str, device) -> np.ndarray:
    """Encode a single text and return L2-normalized embedding."""
    # SigLIP2: padding="max_length", max_length=64, lowercase (tokenizer default)
    inputs = tokenizer(
        [text],
        padding="max_length",
        max_length=64,
        truncation=True,
        return_tensors="pt",
    ).to(device)
    with torch.no_grad():
        out = model.get_text_features(**inputs)
    feats = out.pooler_output if out.pooler_output is not None else out.last_hidden_state[:, 0]
    feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
    return feats.cpu().float().numpy()


def search(
    query: str,
    top_k: int = 5,
    embeddings_dir: Path | None = None,
) -> list[tuple[str, float]]:
    """
    Return top-k (filename, score) pairs for the text query.
    Score is cosine similarity in [0, 1] (higher = more similar).
    """
    dir_ = embeddings_dir or EMBEDDINGS_DIR
    embeddings, index = load_embeddings()
    # Load model for text encoding
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModel.from_pretrained(
        MODEL_ID,
        dtype=torch.float16 if device == "cuda" else torch.float32,
        attn_implementation="sdpa",
        local_files_only=True,
    ).eval().to(device)
    tokenizer = Siglip2Tokenizer.from_pretrained(MODEL_ID, local_files_only=True)
    device = next(model.parameters()).device

    q = get_text_embedding(model, tokenizer, query, device)
    # Cosine similarity (embeddings already normalized)
    scores = (embeddings @ q.T).squeeze(1)
    # Clamp to [0, 1] for display (cosine can be in [-1,1])
    scores = np.clip(scores, 0.0, 1.0)

    order = np.argsort(-scores)[:top_k]
    return [(index[i], float(scores[i])) for i in order]


def main() -> int:
    parser = argparse.ArgumentParser(description="Retrieve images by text query")
    parser.add_argument("query", help="Text query (e.g. 'a skateboard')")
    parser.add_argument("-k", type=int, default=5, help="Number of results (default: 5)")
    args = parser.parse_args()

    try:
        results = search(args.query, top_k=args.k)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 1

    for filename, score in results:
        print(f"{score:.4f}\t{filename}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
