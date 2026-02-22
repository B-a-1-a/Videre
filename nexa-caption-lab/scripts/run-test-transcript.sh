#!/usr/bin/env bash
# Download sample video (if missing) and run local Whisper transcription.
# Run from repo root or from nexa-caption-lab.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_VIDEO="$LAB_DIR/test-data/sample_video.mp4"
SAMPLE_URL="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"

mkdir -p "$LAB_DIR/test-data"
if [[ ! -f "$TEST_VIDEO" ]]; then
  echo "Downloading sample video..."
  curl -L -o "$TEST_VIDEO" "$SAMPLE_URL"
fi

echo "Transcribing $TEST_VIDEO ..."
cd "$LAB_DIR"
python -m nexa_caption_lab.whisper_local "$TEST_VIDEO" --output-dir "$LAB_DIR/outputs" --model small

echo "Done. Check $LAB_DIR/outputs/ for .srt, .vtt, .json"
