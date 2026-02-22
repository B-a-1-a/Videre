#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable

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


def resolve_device(raw_device: str) -> tuple[str, int]:
    device = (raw_device or "auto").strip().lower()
    if device == "auto":
        try:
            import torch

            if torch.cuda.is_available():
                return ("cuda", 0)
        except Exception:
            pass
        return ("cpu", 0)
    if device in {"cpu", "-1"}:
        return ("cpu", 0)
    if device.startswith("cuda"):
        if ":" in device:
            return ("cuda", max(0, to_int(device.split(":", 1)[1], default=0)))
        return ("cuda", 0)
    parsed = to_int(device, default=-1)
    if parsed >= 0:
        return ("cuda", parsed)
    return ("cpu", 0)


def normalize_compute_type(raw_compute_type: Any, device_name: str) -> str:
    requested = str(raw_compute_type or "").strip().lower()
    if device_name == "cuda":
        allowed = {"int8", "int8_float16", "float16", "float32"}
        default = "int8_float16"
        if not requested:
            return default
        if requested in allowed:
            return requested
        if requested == "int8_float32":
            return "int8"
        return default

    allowed_cpu = {"int8", "int8_float32", "float32"}
    default_cpu = "int8"
    if not requested:
        return default_cpu
    if requested in allowed_cpu:
        return requested
    if requested in {"float16", "int8_float16"}:
        return default_cpu
    return default_cpu


def normalize_chunk_seconds(raw_chunk_seconds: Any) -> float:
    parsed = to_float(raw_chunk_seconds, default=45.0)
    if parsed <= 0:
        parsed = 45.0
    return max(5.0, min(600.0, parsed))


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


def normalize_words_from_transformers(
    chunks: Any, clip_start_sec: float
) -> list[dict[str, float | str]]:
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
        if end_val < start_val:
            end_val = start_val

        words.append(
            {
                "text": text,
                "start": max(0.0, clip_start_sec + float(start_val)),
                "end": max(0.0, clip_start_sec + float(end_val)),
            }
        )
    return words


def normalize_words_from_faster_whisper(
    segments: Iterable[Any],
    clip_start_sec: float,
    with_word_timestamps: bool,
) -> tuple[list[str], list[dict[str, float | str]]]:
    text_parts: list[str] = []
    words: list[dict[str, float | str]] = []

    for segment in segments:
        segment_text = str(getattr(segment, "text", "") or "").strip()
        if segment_text:
            text_parts.append(segment_text)
        if not with_word_timestamps:
            continue

        segment_words = getattr(segment, "words", None)
        if segment_words is None:
            continue

        for word in segment_words:
            token = str(getattr(word, "word", "") or "").strip()
            if not token:
                continue
            start_val = getattr(word, "start", None)
            end_val = getattr(word, "end", None)
            if start_val is None and end_val is None:
                continue
            start_num = max(0.0, to_float(start_val, default=0.0))
            end_num = max(start_num, to_float(end_val, default=start_num))
            words.append(
                {
                    "text": token,
                    "start": clip_start_sec + start_num,
                    "end": clip_start_sec + end_num,
                }
            )

    return (text_parts, words)


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


def load_faster_whisper_model(
    model: str, device_name: str, device_index: int, compute_type: str
) -> Any:
    from faster_whisper import WhisperModel

    return WhisperModel(
        model_size_or_path=model,
        device=device_name,
        device_index=device_index,
        compute_type=compute_type,
    )


def load_transformers_pipeline(
    model: str, device_name: str, device_index: int, compute_type: str
) -> Any:
    import torch
    from transformers import pipeline

    torch_dtype = torch.float32
    if device_name == "cuda" and compute_type in {"float16", "int8_float16"}:
        torch_dtype = torch.float16

    device = device_index if device_name == "cuda" else -1
    return pipeline(
        "automatic-speech-recognition",
        model=model,
        device=device,
        torch_dtype=torch_dtype,
    )


def transcribe_chunk_with_faster_whisper(
    model_runner: Any,
    audio_path: str,
    timestamps: str,
    chunk_start_sec: float,
) -> tuple[str, list[dict[str, float | str]]]:
    with_word_timestamps = timestamps == "word"
    segments, _info = model_runner.transcribe(
        audio_path,
        task="transcribe",
        beam_size=1,
        best_of=1,
        temperature=0.0,
        condition_on_previous_text=False,
        word_timestamps=with_word_timestamps,
    )
    text_parts, words = normalize_words_from_faster_whisper(
        segments, clip_start_sec=chunk_start_sec, with_word_timestamps=with_word_timestamps
    )
    text = " ".join(part for part in text_parts if part).strip()
    return (text, words)


