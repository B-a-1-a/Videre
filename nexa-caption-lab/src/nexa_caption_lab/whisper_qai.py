"""
Transcription using Whisper from Qualcomm AI Hub (qai-hub-models).

Runs the PyTorch reference implementation locally (CPU). For NPU-compiled
models on Snapdragon devices, use the qai_hub export/compile flow.

Install:  pip install "qai-hub-models[whisper-small]"
Run:      python -m nexa_caption_lab.whisper_qai path/to/video.mp4
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from nexa_caption_lab.caption_video import (
    AUDIO_EXTENSIONS,
    VIDEO_EXTENSIONS,
    CaptionSegment,
    extract_audio_with_ffmpeg,
    normalize_segments,
    to_plain_data,
    write_caption_files,
)


def transcribe_with_qai_whisper(
    audio_path: Path,
    model_size: str = "small",
    language: str | None = None,
    chunk_size: int | None = None,
) -> dict:
    """
    Transcribe audio using Qualcomm AI Hub's Whisper weights with HuggingFace
    generate() for proper timestamp-segmented output.

    chunk_size: if set, use word-level timestamps and group every N words
                into a segment. If None, use Whisper's natural sentence-level
                segmentation.
    """
    try:
        import numpy as np
        import torch
        from transformers import (
            WhisperForConditionalGeneration,
            WhisperProcessor,
        )
    except ImportError as exc:
        raise RuntimeError(
            "qai-hub-models or transformers is not installed. "
            'Run: pip install "qai-hub-models[whisper-small]"'
        ) from exc

    model_map = {
        "tiny": "openai/whisper-tiny",
        "base": "openai/whisper-base",
        "small": "openai/whisper-small",
        "medium": "openai/whisper-medium",
        "large-v2": "openai/whisper-large-v2",
        "large-v3": "openai/whisper-large-v3",
    }
    hf_id = model_map.get(model_size, f"openai/whisper-{model_size}")

    print(f"Loading {hf_id} via Qualcomm AI Hub Models...", file=sys.stderr)
    model = WhisperForConditionalGeneration.from_pretrained(hf_id)
    processor = WhisperProcessor.from_pretrained(hf_id)
    model.eval()

    # Load audio from WAV (ffmpeg already extracts to 16kHz mono WAV)
    import scipy.io.wavfile as wavfile
    sr, audio_data = wavfile.read(str(audio_path))
    audio_data = audio_data.astype(np.float32)
    if audio_data.ndim == 2:
        audio_data = audio_data.mean(-1)
    if audio_data.max() > 1.0 or audio_data.min() < -1.0:
        audio_data = audio_data / 32768.0

    input_features = processor(
        audio_data, sampling_rate=sr, return_tensors="pt"
    ).input_features

    generate_kwargs: dict = {"return_timestamps": True}
    if language:
        generate_kwargs["language"] = language

    with torch.no_grad():
        predicted_ids = model.generate(input_features, **generate_kwargs)

    output = processor.batch_decode(
        predicted_ids, skip_special_tokens=True, output_offsets=True
    )

    segments: list[CaptionSegment] = []
    full_text_parts: list[str] = []

    for item in output:
        if isinstance(item, dict):
            text = item.get("text", "").strip()
            offsets = item.get("offsets", [])
            if offsets:
                for chunk in offsets:
                    t = chunk.get("text", "").strip()
                    ts = chunk.get("timestamp", (0.0, 0.0))
                    if t and ts:
                        segments.append(CaptionSegment(
                            start=ts[0] if ts[0] is not None else 0.0,
                            end=ts[1] if ts[1] is not None else (ts[0] or 0.0) + 1.0,
                            text=t,
                        ))
            if text:
                full_text_parts.append(text)
        elif isinstance(item, str) and item.strip():
            full_text_parts.append(item.strip())

    # Fall back to timestamp token parsing if batch_decode didn't return offsets
    if not segments and predicted_ids is not None:
        segments = _extract_timestamp_segments(predicted_ids[0], processor, hf_id)

    # Subdivide sentence-level segments into smaller word-count chunks
    if chunk_size and segments:
        segments = _subdivide_segments_by_words(segments, chunk_size)

    result = {
        "segments": [
            {"start": s.start, "end": s.end, "text": s.text}
            for s in segments
        ],
        "text": " ".join(full_text_parts),
        "model": hf_id,
        "backend": "qai-hub-models (HuggingFace generate w/ timestamps)",
    }
    return result


def _subdivide_segments_by_words(
    segments: list[CaptionSegment], chunk_size: int
) -> list[CaptionSegment]:
    """
    Split each sentence-level segment into smaller chunks of chunk_size words,
    distributing the segment's time span proportionally across words.
    """
    result: list[CaptionSegment] = []
    for seg in segments:
        words = seg.text.split()
        if len(words) <= chunk_size:
            result.append(seg)
            continue

        duration = seg.end - seg.start
        time_per_word = duration / len(words)

        for i in range(0, len(words), chunk_size):
            group = words[i : i + chunk_size]
            chunk_start = seg.start + i * time_per_word
            chunk_end = seg.start + (i + len(group)) * time_per_word
            result.append(CaptionSegment(
                start=round(chunk_start, 3),
                end=round(chunk_end, 3),
                text=" ".join(group),
            ))
    return result


def _extract_timestamp_segments(
    token_ids, processor, hf_id: str
) -> list[CaptionSegment]:
    """
    Parse Whisper timestamp tokens from generated IDs to build segments.
    Whisper uses special tokens >= 50364 as timestamp markers, each
    representing 0.02-second increments.
    """
    import torch
    tokenizer = processor.tokenizer
    timestamp_begin = tokenizer.convert_tokens_to_ids("<|0.00|>")

    segments = []
    current_text_tokens = []
    seg_start = 0.0

    ids = token_ids.tolist() if isinstance(token_ids, torch.Tensor) else token_ids

    for tid in ids:
        if tid >= timestamp_begin:
            timestamp_sec = (tid - timestamp_begin) * 0.02
            if current_text_tokens:
                text = tokenizer.decode(current_text_tokens, skip_special_tokens=True).strip()
                if text:
                    segments.append(CaptionSegment(
                        start=seg_start,
                        end=timestamp_sec,
                        text=text,
                    ))
                current_text_tokens = []
            seg_start = timestamp_sec
        elif tid < tokenizer.all_special_ids[0] if tokenizer.all_special_ids else True:
            current_text_tokens.append(tid)
        else:
            # Skip special non-timestamp tokens (SOT, language, task, etc.)
            pass

    if current_text_tokens:
        text = tokenizer.decode(current_text_tokens, skip_special_tokens=True).strip()
        if text:
            segments.append(CaptionSegment(
                start=seg_start,
                end=seg_start + 1.0,
                text=text,
            ))

    return segments


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Transcribe video/audio using Whisper from Qualcomm AI Hub."
    )
    parser.add_argument("input", type=Path, help="Path to video or audio file.")
    parser.add_argument(
        "--model",
        default="small",
        choices=("tiny", "base", "small", "medium", "large-v2", "large-v3"),
        help="Whisper model size (default: small).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("outputs"),
        help="Directory for caption files (default: outputs).",
    )
    parser.add_argument(
        "--output-format",
        choices=("all", "srt", "vtt", "json"),
        default="all",
        help="Output format (default: all).",
    )
    parser.add_argument("--language", default=None, help="Optional language code (e.g. en).")
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=None,
        help="Words per segment. Uses word-level timestamps and groups N words "
             "into each subtitle chunk. Omit for sentence-level segments.",
    )
    parser.add_argument("--ffmpeg-bin", default="ffmpeg", help="ffmpeg binary for video.")
    parser.add_argument(
        "--sample-rate",
        type=int,
        default=16_000,
        help="Sample rate when extracting audio from video.",
    )
    args = parser.parse_args()

    input_path = args.input.expanduser().resolve()
    if not input_path.exists():
        parser.error(f"Input file does not exist: {input_path}")

    output_dir = args.output_dir.expanduser().resolve()

    try:
        with tempfile.TemporaryDirectory(prefix="nexa-qai-whisper-") as tmp_name:
            temp_dir = Path(tmp_name)
            suffix = input_path.suffix.lower()
            needs_extract = suffix in VIDEO_EXTENSIONS or suffix not in AUDIO_EXTENSIONS
            if needs_extract:
                audio_path = extract_audio_with_ffmpeg(
                    input_path=input_path,
                    ffmpeg_bin=args.ffmpeg_bin,
                    temp_dir=temp_dir,
                    sample_rate=args.sample_rate,
                )
            else:
                audio_path = input_path

            result = transcribe_with_qai_whisper(
                audio_path=audio_path,
                model_size=args.model,
                language=args.language or None,
                chunk_size=args.chunk_size,
            )
            segments = normalize_segments([
                CaptionSegment(s["start"], s["end"], s["text"])
                for s in result["segments"]
            ])

            if not segments:
                print("No speech segments detected.", file=sys.stderr)
                return 0

            output_base = output_dir / input_path.stem
            written = write_caption_files(
                output_base=output_base,
                segments=segments,
                raw_result=to_plain_data(result),
                output_format=args.output_format,
            )
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    for path in written:
        print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
