import { useCallback, useMemo } from "react";
import { RULER_HEIGHT_PX } from "./constants";
import { msToPx, pxToMs, snapMs } from "./utils";

interface TimelineRulerProps {
  durationMs: number;
  zoomPxPerSec: number;
  scrollLeft: number;
  visibleWidth: number;
  playheadMs: number;
  onScrubMs: (ms: number) => void;
}

function getRulerSteps(zoomPxPerSec: number): { majorMs: number; minorMs: number } {
  if (zoomPxPerSec >= 450) return { majorMs: 250, minorMs: 50 };
  if (zoomPxPerSec >= 280) return { majorMs: 500, minorMs: 100 };
  if (zoomPxPerSec >= 140) return { majorMs: 1000, minorMs: 250 };
  if (zoomPxPerSec >= 80) return { majorMs: 2000, minorMs: 500 };
  if (zoomPxPerSec >= 45) return { majorMs: 5000, minorMs: 1000 };
  return { majorMs: 10000, minorMs: 2000 };
}

function formatRulerLabel(ms: number, majorMs: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);

  if (majorMs < 1000) {
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function TimelineRuler({
  durationMs,
  zoomPxPerSec,
  scrollLeft,
  visibleWidth,
  playheadMs,
  onScrubMs,
}: TimelineRulerProps) {
  const totalWidth = msToPx(durationMs, zoomPxPerSec) + visibleWidth;
  const { majorMs, minorMs } = getRulerSteps(zoomPxPerSec);

  const ticks = useMemo(() => {
    const startMs = Math.max(0, Math.floor(pxToMs(scrollLeft, zoomPxPerSec) / minorMs) * minorMs);
    const endMs = pxToMs(scrollLeft + visibleWidth, zoomPxPerSec) + minorMs * 3;

    const nextTicks: Array<{ ms: number; px: number; major: boolean }> = [];
    for (let ms = startMs; ms <= endMs && ms <= durationMs + majorMs * 2; ms += minorMs) {
      const isMajor = ms % majorMs === 0;
      nextTicks.push({ ms, px: msToPx(ms, zoomPxPerSec), major: isMajor });
    }
    return nextTicks;
  }, [durationMs, majorMs, minorMs, scrollLeft, visibleWidth, zoomPxPerSec]);

  const scrubToClientX = useCallback(
    (clientX: number, rect: DOMRect) => {
      const x = clientX - rect.left + scrollLeft;
      const ms = snapMs(pxToMs(x, zoomPxPerSec));
      onScrubMs(Math.max(0, Math.min(ms, durationMs)));
    },
    [durationMs, onScrubMs, scrollLeft, zoomPxPerSec],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      scrubToClientX(e.clientX, rect);

      const onMouseMove = (moveEvent: MouseEvent) => {
        scrubToClientX(moveEvent.clientX, rect);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [scrubToClientX],
  );

  return (
    <div
      className="timeline-ruler"
      style={{ height: RULER_HEIGHT_PX, width: totalWidth }}
      onMouseDown={handleMouseDown}
    >
      {ticks.map((tick) => (
        <div
          key={tick.ms}
          className={`ruler-tick ${tick.major ? "major" : "minor"}`}
          style={{ left: tick.px }}
        >
          {tick.major && (
            <span className="ruler-tick-label">{formatRulerLabel(tick.ms, majorMs)}</span>
          )}
        </div>
      ))}

      <div
        className="timeline-ruler-playhead"
        style={{ left: msToPx(playheadMs, zoomPxPerSec) }}
      />
    </div>
  );
}