def transcribe_chunk_with_transformers(
    asr: Any,
    audio_path: str,
    timestamps: str,
    chunk_start_sec: float,
) -> tuple[str, list[dict[str, float | str]]]:
    if timestamps == "word":
        raw_result = asr(audio_path, return_timestamps="word")
    else:
        raw_result = asr(audio_path)

    text = ""
    chunks: Any = []
    if isinstance(raw_result, dict):
        text = str(raw_result.get("text") or "").strip()
        chunks = raw_result.get("chunks")
    else:
        text = str(raw_result).strip()

    words = normalize_words_from_transformers(chunks, clip_start_sec=chunk_start_sec)
    if not text and words:
        text = " ".join(str(word["text"]) for word in words).strip()
    return (text, words)


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
    device_name, device_index = resolve_device(str(payload.get("device") or "auto"))
    compute_type = normalize_compute_type(payload.get("computeType"), device_name)
    chunk_seconds = normalize_chunk_seconds(payload.get("chunkSeconds"))

    runner_backend = ""
    faster_runner: Any | None = None
    transformers_runner: Any | None = None
    backend_failures: list[str] = []

    try:
        faster_runner = load_faster_whisper_model(
            model=model,
            device_name=device_name,
            device_index=device_index,
            compute_type=compute_type,
        )
        runner_backend = "faster-whisper"
    except Exception as exc:
        backend_failures.append(f"faster-whisper unavailable: {exc}")

    if faster_runner is None:
        try:
            transformers_runner = load_transformers_pipeline(
                model=model,
                device_name=device_name,
                device_index=device_index,
                compute_type=compute_type,
            )
            runner_backend = "transformers"
        except Exception as exc:
            backend_failures.append(f"transformers fallback unavailable: {exc}")

    if faster_runner is None and transformers_runner is None:
        message = (
            "Failed to load any Whisper backend. "
            + " | ".join(backend_failures)
            + f". {SETUP_HINT}"
        )
        print(json.dumps({"results": fail_results(jobs, message)}))
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

        text_parts: list[str] = []
        words: list[dict[str, float | str]] = []
        try:
            chunk_start = start_sec
            while chunk_start < end_sec:
                chunk_end = min(end_sec, chunk_start + chunk_seconds)
                if chunk_end <= chunk_start:
                    chunk_end = min(end_sec, chunk_start + 0.01)
                if chunk_end <= chunk_start:
                    break

                temp_audio = None
                try:
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                        temp_audio = Path(tmp.name)

                    extract_audio_segment(
                        ffmpeg_bin=ffmpeg_bin,
                        input_path=input_path,
                        output_path=str(temp_audio),
                        start_sec=chunk_start,
                        end_sec=chunk_end,
                    )

                    if faster_runner is not None:
                        chunk_text, chunk_words = transcribe_chunk_with_faster_whisper(
                            model_runner=faster_runner,
                            audio_path=str(temp_audio),
                            timestamps=timestamps,
                            chunk_start_sec=chunk_start,
                        )
                    else:
                        chunk_text, chunk_words = transcribe_chunk_with_transformers(
                            asr=transformers_runner,
                            audio_path=str(temp_audio),
                            timestamps=timestamps,
                            chunk_start_sec=chunk_start,
                        )

                    if chunk_text:
                        text_parts.append(chunk_text)
                    if chunk_words:
                        words.extend(chunk_words)
                finally:
                    if temp_audio is not None:
                        try:
                            temp_audio.unlink(missing_ok=True)
                        except Exception:
                            pass

                chunk_start = chunk_end

            text = " ".join(part for part in text_parts if part).strip()
            if not text and words:
                text = " ".join(str(word["text"]) for word in words).strip()

            results.append(
                {
                    "scrubberId": scrubber_id,
                    "text": text,
                    "words": words,
                    "clipStartSec": start_sec,
                    "clipEndSec": end_sec,
                    "error": None,
                    "backend": runner_backend,
                    "computeType": compute_type,
                    "chunkSeconds": chunk_seconds,
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
                    "backend": runner_backend or None,
                }
            )

    print(json.dumps({"results": results}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
