# Videre (Electron Local Desktop)

Videre is an Electron desktop video editor running fully local without
auth/cloud dependencies.

## What Changed

- Tauri runtime removed.
- Frontend moved to a React Router app (`/app`).
- Authentication removed (local single-user mode).
- Project persistence moved to local filesystem JSON storage.
- Media upload/render is local-only via the bundled Remotion/Express server.

## Local Data Paths

- Projects index: `local_data/projects.json`
- Project state files: `local_data/project_state/<project-id>.json`
- Imported media: `out/<project-id>/`
- Rendered outputs: `out/`

You can override paths with:

- `VIDERE_DATA_DIR`
- `VIDERE_MEDIA_DIR`
- `TIMELINE_DIR`

## Development

### Prerequisites

- Node.js 20+
- `pnpm`
- `ffmpeg` available on your `PATH`

### Start Desktop App

```bash
pnpm install
pnpm desktop:dev
```

This starts:

- React Router dev server on `http://127.0.0.1:5173`
- Local render/upload server on `http://127.0.0.1:8000`
- Electron window loading the app

Shortcut:

```bash
./scripts/start-dev.sh
```

## Scripts

- `pnpm dev` - React Router dev server
- `pnpm render:server` - Remotion render/upload server
- `pnpm desktop:dev` - Full desktop dev stack (web + render + Electron)
- `pnpm build` - React Router production build
- `pnpm preview` - Serve production build locally
- `pnpm typecheck` - Type generation + TypeScript checks
- `pnpm lint` - ESLint checks

## Local Whisper Setup

The Captions tab uses a local Python runner with
`transformers` + `openai/whisper-small`.

### Install Python Dependencies

Use a Python version supported by your local `torch` build
(Python 3.11/3.12 is recommended).

```bash
python3.12 -m venv .venv-whisper
source .venv-whisper/bin/activate
pip install -r app/videorender/requirements-whisper.txt
```

The render server auto-detects `.venv-whisper/bin/python` first. If you use a
different interpreter path, set `VIDERE_WHISPER_PYTHON`.

### Optional Environment Overrides

- `VIDERE_WHISPER_PYTHON` (default: `python3`)
- `VIDERE_WHISPER_MODEL` (default: `openai/whisper-small`)
- `VIDERE_WHISPER_DEVICE` (default: `auto`)
- `VIDERE_WHISPER_FFMPEG_BIN` (default: `ffmpeg`)

### First Run Behavior

The first transcription request downloads the Whisper model weights and may
take noticeably longer than subsequent runs.

## Notes

- No login/session setup is required.
- Storage/account views now report local disk usage.
- All imported videos/images/audio remain on local disk.

## Python Labs (unchanged)

- `nexa-caption-lab/`
- `nexa-video-context-lab/`
