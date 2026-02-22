# Videre

Videre is a fully local Electron-based desktop video editor. It runs completely offline — no cloud dependencies, no authentication, and no telemetry. Your media and projects stay private on your local machine.

Videre leverages on-device AI for intelligent features like:
- **Whisper NPU Transcription** — Transcribe video clips using Qualcomm's NPU via `onnxruntime-qnn`
- **Transcript Analysis** — Automatically detect filler words, retakes, and suggest cuts with timestamps

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Electron Shell (electron/main.cjs)             │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ React Router  │  │ Express/Remotion Server │  │
│  │ Frontend      │  │ (videorender.ts)        │  │
│  │ :5173         │  │ :8000                   │  │
│  │               │  │  ├─ /transcribe-clips   │  │
│  │  Captions.tsx │◄─┤  ├─ /analyze-transcript │  │
│  │  Timeline     │  │  ├─ /render             │  │
│  │  Media Panel  │  │  └─ /upload             │  │
│  └───────────────┘  └─────────┬──────────────┘  │
│                               │                  │
│                    ┌──────────▼──────────┐       │
│                    │ Python venv/        │       │
│                    │  whisper_npu (.onnx) │       │
│                    │  llama_npu_analyze   │       │
│                    │  onnxruntime-qnn     │       │
│                    └─────────────────────┘       │
└─────────────────────────────────────────────────┘
```

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 20+ | |
| **pnpm** | Latest | `npm install -g pnpm` |
| **Python** | 3.10–3.13 | For AI transcription & analysis |
| **FFmpeg** | Latest | Must be in your system `PATH` |

---

## Installation (From Scratch)

### Step 1: Clone & Install Node Dependencies

```bash
git clone https://github.com/B-a-1-a/Videre.git
cd Videre
pnpm install
```

### Step 2: Create the Python Virtual Environment

Create a virtual environment named `venv` in the project root. The backend auto-detects this directory.

**Windows (PowerShell/CMD):**
```powershell
py -m venv venv
venv\Scripts\activate
```

**macOS / Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

### Step 3: Install Python AI Dependencies

With the virtual environment activated, install the required packages:

```bash
# Core NPU transcription lab (includes onnxruntime-qnn, transformers, scipy)
pip install -e "./nexa-caption-lab[npu]"

# Hugging Face transformers (for Whisper tokenizer/processor)
pip install transformers scipy

# QNN-enabled ONNX Runtime (Snapdragon NPU acceleration)
pip install onnxruntime-qnn
```

### Step 4: Verify the Python Environment

Run these commands to confirm everything is installed correctly:

```bash
# Check QNN (NPU) execution provider is available
python -c "import onnxruntime as ort; providers = ort.get_available_providers(); print(providers); assert 'QNNExecutionProvider' in providers, 'QNN not found!'"

# Check Whisper NPU module loads
python -c "from nexa_caption_lab.whisper_npu import transcribe_with_npu; print('Whisper NPU: OK')"

# Check transformers loads
python -c "import transformers; print('Transformers:', transformers.__version__)"

# Check analysis script runs
echo '{"scrubberId":"test","text":"hello um","words":[{"text":"hello","start":0,"end":0.3},{"text":"um","start":0.4,"end":0.6}]}' | python app/videorender/llama_npu_analyze.py
```

Expected output for the last command:
```json
{"scrubberId": "test", "success": true, "suggestions": [{"type": "filler", "description": "Filler word: 'um'", "startSec": 0.4, "endSec": 0.6}], "error": null}
```

### Step 5: Launch the App

```bash
pnpm desktop:dev
```

This starts three services concurrently:
- **React Router** dev server → `http://127.0.0.1:5173`
- **Express/Remotion** render server → `http://127.0.0.1:8000`
- **Electron** desktop window

---

## Troubleshooting

### PowerShell "scripts disabled" error (Windows)
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### "No module named 'transformers'"
Your Python environment is missing dependencies. Activate your venv and reinstall:
```bash
venv\Scripts\activate        # Windows
source venv/bin/activate     # macOS/Linux
pip install transformers scipy onnxruntime-qnn
```

### QNNExecutionProvider not showing up
You likely installed `onnxruntime` (standard) instead of `onnxruntime-qnn`. Fix:
```bash
pip install onnxruntime-qnn
```

### Python version conflicts with torch/qai-hub-models
If you see dependency resolution errors when installing `qai-hub-models`, your Python version may be too new (3.14+). Use Python 3.12 or 3.13 for compatibility.

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm desktop:dev` | Full desktop stack (Web + Render Server + Electron) |
| `pnpm dev` | React Router frontend only |
| `pnpm render:server` | Express/Remotion backend only |
| `pnpm build` | Production build |
| `pnpm preview` | Serve production build |
| `pnpm typecheck` | TypeScript type checks |
| `pnpm lint` | ESLint |

---

## Local Data Paths

| Data | Location |
|------|----------|
| Projects index | `local_data/projects.json` |
| Project states | `local_data/project_state/<project-id>.json` |
| Imported media | `out/<project-id>/` |
| Rendered output | `out/` |

Override with environment variables: `VIDERE_DATA_DIR`, `VIDERE_MEDIA_DIR`, `TIMELINE_DIR`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VIDERE_WHISPER_PYTHON` | Auto-detected (`venv/`, `.venv-whisper/`, `.venv/`, system) | Python interpreter path |
| `VIDERE_WHISPER_MODEL` | `openai/whisper-small` | Whisper model (legacy mode only) |
| `VIDERE_WHISPER_DEVICE` | `auto` | Device for legacy Whisper |
| `VIDERE_WHISPER_FFMPEG_BIN` | `ffmpeg` | FFmpeg binary path |
| `VIDERE_NPU_MODELS_DIR` | `nexa-caption-lab/models` | NPU model root directory |

---

## AI Features

### Whisper NPU Transcription
In the **Captions** tab, select a clip and click **Transcribe**. The audio is extracted via FFmpeg, processed through the Whisper Small model on the Snapdragon NPU, and word-level timestamps are returned. Each word gets its own start/end time via quantized distribution across segments.

### Transcript Analysis
After transcribing, click **Analyze** to detect:
- **Filler words** — "um", "uh", "basically", "like", etc.
- **Retakes** — "let me start over", "scratch that", etc.
- **Long pauses** — Gaps ≥1.5s suggesting natural cut points
- **Repeated phrases** — Stutters or restarts

Results appear in a modal with timestamps for each suggestion.

### First Run Behavior
The first transcription downloads model weights (~500MB for Whisper Small NPU) and takes longer than subsequent runs. After the initial download, everything runs fully offline.

---

## Python Labs

These standalone research tools are included but not integrated into the Electron UI:
- `nexa-caption-lab/` — Whisper NPU transcription library
- `nexa-video-context-lab/` — VLM-based scene analysis and timestamp matching

---

## Notes

- No login or account setup required
- All media stays on local disk
- Storage views report local disk usage
- The app auto-detects `venv/`, `.venv-whisper/`, or `.venv/` Python environments
