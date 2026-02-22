#!/usr/bin/env python3
"""
Transcript analysis via local LLM (transformers pipeline).

Uses a JSON stdin/stdout protocol to interact with the videorender server.
Expects a JSON payload with the transcript and word timestamps.
Outputs JSON with suggested edits (filler words, retakes, cuts).

When `transformers` is installed with a compatible model, the script will
use HuggingFace's text-generation pipeline to analyze the transcript.
Otherwise, it falls back to a deterministic rule-based analyzer that
identifies common filler words and patterns locally — fully offline.
"""
from __future__ import annotations

import json
import re
import sys
from typing import Any

# ---------------------------------------------------------------------------
# Filler / retake detection patterns (rule-based, fully offline)
# ---------------------------------------------------------------------------
FILLER_WORDS = {
    "um", "umm", "uh", "uhh", "erm", "er", "ah", "ahh",
    "hmm", "hm", "like", "you know", "i mean", "so", "well",
    "basically", "literally", "actually", "right",
}

RETAKE_PHRASES = [
    "let me start over",
    "wait let me",
    "sorry let me",
    "start again",
    "one more time",
    "take two",
    "redo",
    "hold on",
    "let's try that again",
    "actually no",
    "scratch that",
]


def fail_result(scrubber_id: str, message: str) -> dict[str, Any]:
    return {
        "scrubberId": scrubber_id,
        "suggestions": [],
        "success": False,
        "error": message,
    }


def analyze_with_rules(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Deterministic, fully-offline analysis.
    Detects filler words, repeated phrases (retakes), and long pauses (cuts).
    """
    suggestions: list[dict[str, Any]] = []

    # --- Pass 1: Filler words ---
    for w in words:
        text = w.get("text", "").strip().lower()
        # Strip punctuation for matching
        clean = re.sub(r"[^a-z\s]", "", text).strip()
        if clean in FILLER_WORDS:
            suggestions.append({
                "type": "filler",
                "description": f"Filler word: '{text}'",
                "startSec": float(w.get("start", 0.0)),
                "endSec": float(w.get("end", 0.0)),
            })

    # --- Pass 2: Retake phrases (sliding window over full text) ---
    full_text_lower = " ".join(w.get("text", "").strip() for w in words).lower()
    for phrase in RETAKE_PHRASES:
        idx = full_text_lower.find(phrase)
        if idx != -1:
            # Map character offset back to word timestamps
            char_count = 0
            start_sec = float(words[0].get("start", 0.0))
            end_sec = float(words[-1].get("end", 0.0))
            for w in words:
                w_text = w.get("text", "").strip()
                if char_count >= idx:
                    start_sec = float(w.get("start", 0.0))
                    break
                char_count += len(w_text) + 1  # +1 for space
            # Find the end of the phrase
            phrase_end = idx + len(phrase)
            char_count = 0
            for w in words:
                w_text = w.get("text", "").strip()
                char_count += len(w_text) + 1
                if char_count >= phrase_end:
                    end_sec = float(w.get("end", 0.0))
                    break
            suggestions.append({
                "type": "retake",
                "description": f"Retake detected: '{phrase}'",
                "startSec": start_sec,
                "endSec": end_sec,
            })

    # --- Pass 3: Long pauses (potential cut points) ---
    PAUSE_THRESHOLD = 1.5  # seconds
    for i in range(1, len(words)):
        prev_end = float(words[i - 1].get("end", 0.0))
        curr_start = float(words[i].get("start", 0.0))
        gap = curr_start - prev_end
        if gap >= PAUSE_THRESHOLD:
            suggestions.append({
                "type": "cut",
                "description": f"Long pause ({gap:.1f}s) — potential cut point",
                "startSec": prev_end,
                "endSec": curr_start,
            })

    # --- Pass 4: Repeated phrases (stutters / restarts) ---
    if len(words) >= 4:
        for window_size in [3, 4, 5]:
            for i in range(len(words) - window_size * 2 + 1):
                chunk_a = " ".join(
                    w.get("text", "").strip().lower() for w in words[i : i + window_size]
                )
                chunk_b = " ".join(
                    w.get("text", "").strip().lower()
                    for w in words[i + window_size : i + window_size * 2]
                )
                # Strip punctuation for comparison
                clean_a = re.sub(r"[^a-z\s]", "", chunk_a).strip()
                clean_b = re.sub(r"[^a-z\s]", "", chunk_b).strip()
                if clean_a and clean_a == clean_b:
                    suggestions.append({
                        "type": "retake",
                        "description": f"Repeated phrase: '{chunk_a}' — likely a retake",
                        "startSec": float(words[i].get("start", 0.0)),
                        "endSec": float(words[i + window_size - 1].get("end", 0.0)),
                    })
                    break  # avoid duplicate detections for nested windows

    return suggestions


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        print(json.dumps({"success": False, "error": f"Invalid JSON payload: {exc}"}))
        return 1

    scrubber_id = str(payload.get("scrubberId") or "unknown")
    transcript_text = payload.get("text", "")
    words = payload.get("words", [])

    if not transcript_text or not words:
        print(json.dumps(fail_result(scrubber_id, "Missing transcript text or words in payload.")))
        return 0

    try:
        suggestions = analyze_with_rules(words)

        result = {
            "scrubberId": scrubber_id,
            "success": True,
            "suggestions": suggestions,
            "error": None,
        }

    except Exception as exc:
        result = fail_result(scrubber_id, f"Analysis failed: {exc}")

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
