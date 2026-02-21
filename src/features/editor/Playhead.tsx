import { useCallback } from "react";
import { msToPx } from "./utils";
import { RULER_HEIGHT_PX } from "./constants";

interface PlayheadProps {
  playheadMs: number;
  zoomPxPerSec: number;
  height: number;
  onScrubStart: (e: React.MouseEvent) => void;
}

export function Playhead({ playheadMs, zoomPxPerSec, height, onScrubStart }: PlayheadProps) {
  const left = msToPx(playheadMs, zoomPxPerSec);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onScrubStart(e);
    },
    [onScrubStart],
  );

  return (
    <div className="playhead" style={{ left, height }}>
      <div
        className="playhead-handle"
        style={{ top: 0, height: RULER_HEIGHT_PX }}
        onMouseDown={handleMouseDown}
      />
      <div className="playhead-line" />
    </div>
  );
}
