import { useCallback } from "react";
import { RULER_HEIGHT_PX } from "./constants";
import { msToPx, pxToMs, snapMs, msToTimecode } from "./utils";

interface TimelineRulerProps {
  durationMs: number;
  zoomPxPerSec: number;
  scrollLeft: number;
  visibleWidth: number;
  onClickMs: (ms: number) => void;
}

function getTickInterval(zoomPxPerSec: number): number {
  if (zoomPxPerSec > 150) return 500;
  if (zoomPxPerSec > 60) return 1000;
  if (zoomPxPerSec > 30) return 5000;
  return 10000;
}

export function TimelineRuler({ durationMs, zoomPxPerSec, scrollLeft, visibleWidth, onClickMs }: TimelineRulerProps) {
  const totalWidth = msToPx(durationMs, zoomPxPerSec) + visibleWidth;
  const tickIntervalMs = getTickInterval(zoomPxPerSec);

  // Only render ticks visible in the viewport
  const startMs = Math.max(0, Math.floor(pxToMs(scrollLeft, zoomPxPerSec) / tickIntervalMs) * tickIntervalMs);
  const endMs = pxToMs(scrollLeft + visibleWidth, zoomPxPerSec) + tickIntervalMs;

  const ticks: { ms: number; px: number }[] = [];
  for (let ms = startMs; ms <= endMs && ms <= durationMs + tickIntervalMs * 2; ms += tickIntervalMs) {
    ticks.push({ ms, px: msToPx(ms, zoomPxPerSec) });
  }

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollLeft;
      const ms = snapMs(pxToMs(x, zoomPxPerSec));
      onClickMs(Math.max(0, ms));
    },
    [scrollLeft, zoomPxPerSec, onClickMs],
  );

  return (
    <div
      className="timeline-ruler"
      style={{ height: RULER_HEIGHT_PX, width: totalWidth }}
      onClick={handleClick}
    >
      {ticks.map((tick) => (
        <div
          key={tick.ms}
          className="ruler-tick"
          style={{ left: tick.px }}
        >
          <span className="ruler-tick-label">{msToTimecode(tick.ms)}</span>
        </div>
      ))}
    </div>
  );
}
