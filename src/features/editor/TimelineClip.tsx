import { useCallback } from "react";
import type { Clip, MediaAsset } from "../../types/domain";
import { msToPx } from "./utils";

interface TimelineClipProps {
  clip: Clip;
  asset: MediaAsset | undefined;
  zoomPxPerSec: number;
  isSelected: boolean;
  onSelect: (clipId: string) => void;
  onDragStart: (e: React.MouseEvent, clip: Clip, type: "move" | "trim-left" | "trim-right") => void;
}

function clipColorClass(kind: string | undefined): string {
  switch (kind) {
    case "video": return "clip-video";
    case "audio": return "clip-audio";
    case "image": return "clip-image";
    default: return "clip-video";
  }
}

export function TimelineClip({ clip, asset, zoomPxPerSec, isSelected, onSelect, onDragStart }: TimelineClipProps) {
  const clipDurationMs = clip.sourceOutMs - clip.sourceInMs;
  const left = msToPx(clip.timelineStartMs, zoomPxPerSec);
  const width = Math.max(8, msToPx(clipDurationMs, zoomPxPerSec));

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(clip.id);
      onDragStart(e, clip, "move");
    },
    [clip, onSelect, onDragStart],
  );

  const handleTrimLeftDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(clip.id);
      onDragStart(e, clip, "trim-left");
    },
    [clip, onSelect, onDragStart],
  );

  const handleTrimRightDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(clip.id);
      onDragStart(e, clip, "trim-right");
    },
    [clip, onSelect, onDragStart],
  );

  const className = [
    "timeline-clip",
    clipColorClass(asset?.kind),
    isSelected ? "selected" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={className}
      style={{ left, width }}
      onMouseDown={handleMouseDown}
    >
      <div className="clip-trim-handle clip-trim-left" onMouseDown={handleTrimLeftDown} />
      <div className="clip-body">
        <span className="clip-label">{asset?.fileName ?? "?"}</span>
      </div>
      <div className="clip-trim-handle clip-trim-right" onMouseDown={handleTrimRightDown} />
    </div>
  );
}
