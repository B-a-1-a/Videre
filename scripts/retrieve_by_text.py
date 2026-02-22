#!/usr/bin/env python3
"""
Retrieve relevant images by text query using stored SigLIP2 embeddings.

For best results, describe what is *in* the image (e.g. "food", "a skateboard",
"person eating") rather than abstract intents ("i want food"). The script
automatically wraps your query as "This is a photo of <query>." to match how
SigLIP2 was trained. Use --raw to skip that and use your exact text.

Runs fully offline after the first run (local_files_only=True).

Usage:
  python scripts/retrieve_by_text.py "food"
  python scripts/retrieve_by_text.py "a skateboard" -k 3
  python scripts/retrieve_by_text.py "i want food" --raw   # use exact query

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

# SigLIP2 zero-shot style; improves retrieval when query describes visual content
PROMPT_TEMPLATE = "This is a photo of {}."


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
    raw_query: bool = False,
) -> list[tuple[str, float]]:
    """
    Return top-k (filename, score) pairs for the text query.
    Score is cosine similarity in [0, 1] (higher = more similar).
    If raw_query is False, query is wrapped as "This is a photo of <query>." for better matching.
    """
    dir_ = embeddings_dir or EMBEDDINGS_DIR
    embeddings, index = load_embeddings()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModel.from_pretrained(
        MODEL_ID,
        dtype=torch.float16 if device == "cuda" else torch.float32,
        attn_implementation="sdpa",
        local_files_only=True,
    ).eval().to(device)
    tokenizer = Siglip2Tokenizer.from_pretrained(MODEL_ID, local_files_only=True)
    device = next(model.parameters()).device

    text = query if raw_query else PROMPT_TEMPLATE.format(query.strip())
    q = get_text_embedding(model, tokenizer, text, device)
    # Cosine similarity (embeddings already normalized)
    scores = (embeddings @ q.T).squeeze(1)
    # Clamp to [0, 1] for display (cosine can be in [-1,1])
    scores = np.clip(scores, 0.0, 1.0)

    order = np.argsort(-scores)[:top_k]
    return [(index[i], float(scores[i])) for i in order]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Retrieve images by text query. Use descriptive phrases (e.g. 'food', 'a skateboard')."
    )
    parser.add_argument("query", help="What to search for (e.g. 'food', 'person skating')")
    parser.add_argument("-k", type=int, default=5, help="Number of results (default: 5)")
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Use query as-is instead of wrapping as 'This is a photo of <query>.'",
    )
    args = parser.parse_args()

    try:
        results = search(args.query, top_k=args.k, raw_query=args.raw)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 1

    for filename, score in results:
        print(f"{score:.4f}\t{filename}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
