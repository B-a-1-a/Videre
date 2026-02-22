# Videre (Tauri v2)

Videre is a local-first desktop video editor built with Tauri + React + TypeScript.

## Implemented in this baseline

- Local project lifecycle:
  - Create project folders
  - Open project folders
  - Save and list recent projects
- Managed project structure:
  - `project.db`
  - `media/originals`
  - `media/proxies`
  - `media/waveforms`
  - `exports`
- Media import pipeline:
  - Copy imported files into managed storage (hash-based naming)
  - Probe metadata with FFprobe
  - Background proxy and waveform generation
- Timeline engine:
  - Multi-track model (`video` + `audio`)
  - Add/remove/reorder tracks
  - Add/move/trim/split/delete clips
- Render pipeline:
  - Background render jobs
  - MP4 output (`libx264` + `aac`, `yuv420p`)
  - Cancel render jobs
- AI scaffolding only:
  - Stub tables and `analysis_enqueue_stub` command (returns not implemented)

## Architecture

- Frontend: React + TypeScript + Zustand
- Backend: Rust + Tauri commands
- Persistence: SQLite (`rusqlite`)
- Media tooling: FFmpeg / FFprobe sidecars (with dev fallback to system binaries)

## Getting started

### Prerequisites

- Node.js `>=20.19` or `>=22.12` (Vite 7 requirement)
- `pnpm` 10+
- Rust toolchain (`rustup`, `cargo`)
- Python 3.10+ (for nexa-caption-lab and nexa-video-context-lab)

### Desktop startup (recommended)

```bash
./scripts/start-dev.sh
```

This is the recommended way to run the app locally because it follows the full Tauri desktop flow:

- Installs JS dependencies
- Fetches FFmpeg/FFprobe sidecars
- Builds frontend assets
- Starts `pnpm tauri dev`

Optional flags:

- `./scripts/start-dev.sh --all-sidecars`
- `./scripts/start-dev.sh --skip-build`

### Manual desktop startup commands

Use this if you prefer to run each step explicitly:

```bash
pnpm install
pnpm sidecars:fetch
pnpm build
pnpm tauri dev
```

To fetch sidecars for all configured targets:

```bash
pnpm sidecars:fetch -- --all
```

### Important

For full desktop behavior (filesystem dialogs, sidecars, Tauri IPC), run via `pnpm tauri dev` or `./scripts/start-dev.sh`.  
`pnpm dev` (Vite-only) does not provide the full desktop runtime.

## Production bundling

Default build target is `.app` on macOS:

```bash
pnpm tauri build
```

To explicitly request DMG packaging:

```bash
pnpm tauri build --bundles dmg
```

Note: DMG creation uses `hdiutil` and Finder automation and can fail in sandboxed/headless environments.

## IPC commands

- `project_create(name, location)`
- `project_open(project_root)`
- `project_save(project_id)`
- `project_list_recent()`
- `project_delete(project_id)`
- `media_import(project_id, source_paths)`
- `media_remove(project_id, asset_id)`
- `timeline_get(project_id)`
- `timeline_apply_patch(project_id, patch)`
- `render_start(project_id, settings)`
- `render_status(project_id, job_id)`
- `render_cancel(project_id, job_id)`
- `analysis_enqueue_stub(project_id, job_kind)`

## CI

A GitHub Actions workflow is included at `.github/workflows/ci.yml` for:

- Type checks
- Rust fmt/clippy/tests
- Cargo + npm audits
- macOS and Windows matrix runs

## Standalone Nexa Caption Lab

For isolated Python-based ASR captioning experiments (no Tauri integration), use:

- `/Users/bala/Repos/Videre/nexa-caption-lab`

See `/Users/bala/Repos/Videre/nexa-caption-lab/README.md` for setup and CLI usage.

## Standalone Nexa Video Context Lab

For isolated Python-based video context workflows with timestamp sections (`find`, `select-part`, `clip`), use:

- `/Users/bala/Repos/Videre/nexa-video-context-lab`

See `/Users/bala/Repos/Videre/nexa-video-context-lab/README.md` for setup and CLI usage.

## Security notes

- Path handling is constrained to opened project roots.
- Imported media is canonicalized and copied into managed project storage.
- Render output file names are sanitized to prevent traversal.
- Tauri capability permissions are limited to defaults + dialog + opener.
