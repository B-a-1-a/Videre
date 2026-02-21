import { useCallback } from "react";
import type { Clip, Track, MediaAsset } from "../../types/domain";
import { TimelineClip } from "./TimelineClip";
import { TRACK_HEIGHT_PX, TRACK_HEADER_WIDTH_PX } from "./constants";
import { pxToMs, snapMs } from "./utils";

interface TimelineTrackProps {
  track: Track;
  clips: Clip[];
  assets: MediaAsset[];
  zoomPxPerSec: number;
  totalWidth: number;
  isSelected: boolean;
  selectedClipId: string | undefined;
  onSelectTrack: (trackId: string) => void;
  onSelectClip: (clipId: string) => void;
  onClipDragStart: (e: React.MouseEvent, clip: Clip, type: "move" | "trim-left" | "trim-right") => void;
  onLaneClick: (trackId: string, ms: number) => void;
}

export function TimelineTrack({
  track,
  clips,
  assets,
  zoomPxPerSec,
  totalWidth,
  isSelected,
  selectedClipId,
  onSelectTrack,
  onSelectClip,
  onClipDragStart,
  onLaneClick,
}: TimelineTrackProps) {
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
      </div>
      <div
        className="track-lane"
        style={{ width: totalWidth, height: TRACK_HEIGHT_PX }}
        onMouseDown={handleLaneClick}
      >
        {clips.map((clip) => {
          const asset = assets.find((a) => a.id === clip.assetId);
          return (
            <TimelineClip
              key={clip.id}
              clip={clip}
              asset={asset}
              zoomPxPerSec={zoomPxPerSec}
              isSelected={clip.id === selectedClipId}
              onSelect={onSelectClip}
              onDragStart={onClipDragStart}
            />
          );
        })}
      </div>
    </div>
  );
}
