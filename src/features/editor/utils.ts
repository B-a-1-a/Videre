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

export function msToClockTimecode(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function parseTimecodeToMs(input: string, fps = 30): number | null {
  const value = input.trim();
  if (!value) return null;

  if (/^\d+f$/i.test(value)) {
    const frame = Number(value.slice(0, -1));
    if (!Number.isFinite(frame) || frame < 0) return null;
    return Math.round((frame / fps) * 1000);
  }

  if (value.includes(":")) {
    const parts = value.split(":");
    if (parts.length === 2 || parts.length === 3) {
      const [hPart, mPart, sPart] = parts.length === 3 ? parts : ["0", parts[0], parts[1]];
      const hours = Number(hPart);
      const minutes = Number(mPart);
      const seconds = Number(sPart);
      if ([hours, minutes, seconds].some((part) => !Number.isFinite(part) || part < 0)) {
        return null;
      }
      return Math.round(((hours * 3600) + (minutes * 60) + seconds) * 1000);
    }
  }

  const plainSeconds = Number(value);
  if (!Number.isFinite(plainSeconds) || plainSeconds < 0) return null;
  return Math.round(plainSeconds * 1000);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
