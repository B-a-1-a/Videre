# Download YouTube sample and transcribe

## 1. Download the video

Install yt-dlp and download the sample (run from `nexa-caption-lab`):

```bash
pip install yt-dlp
python -m yt_dlp -f "bv*[ext=mp4]+ba/b[ext=mp4]/b" -o "test-data/sample_video.mp4" "https://www.youtube.com/watch?v=JhU0yO43b6o"
```

## 2. Transcribe

From `nexa-caption-lab` (with `pip install ".[local]"` and **ffmpeg** on PATH or via `--ffmpeg-bin`):

```bash
nexa-caption-local test-data/sample_video.mp4 --output-dir outputs
```

Transcripts are written to `outputs/sample_video.srt`, `outputs/sample_video.vtt`, and `outputs/sample_video.json`.
