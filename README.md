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

The Captions tab transcribes clips with a local Python runner. By default it
uses **Whisper on the Snapdragon NPU** (`nexa-caption-lab` + `onnxruntime-qnn`).
You can switch to the legacy **transformers** pipeline for testing via the
"Use legacy Whisper (transformers) for testing" option in the Captions panel.

### Default: NPU (Whisper on Snapdragon NPU)

From the repo root, create a venv (Python 3.10+) and install the NPU backend:

**Windows (PowerShell or cmd):**

```powershell
py -m venv .venv-whisper
.venv-whisper\Scripts\activate
pip install -e ./nexa-caption-lab[npu]
```

**macOS / Linux:**

```bash
python3.12 -m venv .venv-whisper
source .venv-whisper/bin/activate
pip install -e ./nexa-caption-lab[npu]
```

This installs `onnxruntime-qnn` and `transformers`. The app will use
`.venv-whisper\Scripts\python.exe` (Windows) or `.venv-whisper/bin/python`
(Unix) automatically. NPU models go under `nexa-caption-lab/models/` and are
downloaded on first use.

### Optional: Legacy Whisper (transformers, for testing)

To use the legacy script (`whisper_transcribe.py`) with torch + transformers,
install in the same venv:

```bash
pip install -r app/videorender/requirements-whisper.txt
```

Then enable "Use legacy Whisper (transformers) for testing" in the Captions
tab when running transcription.

### Environment Overrides

- `VIDERE_WHISPER_PYTHON` – Python interpreter (auto-detects `.venv-whisper`, `.venv`, then system).
- `VIDERE_WHISPER_MODEL` – Model name (legacy only; default: `openai/whisper-small`).
- `VIDERE_WHISPER_DEVICE` – Device for legacy (default: `auto`).
- `VIDERE_WHISPER_FFMPEG_BIN` – ffmpeg binary (default: `ffmpeg`).
- `VIDERE_NPU_MODELS_DIR` – Override NPU model root (default: `nexa-caption-lab/models`).

### First Run Behavior

The first transcription may download model weights (NPU or Hugging Face) and
take longer than subsequent runs.

## Notes

- No login/session setup is required.
- Storage/account views now report local disk usage.
- All imported videos/images/audio remain on local disk.

## Python Labs (unchanged)

- `nexa-caption-lab/`
- `nexa-video-context-lab/`
