#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ALL_SIDECARS=0
SKIP_BUILD=0
DEV_PORT=1420

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

warn_if_unsupported_node() {
  local node_version major minor
  node_version="$(node -p "process.versions.node" 2>/dev/null || true)"
  if [[ -z "$node_version" ]]; then
    return
  fi

  IFS='.' read -r major minor _ <<<"$node_version"
  if [[ -z "$major" || -z "$minor" ]]; then
    return
  fi

  # Vite 7 requires Node >=20.19 or >=22.12.
  if (( major < 20 )) || \
     (( major == 20 && minor < 19 )) || \
     (( major == 21 )) || \
     (( major == 22 && minor < 12 )); then
    echo "Warning: Node.js ${node_version} does not meet Vite's supported range (>=20.19.0 or >=22.12.0)." >&2
    echo "The dev server may fail unpredictably. Consider upgrading Node before continuing." >&2
  fi
}

ensure_dev_port_free() {
  local pids pid cmd killed_any=0

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  pids="$(lsof -tiTCP:${DEV_PORT} -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  for pid in $pids; do
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$cmd" == *"${ROOT_DIR}"*"/vite/bin/vite.js"* ]]; then
      echo "Port ${DEV_PORT} is occupied by an existing Videre Vite process (PID ${pid}); stopping it..."
      kill "$pid" || true
      killed_any=1
      continue
    fi

    echo "Port ${DEV_PORT} is already in use by PID ${pid}: ${cmd}" >&2
    echo "Stop that process and re-run this script. Tauri expects http://localhost:${DEV_PORT}." >&2
    exit 1
  done

  if (( killed_any == 1 )); then
    sleep 1
  fi

  if lsof -tiTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port ${DEV_PORT} is still in use after cleanup. Stop the listener and try again." >&2
    exit 1
  fi
}

warn_if_unsupported_node
ensure_dev_port_free

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
