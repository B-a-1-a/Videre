import { useCallback, useState } from "react";
import type { AssetKind, Clip, Track, MediaAsset, TextOverlay, Transition } from "../../types/domain";
import { TimelineClip } from "./TimelineClip";
import { TRACK_HEIGHT_PX, TRACK_HEADER_WIDTH_PX } from "./constants";
import { msToPx, pxToMs, snapMs } from "./utils";

interface TimelineTrackProps {
  track: Track;
  clips: Clip[];
  assets: MediaAsset[];
  textOverlays: TextOverlay[];
  transitions: Transition[];
  zoomPxPerSec: number;
  totalWidth: number;
  isSelected: boolean;
  selectedClipIds: string[];
  onSelectTrack: (trackId: string) => void;
  onSelectClip: (clipId: string, additive: boolean) => void;
  onClipContextMenu: (e: React.MouseEvent, clip: Clip) => void;
  onDeleteTrack: (trackId: string) => void;
  onClipDragStart: (e: React.MouseEvent, clip: Clip, type: "move" | "trim-left" | "trim-right") => void;
  onLaneClick: (trackId: string, ms: number) => void;
  onDropAsset: (trackId: string, ms: number, assetId: string) => void;
}

export function TimelineTrack({
  track,
  clips,
  assets,
  textOverlays,
  transitions,
  zoomPxPerSec,
  totalWidth,
  isSelected,
  selectedClipIds,
  onSelectTrack,
  onSelectClip,
  onClipContextMenu,
  onDeleteTrack,
  onClipDragStart,
  onLaneClick,
  onDropAsset,
}: TimelineTrackProps) {
  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleLaneClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only handle clicks on the lane itself, not on clips
      if (e.target !== e.currentTarget) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ms = snapMs(pxToMs(x, zoomPxPerSec));
      onSelectTrack(track.id);
      onLaneClick(track.id, Math.max(0, ms));
    },
    [track.id, zoomPxPerSec, onSelectTrack, onLaneClick],
  );

  const extractDropAsset = useCallback((event: React.DragEvent<HTMLDivElement>): { assetId: string; assetKind?: AssetKind } | null => {
    const raw = event.dataTransfer.getData("application/x-videre-asset");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { assetId?: string; assetKind?: AssetKind };
      if (!parsed.assetId) return null;
      return { assetId: parsed.assetId, assetKind: parsed.assetKind };
    } catch {
      return null;
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDropTarget(false);
      const payload = extractDropAsset(event);
      if (!payload) return;

      const acceptsAsset = track.kind === "audio"
        ? payload.assetKind === "audio"
        : payload.assetKind === "video" || payload.assetKind === "image";
      if (!acceptsAsset) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const ms = snapMs(pxToMs(Math.max(0, x), zoomPxPerSec));
      onSelectTrack(track.id);
      onLaneClick(track.id, Math.max(0, ms));
      onDropAsset(track.id, Math.max(0, ms), payload.assetId);
    },
    [extractDropAsset, onDropAsset, onLaneClick, onSelectTrack, track.id, track.kind, zoomPxPerSec],
  );

  const kindIcon = track.kind === "audio" ? "♪" : "▶";

  return (
    <div className={`track-row${isSelected ? " selected" : ""}`} style={{ height: TRACK_HEIGHT_PX }}>
      <div
        className="track-header"
        style={{ width: TRACK_HEADER_WIDTH_PX }}
        onClick={() => onSelectTrack(track.id)}
      >
        <span className="track-kind-icon">{kindIcon}</span>
        <span className="track-name">{track.name}</span>
        <span className="track-header-spacer" />
        <button
          className="track-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteTrack(track.id);
          }}
          aria-label={`Delete ${track.name}`}
          title={`Delete ${track.name}`}
          type="button"
        >
          ×
        </button>
      </div>
      <div
        className={`track-lane${isDropTarget ? " drop-target" : ""}`}
        style={{ width: totalWidth, height: TRACK_HEIGHT_PX }}
        onMouseDown={handleLaneClick}
        onDragOver={(event) => {
          const payload = extractDropAsset(event);
          if (!payload) return;
          const acceptsAsset = track.kind === "audio"
            ? payload.assetKind === "audio"
            : payload.assetKind === "video" || payload.assetKind === "image";
          if (!acceptsAsset) return;
          event.preventDefault();
          setIsDropTarget(true);
        }}
        onDragLeave={() => setIsDropTarget(false)}
        onDrop={handleDrop}
      >
        {clips.map((clip) => {
          const asset = clip.assetId === "__text__" ? undefined : assets.find((a) => a.id === clip.assetId);
          const overlay = textOverlays.find((o) => o.clipId === clip.id);
          return (
            <TimelineClip
              key={clip.id}
              clip={clip}
              asset={asset}
              textOverlay={overlay}
              zoomPxPerSec={zoomPxPerSec}
              isSelected={selectedClipIds.includes(clip.id)}
              onSelect={onSelectClip}
              onDragStart={onClipDragStart}
              onContextMenu={onClipContextMenu}
            />
          );
        })}

        {/* Transition indicators */}
        {transitions.map((t) => {
          const fromClip = clips.find((c) => c.id === t.fromClipId);
          if (!fromClip) return null;
          const fromEnd = fromClip.timelineStartMs + (fromClip.sourceOutMs - fromClip.sourceInMs);
          const left = msToPx(fromEnd, zoomPxPerSec);
          return (
            <div
              key={t.id}
              className="transition-indicator"
              style={{ left: left - 8 }}
              title={`${t.transitionType} (${t.durationMs}ms)`}
            >
              ◆
            </div>
          );
        })}
      </div>
    </div>
  );
}
