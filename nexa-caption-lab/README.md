# Nexa Caption Lab

Standalone Python sandbox for video/audio captioning with timestamped outputs via Nexa SDK.
This directory is intentionally separate from the Tauri app.

## Requirements

- Python 3.10+
- `ffmpeg` (needed when input is a video file)
- Nexa API key in `NEXA_API_KEY`

## Setup

```bash
cd /Users/bala/Repos/Videre/nexa-caption-lab
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Run

```bash
export NEXA_API_KEY="your-key"
nexa-caption /absolute/path/to/video.mp4 \
  --model Systran/faster-whisper-large-v3-turbo \
  --timestamps segment \
  --beam-size 5 \
  --output-dir /Users/bala/Repos/Videre/nexa-caption-lab/outputs
```

Outputs:
- `*.srt`
- `*.vtt`
- `*.json` (segments + raw ASR payload)

For word-level timestamps:

```bash
nexa-caption /absolute/path/to/video.mp4 \
  --model Systran/faster-whisper-large-v3-turbo \
  --timestamps word

# Optional backend flags if needed in your environment:
#   --quant q4_k_m
#   --plugin-id mlx
#   --device-id cpu
#   --language en
```

## Test

```bash
pytest -q
```
