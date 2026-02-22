import { useCallback } from "react";
import type { Clip, MediaAsset, TextOverlay } from "../../types/domain";
import { msToPx } from "./utils";

interface TimelineClipProps {
  clip: Clip;
  asset: MediaAsset | undefined;
  textOverlay?: TextOverlay;
  zoomPxPerSec: number;
  isSelected: boolean;
  onSelect: (clipId: string, additive: boolean) => void;
  onDragStart: (e: React.MouseEvent, clip: Clip, type: "move" | "trim-left" | "trim-right") => void;
  onContextMenu?: (e: React.MouseEvent, clip: Clip) => void;
}

function clipColorClass(kind: string | undefined, isText: boolean): string {
  if (isText) return "clip-text";
  switch (kind) {
    case "video": return "clip-video";
    case "audio": return "clip-audio";
    case "image": return "clip-image";
    default: return "clip-video";
  }
}

export function TimelineClip({ clip, asset, textOverlay, zoomPxPerSec, isSelected, onSelect, onDragStart, onContextMenu }: TimelineClipProps) {
  const isTextClip = clip.assetId === "__text__";
  const clipDurationMs = clip.sourceOutMs - clip.sourceInMs;
  const left = msToPx(clip.timelineStartMs, zoomPxPerSec);
  const width = Math.max(8, msToPx(clipDurationMs, zoomPxPerSec));

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const additive = e.ctrlKey || e.metaKey;
      onSelect(clip.id, additive);
      if (!additive) {
        onDragStart(e, clip, "move");
      }
    },
    [clip, onSelect, onDragStart],
  );

  const handleTrimLeftDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(clip.id, false);
      onDragStart(e, clip, "trim-left");
    },
    [clip, onSelect, onDragStart],
  );

  const handleTrimRightDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(clip.id, false);
      onDragStart(e, clip, "trim-right");
    },
    [clip, onSelect, onDragStart],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu?.(e, clip);
    },
    [clip, onContextMenu],
  );

  const className = [
    "timeline-clip",
    clipColorClass(asset?.kind, isTextClip),
    isSelected ? "selected" : "",
  ].filter(Boolean).join(" ");

  const label = isTextClip
    ? (textOverlay?.content ?? "Text")
    : (asset?.fileName ?? "?");

  return (
    <div
      className={className}
      style={{ left, width }}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      <div className="clip-trim-handle clip-trim-left" onMouseDown={handleTrimLeftDown} />
      <div className="clip-body">
        <span className="clip-label">{label}</span>
      </div>
      <div className="clip-trim-handle clip-trim-right" onMouseDown={handleTrimRightDown} />
    </div>
  );
}
