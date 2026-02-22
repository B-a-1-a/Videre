"""
Local transcription using faster-whisper. No API keys or cloud required.

Install: pip install ".[local]"   (or pip install faster-whisper)
Run:     nexa-caption-local path/to/audio_or_video.mp4 [options]
         or: python -m nexa_caption_lab.whisper_local path/to/audio.mp3
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from nexa_caption_lab.caption_video import (
    AUDIO_EXTENSIONS,
    VIDEO_EXTENSIONS,
    extract_audio_with_ffmpeg,
    extract_caption_segments,
    to_plain_data,
    write_caption_files,
)


def transcribe_with_faster_whisper(
    audio_path: Path,
    model_size: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
    language: str | None = None,
) -> dict:
    """
    Transcribe audio with faster-whisper locally. Returns a dict with a
    "segments" list compatible with extract_caption_segments().
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper is not installed. Run: pip install faster-whisper "
            "or pip install '.[local]' from nexa-caption-lab."
        ) from exc

    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        word_timestamps=False,
        vad_filter=True,
    )
    segments_list = list(segments_iter)

    # Build result in the same shape caption_video expects (segments with start/end/text).
    result = {
        "segments": [
            {
                "start": seg.start,
                "end": seg.end,
                "text": (seg.text or "").strip(),
            }
            for seg in segments_list
            if (seg.text or "").strip()
        ],
        "language": getattr(info, "language", None),
    }
    return result


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Transcribe video/audio locally with faster-whisper (no API key)."
    )
    parser.add_argument("input", type=Path, help="Path to video or audio file.")
    parser.add_argument(
        "--model",
        default="small",
        choices=("tiny", "base", "small", "medium", "large-v2", "large-v3"),
        help="Whisper model size (default: small).",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        choices=("cpu", "cuda", "auto"),
        help="Device to run on (default: cpu).",
    )
    parser.add_argument(
        "--compute-type",
        default="int8",
        choices=("float16", "int8"),
        help="Compute type; int8 is faster on CPU (default: int8).",
    )
    parser.add_argument("--language", default=None, help="Optional language code (e.g. en).")
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
        with tempfile.TemporaryDirectory(prefix="nexa-whisper-") as tmp_name:
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

            result = transcribe_with_faster_whisper(
                audio_path=audio_path,
                model_size=args.model,
                device=args.device,
                compute_type=args.compute_type,
                language=args.language or None,
            )
            segments = extract_caption_segments(result)

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
