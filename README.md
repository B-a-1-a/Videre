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

### 1) Install dependencies

```bash
pnpm install
```

### 2) Optional: fetch pinned sidecar binaries

```bash
pnpm sidecars:fetch
```

This populates `src-tauri/binaries` for macOS and Windows target names expected by Tauri bundling.

### 3) Run development app

```bash
pnpm tauri dev
```

## IPC commands

- `project_create(name, location)`
- `project_open(project_root)`
- `project_save(project_id)`
- `project_list_recent()`
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

## Security notes

- Path handling is constrained to opened project roots.
- Imported media is canonicalized and copied into managed project storage.
- Render output file names are sanitized to prevent traversal.
- Tauri capability permissions are limited to defaults + dialog + opener.
