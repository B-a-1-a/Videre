from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_MODEL = "NexaAI/Qwen3-VL-4B-GGUF"


@dataclass
class VideoMetadata:
    duration: float
    width: int | None
    height: int | None
    fps: float | None


@dataclass
class FrameSample:
    index: int
    timestamp: float
    path: Path


def run_checked(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        stderr = proc.stderr.strip() or "Unknown command error."
        raise RuntimeError(f"Command failed:\n{' '.join(cmd)}\n\n{stderr}")
    return proc


def require_binary(binary_name: str) -> None:
    if shutil.which(binary_name) is None:
        raise RuntimeError(f"'{binary_name}' was not found in PATH.")


def slugify(value: str, max_length: int = 40) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    slug = slug or "query"
    return slug[:max_length].rstrip("-")


def parse_float_time(value: Any) -> float | None:
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
            numbers = [float(part) for part in parts]
        except ValueError:
            return None
        if len(numbers) == 2:
            minutes, seconds = numbers
            return minutes * 60 + seconds
        hours, minutes, seconds = numbers
        return hours * 3600 + minutes * 60 + seconds
    return None


def format_timecode(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02}.{ms:03}"


def parse_range_token(token: str) -> tuple[float, float]:
    if "-" not in token:
        raise ValueError(f"Invalid range '{token}' (expected START-END).")
    left, right = token.split("-", 1)
    start = parse_float_time(left)
    end = parse_float_time(right)
    if start is None or end is None:
        raise ValueError(f"Invalid range '{token}' (unparseable times).")
    if end <= start:
        raise ValueError(f"Invalid range '{token}' (end must be > start).")
    return start, end


def parse_ranges_arg(raw: str) -> list[tuple[float, float]]:
    ranges: list[tuple[float, float]] = []
    for piece in [part.strip() for part in raw.split(",") if part.strip()]:
        ranges.append(parse_range_token(piece))
    if not ranges:
        raise ValueError("No valid ranges provided.")
    return ranges


def parse_indices_arg(raw: str) -> list[int]:
    values: list[int] = []
    for piece in [part.strip() for part in raw.split(",") if part.strip()]:
        try:
            idx = int(piece)
        except ValueError as exc:
            raise ValueError(f"Invalid index '{piece}'.") from exc
        if idx < 1:
            raise ValueError("Indices are 1-based and must be >= 1.")
        values.append(idx)
    if not values:
        raise ValueError("No valid indices provided.")
    return values


def tokenize(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", value.lower())


def score_query_match(query: str, text: str) -> float:
    query_tokens = set(tokenize(query))
    text_tokens = set(tokenize(text))
    if not query_tokens or not text_tokens:
        return 0.0
    overlap = len(query_tokens & text_tokens)
    if overlap == 0 and query.lower() not in text.lower():
        return 0.0

    coverage = overlap / len(query_tokens)
    density = overlap / max(1, len(text_tokens))
    phrase_bonus = 0.3 if query.lower() in text.lower() else 0.0
    return coverage * 0.75 + density * 0.2 + phrase_bonus


def extract_first_json_object(text: str) -> dict[str, Any] | None:
    candidate = text.strip()
    fence_match = re.search(r"```(?:json)?\s*(.*?)```", candidate, re.IGNORECASE | re.DOTALL)
    if fence_match:
        candidate = fence_match.group(1).strip()

    try:
        loaded = json.loads(candidate)
        if isinstance(loaded, dict):
            return loaded
    except json.JSONDecodeError:
        pass

    start_positions = [idx for idx, char in enumerate(candidate) if char == "{"]
    for start in start_positions:
        depth = 0
        for idx in range(start, len(candidate)):
            char = candidate[idx]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    chunk = candidate[start : idx + 1]
                    try:
                        loaded = json.loads(chunk)
                    except json.JSONDecodeError:
                        break
                    if isinstance(loaded, dict):
                        return loaded
                    break
    return None


def to_float(value: Any, default: float = 0.0) -> float:
    parsed = parse_float_time(value)
    return default if parsed is None else float(parsed)


def to_text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
            elif isinstance(item, (int, float)):
                out.append(str(item))
        return out
    return []


def normalize_scene_payload(raw_text: str) -> dict[str, Any]:
    parsed = extract_first_json_object(raw_text) or {}
    summary = str(parsed.get("summary") or raw_text).strip()
    actions = to_text_list(parsed.get("actions"))
    objects = to_text_list(parsed.get("objects"))
    scene_type = str(parsed.get("scene_type") or parsed.get("sceneType") or "").strip()
    confidence = max(0.0, min(1.0, to_float(parsed.get("confidence"), default=0.5)))
    return {
        "summary": summary,
        "actions": actions,
        "objects": objects,
        "scene_type": scene_type,
        "confidence": confidence,
        "raw_model_text": raw_text,
    }


def choose_evenly_spaced_frames(frames: list[FrameSample], max_count: int) -> list[FrameSample]:
    if max_count <= 0:
        return []
    if len(frames) <= max_count:
        return frames
    picked: list[FrameSample] = []
    seen: set[int] = set()
    for i in range(max_count):
        idx = round(i * (len(frames) - 1) / (max_count - 1))
        if idx in seen:
            continue
        seen.add(idx)
        picked.append(frames[idx])
    if len(picked) < max_count:
        for idx, frame in enumerate(frames):
            if idx in seen:
                continue
            picked.append(frame)
            if len(picked) == max_count:
                break
    return picked


def find_nearest_frame(frames: list[FrameSample], target_time: float) -> FrameSample | None:
    if not frames:
        return None
    return min(frames, key=lambda frame: abs(frame.timestamp - target_time))


def probe_video(input_path: Path, ffprobe_bin: str) -> VideoMetadata:
    require_binary(ffprobe_bin)
    proc = run_checked(
        [
            ffprobe_bin,
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            str(input_path),
        ]
    )
    data = json.loads(proc.stdout)
    format_info = data.get("format", {}) if isinstance(data, dict) else {}
    streams = data.get("streams", []) if isinstance(data, dict) else []

    duration = parse_float_time(format_info.get("duration")) or 0.0
    width: int | None = None
    height: int | None = None
    fps: float | None = None

    for stream in streams:
        if not isinstance(stream, dict):
            continue
        if stream.get("codec_type") == "video":
            width_val = stream.get("width")
            height_val = stream.get("height")
            if isinstance(width_val, int):
                width = width_val
            if isinstance(height_val, int):
                height = height_val

            rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate")
            if isinstance(rate, str) and "/" in rate:
                left, right = rate.split("/", 1)
                try:
                    num = float(left)
                    den = float(right)
                    if den != 0:
                        fps = num / den
                except ValueError:
                    pass

            stream_duration = parse_float_time(stream.get("duration"))
            if stream_duration and stream_duration > duration:
                duration = stream_duration
            break

    if duration <= 0:
        raise RuntimeError("Could not determine video duration.")
    return VideoMetadata(duration=duration, width=width, height=height, fps=fps)


def extract_frames(
    input_path: Path,
    frames_dir: Path,
    ffmpeg_bin: str,
    sample_interval: float,
    duration: float,
) -> list[FrameSample]:
    if sample_interval <= 0:
        raise ValueError("sample_interval must be > 0.")
    require_binary(ffmpeg_bin)
    frames_dir.mkdir(parents=True, exist_ok=True)
    out_pattern = frames_dir / "frame_%06d.jpg"
    fps_expr = f"1/{sample_interval:.6f}"
    run_checked(
        [
            ffmpeg_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(input_path),
            "-vf",
            f"fps={fps_expr}",
            "-q:v",
            "2",
            str(out_pattern),
        ]
    )

    frame_paths = sorted(frames_dir.glob("frame_*.jpg"))
    samples: list[FrameSample] = []
    for idx, frame_path in enumerate(frame_paths):
        ts = min(duration, idx * sample_interval)
        samples.append(FrameSample(index=idx, timestamp=ts, path=frame_path))
    return samples


def section_windows(duration: float, section_seconds: float) -> list[tuple[float, float]]:
    if section_seconds <= 0:
        raise ValueError("section_seconds must be > 0.")
    count = max(1, math.ceil(duration / section_seconds))
    windows: list[tuple[float, float]] = []
    for idx in range(count):
        start = idx * section_seconds
        end = min(duration, start + section_seconds)
        if end > start:
            windows.append((start, end))
    return windows


def section_text_blob(section: dict[str, Any]) -> str:
    parts = [
        str(section.get("summary") or ""),
        " ".join(to_text_list(section.get("actions"))),
        " ".join(to_text_list(section.get("objects"))),
        str(section.get("scene_type") or ""),
    ]
    return " ".join(part for part in parts if part).strip()


def find_matches(
    sections: list[dict[str, Any]],
    query: str,
    top_k: int,
    min_score: float,
) -> list[dict[str, Any]]:
    scored: list[dict[str, Any]] = []
    for idx, section in enumerate(sections, start=1):
        blob = section_text_blob(section)
        score = score_query_match(query=query, text=blob)
        if score < min_score:
            continue
        scored.append(
            {
                "index": idx,
                "section_id": section.get("section_id"),
                "start": float(section.get("start", 0.0)),
                "end": float(section.get("end", 0.0)),
                "score": round(score, 4),
                "summary": section.get("summary", ""),
                "actions": to_text_list(section.get("actions")),
                "objects": to_text_list(section.get("objects")),
            }
        )
    scored.sort(key=lambda item: (-item["score"], item["start"]))
    return scored[: max(1, top_k)]


def load_context(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Context file is not an object: {path}")
    if not isinstance(data.get("sections"), list):
        raise ValueError(f"Context file has no sections array: {path}")
    return data


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def clip_video(
    video_path: Path,
    start: float,
    end: float,
    output_path: Path,
    ffmpeg_bin: str,
) -> None:
    require_binary(ffmpeg_bin)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    run_checked(
        [
            ffmpeg_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-to",
            f"{end:.3f}",
            "-i",
            str(video_path),
            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )


class VlmSceneAnalyzer:
    def __init__(
        self,
        model: str,
        quant: str | None,
        plugin_id: str | None,
        device_id: str | None,
    ) -> None:
        try:
            from nexaai import VLM, GenerationConfig, VlmChatMessage, VlmContent
        except Exception as exc:
            raise RuntimeError(
                "Failed to import nexaai. Install with `pip install -e .`."
            ) from exc

        self.GenerationConfig = GenerationConfig
        self.VlmChatMessage = VlmChatMessage
        self.VlmContent = VlmContent

        load_kwargs: dict[str, Any] = {}
        if quant:
            load_kwargs["quant"] = quant
        if plugin_id:
            load_kwargs["plugin_id"] = plugin_id
        if device_id:
            load_kwargs["device_id"] = device_id

        if hasattr(VLM, "from_"):
            self._model = VLM.from_(model, **load_kwargs)
        elif hasattr(VLM, "from_pretrained"):
            self._model = VLM.from_pretrained(model, **load_kwargs)
        else:
            raise RuntimeError("Unsupported nexaai VLM loader interface.")

    def describe_section(
        self,
        image_paths: list[str],
        start: float,
        end: float,
        max_tokens: int,
    ) -> dict[str, Any]:
        prompt = (
            "You are a video-editing scene analyst.\n"
            f"The following keyframes represent a section from {start:.2f}s to {end:.2f}s.\n"
            "Return ONLY valid JSON with this schema:\n"
            '{\n'
            '  "summary": "short scene summary",\n'
            '  "actions": ["action 1", "action 2"],\n'
            '  "objects": ["object 1", "object 2"],\n'
            '  "scene_type": "single label",\n'
            '  "confidence": 0.0\n'
            "}\n"
            "Rules:\n"
            "- Keep summary under 45 words.\n"
            "- confidence must be between 0 and 1.\n"
            "- No markdown, no extra keys."
        )
        contents = [self.VlmContent(type="text", text=prompt)]
        contents.extend(self.VlmContent(type="image", text=path) for path in image_paths)
        messages = [self.VlmChatMessage(role="user", contents=contents)]

        formatted_prompt = self._model.apply_chat_template(messages=messages)
        gen_cfg = self.GenerationConfig(
            max_tokens=max_tokens,
            image_paths=image_paths or None,
            image_max_length=len(image_paths),
        )
        response = self._model.generate(prompt=formatted_prompt, config=gen_cfg)
        response_text = getattr(response, "full_text", str(response))
        return normalize_scene_payload(response_text)


def command_build_context(args: argparse.Namespace) -> int:
    input_video = Path(args.video).expanduser().resolve()
    if not input_video.exists():
        raise RuntimeError(f"Input video not found: {input_video}")

    if args.api_key:
        os.environ["NEXA_API_KEY"] = args.api_key

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    metadata = probe_video(input_video, ffprobe_bin=args.ffprobe_bin)
    windows = section_windows(metadata.duration, section_seconds=args.section_seconds)

    if args.keep_frames:
        frames_dir = output_dir / f"{input_video.stem}_frames"
        temp_ctx: tempfile.TemporaryDirectory[str] | None = None
    else:
        temp_ctx = tempfile.TemporaryDirectory(prefix="nexa-vctx-frames-")
        frames_dir = Path(temp_ctx.name)

    try:
        frames = extract_frames(
            input_path=input_video,
            frames_dir=frames_dir,
            ffmpeg_bin=args.ffmpeg_bin,
            sample_interval=args.sample_interval,
            duration=metadata.duration,
        )
        if not frames:
            raise RuntimeError("No frames extracted. Check video format and ffmpeg installation.")

        print(
            f"Extracted {len(frames)} keyframes. Loading model {args.model}...",
            file=sys.stderr,
        )
        analyzer = VlmSceneAnalyzer(
            model=args.model,
            quant=args.quant,
            plugin_id=args.plugin_id,
            device_id=args.device_id,
        )

        sections: list[dict[str, Any]] = []
        for idx, (start, end) in enumerate(windows, start=1):
            bucket = [frame for frame in frames if start <= frame.timestamp < end]
            if not bucket:
                nearest = find_nearest_frame(frames, (start + end) / 2)
                bucket = [nearest] if nearest else []

            chosen = choose_evenly_spaced_frames(bucket, max_count=args.max_images_per_section)
            image_paths = [str(frame.path) for frame in chosen]
            print(
                f"Analyzing section {idx}/{len(windows)} "
                f"({format_timecode(start)} - {format_timecode(end)}) with {len(image_paths)} frame(s)...",
                file=sys.stderr,
            )
            model_payload = analyzer.describe_section(
                image_paths=image_paths,
                start=start,
                end=end,
                max_tokens=args.max_tokens,
            )
            section = {
                "section_id": f"s{idx:03d}",
                "start": round(start, 3),
                "end": round(end, 3),
                "summary": model_payload["summary"],
                "actions": model_payload["actions"],
                "objects": model_payload["objects"],
                "scene_type": model_payload["scene_type"],
                "confidence": model_payload["confidence"],
                "frame_timestamps": [round(frame.timestamp, 3) for frame in chosen],
            }
            if args.keep_frames:
                section["frame_paths"] = image_paths
            if args.include_raw_model_text:
                section["raw_model_text"] = model_payload["raw_model_text"]
            sections.append(section)

    finally:
        if temp_ctx is not None:
            temp_ctx.cleanup()

    payload = {
        "video_path": str(input_video),
        "model": args.model,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "duration": round(metadata.duration, 3),
            "width": metadata.width,
            "height": metadata.height,
            "fps": metadata.fps,
        },
        "sampling": {
            "sample_interval_seconds": args.sample_interval,
            "section_seconds": args.section_seconds,
            "max_images_per_section": args.max_images_per_section,
        },
        "sections": sections,
    }
    if args.keep_frames:
        payload["frames_dir"] = str(frames_dir)

    output_path = (
        Path(args.output_json).expanduser().resolve()
        if args.output_json
        else output_dir / f"{input_video.stem}.scene_context.json"
    )
    save_json(output_path, payload)
    print(f"Wrote scene context: {output_path}")
    return 0


def command_find(args: argparse.Namespace) -> int:
    context_path = Path(args.context).expanduser().resolve()
    context = load_context(context_path)
    sections = context["sections"]
    matches = find_matches(
        sections=sections,
        query=args.query,
        top_k=args.top_k,
        min_score=args.min_score,
    )
    payload = {
        "context_path": str(context_path),
        "query": args.query,
        "top_k": args.top_k,
        "min_score": args.min_score,
        "matches": matches,
    }

    output_path = (
        Path(args.output_json).expanduser().resolve()
        if args.output_json
        else context_path.with_name(f"{context_path.stem}.find.{slugify(args.query)}.json")
    )
    save_json(output_path, payload)

    print(f"Wrote find results: {output_path}")
    if not matches:
        print("No matching sections found.")
        return 0
    for match in matches:
        print(
            f"- #{match['index']:02d}  {format_timecode(match['start'])} -> "
            f"{format_timecode(match['end'])}  score={match['score']:.3f}"
        )
        if match["summary"]:
            print(f"  {match['summary']}")
    return 0


def command_select_part(args: argparse.Namespace) -> int:
    context_path = Path(args.context).expanduser().resolve()
    context = load_context(context_path)
    sections: list[dict[str, Any]] = context["sections"]

    chosen_index: int | None = None
    match_payload: dict[str, Any] | None = None
    if args.index is not None:
        if args.index < 1 or args.index > len(sections):
            raise RuntimeError(f"--index must be between 1 and {len(sections)}")
        chosen_index = args.index
    else:
        matches = find_matches(
            sections=sections,
            query=args.query,
            top_k=max(1, args.top_k),
            min_score=args.min_score,
        )
        if not matches:
            raise RuntimeError("No sections matched your query.")
        match_payload = matches[0]
        chosen_index = match_payload["index"]

    selected = sections[chosen_index - 1]
    video_duration = to_float((context.get("metadata") or {}).get("duration"), default=0.0)
    start = max(0.0, to_float(selected.get("start"), default=0.0) - args.padding)
    end = to_float(selected.get("end"), default=start) + args.padding
    if video_duration > 0:
        end = min(video_duration, end)

    selection_payload = {
        "context_path": str(context_path),
        "selected_index": chosen_index,
        "selected_section": selected,
        "range": {"start": round(start, 3), "end": round(end, 3)},
        "selection_mode": "index" if args.index is not None else "query",
        "query": args.query,
        "match": match_payload,
    }
    output_path = (
        Path(args.output_json).expanduser().resolve()
        if args.output_json
        else context_path.with_name(f"{context_path.stem}.selected_part.json")
    )
    save_json(output_path, selection_payload)
    print(f"Wrote selection: {output_path}")
    print(f"Selected range: {format_timecode(start)} -> {format_timecode(end)}")

    if args.clip_output:
        if not args.video:
            raise RuntimeError("--video is required when --clip-output is set.")
        video_path = Path(args.video).expanduser().resolve()
        clip_out = Path(args.clip_output).expanduser().resolve()
        clip_video(
            video_path=video_path,
            start=start,
            end=end,
            output_path=clip_out,
            ffmpeg_bin=args.ffmpeg_bin,
        )
        print(f"Wrote clip: {clip_out}")
    return 0


def command_clip(args: argparse.Namespace) -> int:
    video_path = Path(args.video).expanduser().resolve()
    if not video_path.exists():
        raise RuntimeError(f"Video not found: {video_path}")

    ranges: list[dict[str, Any]] = []
    if args.ranges:
        for idx, (start, end) in enumerate(parse_ranges_arg(args.ranges), start=1):
            ranges.append({"label": f"manual_{idx:03d}", "start": start, "end": end})
    elif args.find_json:
        find_payload = json.loads(Path(args.find_json).expanduser().resolve().read_text(encoding="utf-8"))
        matches = find_payload.get("matches")
        if not isinstance(matches, list) or not matches:
            raise RuntimeError("find-json has no matches.")
        for item in matches[: max(1, args.top_k)]:
            ranges.append(
                {
                    "label": str(item.get("section_id") or f"find_{item.get('index', 0)}"),
                    "start": to_float(item.get("start")),
                    "end": to_float(item.get("end")),
                }
            )
    elif args.context and args.indices:
        context = load_context(Path(args.context).expanduser().resolve())
        sections: list[dict[str, Any]] = context["sections"]
        for index in parse_indices_arg(args.indices):
            if index > len(sections):
                raise RuntimeError(f"Index {index} out of range for {len(sections)} section(s).")
            section = sections[index - 1]
            ranges.append(
                {
                    "label": str(section.get("section_id") or f"section_{index:03d}"),
                    "start": to_float(section.get("start")),
                    "end": to_float(section.get("end")),
                }
            )
    elif args.context and args.query:
        context = load_context(Path(args.context).expanduser().resolve())
        matches = find_matches(
            sections=context["sections"],
            query=args.query,
            top_k=args.top_k,
            min_score=args.min_score,
        )
        if not matches:
            raise RuntimeError("No context sections matched the clip query.")
        for item in matches:
            ranges.append(
                {
                    "label": str(item.get("section_id") or f"match_{item.get('index', 0)}"),
                    "start": to_float(item.get("start")),
                    "end": to_float(item.get("end")),
                }
            )
    else:
        raise RuntimeError(
            "Provide one source: --ranges OR --find-json OR (--context + --indices) OR (--context + --query)."
        )

    out_dir = Path(args.output_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest_clips: list[dict[str, Any]] = []
    for idx, item in enumerate(ranges, start=1):
        start = max(0.0, item["start"] - args.padding)
        end = item["end"] + args.padding
        if end <= start:
            continue
        label = slugify(item["label"], max_length=24)
        out_path = out_dir / (
            f"{video_path.stem}.clip_{idx:03d}_{label}_{int(start*1000)}_{int(end*1000)}.mp4"
        )
        clip_video(
            video_path=video_path,
            start=start,
            end=end,
            output_path=out_path,
            ffmpeg_bin=args.ffmpeg_bin,
        )
        print(f"Wrote clip: {out_path}")
        manifest_clips.append(
            {
                "index": idx,
                "label": item["label"],
                "start": round(start, 3),
                "end": round(end, 3),
                "path": str(out_path),
            }
        )

    manifest = {
        "video_path": str(video_path),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "clips": manifest_clips,
    }
    manifest_path = (
        Path(args.output_json).expanduser().resolve()
        if args.output_json
        else out_dir / f"{video_path.stem}.clip_manifest.json"
    )
    save_json(manifest_path, manifest)
    print(f"Wrote clip manifest: {manifest_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="nexa-video-context",
        description="Video -> Scene Context lab with find/select/clip timestamp workflows.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_ctx = subparsers.add_parser(
        "build-context",
        help="Ingest a video and build timestamped scene context sections using Nexa VLM.",
    )
    build_ctx.add_argument("video", help="Input video path.")
    build_ctx.add_argument("--model", default=DEFAULT_MODEL, help="Nexa model id to load.")
    build_ctx.add_argument("--quant", default=None, help="Optional quantization profile.")
    build_ctx.add_argument("--plugin-id", default=None, help="Optional plugin id.")
    build_ctx.add_argument("--device-id", default=None, help="Optional device id.")
    build_ctx.add_argument("--api-key", default=None, help="Optional NEXA_API_KEY override.")
    build_ctx.add_argument("--sample-interval", type=float, default=2.0, help="Seconds between sampled frames.")
    build_ctx.add_argument("--section-seconds", type=float, default=12.0, help="Duration of each scene section.")
    build_ctx.add_argument(
        "--max-images-per-section",
        type=int,
        default=6,
        help="Maximum number of sampled frames fed to the model per section.",
    )
    build_ctx.add_argument("--max-tokens", type=int, default=280, help="Max output tokens per section.")
    build_ctx.add_argument("--keep-frames", action="store_true", help="Keep extracted frame images on disk.")
    build_ctx.add_argument(
        "--include-raw-model-text",
        action="store_true",
        help="Include unparsed raw model text in each section.",
    )
    build_ctx.add_argument("--output-dir", default="outputs", help="Output directory for context JSON.")
    build_ctx.add_argument("--output-json", default=None, help="Optional explicit output JSON path.")
    build_ctx.add_argument("--ffmpeg-bin", default="ffmpeg", help="ffmpeg executable name/path.")
    build_ctx.add_argument("--ffprobe-bin", default="ffprobe", help="ffprobe executable name/path.")
    build_ctx.set_defaults(func=command_build_context)

    find_cmd = subparsers.add_parser(
        "find",
        help="Find timestamp sections from a scene context JSON using a natural-language query.",
    )
    find_cmd.add_argument("--context", required=True, help="Path to *.scene_context.json.")
    find_cmd.add_argument("--query", required=True, help="Search query.")
    find_cmd.add_argument("--top-k", type=int, default=5, help="Max number of matches.")
    find_cmd.add_argument("--min-score", type=float, default=0.05, help="Minimum lexical score to keep.")
    find_cmd.add_argument("--output-json", default=None, help="Optional output path for find results.")
    find_cmd.set_defaults(func=command_find)

    select_cmd = subparsers.add_parser(
        "select-part",
        help="Select one timestamp section by index or query.",
    )
    select_cmd.add_argument("--context", required=True, help="Path to *.scene_context.json.")
    mode = select_cmd.add_mutually_exclusive_group(required=True)
    mode.add_argument("--index", type=int, default=None, help="1-based section index to select.")
    mode.add_argument("--query", default=None, help="Query to select best-matching section.")
    select_cmd.add_argument("--top-k", type=int, default=3, help="Used when selecting by query.")
    select_cmd.add_argument("--min-score", type=float, default=0.05, help="Used when selecting by query.")
    select_cmd.add_argument("--padding", type=float, default=0.0, help="Expand selection range by this many seconds.")
    select_cmd.add_argument("--output-json", default=None, help="Optional output path for selection JSON.")
    select_cmd.add_argument("--video", default=None, help="Input video path (required for clip export).")
    select_cmd.add_argument("--clip-output", default=None, help="If set, also export a clip for the selected range.")
    select_cmd.add_argument("--ffmpeg-bin", default="ffmpeg", help="ffmpeg executable name/path.")
    select_cmd.set_defaults(func=command_select_part)

    clip_cmd = subparsers.add_parser(
        "clip",
        help="Export one or more video clips from timestamp ranges.",
    )
    clip_cmd.add_argument("--video", required=True, help="Input video path.")
    clip_cmd.add_argument(
        "--ranges",
        default=None,
        help="Manual ranges like '00:00:10-00:00:15,25-30.5'.",
    )
    clip_cmd.add_argument("--find-json", default=None, help="Path to output from the find command.")
    clip_cmd.add_argument("--context", default=None, help="Path to *.scene_context.json.")
    clip_cmd.add_argument("--indices", default=None, help="Section indices from context (e.g. '1,3,5').")
    clip_cmd.add_argument("--query", default=None, help="Query over context to auto-select clip ranges.")
    clip_cmd.add_argument("--top-k", type=int, default=3, help="Clip up to top K sections for query/find-json modes.")
    clip_cmd.add_argument("--min-score", type=float, default=0.05, help="Query min score for context query mode.")
    clip_cmd.add_argument("--padding", type=float, default=0.0, help="Expand every clip range by this many seconds.")
    clip_cmd.add_argument("--output-dir", default="outputs/clips", help="Output directory for clip files.")
    clip_cmd.add_argument("--output-json", default=None, help="Optional output path for clip manifest.")
    clip_cmd.add_argument("--ffmpeg-bin", default="ffmpeg", help="ffmpeg executable name/path.")
    clip_cmd.set_defaults(func=command_clip)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except (RuntimeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
