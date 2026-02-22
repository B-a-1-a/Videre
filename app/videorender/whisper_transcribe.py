#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

SETUP_HINT = (
    "Install dependencies in a Python 3.12 venv: "
    "python3.12 -m venv .venv-whisper && "
    ".venv-whisper/bin/pip install -r app/videorender/requirements-whisper.txt"
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


def to_int(value: Any, default: int = 0) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError:
            return default
    return default


def resolve_device(raw_device: str) -> int:
    try:
        import torch
    except Exception:
        torch = None  # type: ignore[assignment]

    device = (raw_device or "auto").strip().lower()
    if device == "auto":
        if torch is not None and torch.cuda.is_available():
            return 0
        return -1
    if device in {"cpu", "-1"}:
        return -1
    if device.startswith("cuda"):
        if ":" in device:
            return to_int(device.split(":", 1)[1], default=0)
        return 0
    return to_int(device, default=-1)


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


def normalize_words(chunks: Any, clip_start_sec: float) -> list[dict[str, float | str]]:
    if not isinstance(chunks, list):
        return []

    words: list[dict[str, float | str]] = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        text = str(chunk.get("text") or "").strip()
        if not text:
            continue

        timestamp = chunk.get("timestamp")
        start_val: float | None = None
        end_val: float | None = None
        if isinstance(timestamp, (list, tuple)) and len(timestamp) >= 2:
            if timestamp[0] is not None:
                start_val = to_float(timestamp[0], default=0.0)
            if timestamp[1] is not None:
                end_val = to_float(timestamp[1], default=0.0)
        elif isinstance(timestamp, dict):
            if timestamp.get("start") is not None:
                start_val = to_float(timestamp.get("start"), default=0.0)
            if timestamp.get("end") is not None:
                end_val = to_float(timestamp.get("end"), default=0.0)

        if start_val is None or end_val is None:
            continue

        words.append(
            {
                "text": text,
                "start": max(0.0, clip_start_sec + float(start_val)),
                "end": max(0.0, clip_start_sec + float(end_val)),
            }
        )
    return words


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

    model = str(payload.get("model") or "openai/whisper-small")
    timestamps = str(payload.get("timestamps") or "word")
    ffmpeg_bin = str(payload.get("ffmpegBin") or "ffmpeg")
    device = resolve_device(str(payload.get("device") or "auto"))

    try:
        import torch  # noqa: F401
    except Exception as exc:
        print(
            json.dumps(
                {"results": fail_results(jobs, f"torch import failed: {exc}. {SETUP_HINT}")}
            )
        )
        return 0

    try:
        from transformers import pipeline
    except Exception as exc:
        print(
            json.dumps(
                {
                    "results": fail_results(
                        jobs, f"transformers import failed: {exc}. {SETUP_HINT}"
                    )
                }
            )
        )
        return 0

    try:
        asr = pipeline(
            "automatic-speech-recognition",
            model=model,
            device=device,
        )
    except Exception as exc:
        print(
            json.dumps(
                {
                    "results": fail_results(
                        jobs,
                        f"Failed to load model '{model}'. Install dependencies and verify model availability. {exc}",
                    )
                }
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

            if timestamps == "word":
                raw_result = asr(str(temp_audio), return_timestamps="word")
            else:
                raw_result = asr(str(temp_audio))

            text = ""
            chunks: Any = []
            if isinstance(raw_result, dict):
                text = str(raw_result.get("text") or "").strip()
                chunks = raw_result.get("chunks")
            else:
                text = str(raw_result).strip()

            words = normalize_words(chunks, clip_start_sec=start_sec)
            if not text and words:
                text = " ".join(word["text"] for word in words).strip()

            results.append(
                {
                    "scrubberId": scrubber_id,
                    "text": text,
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
