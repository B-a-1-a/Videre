# Nexa Video Context Lab

Standalone Python lab for:

- **Video -> Scene Context**
- **Find** timestamp sections from a query
- **Select Part** (pick one timestamp section)
- **Clip** one or many timestamp sections into MP4 outputs

This is separate from Tauri and focused on local prototyping.

## Model

This lab targets the Nexa Qwen3-VL model page:

- https://sdk.nexa.ai/model/Qwen3-VL-4B-Instruct

Default model id in this lab is:

- `NexaAI/Qwen3-VL-4B-GGUF`

(`Qwen3-VL-4B-Instruct-NPU` can be used via `--model` for Qualcomm NPU targets.)

## Requirements

- Python 3.10+
- `ffmpeg` + `ffprobe`
- `NEXA_API_KEY` (for gated/pro model access)

## Setup

```bash
cd /Users/bala/Repos/Videre/nexa-video-context-lab
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## 1) Build Scene Context From Video

```bash
export NEXA_API_KEY="your-key"
nexa-video-context build-context /absolute/path/to/video.mp4 \
  --model NexaAI/Qwen3-VL-4B-GGUF \
  --sample-interval 2.0 \
  --section-seconds 12 \
  --output-dir /Users/bala/Repos/Videre/nexa-video-context-lab/outputs
```

Output:
- `*.scene_context.json` with section timestamps and scene summaries.

## 2) Find Matching Timestamp Sections

```bash
nexa-video-context find \
  --context /Users/bala/Repos/Videre/nexa-video-context-lab/outputs/video.scene_context.json \
  --query "person walks to whiteboard and points"
```

Output:
- `*.find.<query>.json` with ranked timestamp matches.

## 3) Select One Part

By index:

```bash
nexa-video-context select-part \
  --context /Users/bala/Repos/Videre/nexa-video-context-lab/outputs/video.scene_context.json \
  --index 3
```

By query and immediately export one clip:

```bash
nexa-video-context select-part \
  --context /Users/bala/Repos/Videre/nexa-video-context-lab/outputs/video.scene_context.json \
  --query "applause" \
  --video /absolute/path/to/video.mp4 \
  --clip-output /Users/bala/Repos/Videre/nexa-video-context-lab/outputs/applause.mp4
```

## 4) Clip Multiple Parts

From context indices:

```bash
nexa-video-context clip \
  --video /absolute/path/to/video.mp4 \
  --context /Users/bala/Repos/Videre/nexa-video-context-lab/outputs/video.scene_context.json \
  --indices 2,4,6 \
  --output-dir /Users/bala/Repos/Videre/nexa-video-context-lab/outputs/clips
```

Manual ranges:

```bash
nexa-video-context clip \
  --video /absolute/path/to/video.mp4 \
  --ranges "00:00:10-00:00:14.2,38-44" \
  --output-dir /Users/bala/Repos/Videre/nexa-video-context-lab/outputs/clips
```

## Test

```bash
pytest -q
```
