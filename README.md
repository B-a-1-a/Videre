# Videre

Videre is a fully local Electron-based desktop video editor. It is designed to run completely offline without any cloud dependencies or authentication requirements, ensuring your media and projects remain private on your local machine.

Videre leverages advanced local AI integrations to provide intelligent features like automated transcription and transcript analysis using on-device NPUs (Neural Processing Units).

---

## 🏗️ Architecture Overview

The application consists of three main pillars:
1. **Frontend (App/UI)**: Built with React Router (`/app`). Handles the user interface, video timeline editing, and media management.
2. **Backend (Render & API Server)**: A Node.js Express server (`/app/videorender/videorender.ts`) powered by Remotion. It serves media, builds projects, handles file uploads, and spawns AI Python scripts.
3. **Desktop Wrapper**: Electron wrapper (`/electron/main.cjs`) that launches the backend server and frontend in a native application window.

---

## 🚀 Getting Started

### Prerequisites

Before running the application, ensure you have the following installed on your system:
- **Node.js**: v20 or higher
- **pnpm**: Fast, disk space efficient package manager (`npm install -g pnpm`)
- **Python**: v3.10 or higher (Required for AI transcription and analysis)
- **FFmpeg**: Must be installed and available in your system's `PATH`.

### 1. Install Node Dependencies

Clone the repository and install the standard JavaScript dependencies:

```bash
pnpm install
```

### 2. Start the Development Environment

To launch the complete application stack (Frontend, Backend, and Electron Desktop App), run:

```bash
pnpm desktop:dev
```

This single command utilizes `concurrently` to start:
- The React Router development server on `http://127.0.0.1:5173`
- The Local Remotion render/upload API server on `http://127.0.0.1:8000`
- The Electron window loading the application

> **Troubleshooting PowerShell Errors (Windows)**:
> If you encounter an error like *`pnpm.ps1 cannot be loaded because running scripts is disabled`*, you need to update your PowerShell execution policy. Run PowerShell as Administrator and execute:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

---

## 🧠 Local AI Setup (NPU & CPU)

Videre integrates on-device AI for transcribing video clips and analyzing transcripts. These require a Python virtual environment to run.

### Setup the Python Virtual Environment

From the root of the repository, create a Python virtual environment named `.venv-whisper`. *It must be named exactly this for the backend to detect it automatically.*

**Windows (PowerShell/CMD):**
```powershell
py -m venv .venv-whisper
.venv-whisper\Scripts\activate
# Install NPU-accelerated transcription lab dependencies
pip install -e ./nexa-caption-lab[npu]
```

**macOS / Linux:**
```bash
python3 -m venv .venv-whisper
source .venv-whisper/bin/activate
pip install -e ./nexa-caption-lab[npu]
```

### 1. Whisper NPU Transcription
The "Captions" tab allows you to transcribe audio from video clips. By default, it uses **Whisper on the Snapdragon NPU** (via `onnxruntime-qnn`). The first run will automatically download the required NPU model weights into `nexa-caption-lab/models/`.

*Legacy CPU/GPU testing option*: If you don't have an NPU, you can optionally install standard PyTorch/Transformers into the same virtual environment using `pip install -r app/videorender/requirements-whisper.txt`, and toggle "Use legacy Whisper" in the UI.

### 2. Llama 3.2 3B Instruct Transcript Analysis
After transcribing a clip, you can click **Analyze** in the UI to use the Llama 3.2 3B Instruct model (via Qualcomm AI Hub tools). The local LLM will detect filler words ("umms", "uhhs"), retakes, and suggest structural cuts with frame-accurate timestamps. This uses `qai-hub-models` within your Python environment.

---

## 📁 Local Data Management

All data remains stored locally. You can find your saved files and media in the root directories created during runtime:

- **Projects Index**: `local_data/projects.json`
- **Project State Files**: `local_data/project_state/<project-id>.json`
- **Imported Media Files**: `out/<project-id>/`
- **Rendered Outputs**: `out/`

*Note: You can override these paths by setting the environment variables `VIDERE_DATA_DIR`, `VIDERE_MEDIA_DIR`, or `TIMELINE_DIR`.*

---

## 🛠️ Available Scripts

Here are the granular `pnpm` scripts available in `package.json` if you wish to run components individually:

- `pnpm dev` - Starts only the React Router frontend dev server.
- `pnpm render:server` - Starts only the backend Express/Remotion API server.
- `pnpm desktop:dev` - Starts the full local desktop stack (Web + Server + Electron).
- `pnpm build` - Creates a production build of the React Router application.
- `pnpm preview` - Serves the production build locally.
- `pnpm typecheck` - Performs TypeScript type-checking.
- `pnpm lint` - Runs ESLint across the codebase.

## 🧪 Additional Python Labs

This repository also contains standalone research labs for video context analysis. These do not natively run in the Electron UI but can be executed via CLI:
- `nexa-video-context-lab/`: Scripts for building scene context, finding timestamp matches via VLMs, and exporting segments.
- `nexa-caption-lab/`: The core library interfacing with Whisper for NPU optimizations.
