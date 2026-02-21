import { SNAP_MS } from "./constants";

export function msToPx(ms: number, zoomPxPerSec: number): number {
  return (ms / 1000) * zoomPxPerSec;
}

export function pxToMs(px: number, zoomPxPerSec: number): number {
  return (px / zoomPxPerSec) * 1000;
}

export function snapMs(ms: number): number {
  return Math.round(ms / SNAP_MS) * SNAP_MS;
}

export function msToTimecode(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const f = Math.floor((totalSeconds % 1) * 10);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${f}`;
  }
  return `${m}:${String(s).padStart(2, "0")}.${f}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
