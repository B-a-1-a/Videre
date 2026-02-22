# Test data for caption lab

Sample video for testing local transcription (faster-whisper).

- **sample_video.mp4** – Short clip (~15 s), from [Google’s sample videos](https://developers.google.com/media).

You need **ffmpeg** on PATH when the input is video (audio is extracted automatically). The main Videre app fetches FFmpeg sidecars; you can add that bin to PATH or install [ffmpeg](https://ffmpeg.org/) locally.

## Fetch the sample (if missing)

```bash
cd nexa-caption-lab/test-data
curl -L -o sample_video.mp4 "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
```

## Produce transcripts

From the **nexa-caption-lab** directory (with `pip install ".[local]"`):

```bash
nexa-caption-local test-data/sample_video.mp4 --output-dir outputs
```

Or:

```bash
python -m nexa_caption_lab.whisper_local test-data/sample_video.mp4 --output-dir outputs
```

If ffmpeg is not on PATH but you have Videre’s sidecars (run `pnpm sidecars:fetch` from the repo root), use:

```bash
nexa-caption-local test-data/sample_video.mp4 --output-dir outputs --ffmpeg-bin "../binaries/ffmpeg-x86_64-pc-windows-msvc.exe"
# On macOS/Linux the binary name differs; list the binaries/ folder.
```

**One-shot (download + transcribe):** from `nexa-caption-lab`:

```bash
bash scripts/run-test-transcript.sh
```

Outputs (in `outputs/`) will include `sample_video.srt`, `sample_video.vtt`, and `sample_video.json`.
