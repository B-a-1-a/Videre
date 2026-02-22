#!/usr/bin/env python3
"""
Whisper transcription via Snapdragon NPU (nexa_caption_lab.whisper_npu).

Uses the same JSON stdin/stdout protocol as whisper_transcribe.py so the
videorender server can use this as the default and switch to whisper_transcribe.py
for legacy/testing with the useLegacyWhisper flag.

Install (from repo root): pip install -e ./nexa-caption-lab[npu]
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

SETUP_HINT = (
    "Install NPU dependencies from repo root: "
    "pip install -e ./nexa-caption-lab[npu]  "
    "Requires: onnxruntime-qnn, transformers. Optional: set VIDERE_NPU_MODELS_DIR."
)


def to_float(value: Any, default: float = 0.0) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return default
    return default


def extract_audio_segment(
    ffmpeg_bin: str,
    input_path: str,
    output_path: str,
    start_sec: float,
    end_sec: float,
) -> None:
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input_path,
        "-ss",
        f"{start_sec:.3f}",
        "-to",
        f"{end_sec:.3f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        output_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = proc.stderr.strip() or "Unknown ffmpeg error."
        raise RuntimeError(detail)


def fail_results(jobs: list[dict[str, Any]], message: str) -> list[dict[str, Any]]:
    failed: list[dict[str, Any]] = []
    for job in jobs:
        scrubber_id = str(job.get("scrubberId") or "unknown")
        failed.append(
            {
                "scrubberId": scrubber_id,
                "text": "",
                "words": [],
                "clipStartSec": to_float(job.get("startSec"), default=0.0),
                "clipEndSec": to_float(job.get("endSec"), default=0.0),
                "error": message,
            }
        )
    return failed


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        print(json.dumps({"results": [], "error": f"Invalid JSON payload: {exc}"}))
        return 1

    jobs = payload.get("jobs")
    if not isinstance(jobs, list):
        print(json.dumps({"results": [], "error": "jobs must be an array"}))
        return 1

    if len(jobs) == 0:
        print(json.dumps({"results": []}))
        return 0

    ffmpeg_bin = str(payload.get("ffmpegBin") or "ffmpeg")
    models_root_raw = os.environ.get("VIDERE_NPU_MODELS_DIR", "").strip()
    if models_root_raw:
        models_root = Path(models_root_raw).expanduser().resolve()
    else:
        # Default: nexa-caption-lab/models next to repo root (parent of app/videorender)
        models_root = Path(__file__).resolve().parent.parent.parent / "nexa-caption-lab" / "models"
    backend = str(payload.get("backend") or "htp").strip().lower()
    if backend not in ("htp", "cpu"):
        backend = "htp"

    try:
        from nexa_caption_lab.whisper_npu import transcribe_with_npu
    except Exception as exc:
        print(
            json.dumps(
                {"results": fail_results(jobs, f"NPU import failed: {exc}. " + SETUP_HINT)}
            )
        )
        return 0

    results: list[dict[str, Any]] = []
    for job in jobs:
        scrubber_id = str(job.get("scrubberId") or "unknown")
        input_path = str(job.get("inputPath") or "").strip()
        start_sec = max(0.0, to_float(job.get("startSec"), default=0.0))
        end_sec = max(start_sec + 0.01, to_float(job.get("endSec"), default=start_sec + 0.01))
        if not input_path:
            results.append(
                {
                    "scrubberId": scrubber_id,
                    "text": "",
                    "words": [],
                    "clipStartSec": start_sec,
                    "clipEndSec": end_sec,
                    "error": "Missing inputPath.",
                }
            )
            continue

        temp_audio = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                temp_audio = Path(tmp.name)

            extract_audio_segment(
                ffmpeg_bin=ffmpeg_bin,
                input_path=input_path,
                output_path=str(temp_audio),
                start_sec=start_sec,
                end_sec=end_sec,
            )

            result = transcribe_with_npu(
                audio_path=temp_audio,
                models_root=models_root,
                chunk_size=None,
                backend=backend,
            )

            full_text = result.get("text") or ""
            segments = result.get("segments") or []
            # Map segments to "words" format (same as legacy): each segment = one word/phrase with start/end in clip time
            words = [
                {
                    "text": seg.get("text", "").strip(),
                    "start": start_sec + to_float(seg.get("start"), 0.0),
                    "end": start_sec + to_float(seg.get("end"), 0.0),
                }
                for seg in segments
                if seg.get("text", "").strip()
            ]
            if not full_text and words:
                full_text = " ".join(w["text"] for w in words).strip()

            results.append(
                {
                    "scrubberId": scrubber_id,
                    "text": full_text,
                    "words": words,
                    "clipStartSec": start_sec,
                    "clipEndSec": end_sec,
                    "error": None,
                }
            )
        except Exception as exc:
            results.append(
                {
                    "scrubberId": scrubber_id,
                    "text": "",
                    "words": [],
                    "clipStartSec": start_sec,
                    "clipEndSec": end_sec,
                    "error": str(exc),
                }
            )
        finally:
            if temp_audio is not None:
                try:
                    temp_audio.unlink(missing_ok=True)
                except Exception:
                    pass

    print(json.dumps({"results": results}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
