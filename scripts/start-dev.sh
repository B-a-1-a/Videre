#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ALL_SIDECARS=0
SKIP_BUILD=0

usage() {
  cat <<'EOF'
Usage: scripts/start-dev.sh [options]

Bootstraps and starts the Videre Tauri desktop app:
1) Install JS dependencies
2) Fetch FFmpeg/FFprobe sidecars
3) Build frontend (TypeScript + Vite)
4) Start Tauri dev

Options:
  --all-sidecars  Fetch sidecars for all configured targets
  --skip-build    Skip the build step
  -h, --help      Show this help message
EOF
}

for arg in "$@"; do
  case "$arg" in
    --all-sidecars)
      ALL_SIDECARS=1
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but not found in PATH." >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required but not found in PATH." >&2
  exit 1
fi

echo "[1/4] Installing dependencies..."
pnpm install

echo "[2/4] Fetching sidecar binaries..."
if [[ "$ALL_SIDECARS" -eq 1 ]]; then
  pnpm sidecars:fetch -- --all
else
  pnpm sidecars:fetch
fi

if [[ "$SKIP_BUILD" -eq 1 ]]; then
  echo "[3/4] Skipping build (--skip-build)."
else
  echo "[3/4] Building frontend..."
  pnpm build
fi

echo "[4/4] Starting Tauri desktop dev app..."
exec pnpm tauri dev
