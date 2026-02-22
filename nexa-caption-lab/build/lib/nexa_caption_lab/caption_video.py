from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

AUDIO_EXTENSIONS = {
    ".wav",
    ".mp3",
    ".m4a",
    ".aac",
    ".flac",
    ".ogg",
    ".opus",
    ".wma",
    ".aiff",
    ".aif",
    ".alac",
}
VIDEO_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
    ".wmv",
    ".flv",
    ".m4v",
    ".webm",
    ".ts",
    ".mpeg",
    ".mpg",
}


@dataclass
class CaptionSegment:
    start: float
    end: float
    text: str


def to_plain_data(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(k): to_plain_data(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_plain_data(v) for v in value]
    for method_name in ("model_dump", "dict", "to_dict"):
        method = getattr(value, method_name, None)
        if callable(method):
            try:
                return to_plain_data(method())
            except Exception:
                continue
    if hasattr(value, "__dict__"):
        return {
            str(k): to_plain_data(v)
            for k, v in vars(value).items()
            if not str(k).startswith("_")
        }
    return str(value)


def coerce_seconds(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(",", ".")
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            pass
        parts = text.split(":")
        if len(parts) not in (2, 3):
            return None
        try:
            numbers = [float(p) for p in parts]
        except ValueError:
            return None
        if len(numbers) == 2:
            minutes, seconds = numbers
            return minutes * 60 + seconds
        hours, minutes, seconds = numbers
        return hours * 3600 + minutes * 60 + seconds
    return None


def _extract_time_range(item: dict[str, Any]) -> tuple[float | None, float | None]:
    pairs = [
        ("start", "end"),
        ("start_time", "end_time"),
        ("start_ts", "end_ts"),
        ("from", "to"),
        ("begin", "stop"),
    ]
    for start_key, end_key in pairs:
        start = coerce_seconds(item.get(start_key))
        end = coerce_seconds(item.get(end_key))
        if start is not None or end is not None:
            return start, end

    for key in ("timestamp", "timestamps", "ts", "time"):
        value = item.get(key)
        if isinstance(value, dict):
            start, end = _extract_time_range(value)
            if start is not None or end is not None:
                return start, end
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            return coerce_seconds(value[0]), coerce_seconds(value[1])

    return None, None


def _extract_text(item: dict[str, Any]) -> str:
    for key in ("text", "transcript", "content", "word", "token", "caption"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _parse_segment_list(items: list[Any]) -> list[CaptionSegment]:
    parsed: list[CaptionSegment] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        start, end = _extract_time_range(item)
        if start is None and end is None:
            continue

        if start is None:
            start = max(0.0, (end or 0.0) - 0.5)
        if end is None or end < start:
            end = start + 0.5

        text = _extract_text(item) or f"[{index}]"
        parsed.append(CaptionSegment(start=float(start), end=float(end), text=text))
    return parsed


def _parse_timestamp_pairs(value: Any) -> list[tuple[float, float]]:
    if not isinstance(value, list):
        return []

    pairs: list[tuple[float, float]] = []

    # Native path commonly returns [[start, end], ...]
    for item in value:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            start = coerce_seconds(item[0])
            end = coerce_seconds(item[1])
            if start is not None and end is not None and end >= start:
                pairs.append((start, end))

    if pairs:
        return pairs

    # C path may return flat [start, end, start, end, ...]
    numeric: list[float] = []
    for item in value:
        parsed = coerce_seconds(item)
        if parsed is not None:
            numeric.append(parsed)
    for i in range(0, len(numeric) - 1, 2):
        start = numeric[i]
        end = numeric[i + 1]
        if end >= start:
            pairs.append((start, end))

    return pairs


def _extract_timestamp_pairs_recursive(node: Any) -> list[tuple[float, float]]:
    if isinstance(node, dict):
        candidate = _parse_timestamp_pairs(node.get("timestamps"))
        if candidate:
            return candidate
        for key in ("result", "asr_result", "data", "output"):
            nested = _extract_timestamp_pairs_recursive(node.get(key))
            if nested:
                return nested
    if isinstance(node, list):
        for item in node:
            nested = _extract_timestamp_pairs_recursive(item)
            if nested:
                return nested
    return []


def _split_text_by_pairs(transcript: str, pair_count: int) -> list[str]:
    transcript = transcript.strip()
    if pair_count <= 0:
        return []
    if not transcript:
        return [f"[{i + 1}]" for i in range(pair_count)]
    if pair_count == 1:
        return [transcript]

    words = transcript.split()
    if len(words) == pair_count:
        return words

    # Evenly spread words across timestamp pairs.
    chunks: list[str] = []
    total = len(words)
    for i in range(pair_count):
        start_idx = round(i * total / pair_count)
        end_idx = round((i + 1) * total / pair_count)
        piece = " ".join(words[start_idx:end_idx]).strip()
        chunks.append(piece or f"[{i + 1}]")
    return chunks


def _extract_segments_recursive(node: Any) -> list[CaptionSegment]:
    if isinstance(node, list):
        parsed = _parse_segment_list(node)
        if parsed:
            return parsed
        for item in node:
            nested = _extract_segments_recursive(item)
            if nested:
                return nested
        return []

    if not isinstance(node, dict):
        return []

    for key in ("segments", "chunks", "words", "timestamps", "items"):
        value = node.get(key)
        if isinstance(value, list):
            parsed = _parse_segment_list(value)
            if parsed:
                return parsed

    for key in ("result", "asr_result", "data", "output"):
        nested = _extract_segments_recursive(node.get(key))
        if nested:
            return nested

    return []


def _extract_transcript_text(node: Any) -> str:
    if isinstance(node, str):
        return node.strip()

    if isinstance(node, list):
        parts = [_extract_transcript_text(item) for item in node]
        return " ".join(p for p in parts if p).strip()

    if isinstance(node, dict):
        for key in ("text", "transcript", "full_text", "caption"):
            value = node.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in ("result", "asr_result", "data", "output"):
            nested = _extract_transcript_text(node.get(key))
            if nested:
                return nested

    return ""


def normalize_segments(segments: list[CaptionSegment]) -> list[CaptionSegment]:
    normalized: list[CaptionSegment] = []
    for segment in sorted(segments, key=lambda s: (s.start, s.end)):
        start = max(0.0, float(segment.start))
        end = max(start + 0.001, float(segment.end))
        text = segment.text.strip()
        if text:
            normalized.append(CaptionSegment(start=start, end=end, text=text))
    return normalized


def extract_caption_segments(result: Any) -> list[CaptionSegment]:
    plain = to_plain_data(result)
    segments = _extract_segments_recursive(plain)

    if not segments:
        pairs = _extract_timestamp_pairs_recursive(plain)
        if pairs:
            transcript = _extract_transcript_text(plain)
            texts = _split_text_by_pairs(transcript, len(pairs))
            segments = [
                CaptionSegment(start=start, end=end, text=text)
                for (start, end), text in zip(pairs, texts, strict=False)
            ]

    if not segments:
        transcript = _extract_transcript_text(plain)
        if transcript:
            rough_duration = max(1.0, min(8.0, len(transcript.split()) / 2.5))
            segments = [CaptionSegment(start=0.0, end=rough_duration, text=transcript)]

    return normalize_segments(segments)


def format_srt_time(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1_000)
    return f"{hours:02}:{minutes:02}:{secs:02},{ms:03}"


def format_vtt_time(seconds: float) -> str:
    return format_srt_time(seconds).replace(",", ".")


def render_srt(segments: list[CaptionSegment]) -> str:
    blocks: list[str] = []
    for idx, segment in enumerate(segments, start=1):
        blocks.append(
            f"{idx}\n"
            f"{format_srt_time(segment.start)} --> {format_srt_time(segment.end)}\n"
            f"{segment.text}\n"
        )
    return "\n".join(blocks).strip() + "\n"


def render_vtt(segments: list[CaptionSegment]) -> str:
    lines = ["WEBVTT", ""]
    for segment in segments:
        lines.append(f"{format_vtt_time(segment.start)} --> {format_vtt_time(segment.end)}")
        lines.append(segment.text)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_caption_files(
    output_base: Path,
    segments: list[CaptionSegment],
    raw_result: Any,
    output_format: str,
) -> list[Path]:
    output_base.parent.mkdir(parents=True, exist_ok=True)
    selected = {"srt", "vtt", "json"} if output_format == "all" else {output_format}
    written: list[Path] = []

    if "srt" in selected:
        srt_path = output_base.with_suffix(".srt")
        srt_path.write_text(render_srt(segments), encoding="utf-8")
        written.append(srt_path)

    if "vtt" in selected:
        vtt_path = output_base.with_suffix(".vtt")
        vtt_path.write_text(render_vtt(segments), encoding="utf-8")
        written.append(vtt_path)

    if "json" in selected:
        json_path = output_base.with_suffix(".json")
        payload = {
            "segments": [asdict(segment) for segment in segments],
            "raw_result": raw_result,
        }
        json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        written.append(json_path)

    return written


def extract_audio_with_ffmpeg(
    input_path: Path,
    ffmpeg_bin: str,
    temp_dir: Path,
    sample_rate: int,
) -> Path:
    if shutil.which(ffmpeg_bin) is None:
        raise RuntimeError(
            f"'{ffmpeg_bin}' was not found in PATH. Install ffmpeg or provide an audio input file."
        )

    output_path = temp_dir / f"{input_path.stem}.wav"
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-f",
        "wav",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        stderr = proc.stderr.strip() or "Unknown ffmpeg error."
        raise RuntimeError(f"ffmpeg failed while extracting audio:\n{stderr}")

    return output_path


def transcribe_with_nexa(
    audio_path: Path,
    model_name: str,
    quant: str | None,
    plugin_id: str | None,
    device_id: str | None,
    language: str | None,
    timestamps: str,
    beam_size: int,
) -> Any:
    try:
        from nexaai import ASR
    except Exception as exc:
        raise RuntimeError(
            "Failed to import nexaai. Run `pip install -e .` (or `pip install nexaai`)."
        ) from exc

    # SDK v1 uses from_(...), while older releases may expose from_pretrained(...).
    load_kwargs: dict[str, Any] = {}
    if plugin_id:
        load_kwargs["plugin_id"] = plugin_id
    if device_id:
        load_kwargs["device_id"] = device_id
    if quant:
        load_kwargs["quant"] = quant
    if hasattr(ASR, "from_"):
        asr_model = ASR.from_(model_name, **load_kwargs)
    elif hasattr(ASR, "from_pretrained"):
        asr_model = ASR.from_pretrained(model_name, **load_kwargs)
    else:
        raise RuntimeError("Unsupported nexaai ASR loader. Expected from_ or from_pretrained.")

    try:
        return asr_model.transcribe(
            audio_path=str(audio_path),
            language=language,
            timestamps=timestamps,
            beam_size=beam_size,
        )
    except TypeError:
        # Compatibility fallback for older signatures.
        return asr_model.transcribe(str(audio_path), timestamps=timestamps)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate timestamped captions from video/audio using Nexa ASR."
    )
    parser.add_argument("input", type=Path, help="Path to the source video or audio file.")
    parser.add_argument("--model", required=True, help="Nexa ASR model id.")
    parser.add_argument("--quant", default=None, help="Optional quantization tag for model loading.")
    parser.add_argument("--plugin-id", default=None, help="Optional Nexa plugin backend.")
    parser.add_argument("--device-id", default=None, help="Optional Nexa device id.")
    parser.add_argument("--language", default=None, help="Optional transcription language code.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("outputs"),
        help="Directory for generated caption files.",
    )
    parser.add_argument(
        "--timestamps",
        choices=("segment", "word"),
        default="segment",
        help="Timestamp granularity requested from Nexa ASR.",
    )
    parser.add_argument(
        "--output-format",
        choices=("all", "srt", "vtt", "json"),
        default="all",
        help="Which output files to write.",
    )
    parser.add_argument("--beam-size", type=int, default=5, help="Beam search size for ASR decoding.")
    parser.add_argument("--api-key", help="Optional override for NEXA_API_KEY.")
    parser.add_argument("--ffmpeg-bin", default="ffmpeg", help="ffmpeg binary name/path.")
    parser.add_argument(
        "--sample-rate",
        type=int,
        default=16_000,
        help="Sample rate used when extracting audio from video.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    input_path = args.input.expanduser().resolve()
    if not input_path.exists():
        parser.error(f"Input file does not exist: {input_path}")

    api_key = args.api_key or os.getenv("NEXA_API_KEY")
    if not api_key:
        parser.error("Missing API key. Set NEXA_API_KEY or pass --api-key.")
    os.environ["NEXA_API_KEY"] = api_key

    output_dir = args.output_dir.expanduser().resolve()

    try:
        with tempfile.TemporaryDirectory(prefix="nexa-caption-") as tmp_name:
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

            result = transcribe_with_nexa(
                audio_path=audio_path,
                model_name=args.model,
                quant=args.quant,
                plugin_id=args.plugin_id,
                device_id=args.device_id,
                language=args.language,
                timestamps=args.timestamps,
                beam_size=args.beam_size,
            )
            segments = extract_caption_segments(result)

            if not segments:
                raise RuntimeError(
                    "No caption segments were found in the ASR response. "
                    "Try a different model or timestamp mode."
                )

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
